import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { capabilityLevelForStackChoice, checklistForRequest, detectStackProfile, isLikelySmallSingleFileRequest, isLikelyTinyOperationalRequest, unsupportedCreationMessage, unsupportedEditingMessage, type StackCapabilityLevel, type StackProfile } from "@/lib/factory/language-adapters";
import { classifyIntent, deterministicMutationIntent } from "@/lib/ai/mission/intent-classifier";
import { runReadOnlyInspection } from "@/lib/ai/mission/inspector";
import { isHighRiskArchitectureRequest, isMultiPartRequest, planMission } from "@/lib/ai/mission/mission-planner";
import { runMissionExecutor } from "@/lib/ai/mission/executor";
import { reviewArchitecture } from "@/lib/ai/mission/architecture-review";
import { verifyMissionResult } from "@/lib/ai/mission/mission-verifier";
import { assessMissionComplexity, shouldRunArchitectureReview, shouldRunVerify, tierForStage } from "@/lib/ai/mission/orchestration";
import { DEFAULT_MISSION_QUALITY, type MissionQualityLevel } from "@/lib/ai/mission/quality-level";
import type { ProviderId } from "@/lib/ai/providers/types";
import { providerForTier } from "@/lib/ai/providers/dispatch";
import { tierForRuntimePayload, type ModelMode, type ModelTier } from "@/lib/ai/model-router";
import { createLocalConnectorProjectAccess, createServerProjectAccess, type LocalConnectorConfig, type ProjectAccess } from "@/lib/ai/mission/project-access";
import type { ExecutionMissionVerification, FactoryCommandEvent, FactoryExecutionEvent, FactoryExecutionEventKind, FactoryExecutionEventStatus, FactoryExistingProjectRequest, FactoryFileEntry, FactoryJournalEntry, FactoryNarrativeObject, FactoryObjectiveChecklistItem, FactoryPreviewPlatform, FactoryPreviewState, FactoryProjectResult, FactorySessionSummary, FactorySourceMode, FactoryUploadedFile, MissionClarification, MissionParentContext, StructuredDiscovery } from "@/lib/factory/types";

type ApprovalResponse = FactoryExistingProjectRequest["approvalResponse"];

function modelForMissionStage(task: string, mode: ModelMode | undefined, stageTier: ModelTier) {
  const tier = mode && mode !== "auto" ? mode : tierForRuntimePayload({ task }, stageTier);
  const selected = providerForTier(tier);
  return selected ? { ...selected, tier } : undefined;
}

type ProjectSpec = {
  projectName: string;
  template: string;
  stack: string;
  projectType: string;
  projectDescription: string;
  projectSource: string;
  selectedUploadPaths: string[];
  existingSourceGuard: string;
  instructions: string;
  slug: string;
};

const projectsRoot = path.join(process.cwd(), "projects");
const previewProcesses = new Map<string, { port: number; processId?: number; lastUsedAt: number }>();
const desktopPreviewTargets = new Map<string, string>();
const journalsRoot = path.join(process.cwd(), ".foundry-data", "journals");
type ExecutionEmitter = (event: FactoryExecutionEvent) => void | Promise<void>;

type ExecutionContext = {
  timeline: FactoryExecutionEvent[];
  emit: ExecutionEmitter;
  checklist: FactoryObjectiveChecklistItem[];
  projectId?: string;
};

const NON_EDIT_INTENT_PATTERN =
  /\b(can you see|what does|what is this|explain|tell me about|do you understand|undo|revert|roll back|rollback|deploy|production|release|ship it|hosting|review|audit|analy[sz]e|architecture assessment|status|what happened|last run|previous run)\b/i;

function looksUnambiguouslyLikeSmallEdit(task: string): boolean {
  if (deterministicMutationIntent(task) === "edit") return isLikelySmallSingleFileRequest(task);
  if (NON_EDIT_INTENT_PATTERN.test(task)) return false;
  return isLikelySmallSingleFileRequest(task);
}

function journalPathFor(projectId: string) {
  const cleanId = projectId.replace(/[^a-zA-Z0-9-]/g, "_") || "project";
  return path.join(journalsRoot, cleanId, "journal.ndjson");
}

async function appendJournalEntry(projectId: string, event: FactoryExecutionEvent) {
  const entry: FactoryJournalEntry = {
    id: `journal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    projectId,
    timestamp: event.timestamp,
    event,
    beforeContent: event.beforeContent,
  };
  const filePath = journalPathFor(projectId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function readJournal(projectId: string): Promise<FactoryJournalEntry[]> {
  const filePath = journalPathFor(projectId);
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as FactoryJournalEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is FactoryJournalEntry => entry !== null);
}

async function writeJournal(projectId: string, entries: FactoryJournalEntry[]) {
  const filePath = journalPathFor(projectId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(filePath, entries.length ? `${body}\n` : "", "utf8");
}

export async function createFactoryProject(brief: string, onEvent?: ExecutionEmitter, discovery?: StructuredDiscovery, modelMode: ModelMode = "auto"): Promise<FactoryProjectResult> {
  const spec = parseBrief(brief);
  const projectPath = await uniqueProjectPath(spec.slug);
  const projectId = path.basename(projectPath);
  const events: string[] = [];
  const commands: FactoryCommandEvent[] = [];
  const execution = createExecutionContext(onEvent, projectId);
  initializeObjectiveChecklist(execution, spec.instructions || `Create ${spec.projectName}`, "new-project");
  const sourceInspection = inspectExistingSourceSelection(spec);

  await emitExecution(execution, "planning", "running", "Planning project", {
    details: { projectName: spec.projectName, stack: spec.stack, template: spec.template },
  });
  await emitExecution(execution, "planning", "completed", "Architecture selected", {
    details: { stack: spec.stack, projectType: spec.projectType },
  });
  completeChecklistItem(execution, "understand-goal", "completed", `Selected ${spec.stack} for ${spec.projectType}.`);

  if (sourceInspection) {
    events.push(sourceInspection);
    events.push("Existing source is read/reference-only. Foundry will not write generated files into the selected root.");
    await emitExecution(execution, "inspection", sourceInspection.includes("appears") ? "warning" : "completed", "Inspected existing source", {
      details: {
        result: sourceInspection,
        writePolicy: "Reference-only. Generated files stay inside Foundry workspace.",
      },
    });
  }

  await emitExecution(execution, "folder", "running", "Creating project folder", { details: { path: projectPath } });
  await mkdir(projectPath, { recursive: true });
  events.push(`Created project folder: ${projectPath}`);
  await emitExecution(execution, "folder", "completed", `Created ${path.basename(projectPath)}`, { filePath: projectPath, details: { path: projectPath } });

  const briefPath = path.join(projectPath, "foundry-brief.md");
  await writeFile(briefPath, brief, "utf8");
  events.push("Created file: foundry-brief.md");
  await emitExecution(execution, "file", "completed", "Created foundry-brief.md", {
    fileName: "foundry-brief.md",
    filePath: "foundry-brief.md",
    details: { reason: "Saved the build brief that drives this project execution.", linesAdded: lineCount(brief) },
  });

  const stackProfile = capabilityLevelForStackChoice(spec.stack);
  await emitExecution(execution, "inspection", "completed", "Detected requested stack", {
    internal: true,
    details: { stack: stackProfile.label, capabilityLevel: stackProfile.level },
  });

  if (stackProfile.level === 1) {
    const message = unsupportedCreationMessage(stackProfile);
    await emitExecution(execution, "summary", "warning", `${stackProfile.label} creation not yet supported`, {
      output: message,
      details: { stack: stackProfile.label, capabilityLevel: stackProfile.level },
    });
    finishObjectiveChecklist(execution, "unsupported", message);
    const files = await listProjectFiles(projectPath);
    return {
      projectId,
      projectName: spec.projectName,
      projectPath,
      briefPath,
      stack: stackProfile.label,
      template: spec.template,
      sourceMode: "new-project",
      objective: `Create ${spec.projectName}`,
      checklist: execution.checklist,
      status: "unsupported",
      supported: false,
      blocker: message,
      events: [...events, message],
      files,
      commands,
      timeline: execution.timeline,
    };
  }

  const initialModel = modelForMissionStage(brief, modelMode, "builder");
  const apiKey = initialModel?.apiKey;
  if (!apiKey) {
    const blocker = "No configured AI provider is available. Add OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY.";
    await emitExecution(execution, "summary", "error", "Mission blocked", { details: { blocker } });
    finishObjectiveChecklist(execution, "failed", blocker);
    const files = await listProjectFiles(projectPath);
    return {
      projectId, projectName: spec.projectName, projectPath, briefPath, stack: stackProfile.label, template: spec.template,
      sourceMode: "new-project", objective: `Create ${spec.projectName}`, checklist: execution.checklist,
      status: "failed", supported: true, blocker, events: [...events, blocker], files, commands, timeline: execution.timeline,
    };
  }

  const primaryIdea = spec.projectDescription.trim() || spec.projectType.trim() || spec.template.trim() || "a small web app";
  const objective = discovery
    ? `Create a new ${stackProfile.label} project: ${discovery.projectType}`
    : `Create a new ${stackProfile.label} project: ${primaryIdea}`;
  // When a Decision Memo exists, build the executor's real working context directly from its typed
  // fields instead of the single-line primaryIdea fragment above — otherwise everything the user
  // reviewed (architecture, features, data model, key facts) never reaches the executor at all,
  // even though it was written to foundry-brief.md. See StructuredDiscovery's doc comment.
  const task = discovery
    ? [
        `Build: ${discovery.projectType}.`,
        `Architecture: ${discovery.architecture}`,
        discovery.mainFeatures.length ? `Main features:\n${discovery.mainFeatures.map((item) => `- ${item}`).join("\n")}` : "",
        discovery.dataModel.length ? `Data model: ${discovery.dataModel.join(", ")}` : "",
        discovery.styleDirection ? `Style direction: ${discovery.styleDirection}` : "",
        discovery.keyFacts.length ? `Key facts:\n${discovery.keyFacts.map((item) => `- ${item}`).join("\n")}` : "",
        discovery.decisions.length ? `Decisions already made — do not re-litigate these:\n${discovery.decisions.map((item) => `- ${item.dimension}: ${item.hypothesis} (${item.rationale})`).join("\n")}` : "",
        spec.instructions ? `Additional instructions — these override or extend the above if they conflict with it: ${spec.instructions}` : "",
      ].filter(Boolean).join("\n\n")
    : [
        `Build: ${primaryIdea}.`,
        spec.instructions ? `Additional instructions — these override or extend the above if they conflict with it: ${spec.instructions}` : "",
      ].filter(Boolean).join("\n");

  const rawAccess = createServerProjectAccess(projectPath, "local-folder");
  const access = accessForCapabilityLevel(rawAccess, stackProfile.level);
  completeChecklistItem(execution, "read-project", "completed", "New, empty project folder — nothing to read before scaffolding.");

  const emitEvent = (event: FactoryExecutionEvent) => execution.emit(event);
  await emitExecution(execution, "planning", "running", "Planning the project structure", { internal: true });
  const planModel = modelForMissionStage(task, modelMode, "builder") ?? initialModel!;
  const plan = await planMission({ objective, task, projectSnapshot: "(empty folder — this is a brand new project)", apiKey: planModel.apiKey, provider: planModel.provider, tier: planModel.tier, canRunCommands: access.capabilities.canRunCommands });
  if (plan.conflicts.length) {
    execution.checklist.splice(0, execution.checklist.length, ...execution.checklist.filter((item) => item.id !== "read-project"), ...plan.checklist);
    const paused = await pauseForPlanConflicts(execution, plan.conflicts);
    const files = await listProjectFiles(projectPath);
    return {
      projectId, projectName: spec.projectName, projectPath, briefPath, stack: stackProfile.label, template: spec.template,
      sourceMode: "new-project", objective, checklist: execution.checklist, status: paused.status, supported: true,
      blocker: paused.blocker, clarificationQuestions: paused.clarificationQuestions, events: [...events, paused.blocker], files, commands, timeline: execution.timeline,
    };
  }
  const checklist = plan.checklist;
  execution.checklist.splice(0, execution.checklist.length, ...execution.checklist.filter((item) => item.id !== "read-project"), ...checklist);
  await emitExecution(execution, "planning", "completed", "Checklist ready", { internal: true, details: { checklistJson: JSON.stringify(checklist) } });

  // A larger build with a live-previewable stack gets a "build the mock first" checkpoint after the
  // first checklist phase, rather than running the whole thing unseen — see offerMockGate in executor.ts.
  const distinctPhases = new Set(checklist.map((item) => item.phase).filter(Boolean)).size;
  const offerMockGate = distinctPhases >= 2 && hasLivePreviewFor(stackProfile.label);

  const implementationModel = modelForMissionStage(task, modelMode, "builder") ?? initialModel!;
  const result = await runMissionExecutor({
    objective,
    task,
    checklist,
    access,
    apiKey: implementationModel.apiKey,
    provider: implementationModel.provider,
    tier: implementationModel.tier,
    onEvent: emitEvent,
    approvedCategories: ["dependencies", "package-runner"],
    offerMockGate,
    hasBuildTooling: stackHasBuildStep(stackProfile.id),
  });

  execution.checklist.splice(0, execution.checklist.length, ...result.checklist);
  completeChecklistItem(execution, "files-on-disk", result.changedFiles.length ? "completed" : "blocked", result.changedFiles.length ? `Wrote ${result.changedFiles.length} file(s) to ${projectPath}.` : "No files were written.");

  const status: FactoryProjectResult["status"] =
    result.status === "passed" ? "passed" : result.status === "awaiting-approval" ? "awaiting-approval" : result.status === "awaiting-mock-approval" ? "awaiting-mock-approval" : "failed";
  const blocker = result.status === "passed" ? undefined : result.blocker;
  const mockGateReached = status === "awaiting-mock-approval";

  const preview = status === "passed" || mockGateReached ? await startPreview(projectId, projectPath, stackProfile.label, events, execution) : undefined;
  const files = await listProjectFiles(projectPath);
  completeChecklistItem(
    execution,
    "references-checked",
    status === "passed" || mockGateReached ? "completed" : "blocked",
    status === "passed" || mockGateReached ? "Verified via the mission executor." : blocker,
  );
  finishObjectiveChecklist(execution, status, blocker);
  await emitExecution(
    execution,
    "summary",
    status === "passed" ? "completed" : mockGateReached ? "completed" : "error",
    status === "passed" ? "Behavior verified" : mockGateReached ? "First working mock ready for review" : "Execution finished with blocker",
    { details: { files: files.length, previewUrl: preview?.previewUrl } },
  );

  return {
    projectId,
    projectName: spec.projectName,
    projectPath,
    briefPath,
    stack: stackProfile.label,
    template: spec.template,
    sourceMode: "new-project",
    objective,
    checklist: execution.checklist,
    status,
    supported: true,
    blocker,
    events,
    files,
    commands,
    previewUrl: preview?.previewUrl,
    previewState: preview?.previewState,
    previewPlatform: preview?.previewPlatform,
    previewReason: preview?.previewReason,
    exportUrl: `/api/factory/export?projectId=${encodeURIComponent(projectId)}`,
    timeline: execution.timeline,
    sessionSummary: result.sessionSummary,
    verification: result.verification,
  };
}

export async function executeExistingProjectTask(
  brief: string,
  task: string,
  uploadedFiles: FactoryUploadedFile[],
  localPathOrEmitter?: string | ExecutionEmitter,
  maybeEmitter?: ExecutionEmitter,
  localConnector?: LocalConnectorConfig,
  signal?: AbortSignal,
  approvedCategories: string[] = [],
  approvedCommands: string[] = [],
  parentMission?: MissionParentContext,
  continuity?: "carry_forward_plan" | "fresh_plan",
  approvalResponse?: ApprovalResponse,
  quality?: MissionQualityLevel,
  modelMode?: ModelMode,
): Promise<FactoryProjectResult> {
  const localPath = typeof localPathOrEmitter === "string" ? localPathOrEmitter.trim() : "";
  const onEvent = typeof localPathOrEmitter === "function" ? localPathOrEmitter : maybeEmitter;
  const spec = parseBrief(brief);
  const projectName = spec.projectName === "Open Existing Project" ? "Existing Project" : spec.projectName;
  if (localConnector?.url) {
    return executeConnectorProjectTask(brief, task, localConnector, projectName, onEvent, signal, approvedCategories, approvedCommands, parentMission, continuity, approvalResponse, quality, modelMode);
  }
  if (localPath) {
    return executeLocalProjectTask(brief, task, localPath, projectName, onEvent, signal, approvedCategories, approvedCommands, parentMission, continuity, approvalResponse, quality, modelMode);
  }
  const safeFiles = uploadedFiles.filter((file) => isUsefulUploadedFile(file.path)).map((file) => ({ ...file, path: safeRelativePath(file.path) })).filter((file) => file.path);
  const connectedPath = connectedProjectPathFromFiles(uploadedFiles);
  if (!safeFiles.length) {
    const emptyProjectId = `connected-${slugify(connectedPath) || "project"}`;
    const execution = createExecutionContext(onEvent, emptyProjectId);
    const events = [`Connected project has no editable file contents: ${connectedPath}`];
    await emitExecution(execution, "inspection", "error", "No editable project files were available", {
      details: { connectedPath, reason: "This project record has paths only. Re-open/upload the folder so Foundry can read file contents, or wait for the local connector." },
    });
    return existingProjectResult({
      projectId: emptyProjectId,
      projectName,
      projectPath: connectedPath,
      briefPath: `${connectedPath}/foundry-brief.md`,
      stack: "Unknown",
      status: "failed",
      blocker: "No uploaded file contents were available to inspect or edit. Re-open/upload the project folder to create an editable Foundry copy. A real local folder connector is required to edit your VS Code folder directly.",
      events,
      files: [],
      commands: [],
      execution,
      sourceMode: "uploaded-copy",
    });
  }
  const projectPath = await uniqueProjectPath(`uploaded-${slugify(projectName || connectedPath) || "project-copy"}`);
  const projectId = path.basename(projectPath);
  const briefPath = path.join(projectPath, "foundry-brief.md");
  const events: string[] = [];
  const commands: FactoryCommandEvent[] = [];
  const execution = createExecutionContext(onEvent, projectId);
  initializeObjectiveChecklist(execution, task, "uploaded-copy");

  await emitExecution(execution, "planning", "running", "Reading project request", {
    details: {
      task,
      mode: "Uploaded project copy",
      connectedPath,
      editingTarget: projectPath,
      writePolicy: "Browser uploads are edited as a Foundry copy. The original VS Code folder will not change until the local connector exists.",
    },
  });
  events.push(`Uploaded project source: ${connectedPath}`);
  events.push(`Editing target: ${projectPath}`);
  await mkdir(projectPath, { recursive: true });
  await writeFile(briefPath, `${brief}\n\nCurrent task: ${task}\n\nEditing target: ${projectPath}\n`, "utf8");
  await emitExecution(execution, "inspection", "completed", "Editing target prepared", {
    filePath: projectPath,
    details: { connectedPath, editingTarget: projectPath, sourceMode: "Uploaded copy, export required", filesAvailable: safeFiles.length },
  });

  const detected = detectExistingProject(safeFiles);
  await writeVirtualFilesToDisk(projectPath, new Map(safeFiles.map((file) => [file.path, file.content])));
  await emitExecution(execution, "file", "completed", "Copied uploaded files into Foundry target", {
    filePath: projectPath,
    details: { reason: "Uploaded files need a writable Foundry copy. Export the result to use it outside Foundry.", files: safeFiles.length },
  });
  events.push(`Detected stack: ${detected.stack}`);
  await emitExecution(execution, "inspection", "completed", "Detected project structure", {
    details: {
      stack: detected.stack,
      entryFiles: detected.entryFiles,
      cssFiles: detected.cssFiles,
      jsFiles: detected.jsFiles,
      packageManager: detected.packageManager || "None detected",
    },
  });

  await noteMissingDependencies(projectPath, detected.packageManager, execution);

  const mission = await runExistingProjectMission({ projectPath, task, sourceMode: "uploaded-copy", execution, signal, approvedCategories, quality, modelMode });
  commands.push(...(mission.commands ?? []));
  const files = await listProjectFilesWithStatuses(projectPath, mission.changedFiles, new Set(safeFiles.map((file) => file.path)));
  events.push(...mission.events);
  const preview = mission.status === "passed" ? await startPreview(projectId, projectPath, detected.stack, events, execution) : undefined;

  return existingProjectResult({
    projectId,
    projectName,
    projectPath,
    briefPath,
    stack: detected.stack,
    status: mission.status,
    blocker: mission.blocker,
    clarificationQuestions: mission.clarificationQuestions,
    events,
    files,
    commands,
    execution,
    preview,
    sessionSummary: mission.sessionSummary,
    verification: mission.verification,
  });
}

async function executeConnectorProjectTask(brief: string, task: string, connector: LocalConnectorConfig, projectName: string, onEvent?: ExecutionEmitter, signal?: AbortSignal, approvedCategories: string[] = [], approvedCommands: string[] = [], parentMission?: MissionParentContext, continuity?: "carry_forward_plan" | "fresh_plan", approvalResponse?: ApprovalResponse, quality?: MissionQualityLevel, modelMode?: ModelMode): Promise<FactoryProjectResult> {
  const rootLabel = connector.rootLabel || connector.url;
  const projectId = `connector-${slugify(rootLabel) || "project"}`;
  const execution = createExecutionContext(onEvent, projectId);
  const events: string[] = [];
  const commands: FactoryCommandEvent[] = [];
  initializeObjectiveChecklist(execution, task, "local-folder");

  await emitExecution(execution, "planning", "running", "Reading project request", {
    details: { task, mode: "Local connector", editingTarget: rootLabel, writePolicy: "Connector direct edits and commands. Changes happen in the real connected project folder." },
  });

  const access = createLocalConnectorProjectAccess(connector, signal);
  await emitExecution(execution, "inspection", "completed", "Local connector connected", {
    details: { editingTarget: rootLabel, sourceMode: "Local connector - direct disk edits and commands" },
  });

  const snapshot = await buildProjectSnapshot(access);
  await emitExecution(execution, "inspection", "completed", "Read connector project tree", {
    details: { root: rootLabel, snapshot: snapshot.slice(0, 500) },
  });

  const mission = await runExistingProjectMissionWithAccess({
    access,
    task,
    sourceMode: "local-folder",
    execution,
    projectSnapshot: snapshot,
    signal,
    approvedCategories,
    approvedCommands,
    parentMission,
    continuity,
    approvalResponse,
    quality,
    modelMode,
  });

  commands.push(...(mission.commands ?? []));
  events.push(...mission.events);
  const files = await listConnectorFilesWithStatuses(access, mission.changedFiles);
  const preview = mission.status === "passed" ? await startConnectorPreview(connector) : undefined;
  if (preview) {
    const isReady = preview.previewState === "ready" || preview.previewState === "starting";
    await emitExecution(execution, "preview", isReady ? "completed" : "skipped", isReady ? "Preview ready" : "Preview unavailable", { details: { previewUrl: preview.previewUrl, reason: preview.previewReason } });
  }

  return existingProjectResult({
    projectId,
    projectName,
    projectPath: rootLabel,
    briefPath: `${rootLabel}/foundry-brief.md`,
    stack: mission.stackLabel ?? "Local connector project",
    status: mission.status,
    blocker: mission.blocker,
    clarificationQuestions: mission.clarificationQuestions,
    events,
    files,
    commands,
    execution,
    sourceMode: "local-folder",
    objective: engineeringObjectiveForTask(task),
    preview,
    sessionSummary: mission.sessionSummary,
    verification: mission.verification,
  });
}

async function executeLocalProjectTask(brief: string, task: string, localPath: string, projectName: string, onEvent?: ExecutionEmitter, signal?: AbortSignal, approvedCategories: string[] = [], approvedCommands: string[] = [], parentMission?: MissionParentContext, continuity?: "carry_forward_plan" | "fresh_plan", approvalResponse?: ApprovalResponse, quality?: MissionQualityLevel, modelMode?: ModelMode): Promise<FactoryProjectResult> {
  const projectPath = path.resolve(localPath);
  const projectId = `local-${slugify(path.basename(projectPath)) || "project"}`;
  const execution = createExecutionContext(onEvent, projectId);
  const events: string[] = [];
  const commands: FactoryCommandEvent[] = [];
  initializeObjectiveChecklist(execution, task, "local-folder");

  await emitExecution(execution, "planning", "running", "Reading project request", {
    details: { task, mode: "Local folder connected", editingTarget: projectPath, writePolicy: "Direct disk edits. Changes should appear in VS Code." },
  });

  const rootStats = await stat(projectPath);
  if (!rootStats.isDirectory()) throw new Error("Local project path is not a folder.");

  const localFiles = await readLocalProjectFiles(projectPath);
  if (!localFiles.length) {
    events.push(`No editable files found in ${projectPath}`);
    await emitExecution(execution, "inspection", "error", "No editable project files were available", {
      details: { editingTarget: projectPath, reason: "No supported editable files were found under this folder." },
    });
    return existingProjectResult({
      projectId,
      projectName,
      projectPath,
      briefPath: path.join(projectPath, "foundry-brief.md"),
      stack: "Unknown",
      status: "failed",
      blocker: "No editable project files were found in the selected local folder.",
      events,
      files: [],
      commands,
      execution,
      sourceMode: "local-folder",
    });
  }

  events.push(`Editing target: ${projectPath}`);
  await emitExecution(execution, "inspection", "completed", "Local folder connected", {
    filePath: projectPath,
    details: { editingTarget: projectPath, filesAvailable: localFiles.length, sourceMode: "Local folder - direct disk edits" },
  });

  const detected = detectExistingProject(localFiles);
  await emitExecution(execution, "inspection", "completed", "Detected project structure", {
    details: {
      stack: detected.stack,
      entryFiles: detected.entryFiles,
      cssFiles: detected.cssFiles,
      jsFiles: detected.jsFiles,
      packageManager: detected.packageManager || "None detected",
    },
  });

  await noteMissingDependencies(projectPath, detected.packageManager, execution);

  const mission = await runExistingProjectMission({ projectPath, task, sourceMode: "local-folder", execution, signal, approvedCategories, approvedCommands, parentMission, continuity, approvalResponse, quality, modelMode });
  commands.push(...(mission.commands ?? []));
  const files = await listProjectFilesWithStatuses(projectPath, mission.changedFiles, new Set(localFiles.map((file) => file.path)));
  events.push(...mission.events);
  const preview = mission.status === "passed" ? await startPreview(projectId, projectPath, detected.stack, events, execution) : undefined;

  return {
    projectId,
    projectName,
    projectPath,
    briefPath: path.join(projectPath, "foundry-brief.md"),
    stack: detected.stack,
    template: "Existing Project",
    sourceMode: "local-folder",
    objective: engineeringObjectiveForTask(task),
    checklist: execution.checklist,
    status: mission.status,
    supported: mission.status !== "unsupported",
    blocker: mission.blocker,
    events,
    files,
    commands,
    previewUrl: preview?.previewUrl,
    previewState: preview?.previewState,
    previewPlatform: preview?.previewPlatform,
    previewReason: preview?.previewReason,
    timeline: execution.timeline,
    sessionSummary: mission.sessionSummary,
    clarificationQuestions: mission.clarificationQuestions,
    verification: mission.verification,
  };
}

async function runExistingProjectMission(params: {
  projectPath: string;
  task: string;
  sourceMode: "local-folder" | "uploaded-copy";
  execution: ExecutionContext;
  signal?: AbortSignal;
  approvedCategories?: string[];
  approvedCommands?: string[];
  parentMission?: MissionParentContext;
  continuity?: "carry_forward_plan" | "fresh_plan";
  approvalResponse?: ApprovalResponse;
  quality?: MissionQualityLevel;
  modelMode?: ModelMode;
}): Promise<{ status: FactoryProjectResult["status"]; blocker?: string; clarificationQuestions?: MissionClarification[]; changedFiles: string[]; commands?: FactoryCommandEvent[]; sessionSummary?: FactorySessionSummary; verification?: ExecutionMissionVerification[]; events: string[] }> {
  const { projectPath, task, sourceMode, execution, signal, approvedCategories, approvedCommands, parentMission, continuity, approvalResponse, quality, modelMode } = params;
  const access = createServerProjectAccess(projectPath, sourceMode, signal);
  const snapshot = await buildProjectSnapshot(access);
  return runExistingProjectMissionWithAccess({ access, task, sourceMode, execution, projectSnapshot: snapshot, signal, approvedCategories, approvedCommands, parentMission, continuity, approvalResponse, quality, modelMode });
}

async function runExistingProjectMissionWithAccess(params: {
  access: ReturnType<typeof createServerProjectAccess> | ReturnType<typeof createLocalConnectorProjectAccess>;
  task: string;
  sourceMode: "local-folder" | "uploaded-copy";
  execution: ExecutionContext;
  projectSnapshot: string;
  signal?: AbortSignal;
  approvedCategories?: string[];
  approvedCommands?: string[];
  parentMission?: MissionParentContext;
  continuity?: "carry_forward_plan" | "fresh_plan";
  approvalResponse?: ApprovalResponse;
  quality?: MissionQualityLevel;
  modelMode?: ModelMode;
}): Promise<{ status: FactoryProjectResult["status"]; blocker?: string; clarificationQuestions?: MissionClarification[]; changedFiles: string[]; commands?: FactoryCommandEvent[]; sessionSummary?: FactorySessionSummary; verification?: ExecutionMissionVerification[]; events: string[]; stackLabel?: string }> {
  const { access, task, execution, projectSnapshot, signal, approvedCategories = [], approvedCommands = [], parentMission, continuity, approvalResponse, quality = DEFAULT_MISSION_QUALITY, modelMode = "auto" } = params;
  const initialModel = modelForMissionStage(task, modelMode, "builder");
  const apiKey = initialModel?.apiKey;
  const objective = engineeringObjectiveForTask(task);

  if (signal?.aborted) {
    const blocker = "Stopped by user before completion.";
    await emitExecution(execution, "summary", "warning", "Stopped by user", { details: { reason: blocker } });
    finishObjectiveChecklist(execution, "stopped", blocker);
    return { status: "stopped", blocker, changedFiles: [], events: [blocker] };
  }

  if (!apiKey) {
    const blocker = "No configured AI provider is available. Add OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY.";
    await emitExecution(execution, "summary", "error", "Mission blocked", { details: { blocker } });
    finishObjectiveChecklist(execution, "failed", blocker);
    return { status: "failed", blocker, changedFiles: [], events: [blocker] };
  }

  const onEvent = (event: FactoryExecutionEvent) => execution.emit(event);

  const { profile: stackProfile, rootEntries } = await detectStackProfileAndEntriesForAccess(access);
  await emitExecution(execution, "inspection", "completed", "Detected project stack", {
    internal: true,
    details: { stack: stackProfile.label, capabilityLevel: stackProfile.level },
  });
  if (!parentMission) {
    const disclosure = capabilityDisclosureLine(stackProfile);
    await emitExecution(execution, "reasoning", "completed", disclosure, {
      tier: "finding",
      rationale: `${disclosure} ${describeCapabilityLevel(stackProfile.level)}`,
      narrative: {
        id: `capability-level-${Date.now()}`,
        tier: "finding",
        rationale: `${disclosure} ${describeCapabilityLevel(stackProfile.level)}`,
        evidence: [],
        source: "project-understanding",
      },
      details: { stack: stackProfile.label, capabilityLevel: stackProfile.level },
    });
  }

  if (!parentMission && stackProfile.id === "unknown") {
    const folderSafety = await checkProjectFolderSafety(rootEntries, task);
    if (folderSafety) {
      execution.checklist.splice(0, execution.checklist.length, { id: "folder-safety", label: "Decide how to handle existing unrelated files", status: "blocked", evidence: "One requirement needs your input before I continue." });
      const paused = await pauseForPlanConflicts(execution, [folderSafety]);
      return { status: paused.status, blocker: paused.blocker, clarificationQuestions: paused.clarificationQuestions, changedFiles: [], events: [paused.blocker], stackLabel: stackProfile.label };
    }
  }

  await emitExecution(execution, "planning", "running", "Understanding your request", { internal: true });
  const skipClassifyCall = looksUnambiguouslyLikeSmallEdit(task);
  const classification = skipClassifyCall
    ? { intent: "edit" as const, needsProjectInspection: true, rationale: "Recognized as a small, unambiguous edit — skipped an extra classification step to start faster." }
    : await classifyIntent({ message: task, hasProjectContext: true, apiKey, provider: initialModel.provider });
  const deterministicIntent = deterministicMutationIntent(task);
  if (
    deterministicIntent &&
    deterministicIntent !== "undo" &&
    (classification.intent === "question" || classification.intent === "status" || classification.intent === "analyze")
  ) {
    const overriddenIntent = classification.intent;
    classification.intent = deterministicIntent;
    classification.needsProjectInspection = true;
    classification.rationale = `Deterministic edit-intent guard overrode ${overriddenIntent}: the task asks Foundry to change files.`;
  }
  await emitExecution(execution, "inspection", "completed", "Classified request", {
    internal: true,
    details: { intent: classification.intent, rationale: classification.rationale },
  });

  if (classification.intent === "question" || classification.intent === "status" || classification.intent === "analyze") {
    const inspection = await runReadOnlyInspection({ message: task, access, apiKey, provider: initialModel.provider, onEvent });
    await emitExecution(execution, "summary", "completed", "Answered without editing files", { output: inspection.answer });
    finishObjectiveChecklist(execution, "passed");
    return { status: "passed", changedFiles: [], events: [inspection.answer], stackLabel: stackProfile.label };
  }

  if (classification.intent === "undo") {
    if (stackProfile.level < 4) {
      const blocker = `Undo is part of full mission support, which isn't enabled yet for ${stackProfile.label} (currently Level ${stackProfile.level}). You'll need to revert this by hand for now.`;
      await emitExecution(execution, "summary", "error", "Undo not available at this capability level", { details: { blocker, stack: stackProfile.label, capabilityLevel: stackProfile.level } });
      finishObjectiveChecklist(execution, "unsupported", blocker);
      return { status: "unsupported", blocker, changedFiles: [], events: [blocker], stackLabel: stackProfile.label };
    }
    const projectId = execution.projectId;
    if (!projectId) {
      const blocker = "No durable history is available for this connection yet, so undo isn't possible.";
      await emitExecution(execution, "summary", "error", "Mission blocked", { details: { blocker } });
      finishObjectiveChecklist(execution, "unsupported", blocker);
      return { status: "unsupported", blocker, changedFiles: [], events: [blocker], stackLabel: stackProfile.label };
    }
    const undone = await undoLastChange(access, execution, projectId);
    if (undone.status === "failed") {
      await emitExecution(execution, "summary", "error", "Mission blocked", { details: { blocker: undone.blocker } });
      finishObjectiveChecklist(execution, "unsupported", undone.blocker);
      return { status: "unsupported", blocker: undone.blocker, changedFiles: [], events: [undone.blocker ?? ""], stackLabel: stackProfile.label };
    }
    await emitExecution(execution, "summary", "completed", "Reverted the last change", { filePath: undone.filePath });
    finishObjectiveChecklist(execution, "passed");
    return { status: "passed", changedFiles: undone.filePath ? [undone.filePath] : [], events: [], stackLabel: stackProfile.label };
  }

  if (stackProfile.level === 1) {
    const unsupportedMessage = unsupportedEditingMessage(stackProfile);
    const inspection = await runReadOnlyInspection({
      message: `${task}\n\n(Note to include in your answer: ${unsupportedMessage})`,
      access,
      apiKey,
      provider: initialModel.provider,
      onEvent,
    });
    const answer = inspection.answer.includes(unsupportedMessage) ? inspection.answer : `${unsupportedMessage}\n\n${inspection.answer}`;
    const blocker = `I inspected the project but did not edit because ${unsupportedMessage}`;
    await emitExecution(execution, "summary", "error", "Inspected but did not edit", {
      output: answer,
      details: { blocker, stack: stackProfile.label, capabilityLevel: stackProfile.level },
    });
    finishObjectiveChecklist(execution, "unsupported", blocker);
    return { status: "unsupported", blocker, changedFiles: [], events: [answer], stackLabel: stackProfile.label };
  }

  const executorAccess = accessForCapabilityLevel(access, stackProfile.level);
  const fastLane =
    (classification.intent === "edit" || classification.intent === "debug" || classification.intent === "build") &&
    (isLikelySmallSingleFileRequest(task) || isLikelyTinyOperationalRequest(task));
  const carryForwardPlan = continuity === "carry_forward_plan" && Boolean(parentMission?.plan.length) && stackProfile.level >= 4;
  if (!fastLane && !carryForwardPlan) await emitExecution(execution, "planning", "running", "Planning the approach", { internal: true });
  let checklist: FactoryObjectiveChecklistItem[];
  if (carryForwardPlan && parentMission) {
    const resolved = parentMission.plan.filter((item) => item.status === "completed" || item.status === "skipped");
    // A "blocked" item in the parent mission was blocked by whatever single command last needed approval
    // (the executor pauses immediately, mission-wide, the instant a command needs approval — it never leaves
    // other unrelated items merely "blocked"). If the user just denied that command, those items must not be
    // silently reset to "pending" and retried — they're the ones the deny instruction is about. Untouched
    // "pending" items are unaffected and carry forward normally for a fresh attempt.
    const deniedThisTurn = approvalResponse?.decision === "deny";
    const stillOpen = parentMission.plan
      .filter((item) => item.status !== "completed" && item.status !== "skipped")
      .map((item) =>
        deniedThisTurn && item.status === "blocked"
          ? { ...item, status: "skipped" as const, evidence: `Skipped — the command this needed was denied. Manual command: \`${approvalResponse.requestedCommand.trim()}\`` }
          : { ...item, status: "pending" as const },
      );
    const followUpItems = approvalResponse ? [] : [{ id: `followup-${Date.now()}`, label: `Complete: ${task.trim()}`, status: "pending" as const }];
    checklist = [...resolved, ...stillOpen, ...followUpItems];
    await emitExecution(execution, "planning", "completed", "Continuing the open plan from the previous mission", {
      internal: true,
      details: { checklistJson: JSON.stringify(checklist), continuedFrom: parentMission.id },
    });
  } else if (fastLane) {
    checklist = [{ id: "small-edit-applied", label: `Complete: ${task.trim()}`, status: "pending" as const }];
  } else {
    // Pre-plan complexity is necessarily an estimate (distinctPhases doesn't exist until the checklist
    // does) — fine here, since tierForStage's "plan" branch only ever keys off quality, never complexity.
    const prePlanComplexity = assessMissionComplexity({
      highRisk: isHighRiskArchitectureRequest(task),
      multiPart: isMultiPartRequest(task),
      distinctPhases: 0,
      stackCapabilityLevel: stackProfile.level,
      fileCount: rootEntries.length,
    });
    const planModel = modelForMissionStage(task, modelMode, tierForStage("plan", quality, prePlanComplexity)) ?? initialModel!;
    const plan = await planMission({ objective, task, projectSnapshot, apiKey: planModel.apiKey, provider: planModel.provider, canRunCommands: executorAccess.capabilities.canRunCommands, tier: planModel.tier });
    checklist = plan.checklist;
    if (plan.conflicts.length) {
      execution.checklist.splice(0, execution.checklist.length, ...checklist);
      const paused = await pauseForPlanConflicts(execution, plan.conflicts);
      return { status: paused.status, blocker: paused.blocker, clarificationQuestions: paused.clarificationQuestions, changedFiles: [], events: [paused.blocker], stackLabel: stackProfile.label };
    }
  }
  execution.checklist.splice(0, execution.checklist.length, ...checklist);
  if (!carryForwardPlan) {
    await emitExecution(execution, "planning", "completed", "Checklist ready", {
      internal: true,
      details: { checklistJson: JSON.stringify(checklist), fastLane },
    });
  }

  const preApprovedCommands = Array.from(
    new Set([...(approvalResponse && approvalResponse.decision !== "deny" ? [approvalResponse.requestedCommand.trim()] : []), ...approvedCommands]),
  );
  if (approvalResponse?.decision === "deny") {
    const deniedCommand = approvalResponse.requestedCommand.trim();
    await emitExecution(execution, "blocked", "warning", `Approval denied: ${deniedCommand}`, {
      tier: "flag",
      command: deniedCommand,
      details: {
        reason: `The user denied this command. You can run it yourself when ready: \`${deniedCommand}\`. Work that depends on it remains blocked; Foundry will continue only with work that can still be verified safely.`,
      },
    });
  }
  const distinctPhases = new Set(checklist.map((item) => item.phase).filter(Boolean)).size;
  const highRisk = isHighRiskArchitectureRequest(task) && distinctPhases >= 2 && stackProfile.level >= 4;
  const complexity = assessMissionComplexity({
    highRisk,
    multiPart: isMultiPartRequest(task),
    distinctPhases,
    stackCapabilityLevel: stackProfile.level,
    fileCount: rootEntries.length,
  });

  let architectureNotes: string | undefined;
  if (shouldRunArchitectureReview(quality, complexity, highRisk)) {
    // Not internal — Capability-First Experience: this is one of the visible workflow steps a user
    // should see ("Reviewing architecture"), not raw model/provider plumbing.
    await emitExecution(execution, "planning", "running", "Reviewing architecture");
    const reviewModel = modelForMissionStage(task, modelMode, tierForStage("review", quality, complexity)) ?? initialModel!;
    const review = await reviewArchitecture({ objective, task, checklist, projectSnapshot, apiKey: reviewModel.apiKey, provider: reviewModel.provider, tier: reviewModel.tier });
    if (review.revisedChecklist?.length) {
      checklist = review.revisedChecklist;
      execution.checklist.splice(0, execution.checklist.length, ...checklist);
    }
    if (review.concerns.length) architectureNotes = review.concerns.map((concern) => `- ${concern}`).join("\n");
    await emitExecution(execution, "planning", "completed", review.concerns.length ? "Architecture review flagged concerns" : "Architecture review found no concerns", {
      details: review.concerns.length ? { concerns: review.concerns } : undefined,
    });
  }

  const implementationModel = modelForMissionStage(task, modelMode, tierForStage("implement", quality, complexity)) ?? initialModel!;
  const result = await runMissionExecutor({
    objective,
    task,
    checklist,
    access: executorAccess,
    apiKey: implementationModel.apiKey,
    provider: implementationModel.provider,
    onEvent,
    signal,
    preApprovedCommands,
    approvedCategories,
    standingApprovedCommands: approvedCommands,
    deniedActions: approvalResponse?.decision === "deny" ? [approvalResponse.requestedCommand.trim()] : [],
    priorContext: parentMission,
    fastLane,
    highRisk,
    tier: implementationModel.tier,
    architectureNotes,
    hasBuildTooling: stackHasBuildStep(stackProfile.id),
  });

  const hasHonestlySkippedItem = result.checklist.some((item) => item.status === "skipped");
  if (result.status === "passed" && deterministicIntent && deterministicIntent !== "undo" && result.changedFiles.length === 0 && !hasHonestlySkippedItem) {
    const blocker = "I inspected the project but did not edit because no file write was verified on disk.";
    await emitExecution(execution, "summary", "error", "Edit mission did not change files", {
      details: { blocker, intent: deterministicIntent, changedFiles: 0 },
    });
    result.status = "failed";
    result.blocker = blocker;
  }

  if (result.status === "passed" && shouldRunVerify(quality)) {
    await runVerificationAndEscalate({ objective, task, result, executorAccess, signal, preApprovedCommands, approvedCategories, approvedCommands, execution, quality, complexity, modelMode });
  }

  execution.checklist.splice(0, execution.checklist.length, ...result.checklist);
  finishObjectiveChecklist(execution, result.status, result.blocker);
  return { status: result.status, blocker: result.blocker, changedFiles: result.changedFiles, commands: result.commands, sessionSummary: result.sessionSummary, verification: result.verification, events: [], stackLabel: stackProfile.label };
}

function narrativeObjectsFromTimeline(timeline: FactoryExecutionEvent[]): FactoryNarrativeObject[] {
  return timeline.map((event) => event.narrative).filter((item): item is FactoryNarrativeObject => Boolean(item));
}

/**
 * The Verify stage + confidence escalation: reviews the mission's own real evidence, and if not
 * confident, runs exactly one continuation pass (via the existing priorContext mechanism) forced to
 * "architect" tier before accepting the result. Never blocks — a low-confidence outcome, even after a
 * second opinion, is surfaced as a flag in the final summary rather than pausing the mission (confirmed
 * product decision). Mutates `result` in place with whatever the follow-up pass found.
 */
async function runVerificationAndEscalate(input: {
  objective: string;
  task: string;
  result: Awaited<ReturnType<typeof runMissionExecutor>>;
  executorAccess: ProjectAccess;
  signal?: AbortSignal;
  preApprovedCommands: string[];
  approvedCategories: string[];
  approvedCommands: string[];
  execution: ExecutionContext;
  quality: MissionQualityLevel;
  complexity: ReturnType<typeof assessMissionComplexity>;
  modelMode: ModelMode;
}): Promise<void> {
  const { objective, task, result, executorAccess, signal, preApprovedCommands, approvedCategories, approvedCommands, execution, quality, complexity, modelMode } = input;
  const onEvent = (event: FactoryExecutionEvent) => execution.emit(event);

  // Not internal — see the matching note on "Reviewing architecture" above.
  await emitExecution(execution, "planning", "running", "Verifying build");
  const verifyTier = tierForStage("verify", quality, complexity);
  const verifyModel = modelForMissionStage(task, modelMode, verifyTier);
  if (!verifyModel) return;
  const verification = await verifyMissionResult({
    objective,
    task,
    checklist: result.checklist,
    changedFiles: result.changedFiles,
    commands: result.commands,
    narrativeObjects: narrativeObjectsFromTimeline(result.timeline),
    apiKey: verifyModel.apiKey,
    provider: verifyModel.provider,
    tier: verifyModel.tier,
  });

  let notes = verification.notes;
  let secondOpinionDisagreed = false;

  if (verification.confidence < 60) {
    const secondApiKey = process.env.ANTHROPIC_API_KEY;
    if (secondApiKey) {
      const secondProvider: ProviderId = "anthropic";
      const secondOpinion = await verifyMissionResult({
        objective,
        task,
        checklist: result.checklist,
        changedFiles: result.changedFiles,
        commands: result.commands,
        narrativeObjects: narrativeObjectsFromTimeline(result.timeline),
        apiKey: secondApiKey,
        provider: secondProvider,
        tier: verifyTier,
      });
      secondOpinionDisagreed = Math.abs(secondOpinion.confidence - verification.confidence) >= 25;
      notes = `${verification.notes} Second opinion (${secondProvider}, ${secondOpinion.confidence}% confident): ${secondOpinion.notes}`.trim();
    }
  }

  if (verification.confidence >= 80) {
    await emitExecution(execution, "planning", "completed", "Verified build and evidence", { details: { confidence: verification.confidence, notes } });
    return;
  }

  // 60-95 (and <60 after a second opinion) escalate to exactly one continuation pass at architect tier
  // — never more than one, and the mission stays "passed" regardless of what it finds (see file-level note).
  await emitExecution(execution, "planning", "warning", "Verification wasn't fully confident — running one more pass", {
    details: { confidence: verification.confidence, notes },
  });

  const priorContext: MissionParentContext = {
    id: `verify-${Date.now()}`,
    state: "passed",
    plan: result.checklist,
    files_touched: result.changedFiles.map((filePath) => ({ path: filePath, status: "edited", verified: true })),
    commands_run: result.commands.map((command) => ({ command: command.command, exitCode: command.exitCode })),
    decisions: result.sessionSummary?.changes ?? [],
    findings: [],
    summary: result.sessionSummary?.outcome ?? "",
  };

  const followUp = await runMissionExecutor({
    objective,
    task: `Double check and address any remaining concerns before this mission is truly done: ${notes || "the verification pass was not fully confident this is correct."}`,
    checklist: [{ id: "verify-followup", label: "Address verification concerns and re-confirm the fix", status: "pending" }],
    access: executorAccess,
    apiKey: (modelForMissionStage(task, modelMode, "architect") ?? verifyModel).apiKey,
    provider: (modelForMissionStage(task, modelMode, "architect") ?? verifyModel).provider,
    onEvent,
    signal,
    preApprovedCommands,
    approvedCategories,
    standingApprovedCommands: approvedCommands,
    priorContext,
    tier: (modelForMissionStage(task, modelMode, "architect") ?? verifyModel).tier,
    maxTurns: 12,
  });

  if (followUp.status === "passed") {
    result.checklist = followUp.checklist;
    result.changedFiles = [...new Set([...result.changedFiles, ...followUp.changedFiles])];
    result.commands = [...result.commands, ...followUp.commands];
    result.sessionSummary = followUp.sessionSummary ?? result.sessionSummary;
    result.verification = followUp.verification ?? result.verification;
  }

  if (verification.confidence < 60) {
    const flagNote = secondOpinionDisagreed
      ? `Foundry was less confident about this mission (${verification.confidence}% before the follow-up pass) and a second opinion disagreed — worth a second look before relying on it.`
      : `Foundry was less confident about this mission (${verification.confidence}% before the follow-up pass) — worth a second look before relying on it.`;
    await emitExecution(execution, "summary", "warning", "Lower confidence — worth a second look", { details: { reason: flagNote } });
    if (result.sessionSummary) result.sessionSummary = { ...result.sessionSummary, flags: [...result.sessionSummary.flags, flagNote] };
  }
}

async function markJournalEntryReverted(projectId: string, entryId: string) {
  const entries = await readJournal(projectId);
  const updated = entries.map((entry) => (entry.id === entryId ? { ...entry, reverted: true } : entry));
  await writeJournal(projectId, updated);
}

function isRevertOk(result: { verified: boolean; reason?: string }) {
  return result.verified || result.reason === "Write succeeded but file content did not change.";
}

async function undoLastChange(access: ProjectAccess, execution: ExecutionContext, projectId: string): Promise<{ status: "passed" | "failed"; blocker?: string; filePath?: string }> {
  const journal = await readJournal(projectId);
  const target = [...journal].reverse().find((entry) => !entry.reverted && entry.event.kind === "edit" && entry.event.status === "completed" && entry.event.filePath);
  if (!target || !target.event.filePath) {
    const hasOnlyCreations = journal.some((entry) => !entry.reverted && entry.event.kind === "file" && entry.event.status === "completed");
    return {
      status: "failed",
      blocker: hasOnlyCreations
        ? "Foundry can only undo edits to files that already existed, not the creation of new files, yet."
        : "There is no recorded file change to undo yet.",
    };
  }

  const filePath = target.event.filePath;
  const beforeContent = target.beforeContent ?? "";
  await emitExecution(execution, "edit", "running", `Reverting ${target.event.fileName || filePath}`, { filePath });
  const result = await access.writeFile(filePath, beforeContent);
  if (!isRevertOk(result)) {
    await emitExecution(execution, "edit", "error", `Could not revert ${filePath}`, { filePath, details: { reason: result.reason } });
    return { status: "failed", blocker: `Could not revert ${filePath}: ${result.reason ?? "the write was not verified."}` };
  }

  await emitExecution(execution, "edit", "completed", `Reverted ${target.event.fileName || filePath} to its previous version`, {
    filePath,
    output: result.diff,
    details: { revertedEntryId: target.id },
  });
  await markJournalEntryReverted(projectId, target.id);
  return { status: "passed", filePath };
}

async function rollbackToEntry(access: ProjectAccess, execution: ExecutionContext, projectId: string, entryId: string): Promise<{ status: "passed" | "failed"; blocker?: string; revertedFiles: string[] }> {
  const journal = await readJournal(projectId);
  const targetIndex = journal.findIndex((entry) => entry.id === entryId);
  if (targetIndex < 0) return { status: "failed", blocker: "That journal entry could not be found.", revertedFiles: [] };

  const candidates = journal
    .slice(targetIndex + 1)
    .filter((entry) => !entry.reverted && entry.event.kind === "edit" && entry.event.status === "completed" && entry.event.filePath)
    .reverse();

  const revertedFiles: string[] = [];
  for (const entry of candidates) {
    const filePath = entry.event.filePath as string;
    const beforeContent = entry.beforeContent ?? "";
    await emitExecution(execution, "edit", "running", `Reverting ${filePath}`, { filePath });
    const result = await access.writeFile(filePath, beforeContent);
    if (!isRevertOk(result)) {
      await emitExecution(execution, "edit", "error", `Could not revert ${filePath}`, { filePath, details: { reason: result.reason } });
      return { status: "failed", blocker: `Could not revert ${filePath}: ${result.reason ?? "the write was not verified."}`, revertedFiles };
    }
    await emitExecution(execution, "edit", "completed", `Reverted ${filePath} to its version at this point in the journal`, { filePath, output: result.diff });
    await markJournalEntryReverted(projectId, entry.id);
    revertedFiles.push(filePath);
  }

  return { status: revertedFiles.length || candidates.length === 0 ? "passed" : "failed", revertedFiles };
}

/** A bare file-name listing forces the planner to guess at things one real read would answer — which
 * script actually starts the app, what it's called, whether this is a single app or a monorepo. Fold in the
 * project's own real package.json (when present) so the planner can answer those from real data instead of
 * asking the user a question their own project already answers (Section 5, "verify before asking"). */
async function buildProjectSnapshot(access: ProjectAccess) {
  const entries = await access.listDir("");
  const listing = entries.slice(0, 60).map((entry) => `${entry.kind === "directory" ? "[dir] " : ""}${entry.name}`).join("\n");
  const hasPackageJson = entries.some((entry) => entry.kind === "file" && entry.name.toLowerCase() === "package.json");
  if (!hasPackageJson) return listing;
  const read = await access.readFile("package.json", { limitBytes: 6000 }).catch(() => undefined);
  const manifestSummary = read?.exists ? summarizePackageJsonForPlanning(read.content) : undefined;
  return manifestSummary ? `${listing}\n\n${manifestSummary}` : listing;
}

function summarizePackageJsonForPlanning(content: string): string | undefined {
  try {
    const pkg = JSON.parse(content) as { name?: string; scripts?: Record<string, string> };
    const scriptLines = pkg.scripts
      ? Object.entries(pkg.scripts).map(([name, command]) => `  ${name}: ${command}`).join("\n")
      : "";
    return [
      `package.json${pkg.name ? ` (${pkg.name})` : ""} — this is the real, current script list, not a guess:`,
      scriptLines || "  (no scripts defined)",
    ].join("\n");
  } catch {
    return undefined;
  }
}

/** "This is a{n} <label>{ project} — I'm at Level N here." — avoids "a Unknown project project" and "a Android". */
function capabilityDisclosureLine(stack: StackProfile): string {
  const label = stack.label.trim();
  const article = /^[aeiou]/i.test(label) ? "an" : "a";
  const noun = /\bproject\b/i.test(label) ? label : `${label} project`;
  return `This is ${article} ${noun} — I'm at Level ${stack.level} here.`;
}

function describeCapabilityLevel(level: StackCapabilityLevel): string {
  switch (level) {
    case 1:
      return "I can read and explain the code and propose changes, but I can't edit or run anything for you yet.";
    case 2:
      return "I can edit files directly and verify by reading them back, but I can't run this stack's build or test commands yet.";
    case 3:
      return "I can edit files and run this stack's build, test, and lint commands directly, but I don't yet support multi-phase mission planning, checkpointing, or undo for it.";
    case 4:
      return "Full mission support here — I can plan multi-step work, edit, run commands, verify, checkpoint, and undo.";
    default:
      return "";
  }
}

/**
 * Section 13: when the user connects a folder that has no recognized stack (nothing Foundry can identify as
 * "this is what's already here") and their request reads like starting something new, never scaffold silently
 * into whatever else is sitting in that folder — ask first. Returns a plain-language question with real,
 * project-specific options when this applies, or undefined when there's nothing to flag.
 */
async function checkProjectFolderSafety(rootEntries: string[], task: string): Promise<string | undefined> {
  const looksLikeNewScopeRequest = /\b(build|create|start|make|scaffold|set ?up|generate)\b[^.?!\n]{0,60}\b(new|from scratch)\b/i.test(task) || /\bfrom scratch\b/i.test(task) || /\bbrand new\b/i.test(task);
  if (!looksLikeNewScopeRequest) return undefined;

  const ignorable = /^(\.git|\.ds_store|\.vscode|\.idea|node_modules|foundry-brief\.md|thumbs\.db)$/i;
  const meaningfulEntries = rootEntries.filter((name) => !ignorable.test(name));
  if (!meaningfulEntries.length) return undefined;

  const sample = meaningfulEntries.slice(0, 12).join(", ");
  return `I found existing files in this folder that don't appear related to the new project you're describing: ${sample}${meaningfulEntries.length > 12 ? ", ..." : ""}. Tell me how to handle them before I start: create a subfolder for the new work, archive the old files first, delete the old files first, continue anyway and mix the new work in here, or cancel.`;
}

async function detectStackProfileAndEntriesForAccess(access: ProjectAccess): Promise<{ profile: StackProfile; rootEntries: string[] }> {
  const rootEntries = (await access.listDir("")).map((entry) => entry.name);
  const names = rootEntries.map((name) => name.toLowerCase());

  let packageJsonContent: string | undefined;
  if (names.includes("package.json")) {
    const read = await access.readFile("package.json", { limitBytes: 6000 }).catch(() => undefined);
    if (read?.exists) packageJsonContent = read.content;
  }

  let javaBuildFileContent: string | undefined;
  const javaBuildFileName = rootEntries.find((name) => ["pom.xml", "build.gradle", "build.gradle.kts"].includes(name.toLowerCase()));
  if (javaBuildFileName) {
    const read = await access.readFile(javaBuildFileName, { limitBytes: 6000 }).catch(() => undefined);
    if (read?.exists) javaBuildFileContent = read.content;
  }

  let dotnetProjectFileContent: string | undefined;
  const dotnetProjectFileName = rootEntries.find((name) => name.toLowerCase().endsWith(".csproj"));
  if (dotnetProjectFileName) {
    const read = await access.readFile(dotnetProjectFileName, { limitBytes: 6000 }).catch(() => undefined);
    if (read?.exists) dotnetProjectFileContent = read.content;
  }

  const profile = detectStackProfile({ rootEntries, packageJsonContent, javaBuildFileContent, dotnetProjectFileContent });
  return { profile, rootEntries };
}

function accessForCapabilityLevel(access: ProjectAccess, level: StackCapabilityLevel): ProjectAccess {
  if (level >= 3 || !access.capabilities.canRunCommands) return access;
  return { ...access, capabilities: { ...access.capabilities, canRunCommands: false } };
}

export async function rebuildFactoryProject(projectId: string): Promise<FactoryProjectResult> {
  const projectPath = safeProjectPath(projectId);
  const briefPath = path.join(projectPath, "foundry-brief.md");
  const brief = await readFile(briefPath, "utf8");
  const spec = parseBrief(brief);
  const events = [`Rebuild started: ${projectPath}`];
  const commands: FactoryCommandEvent[] = [];

  if (!isSupportedStack(spec.stack)) {
    const files = await listProjectFiles(projectPath);
    return {
      projectId,
      projectName: spec.projectName,
      projectPath,
      briefPath,
      stack: spec.stack,
      template: spec.template,
      status: "unsupported",
      supported: false,
      blocker: `${spec.stack} rebuild is stubbed honestly in Phase 2.`,
      events,
      files,
      commands,
    };
  }

  if (isNextStack(spec.stack)) {
    commands.push(await runCommand(projectPath, "npm.cmd", ["install"], events));
    if (commands.at(-1)?.exitCode === 0) {
      commands.push(await runCommand(projectPath, "npm.cmd", ["run", "build"], events));
    }
  }

  const failedCommand = commands.find((command) => command.exitCode !== 0);
  const preview = failedCommand ? undefined : await startPreview(projectId, projectPath, spec.stack, events);
  const files = await listProjectFiles(projectPath);

  return {
    projectId,
    projectName: spec.projectName,
    projectPath,
    briefPath,
    stack: spec.stack,
    template: spec.template,
    status: failedCommand ? "failed" : "passed",
    supported: true,
    blocker: failedCommand ? summarizeCommandFailure(failedCommand) : undefined,
    events: failedCommand ? [...events, "Build failed"] : [...events, "Build passed"],
    files,
    commands,
    previewUrl: preview?.previewUrl,
    previewState: preview?.previewState,
    previewPlatform: preview?.previewPlatform,
    previewReason: preview?.previewReason,
    exportUrl: `/api/factory/export?projectId=${encodeURIComponent(projectId)}`,
  };
}

export async function listProjectFiles(projectPath: string, root = projectPath): Promise<FactoryFileEntry[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !["node_modules", ".next", "dist"].includes(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) return listProjectFiles(projectPath, fullPath);
        const details = await stat(fullPath);
        return [{ path: path.relative(projectPath, fullPath).replace(/\\/g, "/"), status: "created" as const, size: details.size }];
      }),
  );

  return files.flat().sort((a, b) => a.path.localeCompare(b.path));
}

export async function readProjectFile(projectId: string, relativePath: string) {
  const projectPath = safeProjectPath(projectId);
  const filePath = path.resolve(projectPath, relativePath);
  if (!filePath.startsWith(projectPath)) throw new Error("Refusing to read outside the project workspace.");
  return readFile(filePath, "utf8");
}

export async function inspectLocalProjectSource(localPath: string, task = "", apiKey?: string, provider?: ProviderId, tier: ModelTier = "builder") {
  const projectPath = path.resolve(localPath);
  const rootStats = await stat(projectPath);
  if (!rootStats.isDirectory()) throw new Error("Local project path is not a folder.");
  const files = await readLocalProjectFiles(projectPath);
  const detected = detectExistingProject(files);
  if (apiKey && isReadOnlyDiagnosticInspection(task)) {
    const access = createServerProjectAccess(projectPath, "local-folder");
    const inspection = await runReadOnlyInspection({ message: task, access, apiKey, provider, tier, onEvent: async () => {} });
    return {
      projectPath,
      stack: detected.stack,
      files: files.map((file) => ({ path: file.path, size: file.size })),
      answer: inspection.answer,
    };
  }
  return {
    projectPath,
    stack: detected.stack,
    files: files.map((file) => ({ path: file.path, size: file.size })),
    answer: projectInspectionAnswer(files, detected, task),
  };
}

export async function inspectLocalConnectorSource(localConnector: LocalConnectorConfig, task = "", apiKey?: string, provider?: ProviderId, tier: ModelTier = "builder") {
  const access = createLocalConnectorProjectAccess(localConnector);
  const files: FactoryUploadedFile[] = [];
  let totalSize = 0;
  const maxTotalSize = 2_500_000;
  const maxFileSize = 300_000;

  async function visit(relativePath: string) {
    if (totalSize >= maxTotalSize) return;
    const entries = await access.listDir(relativePath);
    for (const entry of entries) {
      const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        await visit(entryPath);
        continue;
      }
      if (!isUsefulUploadedFile(entryPath) || (entry.size ?? 0) > maxFileSize || totalSize + (entry.size ?? 0) > maxTotalSize) continue;
      const read = await access.readFile(entryPath, { offsetBytes: 0, limitBytes: maxFileSize });
      if (!read.exists) continue;
      files.push({ path: entryPath, content: read.content, size: read.totalBytes });
      totalSize += read.totalBytes;
    }
  }

  await visit("");
  const detected = detectExistingProject(files);
  if (apiKey && isReadOnlyDiagnosticInspection(task)) {
    const inspection = await runReadOnlyInspection({ message: task, access, apiKey, provider, tier, onEvent: async () => {} });
    return {
      projectPath: localConnector.rootLabel || localConnector.url,
      stack: detected.stack,
      files: files.map((file) => ({ path: file.path, size: file.size })),
      answer: inspection.answer,
    };
  }
  return {
    projectPath: localConnector.rootLabel || localConnector.url,
    stack: detected.stack,
    files: files.map((file) => ({ path: file.path, size: file.size })),
    answer: projectInspectionAnswer(files, detected, task),
  };
}

function isReadOnlyDiagnosticInspection(task: string) {
  const text = task.toLowerCase();
  return (
    /\b(how (do|can|should) i fix|how to fix|tell me how to fix|what (do|should) i (change|fix|update)|what would fix|what's the fix|what is the fix)\b/.test(text) ||
    /\b(figure out why|find out why|tell me why|explain why|diagnose|root cause|what'?s wrong|what is wrong|why is|why does|why am i|what causes|what caused|what is causing|what's causing)\b/.test(text)
  );
}

type ExistingProjectDetection = {
  stack: string;
  entryFiles: string[];
  cssFiles: string[];
  jsFiles: string[];
  packageManager: string;
  markers: string[];
  primaryLanguages: string[];
};

function existingProjectResult({
  projectId,
  projectName,
  projectPath,
  briefPath,
  stack,
  status,
  blocker,
  events,
  files,
  commands,
  execution,
  sourceMode = "uploaded-copy",
  objective,
  preview,
  sessionSummary,
  clarificationQuestions,
  verification,
}: {
  projectId: string;
  projectName: string;
  projectPath: string;
  briefPath: string;
  stack: string;
  status: FactoryProjectResult["status"];
  blocker?: string;
  events: string[];
  files: FactoryFileEntry[];
  commands: FactoryCommandEvent[];
  execution: ExecutionContext;
  sourceMode?: FactorySourceMode;
  objective?: string;
  preview?: PreviewOutcome;
  sessionSummary?: FactorySessionSummary;
  clarificationQuestions?: MissionClarification[];
  verification?: ExecutionMissionVerification[];
}): FactoryProjectResult {
  return {
    projectId,
    projectName,
    projectPath,
    briefPath,
    stack,
    template: "Existing Project",
    sourceMode,
    objective: objective ?? engineeringObjectiveForTask(execution.checklist[0]?.label ?? projectName),
    checklist: execution.checklist,
    status,
    supported: status !== "unsupported",
    blocker,
    events,
    files,
    commands,
    previewUrl: preview?.previewUrl,
    previewState: preview?.previewState,
    previewPlatform: preview?.previewPlatform,
    previewReason: preview?.previewReason,
    exportUrl: `/api/factory/export?projectId=${encodeURIComponent(projectId)}`,
    timeline: execution.timeline,
    sessionSummary,
    clarificationQuestions,
    verification,
  };
}

function accessForProjectId(projectId: string, localPath?: string, localConnector?: LocalConnectorConfig): { access: ProjectAccess; projectPath: string } {
  if (localConnector?.url) {
    return { access: createLocalConnectorProjectAccess(localConnector), projectPath: localConnector.rootLabel || localConnector.url };
  }
  if (localPath) {
    const resolved = path.resolve(localPath);
    return { access: createServerProjectAccess(resolved, "local-folder"), projectPath: resolved };
  }
  const projectPath = safeProjectPath(projectId);
  return { access: createServerProjectAccess(projectPath, "uploaded-copy"), projectPath };
}

export async function performRollback(
  projectId: string,
  entryId: string,
  options: { localPath?: string; localConnector?: LocalConnectorConfig } = {},
  onEvent?: ExecutionEmitter,
): Promise<FactoryProjectResult> {
  const execution = createExecutionContext(onEvent, projectId);
  const { access, projectPath } = accessForProjectId(projectId, options.localPath, options.localConnector);
  const result = await rollbackToEntry(access, execution, projectId, entryId);
  await emitExecution(execution, "summary", result.status === "passed" ? "completed" : "error", result.status === "passed" ? "Rollback complete" : "Rollback failed", {
    details: { revertedFiles: result.revertedFiles, blocker: result.blocker },
  });
  return existingProjectResult({
    projectId,
    projectName: "Rollback",
    projectPath,
    briefPath: `${projectPath}/foundry-brief.md`,
    stack: "Rollback",
    status: result.status === "passed" ? "passed" : "failed",
    blocker: result.blocker,
    events: result.revertedFiles.map((filePath) => `Reverted ${filePath}`),
    files: result.revertedFiles.map((filePath) => ({ path: filePath, status: "edited" as const, size: 0 })),
    commands: [],
    execution,
  });
}

function detectExistingProject(files: FactoryUploadedFile[]): ExistingProjectDetection {
  const paths = files.map((file) => file.path.replace(/\\/g, "/"));
  const lower = paths.map((item) => item.toLowerCase());
  const entryFiles = paths.filter((item) => /(^|\/)(index|main|app)\.html$/i.test(item) || /\.html$/i.test(item)).slice(0, 8);
  const cssFiles = paths.filter((item) => /\.css$/i.test(item));
  const jsFiles = paths.filter((item) => /\.(js|mjs|cjs)$/i.test(item));
  const markers: string[] = [];
  const languages = new Set<string>();
  for (const item of lower) {
    if (item.endsWith(".ts") || item.endsWith(".tsx")) languages.add("TypeScript");
    if (item.endsWith(".js") || item.endsWith(".jsx") || item.endsWith(".mjs") || item.endsWith(".cjs")) languages.add("JavaScript");
    if (item.endsWith(".cs")) languages.add("C#");
    if (item.endsWith(".java")) languages.add("Java");
    if (item.endsWith(".kt") || item.endsWith(".kts")) languages.add("Kotlin");
    if (item.endsWith(".py")) languages.add("Python");
    if (item.endsWith(".php")) languages.add("PHP");
    if (item.endsWith(".go")) languages.add("Go");
    if (item.endsWith(".rs")) languages.add("Rust");
    if (item.endsWith(".dart")) languages.add("Dart");
    if (item.endsWith(".gd")) languages.add("GDScript");
  }
  const packageManager = lower.some((item) => item.endsWith("pnpm-lock.yaml"))
    ? "pnpm"
    : lower.some((item) => item.endsWith("yarn.lock"))
      ? "yarn"
      : lower.some((item) => item.endsWith("package-lock.json") || item.endsWith("package.json"))
        ? "npm"
        : "";
  let stack = "Unknown";
  if (lower.some((item) => /next\.config\.(js|mjs|ts)$/.test(item))) {
    stack = "Next.js";
    markers.push("next.config");
  } else if (lower.some((item) => /vite\.config\.(js|ts)$/.test(item))) {
    stack = "Vite";
    markers.push("vite.config");
  } else if (lower.some((item) => item.endsWith("angular.json"))) {
    stack = "Angular";
    markers.push("angular.json");
  } else if (lower.some((item) => item.endsWith("pubspec.yaml"))) {
    stack = "Flutter/Dart";
    markers.push("pubspec.yaml");
  } else if (lower.some((item) => item.endsWith("androidmanifest.xml") || item.endsWith("build.gradle") || item.endsWith("build.gradle.kts"))) {
    stack = "Android/Gradle";
    markers.push("Gradle/Android markers");
  } else if (lower.some((item) => item.endsWith(".sln") || item.endsWith(".csproj"))) {
    stack = ".NET/C#";
    markers.push(".sln/.csproj");
  } else if (lower.some((item) => item.endsWith("requirements.txt") || item.endsWith("pyproject.toml") || item.endsWith("manage.py"))) {
    stack = "Python";
    markers.push("Python project markers");
  } else if (lower.some((item) => item.endsWith("composer.json") || item.endsWith("artisan"))) {
    stack = "PHP/Laravel";
    markers.push("composer/artisan");
  } else if (lower.some((item) => item.endsWith("go.mod"))) {
    stack = "Go";
    markers.push("go.mod");
  } else if (lower.some((item) => item.endsWith("cargo.toml"))) {
    stack = "Rust";
    markers.push("Cargo.toml");
  } else if (lower.some((item) => item.endsWith("project.godot"))) {
    stack = "Godot";
    markers.push("project.godot");
  } else if (lower.some((item) => item.endsWith("package.json"))) {
    stack = "JavaScript project";
    markers.push("package.json");
  } else if (entryFiles.length) {
    stack = "Static HTML/CSS/JS";
    markers.push("HTML entry file");
  }

  return { stack, entryFiles, cssFiles, jsFiles, packageManager, markers, primaryLanguages: Array.from(languages).sort() };
}

function projectInspectionAnswer(files: FactoryUploadedFile[], detected: ExistingProjectDetection, task: string) {
  const visibleFiles = files
    .map((file) => file.path)
    .filter((filePath) => !/(^|\/)(node_modules|\.git|\.next|dist|build|coverage)(\/|$)/i.test(filePath));
  const keyFiles = pickKeyProjectFiles(files);
  const purpose = inferProjectPurpose(files, detected);
  const askNext = /\b(can you|do you|what|why|how|see|tell|explain|inspect|look)\b/i.test(task)
    ? "Tell me what you want to change next, or ask me to inspect a specific file or behavior."
    : "What would you like Foundry to do next?";

  return [
    "I can see the project files.",
    "",
    `It appears to be a ${projectKindLabel(detected.stack)}.`,
    purpose ? `What it seems to do: ${purpose}` : "What it seems to do: I can identify the structure, but there is not enough readable application code to confidently summarize the product behavior.",
    detected.primaryLanguages.length ? `Primary languages: ${detected.primaryLanguages.join(", ")}.` : "",
    detected.markers.length ? `Project markers: ${detected.markers.join(", ")}.` : "",
    "",
    "Main files I inspected:",
    ...keyFiles.map((file) => `- ${file.path}${file.note ? `: ${file.note}` : ""}`),
    visibleFiles.length > keyFiles.length ? `- ${visibleFiles.length - keyFiles.length} more readable file${visibleFiles.length - keyFiles.length === 1 ? "" : "s"}.` : "",
    "",
    askNext,
  ].filter(Boolean).join("\n");
}

function pickKeyProjectFiles(files: FactoryUploadedFile[]) {
  const priority = [
    /(^|\/)package\.json$/i,
    /(^|\/)(index|main|app)\.html$/i,
    /(^|\/)(index|main|app)\.(js|jsx|ts|tsx)$/i,
    /(^|\/)src\/(index|main|app)\.(js|jsx|ts|tsx)$/i,
    /(^|\/)README\.md$/i,
    /(^|\/)(styles|style|main|app)\.css$/i,
  ];
  return files
    .slice()
    .sort((a, b) => {
      const ai = priority.findIndex((pattern) => pattern.test(a.path));
      const bi = priority.findIndex((pattern) => pattern.test(b.path));
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.path.localeCompare(b.path);
    })
    .slice(0, 8)
    .map((file) => ({ path: file.path, note: summarizeFileRole(file) }));
}

function summarizeFileRole(file: FactoryUploadedFile) {
  const lower = file.path.toLowerCase();
  if (lower.endsWith("package.json")) return "project metadata and scripts";
  if (lower.endsWith(".html")) return "browser page/markup";
  if (lower.endsWith(".css")) return "styling";
  if (/\.(js|jsx|ts|tsx)$/.test(lower)) return "application logic";
  if (lower.endsWith("readme.md")) return "project documentation";
  if (lower.endsWith(".json")) return "configuration or data";
  return "";
}

function inferProjectPurpose(files: FactoryUploadedFile[], detected: ExistingProjectDetection) {
  const packageFile = files.find((file) => /(^|\/)package\.json$/i.test(file.path));
  if (packageFile) {
    try {
      const pkg = JSON.parse(packageFile.content) as { name?: string; description?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      if (pkg.description) return pkg.description;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) return "a Next.js web application";
      if (deps.vite || deps["@vitejs/plugin-react"]) return "a Vite/React-style web application";
      if (pkg.scripts?.start || pkg.scripts?.dev) return `a JavaScript project with ${Object.keys(pkg.scripts).join(", ")} script${Object.keys(pkg.scripts).length === 1 ? "" : "s"}`;
      if (pkg.name) return `a JavaScript package named ${pkg.name}`;
    } catch {
      // Ignore malformed package metadata and infer from files below.
    }
  }
  if (detected.entryFiles.length) return "a static browser project with HTML entry files";
  if (detected.cssFiles.length && detected.jsFiles.length) return "a browser project with separate styling and JavaScript";
  if (detected.jsFiles.length) return "a JavaScript project or script-based app";
  return "";
}

function projectKindLabel(stack: string) {
  return /\bproject$/i.test(stack) ? stack : `${stack} project`;
}

async function writeVirtualFilesToDisk(projectPath: string, contents: Map<string, string>) {
  for (const [filePath, content] of contents.entries()) {
    const relativePath = safeRelativePath(filePath);
    if (!relativePath) continue;
    const fullPath = path.join(projectPath, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
}

async function listProjectFilesWithStatuses(projectPath: string, changedFiles: string[], originalPaths: Set<string>): Promise<FactoryFileEntry[]> {
  const changed = new Set(changedFiles);
  const files = await listProjectFiles(projectPath);
  return Promise.all(files.map(async (file) => {
    const isChanged = changed.has(file.path);
    const fullPath = path.join(projectPath, file.path);
    return {
      ...file,
      status: isChanged ? (originalPaths.has(file.path) ? "edited" as const : "created" as const) : "uploaded" as const,
      content: isChanged ? await readFile(fullPath, "utf8").catch(() => undefined) : undefined,
    };
  }));
}

async function listConnectorFilesWithStatuses(access: ReturnType<typeof createLocalConnectorProjectAccess>, changedFiles: string[]): Promise<FactoryFileEntry[]> {
  const changed = new Set(changedFiles);

  async function visit(relativePath: string): Promise<FactoryFileEntry[]> {
    const children = await access.listDir(relativePath);
    const nested = await Promise.all(
      children.map(async (child): Promise<FactoryFileEntry[]> => {
        const childPath = relativePath ? `${relativePath}/${child.name}` : child.name;
        if (child.kind === "directory") return visit(childPath);
        const isChanged = changed.has(childPath);
        const read = isChanged ? await access.readFile(childPath, { offsetBytes: 0, limitBytes: 300_000 }) : null;
        return [{
          path: childPath,
          status: isChanged ? ("edited" as const) : ("uploaded" as const),
          size: child.size ?? read?.totalBytes ?? 0,
          content: isChanged && read?.exists ? read.content : undefined,
        }];
      }),
    );
    return nested.flat();
  }

  const entries = await visit("");
  const knownPaths = new Set(entries.map((entry) => entry.path));
  const backfilled = await Promise.all(
    changedFiles
      .filter((changedFile) => !knownPaths.has(changedFile))
      .map(async (changedFile) => {
        const read = await access.readFile(changedFile, { offsetBytes: 0, limitBytes: 300_000 });
        return { path: changedFile, status: "created" as const, size: read.totalBytes, content: read.exists ? read.content : undefined };
      }),
  );
  return [...entries, ...backfilled].sort((a, b) => a.path.localeCompare(b.path));
}

async function readLocalProjectFiles(projectPath: string) {
  const files: FactoryUploadedFile[] = [];
  let totalSize = 0;
  const maxTotalSize = 2_500_000;
  const maxFileSize = 300_000;

  async function visit(current: string) {
    if (totalSize >= maxTotalSize) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(projectPath, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (/(^|\/)(node_modules|\.git|\.next|dist|build|coverage|target|bin|obj)(\/|$)/i.test(relativePath)) continue;
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !isUsefulUploadedFile(relativePath)) continue;
      const details = await stat(fullPath);
      if (details.size > maxFileSize || totalSize + details.size > maxTotalSize) continue;
      files.push({ path: relativePath, content: await readFile(fullPath, "utf8"), size: details.size });
      totalSize += details.size;
    }
  }

  await visit(projectPath);
  return files;
}

function connectedProjectPathFromFiles(files: FactoryUploadedFile[]) {
  const paths = files.map((file) => safeRelativePath(file.path)).filter(Boolean);
  const root = commonTopLevelPath(paths);
  return root ? `Connected upload: ${root}` : "Connected upload";
}

function commonTopLevelPath(paths: string[]) {
  if (!paths.length) return "";
  const first = paths[0].split("/")[0] ?? "";
  return paths.every((item) => item.split("/")[0] === first) ? first : "multiple selected roots";
}

function isUsefulUploadedFile(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)(node_modules|\.git|\.next|dist|build|coverage|target|bin|obj)(\/|$)/.test(normalized)) return false;
  if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|cargo\.lock)$/.test(normalized)) return true;
  return /\.(html|css|js|mjs|cjs|json|md|txt|ts|tsx|jsx|vue|svelte|py|php|cs|java|kt|kts|go|rs|rb|swift|dart|xml|toml|gradle|properties|yml|yaml)$/i.test(normalized);
}

function safeRelativePath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === ".." || part.includes(":"))) return "";
  return parts.join("/");
}

function wantsAssetSeparation(text: string) {
  return /\b(separate|seperate|saparate|split|extract|move)\b/.test(text) || /\bseparat(?:e|ed|ing)?\s+files?\b/.test(text);
}

function isStylingRequest(text: string) {
  return /\b(style|styling|design|nicer|modern|polish|beautiful|responsive|mobile|ux|ui|form|bordered|color|colour|background|bg|green|red|blue|yellow|orange|purple|pink|black|white|gray|grey|button|buttons|input|inputs|header|heading|title|label|labels|cursor|pointer|hand|hover|clickable|rounded|radius|shadow|spacing|padding|margin|font|size)\b/.test(text);
}

export function safeProjectPath(projectId: string) {
  const cleanId = projectId.replace(/[^a-z0-9-]/gi, "");
  const projectPath = path.resolve(projectsRoot, cleanId);
  const resolvedRoot = path.resolve(projectsRoot);
  if (!projectPath.startsWith(resolvedRoot)) throw new Error("Invalid project id.");
  if (!existsSync(projectPath)) throw new Error("Project workspace was not found.");
  return projectPath;
}

export async function deleteFactoryProject(projectId: string) {
  const cleanId = projectId.replace(/[^a-z0-9-]/gi, "");
  const projectPath = path.resolve(projectsRoot, cleanId);
  const resolvedRoot = path.resolve(projectsRoot);
  if (!cleanId || !projectPath.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Invalid project id.");
  await rm(projectPath, { recursive: true, force: true });
}

async function uniqueProjectPath(slug: string) {
  await mkdir(projectsRoot, { recursive: true });
  let candidate = path.join(projectsRoot, slug);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = path.join(projectsRoot, `${slug}-${index}`);
    index += 1;
  }
  return candidate;
}

function parseBrief(brief: string): ProjectSpec {
  const projectName = lineValue(brief, "Project name") || lineValue(brief, "Create Project") || "Foundry Project";
  const template = lineValue(brief, "Template") || "Custom Build";
  const stack = lineValue(brief, "Selected stack") || lineValue(brief, "Preferred stack") || "Next.js";
  const projectType = lineValue(brief, "Project type") || template;
  const projectDescription = lineValue(brief, "Project description");
  const projectSource = lineValue(brief, "Project source");
  const selectedUploadPaths = splitSelectedPaths(lineValue(brief, "Selected upload paths"));
  const existingSourceGuard = lineValue(brief, "Existing source guard");
  const rawInstructions = lineValue(brief, "Custom instructions");
  const instructions = rawInstructions && rawInstructions.toLowerCase() !== "none" ? rawInstructions : "";

  return {
    projectName,
    template,
    stack,
    projectType,
    projectDescription,
    projectSource,
    selectedUploadPaths,
    existingSourceGuard,
    instructions,
    slug: slugify(projectName),
  };
}

function splitSelectedPaths(value: string) {
  if (!value.trim()) return [];
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

function inspectExistingSourceSelection(spec: ProjectSpec) {
  const sourceText = `${spec.projectSource} ${spec.existingSourceGuard}`.toLowerCase();
  if (!sourceText.includes("existing") && spec.selectedUploadPaths.length === 0) return "";

  const analysis = inspectSourcePaths(spec.selectedUploadPaths);
  if (analysis.risky) {
    return `Inspected existing source selection before writing: ${analysis.message}`;
  }
  return spec.selectedUploadPaths.length
    ? "Inspected existing source selection before writing: no obvious project-root conflict from selected paths."
    : "Existing source mode selected without writable local-folder access; generation will use a separate Foundry workspace.";
}

function inspectSourcePaths(names: string[]) {
  const normalized = names.map((name) => name.replace(/\\/g, "/"));
  const roots = new Set(normalized.map((name) => name.split("/")[0]).filter(Boolean));
  const lower = normalized.map((name) => name.toLowerCase());
  const hasProjectMarkers = lower.some((name) =>
    /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|next\.config\.(js|mjs|ts)|vite\.config\.(js|ts)|angular\.json|pom\.xml|build\.gradle|settings\.gradle|\.csproj|\.sln|pubspec\.yaml|cargo\.toml|go\.mod)$/i.test(name),
  );
  const hasRepoOrBuildFolders = lower.some((name) => /(^|\/)(\.git|node_modules|\.next|dist|build|target|bin|obj)(\/|$)/i.test(name));
  const hasManyLooseFiles = normalized.length > 12 && roots.size > Math.max(3, normalized.length / 4);
  const risky = roots.size > 1 || hasProjectMarkers || hasRepoOrBuildFolders || hasManyLooseFiles;

  return {
    risky,
    message: risky
      ? "selection appears to contain an existing project, multiple folders, generated output, or unrelated files."
      : "selection does not show obvious unrelated project markers from available browser paths.",
  };
}

function lineValue(brief: string, label: string) {
  return brief.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
}

function isSupportedStack(stack: string) {
  return isNextStack(stack) || /\b(html|css|js|javascript|static)\b/i.test(stack);
}

function isNextStack(stack: string) {
  return /\bnext(?:\.js)?\b/i.test(stack);
}

/** Mirrors the stacks startPreview() can actually spin up a real, live preview for today —
 * only offer the mock-first gate when "Open Preview" will genuinely work. */
function hasLivePreviewFor(stack: string) {
  return isNextStack(stack) || /\b(html|css|static)\b/i.test(stack);
}

/**
 * Whether a stack has a build/test/dev step that can actually exit 0 and serve as runtime verification.
 * A pure static HTML/CSS/JS site (and an unrecognized/unknown project) has none — a static preview
 * server never exits 0 — so the executor must NOT hard-require a runtime command to complete such a
 * mission (see verifyCompletion's hasBuildTooling gate in lib/ai/mission/executor.ts). Everything with a
 * real toolchain (Next.js, Node, Python, .NET, Java, Go, Rust, etc.) keeps the stricter requirement.
 */
function stackHasBuildStep(stackId: string): boolean {
  return stackId !== "static-html" && stackId !== "unknown";
}

async function noteMissingDependencies(projectPath: string, packageManager: string, execution: ExecutionContext) {
  if (!packageManager) return;
  const packagePath = path.join(projectPath, "package.json");
  if (!existsSync(packagePath)) return;
  if (existsSync(path.join(projectPath, "node_modules"))) return;
  try {
    const manifest = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
    const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
    const declaredCount = dependencyGroups.reduce((count, key) => {
      const group = manifest[key];
      return count + (group && typeof group === "object" ? Object.keys(group).length : 0);
    }, 0);
    if (declaredCount === 0) return;
  } catch {
    // Invalid package metadata should not suppress the normal dependency warning.
  }
  const installCommand = packageManager === "yarn" ? "yarn.cmd" : packageManager === "pnpm" ? "pnpm.cmd" : "npm.cmd";
  const installArgs = packageManager === "yarn" ? ["install", "--prefer-offline"] : packageManager === "pnpm" ? ["install", "--prefer-offline"] : ["install", "--prefer-offline", "--no-audit", "--no-fund"];
  const command = [installCommand, ...installArgs].join(" ");
  await emitExecution(execution, "blocked", "warning", `Permission needed: ${command}`, {
    tier: "flag",
    command,
    details: {
      category: "dependencies",
      reason: "package.json is present but node_modules is missing. Foundry will not install dependencies unless you approve the install command.",
    },
  });
}

function runCommand(cwd: string, command: string, args: string[], events: string[], execution?: ExecutionContext) {
  const printable = [command, ...args].join(" ");
  events.push(`Running command: ${printable}`);
  const startedAt = Date.now();
  void (execution ? emitExecution(execution, "command", "running", `Running ${printable}`, { command: printable, details: { cwd } }) : Promise.resolve());

  return new Promise<FactoryCommandEvent>((resolve) => {
    const child = spawn(command, args, { cwd, shell: true, windowsHide: true, env: { ...process.env, NODE_ENV: isBuildCommand(command, args) ? "production" : process.env.NODE_ENV } });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const output = chunk.toString();
      stdout += output;
      if (execution) void emitExecution(execution, "stdout", "running", `stdout: ${printable}`, { command: printable, output });
    });
    child.stderr.on("data", (chunk) => {
      const output = chunk.toString();
      stderr += output;
      if (execution) void emitExecution(execution, "stderr", "warning", `stderr: ${printable}`, { command: printable, output });
    });
    child.on("error", (error) => {
      stderr += error.message;
      events.push(`Command failed: ${printable}`);
      const durationMs = Date.now() - startedAt;
      if (execution) void emitExecution(execution, "command", "error", `Command failed: ${printable}`, { command: printable, output: error.message, exitCode: null, durationMs });
      resolve({ command: printable, exitCode: null, stdout, stderr, durationMs });
    });
    child.on("close", (exitCode) => {
      events.push(`Command finished (${exitCode ?? "unknown"}): ${printable}`);
      const durationMs = Date.now() - startedAt;
      if (execution) {
        void emitExecution(execution, "command", exitCode === 0 ? "completed" : "error", `Command finished: ${printable}`, {
          command: printable,
          exitCode,
          durationMs,
          output: trimOutput(stderr || stdout),
          details: { duration: formatDuration(durationMs) },
        });
        const dependenciesInstalled = dependencyCountFromInstallOutput(stdout);
        if (exitCode === 0 && isInstallCommand(command, args) && dependenciesInstalled > 0) {
          void emitExecution(execution, "summary", "completed", `Installed ${dependenciesInstalled} dependencies`, {
            command: printable,
            details: { dependenciesInstalled },
          });
        }
      }
      resolve({ command: printable, exitCode, stdout: trimOutput(stdout), stderr: trimOutput(stderr), durationMs });
    });
  });
}

type PreviewOutcome = { previewUrl?: string; previewState: FactoryPreviewState; previewPlatform: FactoryPreviewPlatform; previewReason?: string };

function previewPlatformForStack(stack: string): FactoryPreviewPlatform {
  if (/game|phaser|three\.js|webgl/i.test(stack)) return "game";
  if (/database|schema|sql|postgres|mysql|sqlite|prisma/i.test(stack)) return "database";
  if (/\bcli\b|command.line|terminal/i.test(stack)) return "cli";
  if (/report|document|pdf|analytics|dashboard/i.test(stack)) return "report";
  if (/android|gradle/i.test(stack)) return "android";
  if (/flutter|react native|swift|ios/i.test(stack)) return "mobile";
  if (/\.net|c#|wpf|winforms|unity|godot/i.test(stack)) return "desktop";
  if (/node\/express|express|fastapi|django|flask|\bapi\b|backend|microservice/i.test(stack)) return "api";
  return "web";
}

function previewUnavailableReason(platform: FactoryPreviewPlatform, stack: string) {
  if (platform === "android") return "Android preview needs a connected device or emulator, which Foundry does not have access to in this environment.";
  if (platform === "desktop") return `${stack} is a native desktop stack — Foundry can't render its UI without running it on your machine.`;
  if (platform === "mobile") return "Mobile app preview needs a device or simulator, which isn't available in this environment.";
  if (platform === "cli") return "The command-line project needs a safe dry-run command before Foundry can open an interactive terminal preview.";
  if (platform === "database") return "A database explorer needs a configured local database connection.";
  if (platform === "report") return "No browser-readable report entry file was detected.";
  if (platform === "game") return "This game stack does not expose a browser-playable entry point yet.";
  return `Foundry does not yet run a live preview for ${stack}.`;
}

async function startPreview(projectId: string, projectPath: string, stack: string, events: string[], execution?: ExecutionContext): Promise<PreviewOutcome> {
  const platform = previewPlatformForStack(stack);
  const existing = previewProcesses.get(projectId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return { previewUrl: `http://localhost:${existing.port}`, previewState: "ready", previewPlatform: platform };
  }

  if (isNextStack(stack)) {
    return startNextPreview(projectId, projectPath, events, execution, platform);
  }

  // Any other Node-based project (an Express API, a Vite app, a hand-rolled server) can still get a
  // real live preview — read its actual package.json scripts rather than guessing a framework-specific
  // command, and run whichever real script is there against a PORT env var, the one convention nearly
  // every Node HTTP server already respects.
  const nodeScript = await detectNodeStartScript(projectPath);
  if (nodeScript) {
    return startGenericNodePreview(projectId, projectPath, nodeScript, events, execution, platform);
  }

  if (/\b(html|css|static)\b/i.test(stack)) {
    const rootEntries = await readdir(projectPath).catch(() => [] as string[]);
    const entryFile = rootEntries.find((name) => name.toLowerCase() === "index.html") ?? rootEntries.find((name) => name.toLowerCase().endsWith(".html"));
    if (!entryFile) {
      const reason = "No HTML entry file was found in the project root, so there is nothing to preview yet.";
      if (execution) await emitExecution(execution, "preview", "skipped", "Preview unavailable", { details: { reason } });
      return { previewState: "unavailable", previewPlatform: "web", previewReason: reason };
    }
    return startStaticPreview(projectId, projectPath, entryFile, events, execution);
  }

  if (platform === "desktop") {
    const executable = await findDesktopExecutable(projectPath);
    if (executable) {
      desktopPreviewTargets.set(projectId, executable);
      const reason = `Desktop build ready: ${path.basename(executable)}. Use Launch desktop app to run it.`;
      if (execution) await emitExecution(execution, "preview", "completed", "Desktop app ready to launch", { details: { executable: path.basename(executable) } });
      return { previewState: "ready", previewPlatform: "desktop", previewReason: reason };
    }
  }

  const reason = previewUnavailableReason(platform, stack);
  if (execution) await emitExecution(execution, "preview", "skipped", "Preview unavailable", { details: { reason, stack } });
  return { previewState: "unavailable", previewPlatform: platform, previewReason: reason };
}

async function findDesktopExecutable(projectPath: string): Promise<string | undefined> {
  const queue = [projectPath];
  while (queue.length) {
    const current = queue.shift() as string;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "obj") continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (queue.length < 200) queue.push(fullPath);
      } else if (entry.name.toLowerCase().endsWith(".exe") && /[\\/]bin[\\/]/i.test(fullPath)) {
        return fullPath;
      }
    }
  }
  return undefined;
}

export function launchDesktopPreview(projectId: string) {
  const executable = desktopPreviewTargets.get(projectId);
  if (!executable || !existsSync(executable)) return { ok: false, error: "No built desktop executable is available for this project yet." };
  const child = spawn(executable, [], { cwd: path.dirname(executable), detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { ok: true, executable: path.basename(executable) };
}

async function startStaticPreview(projectId: string, projectPath: string, entryFile: string, events: string[], execution?: ExecutionContext): Promise<PreviewOutcome> {
  const port = await findPreviewPort();
  const scriptPath = path.join(process.cwd(), "scripts", "foundry-static-preview.cjs");
  if (execution) await emitExecution(execution, "preview", "running", "Starting interactive static preview", { details: { port, entryFile } });
  const child = spawn(process.execPath, [scriptPath, projectPath, String(port)], { cwd: projectPath, detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  previewProcesses.set(projectId, { port, processId: child.pid, lastUsedAt: Date.now() });
  const previewUrl = `http://localhost:${port}/${encodeURIComponent(entryFile)}`;
  const ready = await waitForPreviewReady(port);
  events.push(ready ? `Interactive preview ready: ${previewUrl}` : `Preview still starting: ${previewUrl}`);
  if (execution) await emitExecution(execution, "preview", ready ? "completed" : "warning", ready ? "Interactive preview ready" : "Preview still starting", { details: { previewUrl, port, entryFile, ready } });
  return { previewUrl, previewState: ready ? "ready" : "starting", previewPlatform: "web" };
}

async function startNextPreview(projectId: string, projectPath: string, events: string[], execution: ExecutionContext | undefined, platform: FactoryPreviewPlatform): Promise<PreviewOutcome> {
  const port = await findPreviewPort();
  if (execution) await emitExecution(execution, "preview", "running", "Starting development server", { command: `npm.cmd run dev -- -p ${port}`, details: { port } });
  const child = spawn("npm.cmd", ["run", "dev", "--", "-p", String(port)], {
    cwd: projectPath,
    shell: true,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  previewProcesses.set(projectId, { port, processId: child.pid, lastUsedAt: Date.now() });
  const previewUrl = `http://localhost:${port}`;
  const ready = await waitForPreviewReady(port);
  events.push(ready ? `Preview ready: ${previewUrl}` : `Preview still starting: ${previewUrl}`);
  if (execution) {
    await emitExecution(execution, "preview", ready ? "completed" : "warning", ready ? "Preview ready" : "Preview still starting", { details: { previewUrl, port, ready } });
  }
  return { previewUrl, previewState: ready ? "ready" : "starting", previewPlatform: platform };
}

/** Reads the project's actual package.json scripts and returns the first real, existing one worth
 * running as a preview server, in the order a person would try them — never a guessed/invented name. */
async function detectNodeStartScript(projectPath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    return ["dev", "start", "serve"].find((name) => typeof scripts[name] === "string");
  } catch {
    return undefined;
  }
}

async function startGenericNodePreview(
  projectId: string,
  projectPath: string,
  script: string,
  events: string[],
  execution: ExecutionContext | undefined,
  platform: FactoryPreviewPlatform,
): Promise<PreviewOutcome> {
  const port = await findPreviewPort();
  if (execution) await emitExecution(execution, "preview", "running", "Starting development server", { command: `npm.cmd run ${script}`, details: { port, script } });
  const child = spawn("npm.cmd", ["run", script], {
    cwd: projectPath,
    shell: true,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
  previewProcesses.set(projectId, { port, processId: child.pid, lastUsedAt: Date.now() });
  const previewUrl = `http://localhost:${port}`;
  const ready = await waitForPreviewReady(port);
  events.push(ready ? `Preview ready: ${previewUrl}` : `Preview still starting: ${previewUrl}`);
  if (execution) {
    await emitExecution(execution, "preview", ready ? "completed" : "warning", ready ? "Preview ready" : "Preview still starting", { details: { previewUrl, port, ready, script } });
  }
  return { previewUrl, previewState: ready ? "ready" : "starting", previewPlatform: platform };
}

async function waitForPreviewReady(port: number, attempts = 8, delayMs = 400): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(`http://localhost:${port}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.status < 500) return true;
    } catch {
      // Not ready yet — the dev server is likely still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function startConnectorPreview(connector: LocalConnectorConfig): Promise<PreviewOutcome> {
  try {
    const baseUrl = connector.url.replace(/\/+$/, "");
    const headers = { "content-type": "application/json", ...(connector.token ? { authorization: `Bearer ${connector.token}` } : {}) };
    const response = await fetch(`${baseUrl}/preview/start`, { method: "POST", headers, body: JSON.stringify({ root: connector.rootLabel || "", path: "" }) });
    const payload = (await response.json().catch(() => ({}))) as { previewUrl?: string; state?: string; reason?: string; error?: string };
    if (!response.ok) return { previewState: "error", previewPlatform: "web", previewReason: payload.error || "The local connector could not start a preview." };
    return { previewUrl: payload.previewUrl, previewState: payload.state === "ready" ? "ready" : payload.state === "starting" ? "starting" : "error", previewPlatform: "web", previewReason: payload.reason };
  } catch (error) {
    return { previewState: "error", previewPlatform: "web", previewReason: error instanceof Error ? error.message : "Could not reach the local connector to start a preview." };
  }
}

function stopPreview(projectId: string) {
  const preview = previewProcesses.get(projectId);
  if (!preview) return;
  if (preview.processId) {
    try {
      process.kill(preview.processId);
    } catch {
      // The process may have already exited.
    }
  }
  previewProcesses.delete(projectId);
}

const PREVIEW_IDLE_MS = 30 * 60 * 1000;
if (typeof setInterval === "function") {
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [projectId, preview] of previewProcesses.entries()) {
      if (now - preview.lastUsedAt > PREVIEW_IDLE_MS) stopPreview(projectId);
    }
  }, 5 * 60 * 1000);
  sweep.unref?.();
}

export function getPreviewStatus(projectId: string): { previewState: FactoryPreviewState; previewUrl?: string } {
  const preview = previewProcesses.get(projectId);
  if (!preview) return { previewState: "unavailable" };
  preview.lastUsedAt = Date.now();
  return { previewState: "ready", previewUrl: `http://localhost:${preview.port}` };
}

export function stopPreviewForProject(projectId: string) {
  stopPreview(projectId);
}

async function findPreviewPort() {
  const usedPorts = new Set(Array.from(previewProcesses.values()).map((process) => process.port));
  for (let port = 3100; port < 3200; port += 1) {
    if (!usedPorts.has(port) && (await isPortAvailable(port))) return port;
  }
  return 3199;
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function summarizeCommandFailure(command: FactoryCommandEvent) {
  const output = `${command.stderr}\n${command.stdout}`.trim();
  return output.split(/\r?\n/).filter(Boolean).slice(-8).join("\n") || `${command.command} failed.`;
}

function isBuildCommand(command: string, args: string[]) {
  return /npm(?:\.cmd)?/i.test(command) && args.join(" ") === "run build";
}

function isInstallCommand(command: string, args: string[]) {
  return /npm(?:\.cmd)?/i.test(command) && args.join(" ") === "install";
}

function dependencyCountFromInstallOutput(output: string) {
  const added = output.match(/added\s+(\d+)\s+packages?/i);
  if (added?.[1]) return Number(added[1]);
  const changed = output.match(/(?:changed|updated)\s+(\d+)\s+packages?/i);
  if (changed?.[1]) return Number(changed[1]);
  return 0;
}

function createExecutionContext(onEvent?: ExecutionEmitter, projectId?: string): ExecutionContext {
  const timeline: FactoryExecutionEvent[] = [];
  return {
    timeline,
    checklist: [],
    projectId,
    emit: async (event) => {
      timeline.push(event);
      if (projectId && !event.internal) {
        await appendJournalEntry(projectId, event).catch(() => {
          // Durable journaling is best-effort; the live timeline already reached the client.
        });
      }
      await onEvent?.(event);
    },
  };
}

function initializeObjectiveChecklist(execution: ExecutionContext, task: string, sourceMode: FactorySourceMode) {
  if (sourceMode !== "new-project") {
    execution.checklist.splice(0, execution.checklist.length, ...checklistForRequest(task, sourceMode === "local-folder" ? "the connected local folder" : "the Foundry copy"));
    return;
  }
  const items: FactoryObjectiveChecklistItem[] = [
    { id: "understand-goal", label: engineeringObjectiveForTask(task), status: "running" },
    { id: "read-project", label: "Read the actual project files before editing", status: "pending" },
    ...objectiveItemsForTask(task),
    { id: "files-on-disk", label: "Verify generated files in the Foundry workspace", status: "pending" },
    { id: "final-result", label: "Summarize completion against the original request", status: "pending" },
  ];
  execution.checklist.splice(0, execution.checklist.length, ...dedupeChecklist(items));
}

function engineeringObjectiveForTask(task: string) {
  const normalized = task.trim().replace(/\s+/g, " ");
  return normalized ? `Complete goal: ${normalized}` : "Complete the requested project work";
}

function objectiveItemsForTask(task: string): FactoryObjectiveChecklistItem[] {
  const text = task.toLowerCase();
  const items: FactoryObjectiveChecklistItem[] = [];
  if (/\b(fields?|columns?|excel|spreadsheet|upload|mapping|transaction|tx|payload)\b/.test(text) && /\b(dynamic|config|configuration|frontend|ui|edit|add|remove|required|optional|hardcoded|hard-coded|server\.js)\b/.test(text)) {
    items.push(
      { id: "inspect-current-ux", label: "Inspect the current field UI and styling before changing it", status: "pending" },
      { id: "persist-field-config", label: "Persist editable fields in a config file instead of backend code", status: "pending" },
      { id: "server-dynamic-fields", label: "Server reads saved field configuration for transaction/upload mapping", status: "pending" },
      { id: "field-manager-ui", label: "Polished UI lets users add, edit, require, and remove fields", status: "pending" },
      { id: "frontend-dynamic-form", label: "Frontend test form is generated from saved field configuration", status: "pending" },
      { id: "field-config-verified", label: "Re-read changed files and verify the dynamic field behavior path", status: "pending" },
    );
  }
  if (/\b(html|css|style|styles|stylesheet|js|javascript|script|ux|ui|form|border|bordered)\b/.test(text)) {
    items.push({ id: "locate-assets", label: "Locate relevant HTML/CSS/JS/UI files", status: "pending" });
  }
  if (wantsAssetSeparation(text) && /\b(css|style|styling)\b/.test(text)) {
    items.push(
      { id: "stylesheet-exists", label: "Stylesheet file exists on disk", status: "pending" },
      { id: "html-links-css", label: "HTML links the stylesheet", status: "pending" },
      { id: "inline-css-removed", label: "Inline <style> blocks removed from HTML", status: "pending" },
      { id: "css-separated", label: "CSS separated into a referenced stylesheet", status: "pending" },
    );
  }
  if (wantsAssetSeparation(text) && /\b(js|javascript|script)\b/.test(text)) {
    items.push(
      { id: "script-exists", label: "Script file exists on disk", status: "pending" },
      { id: "html-loads-js", label: "HTML loads the script file", status: "pending" },
      { id: "inline-js-removed", label: "Inline <script> blocks removed from HTML", status: "pending" },
      { id: "js-separated", label: "JavaScript separated into a referenced script file", status: "pending" },
    );
  }
  if (isStylingRequest(text)) {
    items.push({ id: "styling-improved", label: "Styling improved without replacing the project blindly", status: "pending" });
  }
  items.push({ id: "references-checked", label: "References checked after edits", status: "pending" });
  return items;
}

function dedupeChecklist(items: FactoryObjectiveChecklistItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function completeChecklistItem(execution: ExecutionContext, id: string, status: FactoryObjectiveChecklistItem["status"], evidence?: string) {
  const item = execution.checklist.find((entry) => entry.id === id);
  if (!item) return;
  item.status = status;
  item.evidence = evidence ?? item.evidence;
}

async function pauseForPlanConflicts(execution: ExecutionContext, conflicts: string[]): Promise<{ status: "needs-clarification"; blocker: string; clarificationQuestions: MissionClarification[] }> {
  // A mission may discover several unresolved decisions, but only the earliest blocker is surfaced.
  // Later decisions are re-evaluated after this answer so the canvas never presents competing prompts.
  const question = conflicts[0] || "One requirement needs your input before I continue.";
  await emitExecution(execution, "reasoning", "warning", question, {
    tier: "flag",
    rationale: question,
    narrative: { id: `conflict-${Math.random().toString(16).slice(2)}`, tier: "flag", rationale: question, evidence: [], source: "conflict" },
  });
  const blocker = "One requirement needs your input before I continue.";
  await emitExecution(execution, "summary", "warning", "Needs your input before continuing", { details: { reason: blocker, questions: [question] } });
  finishObjectiveChecklist(execution, "needs-clarification", blocker);
  return {
    status: "needs-clarification",
    blocker,
    clarificationQuestions: conflicts.map((conflict) => ({
      question: conflict,
      options: clarificationOptionsFromQuestion(conflict),
    })),
  };
}

/** Turn an explicit either/or clarification into clickable choices. Open-ended questions deliberately
 * return no options so the composer remains available for a real free-text answer. */
function clarificationOptionsFromQuestion(question: string): string[] | undefined {
  const normalized = question.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.+?)\s+or\s+(.+?)[?.!]*$/i);
  if (!match) return undefined;

  let left = match[1].trim();
  let right = match[2].trim();
  left = left.replace(/^.*?\b(?:should\s+(?:use|be|have|keep|remove|choose)|would\s+(?:use|be|have|keep|remove|choose|prefer)|do\s+you\s+(?:want|prefer)|whether\s+(?:to\s+)?(?:use|be|have|keep|remove|choose))\s+/i, "");
  right = right.replace(/^(?:should\s+)?(?:use|be|have|keep|remove|choose)\s+/i, "");

  const options = [left, right]
    .map((option) => option.replace(/^(?:a|an|the)\s+/i, "").replace(/[?.!]+$/, "").trim())
    .filter((option) => option.length >= 2 && option.length <= 100);
  if (options.length !== 2 || options[0].toLowerCase() === options[1].toLowerCase()) return undefined;
  return options.map((option) => option.charAt(0).toUpperCase() + option.slice(1));
}

function finishObjectiveChecklist(execution: ExecutionContext, status: FactoryProjectResult["status"], blocker?: string) {
  // A mock-review pause is an intentional checkpoint mid-plan, not a stuck/failed mission — later-phase
  // items stay "pending" so the follow-up that continues the build picks them back up correctly.
  const isPausedForMockReview = status === "awaiting-mock-approval";
  for (const item of execution.checklist) {
    if (item.status === "running") item.status = status === "passed" ? "completed" : isPausedForMockReview ? "pending" : "blocked";
    if (item.status === "pending" && status !== "passed" && !isPausedForMockReview) {
      item.status = "blocked";
      item.evidence = blocker || "Stopped because the objective could not be completed with the available project executor.";
    }
  }
  completeChecklistItem(
    execution,
    "final-result",
    status === "passed" ? "completed" : isPausedForMockReview ? "pending" : "blocked",
    status === "passed" ? "Final summary maps to the requested goal." : isPausedForMockReview ? undefined : blocker,
  );
}

async function emitExecution(
  execution: ExecutionContext,
  kind: FactoryExecutionEventKind,
  status: FactoryExecutionEventStatus,
  title: string,
  event: Partial<Omit<FactoryExecutionEvent, "id" | "timestamp" | "kind" | "status" | "title">> = {},
) {
  await execution.emit({
    id: `event-${Date.now()}-${execution.timeline.length}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    kind,
    status,
    title,
    ...event,
  });
  if (!event.internal) await pauseForLiveStream();
}

function pauseForLiveStream() {
  return new Promise((resolve) => setTimeout(resolve, 90));
}

function lineCount(content: string) {
  return content.split(/\r?\n/).length;
}

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function trimOutput(value: string) {
  return value.length > 20000 ? `${value.slice(0, 20000)}\n[output truncated]` : value;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || "foundry-project";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
