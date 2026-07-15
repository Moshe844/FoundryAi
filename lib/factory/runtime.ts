import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { capabilityLevelForStackChoice, checklistForRequest, detectStackProfile, isLikelySmallSingleFileRequest, unsupportedCreationMessage, unsupportedEditingMessage, type StackCapabilityLevel, type StackProfile } from "@/lib/factory/language-adapters";
import { classifyIntent, deterministicMutationIntent, deterministicTaskAssessment } from "@/lib/ai/mission/intent-classifier";
import { runReadOnlyInspection } from "@/lib/ai/mission/inspector";
import { planMission } from "@/lib/ai/mission/mission-planner";
import { extractAtomicUserRequirements, requiresPolishedUiAcceptance } from "@/lib/ai/mission/requirement-contract";
import { runMissionExecutor } from "@/lib/ai/mission/executor";
import { reviewArchitecture } from "@/lib/ai/mission/architecture-review";
import { verifyMissionResult } from "@/lib/ai/mission/mission-verifier";
import { verificationAction, verificationImproved, verificationRisk } from "@/lib/ai/mission/verification-policy";
import { detectVerificationProfile } from "@/lib/verification/project-detector";
import type { VerificationProfile } from "@/lib/verification/types";
import { assessMissionComplexity, shouldRunArchitectureReview, shouldRunVerify, tierForStage } from "@/lib/ai/mission/orchestration";
import { createExecutionStrategy, tierForCapability, type ExecutionStrategy } from "@/lib/ai/mission/execution-strategy";
import { DEFAULT_MISSION_QUALITY, type MissionQualityLevel } from "@/lib/ai/mission/quality-level";
import type { ProviderId } from "@/lib/ai/providers/types";
import { apiKeyForProvider } from "@/lib/ai/providers/dispatch";
import type { ModelMode, ModelTier } from "@/lib/ai/model-router";
import { routeDynamically } from "@/lib/ai/routing/dynamic-router";
import { profileTask } from "@/lib/ai/routing/task-profiler";
import type { DynamicTaskAssessment } from "@/lib/ai/routing/types";
import { discoverProjectWorkingSet, type ProjectWorkingSet } from "@/lib/ai/routing/project-working-set";
import { createLocalConnectorProjectAccess, createServerProjectAccess, type LocalConnectorConfig, type ProjectAccess } from "@/lib/ai/mission/project-access";
import type { ExecutionMissionVerification, FactoryArtifact, FactoryCommandEvent, FactoryExecutionEvent, FactoryExecutionEventKind, FactoryExecutionEventStatus, FactoryExistingProjectRequest, FactoryFileEntry, FactoryJournalEntry, FactoryNarrativeObject, FactoryObjectiveChecklistItem, FactoryPreviewPlatform, FactoryPreviewState, FactoryProjectResult, FactorySessionSummary, FactorySourceMode, FactoryUploadedFile, MissionClarification, MissionParentContext, StructuredDiscovery } from "@/lib/factory/types";
import { environmentReadinessForStack } from "@/lib/toolchains/provisioner";
import type { FollowUpResolutionRecord } from "@/lib/mission/classifyFollowUp";
import { reconcileBlockedCommandChecklist } from "@/lib/factory/evidence-reconciliation";
import { isWholeProjectDeletionRequest, projectDeletionApprovalCommand } from "@/lib/factory/project-deletion";

type ApprovalResponse = FactoryExistingProjectRequest["approvalResponse"];
type EvidenceImages = NonNullable<FactoryExistingProjectRequest["evidenceImages"]>;

const IMPLEMENTATION_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?|css|scss|sass|less|py|rb|php|java|kt|kts|swift|go|rs|cs|fs|fsx|vb|dart|scala|lua|r|sql|graphql|proto|xaml)$/i;
const IMPLEMENTATION_SOURCE_EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", "target", "bin", "obj"]);

async function hasImplementationSourceForAccess(access: ProjectAccess): Promise<boolean> {
  async function visit(relativePath: string, depth: number): Promise<boolean> {
    if (depth > 5) return false;
    const entries = await access.listDir(relativePath).catch(() => []);
    for (const entry of entries) {
      const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (!IMPLEMENTATION_SOURCE_EXCLUDED_DIRS.has(entry.name.toLowerCase()) && await visit(childPath, depth + 1)) return true;
      } else if (IMPLEMENTATION_SOURCE_PATTERN.test(entry.name)) {
        return true;
      }
    }
    return false;
  }
  return visit("", 0);
}

async function modelForMissionStage(task: string, mode: ModelMode | undefined, stageTier: ModelTier, workingSet?: ProjectWorkingSet, failureHistory = 0, dynamicAssessment?: DynamicTaskAssessment) {
  const tier = mode && mode !== "auto" ? lowerTier(stageTier, mode) : stageTier;
  const routed = await routeDynamically({
    message: task,
    tier,
    likelyFiles: workingSet?.likelyFiles,
    projectFileCount: workingSet?.projectFileCount,
    estimatedSubsystems: workingSet?.estimatedSubsystems,
    crossLayer: workingSet?.crossLayer,
    projectWide: workingSet?.projectWide,
    failureHistory,
    dynamicAssessment,
  });
  const apiKey = apiKeyForProvider(routed.decision.provider);
  return apiKey ? { apiKey, provider: routed.decision.provider, tier: routed.decision.tier, model: routed.decision.model, effort: routed.decision.effort, reason: routed.decision.reason, costClass: routed.decision.costClass } : undefined;
}

function lowerTier(left: ModelTier, ceiling: ModelTier): ModelTier {
  const rank: Record<ModelTier, number> = { fast: 1, builder: 2, architect: 3, "enterprise-architect": 4, "super-reasoning": 5 };
  return rank[left] <= rank[ceiling] ? left : ceiling;
}

function assessmentHighRisk(assessment: DynamicTaskAssessment) {
  return assessment.securityOrPayment || assessment.migration || assessment.risk >= 0.65 || assessment.difficulty >= 0.82;
}

function assessmentMultiPart(assessment: DynamicTaskAssessment) {
  return assessment.estimatedFiles > 3 || assessment.estimatedSubsystems > 1 || assessment.affectedScope === "multi-subsystem" || assessment.affectedScope === "project-wide";
}

function complexityFromAssessment(assessment: DynamicTaskAssessment) {
  return assessMissionComplexity({
    highRisk: assessmentHighRisk(assessment),
    multiPart: assessmentMultiPart(assessment),
    distinctPhases: assessment.estimatedSubsystems,
    stackCapabilityLevel: 4,
    fileCount: assessment.estimatedFiles,
  });
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

function compactDiscoveryTask(discovery: StructuredDiscovery, additionalInstructions: string) {
  const lines = [
    `Build ${conciseRequirement(discovery.projectType, 180)}.`,
    `Use ${conciseRequirement(discovery.recommendedStack || discovery.architecture, 180)}.`,
    discovery.mainFeatures.length ? `Required behavior:\n${discovery.mainFeatures.slice(0, 10).map((item) => `- ${conciseRequirement(item, 180)}`).join("\n")}` : "",
    discovery.dataModel.length ? `Data: ${discovery.dataModel.slice(0, 8).map((item) => conciseRequirement(item, 140)).join("; ")}` : "",
    discovery.styleDirection ? `Design: ${conciseRequirement(discovery.styleDirection, 220)}` : "",
    discovery.keyFacts.length ? `Constraints:\n${discovery.keyFacts.slice(0, 8).map((item) => `- ${conciseRequirement(item, 160)}`).join("\n")}` : "",
    discovery.decisions.length
      ? `Accepted decisions:\n${discovery.decisions.slice(0, 8).map((item) => `- ${conciseRequirement(item.dimension, 50)}: ${conciseRequirement(item.hypothesis, 150)}`).join("\n")}`
      : "",
    additionalInstructions ? `Additional instructions: ${conciseRequirement(additionalInstructions, 500)}` : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

function conciseRequirement(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
}

function compactNewProjectChecklist(projectType: string): FactoryObjectiveChecklistItem[] {
  const product = conciseRequirement(projectType || "the requested project", 90).replace(/[.!?]+$/, "");
  return [
    { id: "build-foundation", label: `Build ${product}`, status: "running" },
    { id: "implement-behavior", label: "Connect the requested interactions and data behavior", status: "pending" },
    { id: "verify-experience", label: "Verify the finished experience in a real browser", status: "pending" },
  ];
}

const projectsRoot = path.join(process.cwd(), "projects");
type PreviewProcessRecord = { port: number; processId?: number; lastUsedAt: number; previewUrl: string; projectPath: string; kind: "static" | "app"; ownershipToken?: string };
const previewProcessGlobal = globalThis as typeof globalThis & { __foundryPreviewProcesses?: Map<string, PreviewProcessRecord> };
// Next.js compiles API routes into separate module graphs. A module-local map lets the execution
// route start a detached preview while the preview/stop route sees an empty registry and falsely
// reports success. Process-global ownership keeps start/status/stop consistent across route bundles
// and survives development hot reloads without orphaning locked project directories.
const previewProcesses = previewProcessGlobal.__foundryPreviewProcesses ??= new Map<string, PreviewProcessRecord>();
const desktopPreviewTargets = new Map<string, string>();
const journalsRoot = path.join(process.cwd(), ".foundry-data", "journals");
type ExecutionEmitter = (event: FactoryExecutionEvent) => void | Promise<void>;

type ExecutionContext = {
  timeline: FactoryExecutionEvent[];
  emit: ExecutionEmitter;
  checklist: FactoryObjectiveChecklistItem[];
  projectId?: string;
  costScopeId: string;
};

async function emitModelSelection(execution: ExecutionContext, stage: string, selection: { provider: ProviderId; model: string; tier: ModelTier; effort?: string; reason?: string; costClass?: string } | undefined) {
  if (!selection) return;
  const alreadyEmitted = execution.timeline.some((event) => event.details?.stage === stage && event.details?.provider === selection.provider && event.details?.model === selection.model);
  if (alreadyEmitted) return;
  await emitExecution(execution, "planning", "completed", `Routing: ${selection.tier} - ${selection.provider}/${selection.model}`, {
    details: { stage, tier: selection.tier, provider: selection.provider, model: selection.model, effort: selection.effort ?? "provider default", reason: selection.reason, costClass: selection.costClass },
  });
}

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

export async function createFactoryProject(brief: string, onEvent?: ExecutionEmitter, discovery?: StructuredDiscovery, modelMode: ModelMode = "auto", quality: MissionQualityLevel = DEFAULT_MISSION_QUALITY, signal?: AbortSignal): Promise<FactoryProjectResult> {
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

  // The pasted/card brief is itself authoritative input. API clients are allowed to omit the
  // optional StructuredDiscovery object, so routing must not silently collapse a detailed brief to
  // only its description and Custom instructions line.
  const routingSummary = discovery
    ? [`Create project: ${spec.projectType}`, `Stack: ${spec.stack}`, spec.projectDescription, spec.instructions].filter(Boolean).join("\n")
    : brief.trim();
  // Bootstrap with Fast. The first paid call dynamically assesses this current request before any
  // planning or implementation tier is selected.
  const initialModel = await modelForMissionStage(routingSummary, modelMode, "fast");
  await emitModelSelection(execution, "initial routing", initialModel);
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
    ? compactDiscoveryTask(discovery, spec.instructions)
    : [
        "Build the project in the authoritative Foundry brief below. Preserve every named feature, constraint, data requirement, interaction, and design requirement; do not reduce it to a generic interpretation.",
        brief.trim(),
      ].filter(Boolean).join("\n\n");

  const obviousCreationProfile = profileTask({ message: task });
  const creationAssessment = obviousCreationProfile.taskType === "project_creation" && obviousCreationProfile.recommendedIntelligenceTier === "fast" && obviousCreationProfile.confidence >= 0.8
    ? deterministicTaskAssessment(task)
    : (await classifyIntent({ message: task, hasProjectContext: false, apiKey, provider: initialModel.provider })).routingAssessment;

  const rawAccess = createServerProjectAccess(projectPath, "local-folder");
  const access = accessForCapabilityLevel(rawAccess, stackProfile.level);
  const environment = await environmentReadinessForStack(stackProfile.id);
  const runtimeBuildAvailable = environment?.status === "ready" || stackHasBuildStep(stackProfile.id);
  completeChecklistItem(execution, "read-project", "completed", "New, empty project folder — nothing to read before scaffolding.");

  const emitEvent = (event: FactoryExecutionEvent) => execution.emit(event);
  const creationProfile = profileTask({ message: task, dynamicAssessment: creationAssessment });
  const simpleCreation = stackProfile.id === "static-html" || (
    creationAssessment.projectCreation
    && creationProfile.recommendedIntelligenceTier === "fast"
    && (creationProfile.missionComplexity ?? 5) <= 2
    && (creationProfile.expectedFiles ?? 99) <= 8
  );
  // A dependency-free static project stays architecturally small even when its discovery memo is
  // verbose. Letting prompt length inflate this to autonomous/architect work made identical catalogue
  // builds route unpredictably and spend premium calls on what is still one browser artifact.
  const creationComplexity = stackProfile.id === "static-html" ? "small" as const : complexityFromAssessment(creationAssessment);
  const backendOnlyCreation = /\b(?:api|backend|microservice|webhook|identity service|data processing service)\b/i.test(discovery?.projectType || primaryIdea)
    && /node-express|node|python|go|java|php|dotnet-web/i.test(stackProfile.id);
  const creationStrategy = createExecutionStrategy({
    kind: "new-project",
    complexity: creationComplexity,
    quality,
    fileCount: creationAssessment.estimatedFiles,
    estimatedArtifacts: simpleCreation ? Math.max(3, Math.min(8, creationProfile.expectedFiles ?? 6)) : Math.max(4, Math.min(20, (discovery?.mainFeatures.length ?? 4) + 3)),
    independentlyGeneratable: simpleCreation || /react|vue|svelte|next/i.test(stackProfile.id),
    highRisk: assessmentHighRisk(creationAssessment),
    securitySensitive: creationAssessment.securityOrPayment,
    needsVisualValidation: !backendOnlyCreation && /web|html|react|vue|svelte|next|ui|screen|page|catalogue|dashboard/i.test(`${stackProfile.id} ${task}`),
    repeatedFailures: 0,
  });
  await emitExecution(execution, "planning", "completed", `Execution strategy: ${creationStrategy.workflow}`, {
    details: { workflow: creationStrategy.workflow, concurrency: creationStrategy.concurrency, reason: creationStrategy.reason },
  });
  await emitExecution(execution, "reasoning", "completed", `I’ve translated the brief into a ${creationStrategy.workflow === "bounded-artifact" ? "focused build" : "staged implementation"}. I’m defining the project structure and verification path before generating files.`);
  await emitExecution(execution, "planning", "running", "Planning the project structure", { internal: true });
  // Structured discovery is already the authoritative product/architecture plan for a greenfield
  // build. Asking a second model to explode it into dozens of file-sized checklist items added a
  // slow planning call, obsolete package guesses, and a completion surface larger than the product.
  // Keep the visible plan outcome-oriented; the executor still receives the complete discovery brief.
  const plan = { checklist: compactNewProjectChecklist(discovery?.projectType || primaryIdea), conflicts: [] };
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
  const offerMockGate = stackProfile.id !== "static-html" && distinctPhases >= 2 && hasLivePreviewFor(stackProfile.label);

  // Establish the selected stack's minimum runnable contract before any model edit. edit_file
  // cannot create a missing manifest, and build/preview must never guess one later.
  await ensureRequestedStackScaffold(projectPath, stackProfile, spec.projectName, execution, events);
  const implementationModel = await modelForMissionStage(task, modelMode, tierForCapability(creationStrategy, "implement", tierForCapability(creationStrategy, "generate", creationProfile.recommendedIntelligenceTier)), undefined, 0, creationAssessment) ?? initialModel!;
  await emitModelSelection(execution, "implementation", implementationModel);
  await emitExecution(execution, "reasoning", "completed", "The plan is set. I’m building the first coherent working version now, then I’ll verify the result against the brief instead of stopping at file generation.");
  let result = await runMissionExecutor({
    objective,
    task,
    checklist,
    costScopeId: execution.costScopeId,
    access,
    apiKey: implementationModel.apiKey,
    provider: implementationModel.provider,
    tier: implementationModel.tier,
    onEvent: emitEvent,
    signal,
    approvedCategories: ["dependencies", "package-runner"],
    offerMockGate,
    hasBuildTooling: runtimeBuildAvailable,
    newProject: true,
    continuableBatch: true,
    staticProject: stackProfile.id === "static-html",
    executionStrategy: creationStrategy,
    routingAssessment: creationAssessment,
    // A real static build commonly needs one turn per complete HTML/CSS/JS artifact plus recovery
    // from a truncated tool call. Three turns made the ceiling itself the most common blocker. Keep
    // the model cheap, but give the execution loop enough room to actually finish the bounded job.
    maxTurns: stackProfile.id === "static-html" ? 8 : creationStrategy.workflow === "bounded-artifact" ? 10 : undefined,
  });

  if (
    stackProfile.id === "static-html"
    && result.status === "failed"
    && /(?:Model provider unavailable after retries:|configured model twice returned)[\s\S]*Model did not call required tool write_file/i.test(result.blocker ?? "")
  ) {
    await emitExecution(execution, "reasoning", "completed", "The fast generation pass could not produce a valid file action. I’m escalating this bounded build once so the mission can continue without restarting.");
    const initialUsage = result.usage;
    const escalationModel = await modelForMissionStage(task, modelMode, "builder", undefined, 1, creationAssessment) ?? implementationModel;
    await emitModelSelection(execution, "implementation escalation", escalationModel);
    const escalated = await runMissionExecutor({
      objective,
      task,
      checklist,
      costScopeId: execution.costScopeId,
      access,
      apiKey: escalationModel.apiKey,
      provider: escalationModel.provider,
      tier: escalationModel.tier,
      onEvent: emitEvent,
      signal,
      approvedCategories: ["dependencies", "package-runner"],
      hasBuildTooling: false,
      newProject: true,
      continuableBatch: true,
      staticProject: true,
      executionStrategy: creationStrategy,
      routingAssessment: creationAssessment,
      maxTurns: 6,
    });
    escalated.usage = [...initialUsage, ...escalated.usage];
    result = escalated;
  }

  const resumableCreationBatchFailure = (candidate: typeof result) => candidate.status === "failed"
    && candidate.changedFiles.length > 0
    && /command or file write failed|production build (?:not verified|failed)/i.test(candidate.blocker ?? "");
  // Greenfield creation uses the same bounded executor as follow-up work. A substantial starter can
  // legitimately fill one batch while creating coordinated source files; stopping there leaves a
  // convincing-looking but unrunnable project. Continue from the verified files on disk while sharing
  // the mission's original cost ledger, so continuation cannot reset its spend allowance.
  const maxCreationContinuationBatches = 1;
  for (let continuationAttempt = 1; continuationAttempt <= maxCreationContinuationBatches && resumableCreationBatchFailure(result); continuationAttempt += 1) {
    await emitExecution(execution, "reasoning", "completed", `The first build batch wrote real project files but did not finish. I’m continuing automatically with the remaining implementation and verification (batch ${continuationAttempt}).`);
    const continuation = await runMissionExecutor({
      objective,
      task: `Continuation batch ${continuationAttempt}: complete this new project from the authoritative brief and the implementation already on disk. Inspect existing files, create only the missing coordinated source and configuration, then install dependencies as needed and run the real production build. Do not rewrite correct files or stop at read-back evidence.\n\nOriginal task:\n${task}`,
      checklist: result.checklist,
      costScopeId: execution.costScopeId,
      access,
      apiKey: implementationModel.apiKey,
      provider: implementationModel.provider,
      tier: implementationModel.tier,
      onEvent: emitEvent,
      signal,
      approvedCategories: ["dependencies", "package-runner"],
      hasBuildTooling: runtimeBuildAvailable,
      newProject: true,
      continuableBatch: true,
      staticProject: stackProfile.id === "static-html",
      executionStrategy: creationStrategy,
      routingAssessment: creationAssessment,
      maxTurns: stackProfile.id === "static-html" ? 8 : 20,
      maxNudges: 2,
    });
    result = {
      ...continuation,
      changedFiles: Array.from(new Set([...result.changedFiles, ...continuation.changedFiles])),
      commands: [...result.commands, ...continuation.commands],
      verification: [...result.verification, ...continuation.verification],
      timeline: [...result.timeline, ...continuation.timeline],
      usage: [...result.usage, ...continuation.usage],
      turnsUsed: result.turnsUsed + continuation.turnsUsed,
    };
  }

  // Models are responsible for implementation decisions, not for whether objective build evidence
  // happens to exist. Once a generated Node project declares a build script, finish the mechanical
  // install/build gate deterministically if the executor did not. This prevents a mission from
  // spending multiple continuation batches saying "the build should run next" without ever issuing
  // the command, while preserving the real exit code and output as the authority.
  const alreadyBuilt = result.commands.some((command) =>
    command.exitCode === 0 && isProductionBuildCommand(command.command),
  );
  let deterministicBuildFailure: FactoryCommandEvent | undefined;
  if (!alreadyBuilt && existsSync(path.join(projectPath, "package.json"))) {
    try {
      const packageJson = JSON.parse(await readFile(path.join(projectPath, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      if (packageJson.scripts?.build) {
        await emitExecution(execution, "command", "running", "Running the declared production build as the final deterministic verification gate");
        if (!existsSync(path.join(projectPath, "node_modules"))) {
          result.commands.push(await runCommand(projectPath, "npm.cmd", ["install", "--prefer-offline", "--no-audit", "--no-fund"], events, execution));
        }
        if (!result.commands.some((command) => /\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+install\b/i.test(command.command) && command.exitCode !== 0)) {
          const buildCommand = await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution);
          result.commands.push(buildCommand);
          if (buildCommand.exitCode !== 0) deterministicBuildFailure = buildCommand;
          result.verification.push({
            check_type: "build",
            result: buildCommand.exitCode === 0 ? "pass" : "fail",
            evidence: buildCommand.exitCode === 0
              ? "The generated project's declared production build completed with exit code 0."
              : `The declared production build failed: ${summarizeCommandFailure(buildCommand)}`,
          });
        }
      }
    } catch (error) {
      await emitExecution(execution, "command", "error", "The generated package manifest could not be used for deterministic build verification", {
        details: { reason: error instanceof Error ? error.message : "Unknown package manifest error." },
      });
    }
  }
  // The first objective compiler failure is often the most useful implementation evidence in a
  // greenfield project (missing dependency, bad import, route/server boundary, or type error). The
  // older ordering discovered that evidence only after the one creation-continuation opportunity
  // had already passed, so a nearly complete app stopped without ever showing the model the actual
  // failure. Permit one bounded repair, sharing the same cost scope, then rerun install/build
  // mechanically. This is never a blind retry and can never reset the mission's spend allowance.
  if (result.status === "passed" && deterministicBuildFailure && result.changedFiles.length > 0) {
    await emitExecution(execution, "reasoning", "completed", "The production compiler found one concrete integration failure. I’m repairing that exact error once, then rerunning the build.");
    const buildRepairModel = await modelForMissionStage(task, modelMode, tierForCapability(creationStrategy, "repair", "builder"), undefined, 1, creationAssessment) ?? implementationModel;
    await emitModelSelection(execution, "build repair", buildRepairModel);
    const buildRepair = await runMissionExecutor({
      objective,
      task: `Repair this generated project using the real production-build failure below. Preserve the complete original brief. Make only the coordinated dependency/configuration/source changes required by this evidence, then run the smallest relevant verification.\n\nOriginal project request:\n${task}\n\nProduction build failure:\n${summarizeCommandFailure(deterministicBuildFailure)}`,
      checklist: [{ id: "production-build-repair", label: "Repair the production compiler failure and verify the build", status: "pending" }],
      costScopeId: execution.costScopeId,
      access,
      apiKey: buildRepairModel.apiKey,
      provider: buildRepairModel.provider,
      tier: buildRepairModel.tier,
      onEvent: emitEvent,
      signal,
      approvedCategories: ["dependencies", "package-runner"],
      hasBuildTooling: true,
      newProject: true,
      continuableBatch: false,
      executionStrategy: creationStrategy,
      routingAssessment: creationAssessment,
      maxTurns: 8,
      maxNudges: 2,
    });
    result.changedFiles = Array.from(new Set([...result.changedFiles, ...buildRepair.changedFiles]));
    result.commands.push(...buildRepair.commands);
    result.verification.push(...buildRepair.verification);
    result.timeline.push(...buildRepair.timeline);
    result.usage.push(...buildRepair.usage);
    result.turnsUsed += buildRepair.turnsUsed;

    const repairInstall = await runCommand(projectPath, "npm.cmd", ["install", "--prefer-offline", "--no-audit", "--no-fund"], events, execution);
    result.commands.push(repairInstall);
    const retryBuild = repairInstall.exitCode === 0
      ? await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution)
      : repairInstall;
    if (repairInstall.exitCode === 0) result.commands.push(retryBuild);
    result.verification.push({
      check_type: "build",
      result: retryBuild.exitCode === 0 ? "pass" : "fail",
      evidence: retryBuild.exitCode === 0
        ? "The generated project's production build passed after one compiler-evidenced repair."
        : `The bounded production-build repair did not resolve the real failure: ${summarizeCommandFailure(retryBuild)}`,
    });
    if (retryBuild.exitCode === 0) {
      result.status = "passed";
      result.blocker = undefined;
    } else {
      result.status = "failed";
      result.blocker = `Production build failed after one bounded repair: ${summarizeCommandFailure(retryBuild)}`;
    }
  }
  const productionBuildVerified = result.commands.some((command) =>
    command.exitCode === 0 && isProductionBuildCommand(command.command),
  );
  const successfulBuildSupersedesBatchBoundary = result.status === "failed"
    && productionBuildVerified
    && /turn budget|not completed|Model-call limit reached|Estimated request cost would exceed/i.test(result.blocker ?? "");
  if (successfulBuildSupersedesBatchBoundary) {
    result.status = "passed";
    result.blocker = undefined;
    await emitExecution(execution, "summary", "completed", "Production build passed; advancing to live preview verification", {
      details: { reconciledEarlierFailures: true },
    });
  }
  const automatedTestsVerified = result.commands.some((command) =>
    command.exitCode === 0 && isAutomatedTestCommand(command.command),
  );
  if (backendOnlyCreation && productionBuildVerified && automatedTestsVerified && result.status === "failed"
    && /browser|visual|playthrough|lost a clear next step|turn budget|not completed|Model-call limit reached|Estimated request cost would exceed/i.test(result.blocker ?? "")) {
    for (const item of result.checklist) {
      if ((item.status === "blocked" || item.status === "pending") && /browser|visual|playthrough/i.test(item.label)) {
        item.status = "skipped";
        item.evidence = "This is a backend-only service. Its real build and automated endpoint tests passed; browser UI verification does not apply.";
      }
    }
    result.status = "passed";
    result.blocker = undefined;
    result.verification.push({
      check_type: "test",
      result: "pass",
      evidence: "Backend-only service verification passed through the declared production build and automated API test suite; no fake browser UI was required.",
    });
    await emitExecution(execution, "summary", "completed", "Backend build and API tests verified; continuing to the operational service preview", {
      details: { platform: "api", browserUiRequired: false },
    });
  }

  execution.checklist.splice(0, execution.checklist.length, ...result.checklist);
  let modelUsage = summarizeModelUsage(result.usage);
  const estimatedBuildCost = modelUsage.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
  await emitExecution(execution, "planning", "completed", `Build-model usage · ${result.turnsUsed} turn${result.turnsUsed === 1 ? "" : "s"} · $${estimatedBuildCost.toFixed(4)} estimated`, {
    details: { stage: "implementation usage", turns: result.turnsUsed, modelUsageJson: JSON.stringify(modelUsage) },
  });
  if (!runtimeBuildAvailable && stackProfile.id !== "static-html") {
    result.verification.push({
      check_type: "build",
      result: "skipped",
      evidence: `${stackProfile.label} source files were verified by disk read-back, but its local compiler/runtime is not installed or configured on this machine, so build/runtime validation was not run.`,
    });
  }
  completeChecklistItem(execution, "files-on-disk", result.changedFiles.length ? "completed" : "blocked", result.changedFiles.length ? `Wrote ${result.changedFiles.length} file(s) to ${projectPath}.` : "No files were written.");

  const onlyBoundedBookkeepingRemains = result.status === "failed"
    && creationStrategy.workflow === "bounded-artifact"
    && result.changedFiles.length >= 3
    && /^Checklist item\(s\) not completed:/i.test(result.blocker ?? "");
  let status: FactoryProjectResult["status"] =
    result.status === "passed" || onlyBoundedBookkeepingRemains ? "passed" : result.status === "awaiting-approval" ? "awaiting-approval" : result.status === "awaiting-mock-approval" ? "awaiting-mock-approval" : "failed";
  let blocker = result.status === "passed" || onlyBoundedBookkeepingRemains ? undefined : result.blocker;
  const mockGateReached = status === "awaiting-mock-approval";
  const productionBuildPassed = result.commands.some((command) =>
    command.exitCode === 0 && isProductionBuildCommand(command.command),
  );

  // A successful real build is enough to expose the actual preview for the remaining interactive
  // gate even when the mission is still honestly blocked on browser/playthrough evidence.
  const preview = status === "passed" || mockGateReached || productionBuildPassed ? await startPreview(projectId, projectPath, stackProfile.label, events, execution) : undefined;
  if (status === "passed" && preview?.previewUrl && preview.previewState === "ready" && preview.previewPlatform === "web") {
    let browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, task);
    if (!browserEvidence.verified && stackProfile.id === "static-html") {
      const repairedBrokenImages = browserEvidence.brokenImageSources?.length
        ? await repairBrokenStaticImages(access, browserEvidence.brokenImageSources, execution)
        : false;
      if (repairedBrokenImages) {
        browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, task);
      }
    }
    if (!browserEvidence.verified) {
      await emitExecution(execution, "reasoning", "completed", "The rendered page exposed a concrete browser issue. I’m repairing that exact failure now, then I’ll run the browser check again.");
      const repairTier: ModelTier = /explicit acceptance requirements/i.test(browserEvidence.evidence)
        && !/(?:Console:|Page error:|Failed local request:|browser interaction failed)/i.test(browserEvidence.evidence)
        ? "fast"
        : "builder";
      const repair = await runMissionExecutor({
        objective,
        task: `Repair this generated static project so it passes the real browser preview check. Preserve the requested product and interactions. Fix only the verified problem below, using self-contained CSS/data placeholders instead of unreliable remote assets when images are broken.\n\nOriginal user request:\n${task}\n\nVerified browser failure:\n${browserEvidence.evidence}`,
        checklist: [{ id: "static-preview-repair", label: "Repair the browser-verified preview failure", status: "pending" }],
        costScopeId: execution.costScopeId,
        access,
        apiKey: implementationModel.apiKey,
        provider: implementationModel.provider,
        tier: repairTier,
        onEvent: emitEvent,
        signal,
        approvedCategories: ["dependencies", "package-runner"],
        hasBuildTooling: false,
        staticProject: true,
        staticRewrite: true,
        maxTurns: 2,
      });
      result.usage.push(...repair.usage);
      result.changedFiles = [...new Set([...result.changedFiles, ...repair.changedFiles])];
      result.commands.push(...repair.commands);
      modelUsage = summarizeModelUsage(result.usage);
      // The repair executor can truthfully write a corrected file yet miss its bookkeeping-only
      // mark_checklist_item call before the turn budget ends. The independent Chromium rerun is the
      // stronger completion gate: if real changed source now renders and behaves cleanly, accept that
      // evidence instead of failing a working project over model ceremony.
      if (repair.changedFiles.length > 0) {
        browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, task);
      }
      if (!browserEvidence.verified) {
        browserEvidence = {
          verified: false,
          evidence: `${browserEvidence.evidence} Automatic repair did not complete: ${repair.blocker || "the repair mission could not verify its changes."}`,
          brokenImageSources: browserEvidence.brokenImageSources,
        };
      }
    }
    result.verification.push({
      check_type: "preview",
      result: browserEvidence.verified ? "pass" : "fail",
      evidence: browserEvidence.evidence,
    });
    if (!browserEvidence.verified) {
      status = "failed";
      blocker = browserEvidence.evidence;
    } else if (onlyBoundedBookkeepingRemains || successfulBuildSupersedesBatchBoundary) {
      for (const item of execution.checklist) {
        if (item.status === "pending" || item.status === "running" || item.status === "blocked") {
          item.status = "completed";
          item.evidence = browserEvidence.evidence;
        }
      }
      if (result.sessionSummary) result.sessionSummary.outcome = "The generated project rendered successfully and passed the real browser completion gate.";
    }
  } else if (status === "passed" && preview?.previewPlatform === "web" && preview.previewState !== "ready") {
    blocker = preview.previewReason || "Foundry could not start an owned preview for the generated project.";
    status = "failed";
    result.verification.push({ check_type: "preview", result: "fail", evidence: blocker });
  }
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
    artifact: preview?.artifact,
    exportUrl: `/api/factory/export?projectId=${encodeURIComponent(projectId)}`,
    timeline: execution.timeline,
    sessionSummary: result.sessionSummary,
    verification: result.verification,
    modelUsage,
    executionTurns: result.turnsUsed,
    environment,
  };
}

function summarizeModelUsage(usage: Awaited<ReturnType<typeof runMissionExecutor>>["usage"]): NonNullable<FactoryProjectResult["modelUsage"]> {
  const grouped = new Map<string, NonNullable<FactoryProjectResult["modelUsage"]>[number]>();
  for (const item of usage) {
    const key = `${item.provider}:${item.model}`;
    const current = grouped.get(key) ?? {
      provider: item.provider,
      model: item.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      cachedCalls: 0,
    };
    current.calls += item.requestCount;
    current.inputTokens += item.inputTokens;
    current.outputTokens += item.outputTokens;
    current.estimatedCostUsd += item.estimatedCostUsd;
    current.cachedCalls += item.cached ? 1 : 0;
    grouped.set(key, current);
  }
  return Array.from(grouped.values());
}

async function validateGeneratedStaticPreview(previewUrl: string, projectPath: string, execution: ExecutionContext, expectedOwnershipToken?: string, requestedTask = "") {
  const artifactDir = path.join(projectPath, ".foundry-artifacts", "validation");
  const screenshotPath = path.join(artifactDir, "generated-preview.png");
  await mkdir(artifactDir, { recursive: true });
  await emitExecution(execution, "preview", "running", "Checking rendered project in a real browser", { details: { previewUrl } });
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const failedLocalRequests: string[] = [];
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("requestfailed", (request) => {
        try {
          const failure = request.failure()?.errorText ?? "";
          const url = request.url();
          // A Playwright navigation deliberately aborts in-flight document assets, and Next dev
          // invalidates disposable HMR updates while compiling a route. Neither proves a broken app.
          if (/ERR_ABORTED/i.test(failure) || /\.(?:hot-update\.js|hot-update\.json)(?:\?|$)/i.test(url)) return;
          if (new URL(url).origin === new URL(previewUrl).origin) failedLocalRequests.push(`${url}${failure ? ` (${failure})` : ""}`);
        } catch {
          // Ignore malformed third-party request URLs; page errors still capture application failures.
        }
      });
      const response = await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
      const rendered = await page.locator("body").evaluate((body) => {
        const brokenImageSources = Array.from(body.querySelectorAll("img"))
          .filter((image) => image.complete && image.naturalWidth === 0 && getComputedStyle(image).display !== "none")
          .map((image) => image.currentSrc || image.src)
          .filter(Boolean);
        const visible = (element: Element) => {
          const node = element as HTMLElement;
          const style = getComputedStyle(node);
          const bounds = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
        };
        const meaningfulElements = Array.from(body.querySelectorAll("main, article, section, form, nav, [role='main'], [role='form'], [role='list'], [role='listitem']")).filter(visible).length;
        const interactiveControls = Array.from(body.querySelectorAll("button, input, select, textarea, a[href]")).filter(visible).length;
        return {
          textLength: (body.textContent ?? "").replace(/\s+/g, " ").trim().length,
          height: Math.round(body.getBoundingClientRect().height),
          meaningfulElements,
          interactiveControls,
          productCards: body.querySelectorAll(".card, .product-card, article, [role='listitem']").length,
          brokenImages: brokenImageSources.length,
          brokenImageSources,
        };
      });
      const requestedExperienceProbe = await validateRequestedStaticExperience(page, requestedTask);
      const authProbe: { evidence: string; problem?: string } = /\b(?:sign\s*up|signup|create\s+(?:an?\s+)?account|registration|sign\s*in|signin|log\s*in|login)\b/i.test(requestedTask)
        ? { evidence: "The task-aware browser check exercised the requested authentication experience." }
        : await validateDetectedAuthFlow(page);
      const interactionProbe = await validateRepresentativeInteraction(page);
      const internalHrefs = await page.locator("a[href]").evaluateAll((links) => Array.from(new Set(links
        .map((link) => (link as HTMLAnchorElement).href)
        .filter((href) => {
          try {
            const target = new URL(href);
            return target.origin === location.origin && target.pathname !== location.pathname && !target.hash;
          } catch {
            return false;
          }
        }))).slice(0, 2));
      const navigationChecks: Array<{ url: string; status?: number; title?: string }> = [];
      const navigationFailures: string[] = [];
      for (const href of internalHrefs) {
        try {
          const navigationResponse = await page.goto(href, { waitUntil: "domcontentloaded", timeout: 20_000 });
          await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
          const status = navigationResponse?.status();
          navigationChecks.push({ url: page.url(), status, title: await page.title() });
          if (status && status >= 400) navigationFailures.push(`${href} returned HTTP ${status}.`);
        } catch (error) {
          navigationFailures.push(`${href} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const problems = [
        ...(response && response.status() >= 400 ? [`Preview returned HTTP ${response.status()}.`] : []),
        ...(expectedOwnershipToken && response?.headers()["x-foundry-preview"] !== expectedOwnershipToken
          ? ["The preview response was not owned by this project; Foundry refused stale output from another server."]
          : []),
        ...consoleErrors.map((error) => `Console: ${error}`),
        ...pageErrors.map((error) => `Page error: ${error}`),
        ...failedLocalRequests.map((url) => `Failed local request: ${url}`),
        ...(rendered.brokenImages ? [`${rendered.brokenImages} visibly broken image(s) remained in the rendered interface.`] : []),
        ...(rendered.textLength < 80 || rendered.height < 240 || (rendered.meaningfulElements < 1 && rendered.interactiveControls < 2 && rendered.productCards < 3) ? ["The rendered page did not contain enough meaningful visible application content."] : []),
        ...(authProbe.problem ? [authProbe.problem] : []),
        ...(requestedExperienceProbe.problem ? [requestedExperienceProbe.problem] : []),
        ...(interactionProbe.problem ? [interactionProbe.problem] : []),
        ...navigationFailures,
      ];
      const verified = problems.length === 0;
      const evidence = verified
        ? `Real browser preview rendered successfully (${rendered.textLength} text characters, ${rendered.meaningfulElements} semantic regions, ${rendered.interactiveControls} interactive controls); exercised ${navigationChecks.length} same-origin navigation target(s) and ${interactionProbe.verified ? "one representative control" : "the rendered surface"} with no console, page, local-request, interaction, or navigation errors. Screenshot: ${screenshotPath}`
        : `Browser preview verification failed: ${problems.join(" ")} Screenshot: ${screenshotPath}`;
      await emitExecution(execution, "preview", verified ? "completed" : "error", verified ? "Rendered project verified" : "Rendered project failed verification", { details: { previewUrl, screenshotPath, consoleErrors, pageErrors, failedLocalRequests, navigationChecksJson: JSON.stringify(navigationChecks), authProbe: authProbe.evidence, requestedExperienceProbe: requestedExperienceProbe.evidence, interactionProbe: interactionProbe.evidence, ...rendered } });
      return { verified, evidence, brokenImageSources: rendered.brokenImageSources };
    } finally {
      await browser.close();
    }
  } catch (error) {
    const evidence = `Browser preview verification could not run: ${error instanceof Error ? error.message : String(error)}`;
    await emitExecution(execution, "preview", "error", "Browser verification unavailable", { details: { reason: evidence } });
    return { verified: false, evidence, brokenImageSources: [] as string[] };
  }
}

async function validateRepresentativeInteraction(page: import("playwright").Page) {
  const editable = page.locator('input:not([type]), input[type="text"], input[type="search"], input[type="tel"], input[type="url"], textarea');
  for (const control of await editable.all()) {
    if (!(await control.isVisible()) || !(await control.isEnabled()) || await control.getAttribute("readonly") !== null) continue;
    try {
      const previous = await control.inputValue();
      const probeValue = `Foundry preview check ${Date.now()}`;
      await control.fill(probeValue);
      const verified = await control.inputValue() === probeValue;
      await control.fill(previous);
      return verified
        ? { verified: true, evidence: "Filled and restored a visible editable control successfully." }
        : { verified: false, evidence: "A visible editable control did not retain typed input.", problem: "A representative visible input could not be exercised successfully." };
    } catch (error) {
      return { verified: false, evidence: error instanceof Error ? error.message : String(error), problem: "A representative visible input failed during browser interaction." };
    }
  }

  const selects = page.locator("select:not([disabled])");
  for (const control of await selects.all()) {
    if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
    const options = await control.locator("option").evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value));
    if (options.length < 2) continue;
    try {
      const previous = await control.inputValue();
      const next = options.find((value) => value !== previous);
      if (!next) continue;
      await control.selectOption(next);
      const verified = await control.inputValue() === next;
      await control.selectOption(previous);
      return verified
        ? { verified: true, evidence: "Changed and restored a visible selection control successfully." }
        : { verified: false, evidence: "A visible selection control did not accept a different option.", problem: "A representative visible selection control could not be exercised successfully." };
    } catch (error) {
      return { verified: false, evidence: error instanceof Error ? error.message : String(error), problem: "A representative visible selection control failed during browser interaction." };
    }
  }

  const buttons = page.locator('button:not([disabled]):not([type="submit"])');
  for (const control of await buttons.all()) {
    if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
    const label = ((await control.innerText().catch(() => "")) || (await control.getAttribute("aria-label")) || "").trim();
    if (/delete|remove|reset|clear|sign\s*out|log\s*out|purchase|pay|checkout/i.test(label)) continue;
    try {
      await control.click();
      await page.locator("body").waitFor({ state: "visible", timeout: 2_000 });
      return { verified: true, evidence: `Clicked a visible non-destructive control${label ? ` (${label.slice(0, 60)})` : ""} successfully.` };
    } catch (error) {
      return { verified: false, evidence: error instanceof Error ? error.message : String(error), problem: "A representative visible button failed during browser interaction." };
    }
  }

  return { verified: false, evidence: "No safe representative form control was present; the rendered surface and any same-origin links were validated instead." };
}

async function validateDetectedAuthFlow(page: import("playwright").Page) {
  // A single-form login/signup surface is common in generated static prototypes. When those
  // controls are present, verify the actual local-first round trip instead of accepting a screenshot.
  if (!(await page.locator("#authForm, form[data-auth-form]").count())) return { evidence: "No deterministic local auth flow was detected for behavioral probing." };
  const signup = page.locator("#signupTab, [role='tab']").filter({ hasText: /sign\s*up|create account/i }).first();
  const login = page.locator("#loginTab, [role='tab']").filter({ hasText: /log\s*in|sign\s*in/i }).first();
  const email = page.locator("#email, #authForm input[type='email']").first();
  const password = page.locator("#password, #authForm input[type='password']").first();
  const confirm = page.locator("#confirmPassword, #authForm input[name*='confirm' i]").first();
  const name = page.locator("#name, #authForm input[name='name']").first();
  const submit = page.locator("#submitButton, #authForm button[type='submit']").first();
  const status = page.locator("#status, #authForm [role='status'], #authForm [aria-live]").first();
  if (!(await signup.count()) || !(await login.count()) || !(await email.count()) || !(await password.count()) || !(await submit.count()) || !(await status.count())) {
    return { evidence: "An auth-like form was present, but it did not expose a deterministic signup/login contract." };
  }
  try {
    const testEmail = `foundry-${Date.now()}@example.com`;
    const testPassword = "Foundry-test-42";
    await signup.click();
    if (await name.count()) await name.fill("Foundry Engineer");
    await email.fill(testEmail);
    await password.fill(testPassword);
    if (await confirm.count()) await confirm.fill(testPassword);
    await submit.click();
    const signupStatus = (await status.textContent())?.trim() ?? "";
    if (!/created|check your email|confirmation|success/i.test(signupStatus)) {
      return { evidence: `Signup feedback: ${signupStatus || "none"}`, problem: "The rendered signup flow did not confirm that an account was created." };
    }
    await login.click();
    await email.fill(testEmail);
    await password.fill(testPassword);
    await submit.click();
    const loginStatus = (await status.textContent())?.trim() ?? "";
    if (!/welcome|signed in|logged in|redirect/i.test(loginStatus)) {
      return { evidence: `Signup feedback: ${signupStatus} Login feedback: ${loginStatus || "none"}`, problem: "The rendered auth flow created an account but could not log back in with the same credentials." };
    }
    return { evidence: `Created ${testEmail} locally and logged back in successfully.` };
  } catch (error) {
    return { evidence: "The detected auth interaction could not be completed.", problem: `The rendered auth interaction failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

type StaticUiMinimum = { count: number; entity: string };

function explicitStaticUiContract(task: string) {
  const requiredIds = new Set<string>();
  const requiredVisibleTerms = new Set<string>();
  const minimums: StaticUiMinimum[] = [];

  for (const match of task.matchAll(/\bstable(?:\s+acceptance)?\s+ids?\s*:\s*([^\n.]+)/gi)) {
    for (const candidate of match[1].split(/\s*,\s*|\s+and\s+/i)) {
      const id = candidate.trim().replace(/^[`'\"]|[`'\"]$/g, "");
      if (/^[a-z][a-z0-9_-]{1,80}$/i.test(id)) requiredIds.add(id);
    }
  }

  // Lists such as "KPI cards for active incidents, critical incidents, MTTA, and resolved today"
  // are unusually high-confidence visible promises. Checking their labels catches attractive but
  // incomplete placeholders without trying to reinterpret every sentence in the user's brief.
  for (const match of task.matchAll(/\b(?:KPI|metric|summary)\s+cards?\s+for\s+([^\n.;]+)/gi)) {
    for (const candidate of match[1].split(/\s*,\s*|\s+and\s+/i)) {
      const term = candidate.trim().replace(/^(?:and|the|a|an)\s+/i, "").replace(/[,:]+$/, "");
      if (term.length >= 3 && term.length <= 60) requiredVisibleTerms.add(term);
    }
  }

  // Follow-up instructions commonly use wording like "add a visible At risk option". Preserve the
  // requested product language as acceptance evidence instead of merely checking that some select
  // exists after the edit.
  for (const match of task.matchAll(/\bvisible\s+([a-z0-9][a-z0-9 -]{1,50}?)\s+(?:option|state|label|banner|control)\b/gi)) {
    const term = match[1].trim().replace(/^(?:a|an|the)\s+/i, "");
    if (term.length >= 2) requiredVisibleTerms.add(term);
  }

  const numberWords: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12,
  };
  for (const match of task.matchAll(/\b(?:seed|show|include|display|render|provide)\s+(?:at\s+least\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:realistic\s+)?([a-z][a-z0-9_-]*)(?=\s+(?:across|with|in|on|for|and|[,.;]|$))/gi)) {
    const count = /^\d+$/.test(match[1]) ? Number(match[1]) : numberWords[match[1].toLowerCase()];
    const entity = match[2].toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (count > 0 && count <= 100 && entity.length >= 3) minimums.push({ count, entity });
  }

  return { requiredIds: [...requiredIds], requiredVisibleTerms: [...requiredVisibleTerms], minimums };
}

async function validateExplicitStaticUiContract(page: import("playwright").Page, task: string): Promise<{ evidence: string; problem?: string }> {
  const contract = explicitStaticUiContract(task);
  if (!contract.requiredIds.length && !contract.requiredVisibleTerms.length && !contract.minimums.length) {
    return { evidence: "The request did not contain deterministic visible-content, stable-ID, or minimum-item acceptance clauses." };
  }

  const probe = await page.locator("body").evaluate((body, expected) => {
    const visible = (element: Element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const normalizedText = ((body as HTMLElement).innerText || body.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const missingIds = expected.requiredIds.filter((id) => {
      const matches = Array.from(body.querySelectorAll("[id]")).filter((element) => element.id === id);
      // Dialog and drawer controls are correctly hidden until their trigger is used. Stable IDs are
      // a structural contract; the independent interaction probe verifies that the hidden surface
      // can actually be opened and exercised.
      return matches.length !== 1;
    });
    const missingTerms = expected.requiredVisibleTerms.filter((term) => {
      const normalizedTerm = term.toLowerCase();
      if (normalizedText.includes(normalizedTerm)) return false;
      const distinctiveWords = normalizedTerm.split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !["the", "and", "for", "with"].includes(word));
      return !distinctiveWords.length || !distinctiveWords.every((word) => normalizedText.includes(word));
    });
    const insufficientMinimums = expected.minimums.flatMap(({ count, entity }) => {
      const singular = entity.replace(/ies$/, "y").replace(/s$/, "");
      const tableRows = Array.from(body.querySelectorAll("tbody tr")).filter(visible).length;
      const namedItems = Array.from(body.querySelectorAll("article, li, [role='listitem'], [data-entity], [class], [id]"))
        .filter((element) => visible(element) && `${element.id} ${element.className || ""} ${(element as HTMLElement).dataset.entity || ""}`.toLowerCase().includes(singular))
        .length;
      const genericItems = Array.from(body.querySelectorAll("article, [role='listitem']")).filter(visible).length;
      const actual = Math.max(tableRows, namedItems, genericItems);
      return actual < count ? [{ entity, expected: count, actual }] : [];
    });
    return { missingIds, missingTerms, insufficientMinimums };
  }, contract);

  const problems = [
    ...(probe.missingIds.length ? [`stable acceptance ID(s) missing or duplicated: ${probe.missingIds.join(", ")}`] : []),
    ...(probe.missingTerms.length ? [`explicit visible content missing: ${probe.missingTerms.join(", ")}`] : []),
    ...probe.insufficientMinimums.map((item) => `requested at least ${item.expected} ${item.entity}, but only ${item.actual} rendered item(s) were found`),
  ];
  const evidence = `Checked ${contract.requiredIds.length} stable ID(s), ${contract.requiredVisibleTerms.length} explicit visible term(s), and ${contract.minimums.length} minimum-item requirement(s).`;
  return problems.length
    ? { evidence: `${evidence} ${problems.join("; ")}.`, problem: `The rendered product did not satisfy explicit acceptance requirements: ${problems.join("; ")}.` }
    : { evidence };
}

async function validateRequestedStaticExperience(page: import("playwright").Page, task: string): Promise<{ evidence: string; problem?: string }> {
  const explicitContract = await validateExplicitStaticUiContract(page, task);
  if (explicitContract.problem) return explicitContract;
  const requiresSignup = /\b(?:sign\s*up|signup|create\s+(?:an?\s+)?account|registration)\b/i.test(task);
  const requiresDashboardFlow = /\b(?:sign\s*in|signin|log\s*in|login)\b/i.test(task) && /\bdashboard\b/i.test(task);
  const requiresPolishedDashboard = requiresDashboardFlow && requiresPolishedUiAcceptance(task);
  if (!requiresSignup && !requiresDashboardFlow) {
    return { evidence: `${explicitContract.evidence} The request did not name a deterministic signup or sign-in-to-dashboard flow.` };
  }

  const visibleByText = (pattern: RegExp) => page.locator("button:visible, a:visible, [role='button']:visible, [role='tab']:visible").filter({ hasText: pattern }).first();
  try {
    if (requiresSignup) {
      const signup = visibleByText(/sign\s*up|create\s+(?:an?\s+)?account|register/i);
      if (!(await signup.count()) || !(await signup.isVisible())) {
        return { evidence: "No visible signup entry point was found.", problem: "The user explicitly requested a signup option, but the rendered interface did not provide one." };
      }
      await signup.click();
      await page.waitForTimeout(100);
      const signupModeVisible = await page.locator("input[name='name'], input[autocomplete='name'], input[name*='confirm' i], input[autocomplete='new-password']").evaluateAll((controls) => controls.some((control) => {
        const node = control as HTMLElement;
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }));
      const signupLanguageVisible = await page.locator("body").getByText(/create\s+(?:an?\s+)?account|sign\s*up/i).evaluateAll((items) => items.some((item) => {
        const node = item as HTMLElement;
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })).catch(() => false);
      if (!signupModeVisible && !signupLanguageVisible) {
        return { evidence: "The signup control did not expose signup fields or signup state.", problem: "The signup option was visible but did not open a usable signup experience." };
      }
    }

    if (!requiresDashboardFlow) return { evidence: "The requested signup entry point opened successfully." };

    const login = visibleByText(/sign\s*in|log\s*in|back\s+to\s+login/i);
    if (await login.count() && await login.isVisible()) {
      await login.click();
      await page.waitForTimeout(100);
    }
    const email = page.locator("input[type='email']:visible, input[autocomplete='email']:visible, input[name*='email' i]:visible").first();
    const password = page.locator("input[type='password']:visible, input[autocomplete='current-password']:visible").first();
    const submit = page.locator("button[type='submit']:visible, input[type='submit']:visible").first();
    if (!(await email.count()) || !(await password.count()) || !(await submit.count())) {
      return { evidence: "The rendered page did not expose a usable sign-in form.", problem: "The requested sign-in-to-dashboard flow could not be exercised because its visible email, password, or submit control was missing." };
    }
    await email.fill(`foundry-preview-${Date.now()}@example.com`);
    await password.fill("Foundry-preview-42");
    await submit.click();
    await page.waitForTimeout(150);

    const dashboard = page.locator("#dashboard:not(.hidden):visible, [data-dashboard]:visible, [aria-label*='dashboard' i]:visible").first();
    const dashboardHeading = page.getByRole("heading", { name: /dashboard|welcome/i }).first();
    await Promise.race([
      dashboard.waitFor({ state: "visible", timeout: 3_000 }),
      dashboardHeading.waitFor({ state: "visible", timeout: 3_000 }),
    ]).catch(() => undefined);
    const destination = await dashboard.count() ? dashboard : dashboardHeading;
    if (!(await destination.count()) || !(await destination.isVisible())) {
      return { evidence: "Submitting the visible sign-in form did not reveal a dashboard destination.", problem: "The user requested sign-in to a dashboard, but the rendered sign-in flow did not reach one." };
    }

    const root = await dashboard.count() ? dashboard : page.locator("body");
    const metrics = await root.evaluate((element) => {
      const visible = (candidate: Element) => {
        const node = candidate as HTMLElement;
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      return {
        textLength: (element.textContent ?? "").replace(/\s+/g, " ").trim().length,
        structuredRegions: Array.from(element.querySelectorAll("header, nav, aside, main, section, article, [role='navigation'], [role='list'], [role='listitem'], .card, [class*='card']")).filter(visible).length,
        interactiveControls: Array.from(element.querySelectorAll("button, a[href], input, select, textarea")).filter(visible).length,
      };
    });
    if (requiresPolishedDashboard && (metrics.textLength < 140 || metrics.structuredRegions < 3 || metrics.interactiveControls < 2)) {
      return {
        evidence: `Sign-in reached the dashboard, but it contained only ${metrics.textLength} text characters, ${metrics.structuredRegions} structured regions, and ${metrics.interactiveControls} interactive controls.`,
        problem: "The user asked for a nice dashboard, but the rendered destination was still a placeholder rather than a content-rich, intentionally structured dashboard.",
      };
    }
    return { evidence: `Exercised the requested auth flow through its dashboard (${metrics.textLength} text characters, ${metrics.structuredRegions} structured regions, ${metrics.interactiveControls} interactive controls).` };
  } catch (error) {
    return { evidence: "The requested user flow could not be completed.", problem: `The browser could not complete the requested signup/sign-in/dashboard flow: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function repairBrokenStaticImages(access: ProjectAccess, brokenSources: string[], execution: ExecutionContext) {
  const entries = await access.listDir("");
  const entry = entries.find((item) => item.kind === "file" && /\.html?$/i.test(item.name));
  if (!entry) return false;
  const source = await access.readFile(entry.name, { limitBytes: 500_000 });
  if (!source.exists || source.truncated) return false;

  // Keep the fallback safe in HTML attributes, single-quoted JavaScript strings,
  // double-quoted JavaScript strings, and JSON. Literal SVG attribute quotes can
  // terminate the generated source context when a broken URL is replaced in place.
  const placeholder = "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22800%22%20height=%22600%22%20viewBox=%220%200%20800%20600%22%3E%3Crect%20width=%22800%22%20height=%22600%22%20fill=%22%23f4e7df%22/%3E%3Cpath%20d=%22M160%20420l150-150%2090%2090%2090-100%20150%20160z%22%20fill=%22%23d8b4a0%22/%3E%3Ccircle%20cx=%22570%22%20cy=%22180%22%20r=%2252%22%20fill=%22%23fff7ed%22/%3E%3C/svg%3E";
  let content = source.content;
  for (const brokenSource of brokenSources) content = content.split(brokenSource).join(placeholder);
  if (content === source.content && !content.includes("data-foundry-image-fallback")) {
    const fallback = `<script data-foundry-image-fallback>document.querySelectorAll('img').forEach((image)=>{const fallback=${JSON.stringify(placeholder)};const repair=()=>{if(image.src!==fallback)image.src=fallback};image.addEventListener('error',repair,{once:true});if(image.complete&&image.naturalWidth===0)repair()});</script>`;
    content = content.replace(/<\/body\s*>/i, `${fallback}</body>`);
  }
  if (content === source.content) return false;

  await emitExecution(execution, "edit", "running", "Replacing broken preview images with reliable local fallbacks", { filePath: entry.name });
  const write = await access.writeFile(entry.name, content);
  await emitExecution(execution, "edit", write.verified ? "completed" : "error", write.verified ? "Repaired broken preview images" : "Could not repair broken preview images", {
    filePath: entry.name,
    details: { repairedImages: brokenSources.length, reason: write.reason },
  });
  return write.verified;
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
  followUpResolution?: FollowUpResolutionRecord,
  continuity?: "carry_forward_plan" | "fresh_plan",
  approvalResponse?: ApprovalResponse,
  quality?: MissionQualityLevel,
  modelMode?: ModelMode,
  evidenceImages: EvidenceImages = [],
): Promise<FactoryProjectResult> {
  const localPath = typeof localPathOrEmitter === "string" ? localPathOrEmitter.trim() : "";
  const onEvent = typeof localPathOrEmitter === "function" ? localPathOrEmitter : maybeEmitter;
  const spec = parseBrief(brief);
  const projectName = spec.projectName === "Open Existing Project" ? "Existing Project" : spec.projectName;
  if (localConnector?.url) {
    return executeConnectorProjectTask(brief, task, localConnector, projectName, onEvent, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceImages);
  }
  if (localPath) {
    return executeLocalProjectTask(brief, task, localPath, projectName, onEvent, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceImages);
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

  const mission = await runExistingProjectMission({ projectPath, task, sourceMode: "uploaded-copy", execution, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceImages });
  commands.push(...(mission.commands ?? []));
  const files = mission.projectDeleted ? [] : await listProjectFilesWithStatuses(projectPath, mission.changedFiles, new Set(safeFiles.map((file) => file.path)));
  events.push(...mission.events);
  const preview = mission.status === "passed" && !mission.projectDeleted && missionHasPreviewableWork(mission) ? await startPreview(projectId, projectPath, detected.stack, events, execution) : undefined;

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
    projectDeleted: mission.projectDeleted,
  });
}

async function executeConnectorProjectTask(brief: string, task: string, connector: LocalConnectorConfig, projectName: string, onEvent?: ExecutionEmitter, signal?: AbortSignal, approvedCategories: string[] = [], approvedCommands: string[] = [], parentMission?: MissionParentContext, followUpResolution?: FollowUpResolutionRecord, continuity?: "carry_forward_plan" | "fresh_plan", approvalResponse?: ApprovalResponse, quality?: MissionQualityLevel, modelMode?: ModelMode, evidenceImages: EvidenceImages = []): Promise<FactoryProjectResult> {
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
    followUpResolution,
    continuity,
    approvalResponse,
    quality,
    modelMode,
    evidenceImages,
  });

  commands.push(...(mission.commands ?? []));
  events.push(...mission.events);
  const files = mission.projectDeleted ? [] : await listConnectorFilesWithStatuses(access, mission.changedFiles);
  const preview = mission.status === "passed" && !mission.projectDeleted && missionHasPreviewableWork(mission) ? await startConnectorPreview(connector) : undefined;
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
    projectDeleted: mission.projectDeleted,
  });
}

async function executeLocalProjectTask(brief: string, task: string, localPath: string, projectName: string, onEvent?: ExecutionEmitter, signal?: AbortSignal, approvedCategories: string[] = [], approvedCommands: string[] = [], parentMission?: MissionParentContext, followUpResolution?: FollowUpResolutionRecord, continuity?: "carry_forward_plan" | "fresh_plan", approvalResponse?: ApprovalResponse, quality?: MissionQualityLevel, modelMode?: ModelMode, evidenceImages: EvidenceImages = []): Promise<FactoryProjectResult> {
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
  const existingEnvironment = await environmentReadinessForStack(capabilityLevelForStackChoice(detected.stack).id);
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

  const mission = await runExistingProjectMission({ projectPath, task, sourceMode: "local-folder", execution, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceImages });
  commands.push(...(mission.commands ?? []));
  events.push(...mission.events);
  let status = mission.status;
  let blocker = mission.blocker;
  let changedFiles = [...mission.changedFiles];
  let sessionSummary = mission.sessionSummary;
  let clarificationQuestions = mission.clarificationQuestions;
  const verification = [...(mission.verification ?? [])];
  const preview = status === "passed" && !mission.projectDeleted && missionHasPreviewableWork(mission) ? await startPreview(projectId, projectPath, detected.stack, events, execution) : undefined;
  if (status === "passed" && detected.stack === "Static HTML/CSS/JS" && preview?.previewUrl) {
    // A follow-up extends the durable project contract; it does not replace it. Validate the saved
    // creation brief and the current instruction together so "preserve everything" cannot pass after
    // a rewrite silently removes earlier controls, seed data, or interaction requirements.
    const acceptanceTask = `${brief.trim()}\n\nCurrent follow-up requirement:\n${task.trim()}`;
    let browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, acceptanceTask);
    if (!browserEvidence.verified) {
      await emitExecution(execution, "reasoning", "completed", "The real browser found a concrete gap in the requested experience. I’m repairing that evidence-backed failure once, then I’ll exercise the same flow again.");
      const repairTask = `Repair this existing static project so the real browser satisfies both its durable project brief and the current follow-up. Preserve working behavior and change only what the verified failure proves is incomplete.\n\nDurable project brief:\n${brief.trim()}\n\nCurrent follow-up:\n${task.trim()}\n\nVerified browser failure:\n${browserEvidence.evidence}`;
      const repairFiles = [...new Set([...detected.entryFiles, ...detected.cssFiles, ...detected.jsFiles])];
      const repair = await runExistingProjectMission({
        projectPath,
        task: repairTask,
        sourceMode: "local-folder",
        execution,
        signal,
        approvedCategories,
        approvedCommands,
        continuity: "fresh_plan",
        quality,
        modelMode,
        followUpResolution: {
          currentIntent: "edit",
          referencedPriorAction: null,
          relevantFiles: repairFiles,
          expectedScope: "Repair only the browser-verified gap while preserving the rest of the working static project.",
          destructive: false,
          referenceConfidence: 1,
          plannedAction: repairTask,
          continuity: "fresh_plan",
          rationale: "A deterministic browser check found a concrete mismatch with the user's request.",
          clarifyingQuestion: "",
          clarifyingOptions: [],
        },
      });
      commands.push(...(repair.commands ?? []));
      events.push(...repair.events);
      verification.push(...(repair.verification ?? []));
      changedFiles = [...new Set([...changedFiles, ...repair.changedFiles])];
      sessionSummary = repair.sessionSummary ?? sessionSummary;
      clarificationQuestions = repair.clarificationQuestions;
      if (repair.status === "passed" && repair.changedFiles.length) {
        browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, acceptanceTask);
      } else {
        status = repair.status;
        blocker = `Browser verification failed, and the bounded automatic repair did not complete: ${repair.blocker || browserEvidence.evidence}`;
      }
    }
    verification.push({ check_type: "preview", result: browserEvidence.verified ? "pass" : "fail", evidence: browserEvidence.evidence });
    if (browserEvidence.verified) {
      status = "passed";
      blocker = undefined;
    } else if (status === "passed") {
      status = "failed";
      blocker = browserEvidence.evidence;
    }
  }
  const files = mission.projectDeleted ? [] : await listProjectFilesWithStatuses(projectPath, changedFiles, new Set(localFiles.map((file) => file.path)));

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
    artifact: preview?.artifact,
    projectDeleted: mission.projectDeleted,
    timeline: execution.timeline,
    sessionSummary,
    clarificationQuestions,
    verification,
    environment: existingEnvironment,
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
  followUpResolution?: FollowUpResolutionRecord;
  continuity?: "carry_forward_plan" | "fresh_plan";
  approvalResponse?: ApprovalResponse;
  quality?: MissionQualityLevel;
  modelMode?: ModelMode;
  evidenceImages?: EvidenceImages;
}): Promise<{ status: FactoryProjectResult["status"]; blocker?: string; clarificationQuestions?: MissionClarification[]; changedFiles: string[]; commands?: FactoryCommandEvent[]; sessionSummary?: FactorySessionSummary; verification?: ExecutionMissionVerification[]; events: string[]; projectDeleted?: boolean }> {
  const { projectPath, task, sourceMode, execution, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceImages } = params;
  const access = createServerProjectAccess(projectPath, sourceMode, signal);
  const snapshot = await buildProjectSnapshot(access);
  return runExistingProjectMissionWithAccess({ access, task, sourceMode, execution, projectSnapshot: snapshot, workspaceProjectPath: projectPath, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceImages });
}

async function runExistingProjectMissionWithAccess(params: {
  access: ReturnType<typeof createServerProjectAccess> | ReturnType<typeof createLocalConnectorProjectAccess>;
  task: string;
  sourceMode: "local-folder" | "uploaded-copy";
  execution: ExecutionContext;
  projectSnapshot: string;
  workspaceProjectPath?: string;
  signal?: AbortSignal;
  approvedCategories?: string[];
  approvedCommands?: string[];
  parentMission?: MissionParentContext;
  followUpResolution?: FollowUpResolutionRecord;
  continuity?: "carry_forward_plan" | "fresh_plan";
  approvalResponse?: ApprovalResponse;
  quality?: MissionQualityLevel;
  modelMode?: ModelMode;
  evidenceImages?: EvidenceImages;
}): Promise<{ status: FactoryProjectResult["status"]; blocker?: string; clarificationQuestions?: MissionClarification[]; changedFiles: string[]; commands?: FactoryCommandEvent[]; sessionSummary?: FactorySessionSummary; verification?: ExecutionMissionVerification[]; events: string[]; stackLabel?: string; projectDeleted?: boolean }> {
  const { access, task: requestedTask, execution, projectSnapshot, workspaceProjectPath, signal, approvedCategories = [], approvedCommands = [], parentMission, followUpResolution, continuity, approvalResponse: structuredApprovalResponse, quality = DEFAULT_MISSION_QUALITY, modelMode = "auto", evidenceImages = [] } = params;
  // Older browser bundles sent approval controls as synthetic prose. Treat that wire format as a
  // control response on the server too, so a stale tab can never restart a premium Builder mission.
  const legacyDeniedCommand = requestedTask.match(/^Denied approval to run "([\s\S]+)" - mark the checklist item/i)?.[1]?.trim();
  const approvalResponse: ApprovalResponse = structuredApprovalResponse ?? (legacyDeniedCommand
    ? { requestedCommand: legacyDeniedCommand, decision: "deny" }
    : undefined);
  const originalTask = parentMission?.source_requirements?.find((requirement) => requirement.trim());
  const operationVerbPresent = /\b(?:run|execute|rerun|verify|validate|check|publish|build|test|launch|open|expose)\b/i.test(requestedTask);
  const explicitlyNoMutation = /\b(?:do not|don't|without)\b[^.!?\n]{0,100}\b(?:edit|change|modify|rewrite|touch)(?:ing)?\b|\bno\s+(?:source|file|code)\s+changes?\b/i.test(requestedTask);
  const verificationOnlyRequest = /\b(?:verify|validate|check|test)\b/i.test(requestedTask)
    && /\b(?:browser|preview|navigation|build|test|lint|typecheck|runtime|server|endpoint|artifact)\b/i.test(requestedTask)
    && !/\b(?:add|create|implement|change|modify|rewrite|refactor|fix|repair|remove|delete)\b/i.test(requestedTask);
  const explicitlyReadOnlyOperation = operationVerbPresent && (explicitlyNoMutation || verificationOnlyRequest);
  const isControlContinuation = Boolean(approvalResponse)
    || /^Resolved project decisions:/i.test(requestedTask.trim())
    || /^(?:yes|yes please|go ahead|continue|do it|proceed)[.!]?$/i.test(requestedTask.trim());
  let task = continuity === "carry_forward_plan" && !explicitlyReadOnlyOperation && originalTask && isControlContinuation
    ? `${originalTask}\n\nContinuation decision: ${requestedTask}. Continue the entire original request; do not stop after only the approved action or decision.`
    : requestedTask;
  if (continuity === "carry_forward_plan" && !explicitlyReadOnlyOperation) {
    const savedBrief = await access.readFile("foundry-brief.md", { limitBytes: 100_000 }).catch(() => undefined);
    if (savedBrief?.exists && savedBrief.content.trim() && !task.includes(savedBrief.content.trim())) {
      task = `${task}\n\nSaved project brief (authoritative requirements):\n${savedBrief.content.trim()}`;
    }
  }
  const projectDeletion = await handleWholeProjectDeletion({
    access,
    execution,
    requestedTask,
    parentMission,
    approvalResponse,
    signal,
  });
  if (projectDeletion) return projectDeletion;
  // Approval clicks are bounded control turns. Do not start each one on the premium builder tier.
  const workingSet = await discoverProjectWorkingSet(access, task);
  await emitExecution(execution, "reasoning", "completed", workingSet.likelyFiles.length
    ? `Working set selected: ${workingSet.likelyFiles.slice(0, 3).join(", ")}${workingSet.likelyFiles.length > 3 ? " and their dependencies" : ""}.`
    : "Project discovery found no task-specific files; implementation will inspect dependencies as needed.");
  const initialModel = await modelForMissionStage(task, modelMode, "fast", workingSet, parentMission?.state === "failed" ? 1 : 0);
  await emitModelSelection(execution, approvalResponse ? "follow-up" : "initial routing", initialModel);
  const apiKey = initialModel?.apiKey;
  const objective = engineeringObjectiveForTask(task);
  if (evidenceImages.length) {
    await emitExecution(execution, "inspection", "completed", `Visual evidence attached · ${evidenceImages.length} screenshot${evidenceImages.length === 1 ? "" : "s"}`, {
      details: { files: evidenceImages.map((image) => image.fileName), visionEnabled: true },
    });
  }

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

  const detectedStack = await detectStackProfileAndEntriesForAccess(access);
  let stackProfile = detectedStack.profile;
  const { rootEntries, verificationProfile } = detectedStack;
  if (stackProfile.id === "unknown" && rootEntries.some((entry) => entry.toLowerCase() === "foundry-brief.md")) {
    const savedBrief = await access.readFile("foundry-brief.md", { limitBytes: 100_000 });
    const selectedStack = savedBrief.content.match(/^Selected stack:\s*(.+)$/im)?.[1]?.trim();
    if (selectedStack) stackProfile = capabilityLevelForStackChoice(selectedStack);
  }
  const hasGeneratedImplementationEntry = await hasImplementationSourceForAccess(access);
  const savedBriefForRecovery = await access.readFile("foundry-brief.md", { limitBytes: 100_000 }).catch(() => undefined);
  const isFoundryGeneratedProject = savedBriefForRecovery?.exists
    && /^Mode:\s*Build new project$/im.test(savedBriefForRecovery.content)
    && /^Project source(?: mode)?:\s*Create inside Foundry workspace$/im.test(savedBriefForRecovery.content);
  const explicitCommandOnlyRequest = explicitlyReadOnlyOperation;
  const resumingIncompleteProject = Boolean(isFoundryGeneratedProject)
    && (!hasGeneratedImplementationEntry
      || parentMission?.state === "failed"
      || Boolean(parentMission?.plan.some((item) => item.status !== "completed" && item.status !== "skipped")))
    && !explicitCommandOnlyRequest
    && !/^\s*(?:delete|remove|erase)\s+(?:this\s+)?project\b/i.test(requestedTask);
  const resumingIncompleteStaticProject = resumingIncompleteProject && stackProfile.id === "static-html";
  const recoveryScaffoldFiles = resumingIncompleteProject && workspaceProjectPath
    ? await ensureRequestedStackScaffold(workspaceProjectPath, stackProfile, path.basename(workspaceProjectPath), execution, [])
    : [];
  if (resumingIncompleteProject) {
    const authoritativeBrief = savedBriefForRecovery ?? await access.readFile("foundry-brief.md", { limitBytes: 100_000 });
    task = [
      "Complete the unfinished generated project from its authoritative saved brief. Create the coordinated implementation, verify it, and run the real output.",
      authoritativeBrief.exists ? `Saved project brief (authoritative requirements):\n${authoritativeBrief.content.trim()}` : "",
      `Current continuation instruction: ${requestedTask.trim()}`,
    ].filter(Boolean).join("\n\n");
  }
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
  // A finished dependency-free static product is one browser artifact. Multiple acceptance clauses
  // can make the request text look "large" without making the code change multi-system. Keep these
  // bounded follow-ups on Fast and let deterministic Chromium acceptance enforce every clause.
  const boundedStaticFollowUp = stackProfile.id === "static-html"
    && workingSet.likelyFiles.filter((file) => /\.(?:html?|css|js)$/i.test(file)).length <= 3
    && /\b(?:add|change|update|make|improve|fix|replace|style|show|include)\b/i.test(task)
    && !/\b(?:new|create|add)\s+(?:a\s+|an\s+|another\s+)?(?:file|page|route|screen)\b/i.test(task)
    && !/\b(?:delete|remove\s+(?:the\s+)?project|migration|database|authentication|authorization|payment|billing|secret|credential)\b/i.test(task);
  const skipClassifyCall = Boolean(approvalResponse) || (continuity === "carry_forward_plan" && isControlContinuation) || looksUnambiguouslyLikeSmallEdit(task) || boundedStaticFollowUp;
  const classification = skipClassifyCall
    ? { intent: resumingIncompleteProject ? "build" as const : "edit" as const, needsProjectInspection: true, rationale: resumingIncompleteProject ? "Resuming the unfinished saved project build without paying for another intent-classification call." : "Recognized as a small, unambiguous edit — skipped an extra classification step to start faster." }
    : await classifyIntent({ message: task, hasProjectContext: true, apiKey, provider: initialModel.provider, projectEvidence: { likelyFiles: workingSet.likelyFiles, estimatedSubsystems: workingSet.estimatedSubsystems, crossLayer: workingSet.crossLayer } });
  const routingAssessment = "routingAssessment" in classification ? classification.routingAssessment : deterministicTaskAssessment(task);
  const deterministicIntent = deterministicMutationIntent(task);
  if (explicitCommandOnlyRequest && (classification.intent === "question" || classification.intent === "status" || classification.intent === "analyze")) {
    classification.intent = "edit";
    classification.needsProjectInspection = true;
    classification.rationale = "Deterministic operation guard: the user explicitly requested a real run/validation action, so prose-only inspection is not a valid result.";
  }
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
    details: { intent: classification.intent, rationale: classification.rationale, routingAssessment: JSON.stringify(routingAssessment) },
  });

  if (approvalResponse?.decision === "deny" && parentMission) {
    const remainingAfterDenial = parentMission.plan.filter((item) => item.status === "pending" || item.status === "running");
    if (!remainingAfterDenial.length) {
      execution.checklist.splice(0, execution.checklist.length, {
        id: "denied-action",
        label: `Run ${approvalResponse.requestedCommand}`,
        status: "skipped",
        evidence: `User denied ${approvalResponse.requestedCommand}.`,
      });
      await emitExecution(execution, "reasoning", "completed", `Denied action was skipped: ${approvalResponse.requestedCommand}`, {
        details: { decision: "deny", requestedCommand: approvalResponse.requestedCommand },
      });
      await emitExecution(execution, "summary", "completed", "The denied action did not run; no other mission work remained");
      return { status: "passed", changedFiles: [], events: [`Denied action skipped: ${approvalResponse.requestedCommand}`], stackLabel: stackProfile.label };
    }
  }

  if (classification.intent === "question" || classification.intent === "status" || classification.intent === "analyze") {
    const inspection = await runReadOnlyInspection({ message: task, access, apiKey, provider: initialModel.provider, onEvent, routingAssessment });
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
    const undone = followUpResolution?.referencedPriorAction
      ? await undoReferencedChange(access, execution, projectId, followUpResolution)
      : await undoLastChange(access, execution, projectId);
    if (undone.status === "failed") {
      await emitExecution(execution, "summary", "error", "Mission blocked", { details: { blocker: undone.blocker } });
      finishObjectiveChecklist(execution, "unsupported", undone.blocker);
      return { status: "unsupported", blocker: undone.blocker, changedFiles: [], events: [undone.blocker ?? ""], stackLabel: stackProfile.label };
    }
    const undoneFiles = "filePaths" in undone ? undone.filePaths : undone.filePath ? [undone.filePath] : [];
    await emitExecution(execution, "summary", "completed", "Reverted the referenced change", { details: { revertedFiles: undoneFiles, referencedExecutionId: followUpResolution?.referencedPriorAction?.executionId } });
    finishObjectiveChecklist(execution, "passed");
    return { status: "passed", changedFiles: undoneFiles, events: [], stackLabel: stackProfile.label };
  }

  if (stackProfile.level === 1) {
    const unsupportedMessage = unsupportedEditingMessage(stackProfile);
    const inspection = await runReadOnlyInspection({
      message: `${task}\n\n(Note to include in your answer: ${unsupportedMessage})`,
      access,
      apiKey,
      provider: initialModel.provider,
      onEvent,
      routingAssessment,
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

  const capabilityAccess = accessForCapabilityLevel(access, stackProfile.level);
  // A partially generated project is still fulfilling its authoritative saved brief. A narrow
  // follow-up resolution from the last failed file must not reduce that build to one touched path;
  // coordinated source files remain inside the already selected project root.
  const executorAccess = resumingIncompleteProject
    ? capabilityAccess
    : constrainAccessToFollowUpScope(capabilityAccess, followUpResolution, execution, requestedTask);
  const assessedProfile = profileTask({ message: task, dynamicAssessment: routingAssessment, projectFileCount: workingSet.projectFileCount, failureHistory: parentMission?.state === "failed" ? 1 : 0 });
  const atomicUserRequirements = extractAtomicUserRequirements(task);
  const requiresRequirementContract = atomicUserRequirements.length > 1 || requiresPolishedUiAcceptance(task);
  // An approval response resumes the exact blocked mission, whose remaining scope may be much larger
  // than the short synthetic control message. Keep the economical model tier, but never apply the
  // six-turn fast-lane ceiling to that resumed work.
  const fastLane = !approvalResponse && (boundedStaticFollowUp || !requiresRequirementContract)
    && (classification.intent === "edit" || classification.intent === "debug" || classification.intent === "build")
    && assessedProfile.recommendedIntelligenceTier === "fast" && assessedProfile.scope.estimatedFiles <= 3;
  const boundedDebug = classification.intent === "debug"
    && !assessmentHighRisk(routingAssessment)
    && routingAssessment.estimatedFiles <= 3
    && routingAssessment.estimatedSubsystems <= 2;
  const directExecutionLane = explicitCommandOnlyRequest || fastLane || boundedDebug;
  const carryForwardPlan = !explicitCommandOnlyRequest && !resumingIncompleteProject && continuity === "carry_forward_plan" && Boolean(parentMission?.plan.length) && stackProfile.level >= 4;
  if (!directExecutionLane && !carryForwardPlan) await emitExecution(execution, "planning", "running", "Planning the approach", { internal: true });
  let checklist: FactoryObjectiveChecklistItem[];
  if (resumingIncompleteProject) {
    checklist = [
      { id: "complete-generated-source", label: "Create the complete coordinated application source from the saved brief", status: "pending" },
      { id: "verify-generated-project", label: "Run the project checks and confirm the real application starts successfully", status: "pending" },
    ];
  } else if (carryForwardPlan && parentMission) {
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
  } else if (directExecutionLane) {
    checklist = [{ id: explicitCommandOnlyRequest ? "operation-verified" : boundedDebug ? "bounded-debug-repair" : "small-edit-applied", label: explicitCommandOnlyRequest ? `Run and verify without source changes: ${requestedTask.trim()}` : `Complete: ${task.trim()}`, status: "pending" as const }];
  } else {
    // Pre-plan complexity is necessarily an estimate (distinctPhases doesn't exist until the checklist
    // does) — fine here, since tierForStage's "plan" branch only ever keys off quality, never complexity.
    const prePlanComplexity = assessMissionComplexity({
      highRisk: assessmentHighRisk(routingAssessment),
      multiPart: assessmentMultiPart(routingAssessment),
      distinctPhases: 0,
      stackCapabilityLevel: stackProfile.level,
      fileCount: routingAssessment.estimatedFiles,
    });
    const prePlanStrategy = createExecutionStrategy({ kind: "existing-project", complexity: prePlanComplexity, quality, fileCount: routingAssessment.estimatedFiles, estimatedArtifacts: 0, independentlyGeneratable: false, highRisk: assessmentHighRisk(routingAssessment), securitySensitive: routingAssessment.securityOrPayment, needsVisualValidation: /\b(ui|layout|screen|page|responsive|visual|css)\b/i.test(task), repeatedFailures: 0 });
    const planModel = await modelForMissionStage(task, modelMode, tierForCapability(prePlanStrategy, "plan", tierForStage("plan", quality, prePlanComplexity)), workingSet, parentMission?.state === "failed" ? 1 : 0, routingAssessment) ?? initialModel!;
    await emitModelSelection(execution, "planning", planModel);
    await emitExecution(execution, "reasoning", "completed", "I’m turning the request and project evidence into a concrete checklist before touching code, including what must be verified afterward.");
    const plan = await planMission({ objective, task, projectSnapshot, apiKey: planModel.apiKey, provider: planModel.provider, canRunCommands: executorAccess.capabilities.canRunCommands, tier: planModel.tier, routingAssessment });
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
  // A category approval arrives in the same click that resumes execution. React persistence may not
  // have committed yet, so the structured response itself must authorize this resumed request.
  const effectiveApprovedCategories = Array.from(new Set([
    ...approvedCategories,
    ...(resumingIncompleteProject ? ["dependencies", "package-runner"] : []),
    ...(approvalResponse?.decision === "approve-category" && approvalResponse.category ? [approvalResponse.category] : []),
  ]));
  if (approvalResponse?.decision === "deny") {
    const deniedCommand = approvalResponse.requestedCommand.trim();
    await emitExecution(execution, "blocked", "warning", `Approval denied: ${deniedCommand}`, {
      tier: "flag",
      command: deniedCommand,
      details: {
        reason: `The user denied this command. You can run it yourself when ready: \`${deniedCommand}\`. Work that depends on it remains blocked; Foundry will continue only with work that can still be verified safely.`,
      },
    });
    // A denial can fully resolve a one-step blocked plan. In that case there is nothing for an AI
    // model to do, so finish deterministically instead of charging for a continuation paraphrase.
    if (!checklist.some((item) => item.status === "pending" || item.status === "blocked")) {
      execution.checklist.splice(0, execution.checklist.length, {
        id: "denied-action",
        label: `Run ${deniedCommand}`,
        status: "skipped",
        evidence: `User denied ${deniedCommand}.`,
      });
      await emitExecution(execution, "summary", "completed", "Continued without the denied action", {
        output: "The denied action was skipped. No model call was needed to resolve this continuation.",
      });
      return {
        status: "passed",
        changedFiles: [],
        events: ["Denied action skipped without restarting the model."],
        stackLabel: stackProfile.label,
      };
    }
  }
  const distinctPhases = new Set(checklist.map((item) => item.phase).filter(Boolean)).size;
  const highRisk = assessmentHighRisk(routingAssessment) && distinctPhases >= 2 && stackProfile.level >= 4;
  const complexity = assessMissionComplexity({
    highRisk,
    multiPart: assessmentMultiPart(routingAssessment),
    distinctPhases,
    stackCapabilityLevel: stackProfile.level,
    fileCount: routingAssessment.estimatedFiles,
  });
  const missionStrategy = createExecutionStrategy({
    kind: "existing-project", complexity, quality, fileCount: routingAssessment.estimatedFiles,
    estimatedArtifacts: checklist.filter((item) => item.status === "pending").length,
    independentlyGeneratable: new Set(checklist.map((item) => item.phase).filter(Boolean)).size > 1 && !highRisk,
    highRisk,
    securitySensitive: routingAssessment.securityOrPayment,
    needsVisualValidation: /\b(ui|layout|screen|page|responsive|visual|css)\b/i.test(task),
    repeatedFailures: parentMission?.state === "failed" ? 1 : 0,
  });
  await emitExecution(execution, "planning", "completed", `Execution strategy: ${missionStrategy.workflow}`, { details: { workflow: missionStrategy.workflow, concurrency: missionStrategy.concurrency, reason: missionStrategy.reason } });

  let architectureNotes: string | undefined;
  if (shouldRunArchitectureReview(quality, complexity, highRisk)) {
    // Not internal — Capability-First Experience: this is one of the visible workflow steps a user
    // should see ("Reviewing architecture"), not raw model/provider plumbing.
    await emitExecution(execution, "planning", "running", "Reviewing architecture");
    const reviewModel = await modelForMissionStage(task, modelMode, tierForCapability(missionStrategy, "review", tierForStage("review", quality, complexity)), workingSet, parentMission?.state === "failed" ? 1 : 0, routingAssessment) ?? initialModel!;
    await emitModelSelection(execution, "architecture review", reviewModel);
    const review = await reviewArchitecture({ objective, task, checklist, projectSnapshot, apiKey: reviewModel.apiKey, provider: reviewModel.provider, tier: reviewModel.tier, routingAssessment });
    if (review.revisedChecklist?.length) {
      checklist = review.revisedChecklist;
      execution.checklist.splice(0, execution.checklist.length, ...checklist);
    }
    if (review.concerns.length) architectureNotes = review.concerns.map((concern) => `- ${concern}`).join("\n");
    await emitExecution(execution, "planning", "completed", review.concerns.length ? "Architecture review flagged concerns" : "Architecture review found no concerns", {
      details: review.concerns.length ? { concerns: review.concerns } : undefined,
    });
  }

  const implementationTier = approvalResponse && !resumingIncompleteProject
    ? "fast"
    : boundedStaticFollowUp
    ? requiresRequirementContract ? "builder" : "fast"
    : tierForCapability(missionStrategy, classification.intent === "debug" ? "debug" : "implement", tierForStage("implement", quality, complexity));
  if (resumingIncompleteProject && savedBriefForRecovery?.exists) {
    const recoverySpec = parseBrief(savedBriefForRecovery.content);
    const generatedRoot = path.resolve(access.rootLabel);
    if (generatedRoot.startsWith(`${path.resolve(projectsRoot)}${path.sep}`)) {
      await ensureRequestedStackScaffold(generatedRoot, stackProfile, recoverySpec.projectName, execution, []);
    }
  }
  const implementationModel = await modelForMissionStage(task, modelMode, implementationTier, workingSet, parentMission?.state === "failed" ? 1 : 0, routingAssessment) ?? initialModel!;
  await emitModelSelection(execution, "implementation", implementationModel);
  await emitExecution(execution, "reasoning", "completed", `The working plan is ready. I’m applying the ${classification.intent === "debug" ? "smallest evidence-backed repair" : "requested change"} now and will report any scope change before escalating.`);
  let result = await runMissionExecutor({
    objective,
    task,
    checklist,
    costScopeId: execution.costScopeId,
    access: executorAccess,
    apiKey: implementationModel.apiKey,
    provider: implementationModel.provider,
    onEvent,
    signal,
    preApprovedCommands,
    approvedCategories: effectiveApprovedCategories,
    standingApprovedCommands: approvedCommands,
    deniedActions: Array.from(new Set([
      ...(parentMission?.denied_actions ?? []),
      ...(approvalResponse?.decision === "deny" ? [approvalResponse.requestedCommand.trim()] : []),
    ])),
    priorContext: resumingIncompleteProject ? undefined : parentMission,
    followUpResolution: resumingIncompleteProject ? undefined : followUpResolution,
    fastLane,
    highRisk,
    tier: implementationModel.tier,
    architectureNotes,
    hasBuildTooling: explicitCommandOnlyRequest ? false : stackHasBuildStep(stackProfile.id),
    verificationProfile,
    executionStrategy: missionStrategy,
    evidenceImages,
    routingAssessment,
    commandOnly: explicitCommandOnlyRequest,
    newProject: resumingIncompleteProject,
    continuableBatch: resumingIncompleteProject,
    staticProject: resumingIncompleteStaticProject || boundedStaticFollowUp,
    maxTurns: approvalResponse ? 20 : resumingIncompleteStaticProject ? 8 : undefined,
  });
  const stalledBeforeFirstMutation = !resumingIncompleteProject
    && !explicitCommandOnlyRequest
    && result.status === "failed"
    && result.changedFiles.length === 0
    && /lost a clear next step|did not call required tool (?:replace_in_file|write_file)|existing file content unchanged|no-progress action/i.test(result.blocker ?? "");
  if (stalledBeforeFirstMutation) {
    await emitExecution(execution, "reasoning", "completed", "The first edit pass inspected the right files but did not apply the requested change. I’m retrying once with a stronger implementation route and the verified working set preserved.");
    const actionRecoveryModel = await modelForMissionStage(task, modelMode, "builder", workingSet, 1, routingAssessment) ?? implementationModel;
    await emitModelSelection(execution, "implementation action recovery", actionRecoveryModel);
    const actionRecovery = await runMissionExecutor({
      objective,
      task: `Apply the requested existing-project change now. The relevant project files were already identified. Inspect only what is necessary, make the smallest complete file edit, then verify it with the project's applicable checks. Do not stop after reading or describing the change.\n\nOriginal task: ${task}`,
      checklist: result.checklist,
      costScopeId: execution.costScopeId,
      access: executorAccess,
      apiKey: actionRecoveryModel.apiKey,
      provider: actionRecoveryModel.provider,
      onEvent,
      signal,
      preApprovedCommands,
      approvedCategories: effectiveApprovedCategories,
      standingApprovedCommands: approvedCommands,
      deniedActions: parentMission?.denied_actions ?? [],
      priorContext: parentMission,
      followUpResolution,
      fastLane: boundedStaticFollowUp,
      highRisk,
      tier: actionRecoveryModel.tier,
      architectureNotes,
      hasBuildTooling: stackHasBuildStep(stackProfile.id),
      verificationProfile,
      executionStrategy: missionStrategy,
      evidenceImages,
      routingAssessment,
      staticProject: boundedStaticFollowUp,
      maxTurns: 8,
      maxNudges: 2,
    });
    result = {
      ...actionRecovery,
      changedFiles: Array.from(new Set([...result.changedFiles, ...actionRecovery.changedFiles])),
      commands: [...result.commands, ...actionRecovery.commands],
      verification: [...result.verification, ...actionRecovery.verification],
      timeline: [...result.timeline, ...actionRecovery.timeline],
      usage: [...result.usage, ...actionRecovery.usage],
      turnsUsed: result.turnsUsed + actionRecovery.turnsUsed,
    };
  }
  if (recoveryScaffoldFiles.length) {
    result.changedFiles = Array.from(new Set([...recoveryScaffoldFiles, ...result.changedFiles]));
  }

  const resumableBatchFailure = (candidate: typeof result) => candidate.status === "failed"
    // A greenfield batch can legitimately spend its whole model-call allowance understanding the
    // requested product and inspecting the new scaffold before its first durable write. Treat the
    // allowance as a continuation boundary, not a terminal product blocker. Existing-project work
    // still requires a real file change before automatic continuation so read-only failures cannot
    // loop without progress.
    && (resumingIncompleteProject || candidate.changedFiles.length > 0)
    && /command or file write failed|production build (?:not verified|failed)/i.test(candidate.blocker ?? "");
  // A substantial greenfield product can legitimately need more than one bounded executor batch.
  // Preserve one routing/cost identity across continuation batches. On-disk progress can continue,
  // but a batch boundary must never reset the amount the user authorized this mission to spend.
  const maxContinuationBatches = 1;
  for (let continuationAttempt = 1; continuationAttempt <= maxContinuationBatches && resumableBatchFailure(result); continuationAttempt += 1) {
    await emitExecution(execution, "reasoning", "completed", `The implementation files are on disk, but batch ${continuationAttempt} did not finish the mission. I’m continuing automatically with the remaining work instead of asking you to restart.`);
    const continuation = await runMissionExecutor({
      objective,
      task: `Continuation batch ${continuationAttempt}: finish the existing mission. The implementation files are already on disk. Inspect them, complete only the remaining implementation and checklist evidence, run the real production build, and report the real result without rewriting correct files.\n\nOriginal task: ${task}`,
      checklist: result.checklist,
      costScopeId: execution.costScopeId,
      access: executorAccess,
      apiKey: implementationModel.apiKey,
      provider: implementationModel.provider,
      onEvent,
      signal,
      preApprovedCommands,
      approvedCategories: effectiveApprovedCategories,
      standingApprovedCommands: approvedCommands,
      deniedActions: parentMission?.denied_actions ?? [],
      priorContext: resumingIncompleteProject ? undefined : parentMission,
      followUpResolution: resumingIncompleteProject ? undefined : followUpResolution,
      fastLane: false,
      highRisk,
      tier: implementationModel.tier,
      hasBuildTooling: explicitCommandOnlyRequest ? false : stackHasBuildStep(stackProfile.id),
      verificationProfile,
      executionStrategy: missionStrategy,
      routingAssessment,
      commandOnly: explicitCommandOnlyRequest,
      newProject: resumingIncompleteProject && result.changedFiles.length < 3,
      continuableBatch: resumingIncompleteProject,
      staticProject: resumingIncompleteStaticProject,
      maxTurns: resumingIncompleteProject ? 20 : 16,
      maxNudges: 2,
    });
    result = {
      ...continuation,
      changedFiles: Array.from(new Set([...result.changedFiles, ...continuation.changedFiles])),
      commands: [...result.commands, ...continuation.commands],
      verification: [...result.verification, ...continuation.verification],
      timeline: [...result.timeline, ...continuation.timeline],
    };
  }

  const hasHonestlySkippedItem = result.checklist.some((item) => item.status === "skipped");
  const generatedProjectBuildPassed = result.commands.some((command) =>
    command.exitCode === 0 && isProductionBuildCommand(command.command),
  );
  if (resumingIncompleteProject && stackHasBuildStep(stackProfile.id) && !generatedProjectBuildPassed) {
    result.status = "failed";
    result.blocker = "The generated project is not complete because its real production build has not passed. Successful installs, directory listings, lint-only checks, or file read-backs are not build verification.";
    await emitExecution(execution, "summary", "error", "Production build not verified", {
      details: { blocker: result.blocker, requiredEvidence: "successful production build command" },
    });
  }
  // Runtime-level mirror of executor.verifyCompletion's write-free guard — and it must stay consistent with
  // it. A mutating-intent mission that changed nothing is only a failure if it ALSO produced no other real
  // evidence: no honestly-skipped item AND no command that ran successfully. "Run the build/tests/lint and
  // report" legitimately writes nothing — its deliverable is a command that ran — and was being falsely
  // marked "failed" here even though the build/typecheck passed. (The deterministic classifier reads the
  // noun "the build" as the scaffold intent "build"; even corrected that would be a run/verify task, so the
  // right fix is to honor successful-command evidence, not to demand a write.)
  const ranSuccessfulCommand = result.commands.some((command) => command.exitCode === 0);
  // The model can exhaust its bounded call budget after doing the work but before narrating the
  // final checklist transition. Reconcile only command-shaped blocked items from runtime facts:
  // the requested command really exited 0, and any file explicitly promised unchanged was not in
  // the write set. This is intentionally narrow; a passing test never completes an unrelated
  // implementation item by itself.
  reconcileBlockedCommandChecklist(result.checklist, result.commands, result.changedFiles);
  const checklistSettled = result.checklist.length > 0 && result.checklist.every((item) => item.status === "completed" || item.status === "skipped");
  const verificationSupportsCompletion = result.verification.some((item) => item.result === "pass") && !result.verification.some((item) => item.result === "fail");
  const exhaustedBudgetAfterVerifiedDirectEdit = result.status === "failed"
    && result.changedFiles.length > 0
    && ranSuccessfulCommand
    && checklistSettled
    && verificationSupportsCompletion
    && /Estimated request cost would exceed|Model-call limit reached|Premium-model call limit reached/i.test(result.blocker ?? "");
  if (exhaustedBudgetAfterVerifiedDirectEdit) {
    for (const item of result.checklist) {
      if (item.status === "pending" || item.status === "running") {
        item.status = "completed";
        item.evidence = "The change was written and read back from disk, and the project command completed before the bounded model budget was reached.";
      }
    }
    result.status = "passed";
    result.blocker = undefined;
    result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
    result.sessionSummary.outcome = "The verified edit is complete. Foundry stopped model calls at the mission budget and is continuing with deterministic runtime verification.";
    await emitExecution(execution, "summary", "completed", "Implementation evidence complete; continuing with browser verification", {
      details: { reason: "The bounded model budget was reached after a verified edit and successful project command, so Foundry is completing deterministic verification instead of buying a wrap-up response." },
    });
  }
  if (result.status === "passed" && deterministicIntent && deterministicIntent !== "undo" && result.changedFiles.length === 0 && !hasHonestlySkippedItem && !ranSuccessfulCommand) {
    const blocker = "I inspected the project but produced no verifiable result — no file write on disk and no command that ran successfully.";
    await emitExecution(execution, "summary", "error", "Mission produced no verifiable change or command result", {
      details: { blocker, intent: deterministicIntent, changedFiles: 0 },
    });
    result.status = "failed";
    result.blocker = blocker;
  }

  if (result.status === "passed" && shouldRunVerify(quality)) {
    await runVerificationAndEscalate({ objective, task, result, executorAccess, signal, preApprovedCommands, approvedCategories: effectiveApprovedCategories, approvedCommands, execution, quality, complexity, modelMode, strategy: missionStrategy });
  }

  const deterministicBrowserOperationRequested = /\b(?:validate|verify|test|exercise|check)\b/i.test(requestedTask)
    && /\b(?:browser|preview|live\s+(?:site|app)|navigation|user\s+flow|click(?:ing)?)\b/i.test(requestedTask);
  if (deterministicBrowserOperationRequested) {
    const buildPassed = result.commands.some((command) => command.exitCode === 0 && isProductionBuildCommand(command.command));
    if (!buildPassed && stackHasBuildStep(stackProfile.id)) {
      result.status = "failed";
      result.blocker = "Real browser verification was requested, but the canonical production build did not pass first.";
    } else {
      const managedPreview = workspaceProjectPath
        ? await startPreview(slugify(path.basename(workspaceProjectPath)) || "workspace-project", workspaceProjectPath, stackProfile.label, [], execution)
        : { previewState: "unavailable" as const, previewPlatform: "web" as const, previewReason: "Deterministic preview startup is not available for this connector mode." };
      if (!managedPreview.previewUrl || managedPreview.previewPlatform !== "web") {
        result.status = "failed";
        result.blocker = managedPreview.previewReason || "Real browser verification was requested, but Foundry could not start an owned web preview.";
      } else {
        const browserEvidence = await validateGeneratedStaticPreview(managedPreview.previewUrl, workspaceProjectPath!, execution, managedPreview.previewOwnershipToken, requestedTask);
        result.verification.push({ check_type: "preview", result: browserEvidence.verified ? "pass" : "fail", evidence: browserEvidence.evidence });
        result.status = browserEvidence.verified ? "passed" : "failed";
        result.blocker = browserEvidence.verified ? undefined : browserEvidence.evidence;
        if (browserEvidence.verified) {
          for (const item of result.checklist) {
            if (item.status === "pending" || item.status === "running" || item.status === "blocked") {
              item.status = "completed";
              item.evidence = browserEvidence.evidence;
            }
          }
        }
      }
    }
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
  strategy: ExecutionStrategy;
}): Promise<void> {
  const { objective, task, result, executorAccess, signal, preApprovedCommands, approvedCategories, approvedCommands, execution, quality, complexity, modelMode, strategy } = input;
  const onEvent = (event: FactoryExecutionEvent) => execution.emit(event);

  // Not internal — see the matching note on "Reviewing architecture" above.
  await emitExecution(execution, "planning", "running", "Verifying build");
  await emitExecution(execution, "reasoning", "completed", "The implementation pass is complete. I’m checking the actual changed files and verification evidence now rather than assuming the edit worked.");
  const verifyTier = tierForCapability(strategy, "verify", tierForStage("verify", quality, complexity));
  const verifyModel = await modelForMissionStage(task, modelMode, verifyTier);
  await emitModelSelection(execution, "verification", verifyModel);
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

  if (verificationAction(verification.confidence) === "accept") {
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
    source_requirements: [task],
    state: "passed",
    plan: result.checklist,
    files_touched: result.changedFiles.map((filePath) => ({ path: filePath, status: "edited", verified: true })),
    commands_run: result.commands.map((command) => ({ command: command.command, exitCode: command.exitCode })),
    decisions: result.sessionSummary?.changes ?? [],
    findings: [],
    summary: result.sessionSummary?.outcome ?? "",
  };

  const repairTier = tierForCapability(strategy, "repair", "architect");
  const repairModel = await modelForMissionStage(task, modelMode, repairTier, undefined, 1) ?? verifyModel;
  await emitModelSelection(execution, "repair", repairModel);
  const followUp = await runMissionExecutor({
    objective,
    task: `Double check and address any remaining concerns before this mission is truly done: ${notes || "the verification pass was not fully confident this is correct."}`,
    checklist: [{ id: "verify-followup", label: "Address verification concerns and re-confirm the fix", status: "pending" }],
    costScopeId: execution.costScopeId,
    access: executorAccess,
    apiKey: repairModel.apiKey,
    provider: repairModel.provider,
    onEvent,
    signal,
    preApprovedCommands,
    approvedCategories,
    standingApprovedCommands: approvedCommands,
    priorContext,
    tier: repairModel.tier,
    maxTurns: 12,
  });

  if (followUp.status !== "passed") {
    const repairFailure = followUp.blocker || "The verification repair pass could not establish a correct result.";
    result.status = followUp.status === "stopped" ? "stopped" : "failed";
    result.blocker = repairFailure;
    await emitExecution(execution, "summary", "error", "Verification repair did not complete", { details: { reason: repairFailure } });
    return;
  }

  result.checklist = followUp.checklist;
  result.changedFiles = [...new Set([...result.changedFiles, ...followUp.changedFiles])];
  result.commands = [...result.commands, ...followUp.commands];
  result.sessionSummary = followUp.sessionSummary ?? result.sessionSummary;
  result.verification = followUp.verification ?? result.verification;

  const finalVerification = await verifyMissionResult({
    objective,
    task,
    checklist: result.checklist,
    changedFiles: result.changedFiles,
    commands: result.commands,
    narrativeObjects: narrativeObjectsFromTimeline([...result.timeline, ...followUp.timeline]),
    apiKey: verifyModel.apiKey,
    provider: verifyModel.provider,
    tier: verifyModel.tier,
  });

  if (verificationAction(finalVerification.confidence) === "accept") {
    await emitExecution(execution, "planning", "completed", "Verified after an automatic repair pass", {
      details: { confidence: finalVerification.confidence, notes: finalVerification.notes },
    });
    return;
  }

  const improved = verificationImproved(verification.confidence, finalVerification.confidence);
  const materialRisk = verificationRisk(finalVerification.confidence) === "material";
  const residualRisk = materialRisk
    ? `Automatic repair completed, but the final result is not verified: ${finalVerification.notes || "the evidence still needs an independent check."}`
    : `Automatic repair improved the mission, but the final result is only partially verified: ${finalVerification.notes || "the available evidence does not fully establish the result."}`;
  await emitExecution(execution, "summary", "warning", "Verification still has unresolved concerns", {
    details: { reason: residualRisk, improved, initialConfidence: verification.confidence, finalConfidence: finalVerification.confidence },
  });
  if (result.sessionSummary) result.sessionSummary = { ...result.sessionSummary, flags: [...result.sessionSummary.flags, residualRisk] };

  if (verificationRisk(verification.confidence) === "material" && !improved) {
    const disagreement = secondOpinionDisagreed
      ? "A second verifier also materially disagreed with the original assessment."
      : "The repair pass did not improve the verification result.";
    if (result.sessionSummary) result.sessionSummary = { ...result.sessionSummary, flags: [...result.sessionSummary.flags, disagreement] };
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

async function undoReferencedChange(
  access: ProjectAccess,
  execution: ExecutionContext,
  projectId: string,
  resolution: FollowUpResolutionRecord,
): Promise<{ status: "passed" | "failed"; blocker?: string; filePaths: string[] }> {
  const journal = await readJournal(projectId);
  const files = new Set(resolution.relevantFiles.map(normalizeScopePath));
  const startedAt = Date.parse(resolution.referencedPriorAction?.createdAt ?? "");
  const endedAt = Date.parse(resolution.referencedPriorAction?.updatedAt ?? "");
  const candidates = journal
    .filter((entry) => {
      if (entry.reverted || entry.event.status !== "completed" || !entry.event.filePath) return false;
      if (entry.event.kind !== "edit" && entry.event.kind !== "file") return false;
      if (!files.has(normalizeScopePath(entry.event.filePath))) return false;
      const timestamp = Date.parse(entry.timestamp);
      if (Number.isFinite(startedAt) && timestamp < startedAt) return false;
      if (Number.isFinite(endedAt) && timestamp > endedAt + 1_000) return false;
      return true;
    })
    .reverse();

  if (!candidates.length) {
    return { status: "failed", blocker: "The referenced execution has no unreverted journaled file changes in its recorded time range.", filePaths: [] };
  }

  const reverted: string[] = [];
  for (const entry of candidates) {
    const filePath = entry.event.filePath as string;
    if (entry.event.kind === "file" && entry.beforeContent === undefined) {
      if (!access.deleteFile) {
        return { status: "failed", blocker: `The referenced change created ${filePath}, but this project connection cannot safely delete created files yet. No unrelated file was changed.`, filePaths: reverted };
      }
      await emitExecution(execution, "edit", "running", `Removing ${filePath} created by the referenced execution`, { filePath });
      const deleted = await access.deleteFile(filePath);
      if (!deleted.verified) {
        return { status: "failed", blocker: `Could not remove ${filePath}: ${deleted.reason ?? "deletion was not verified."}`, filePaths: reverted };
      }
      await emitExecution(execution, "edit", "completed", `Removed ${filePath} created by the referenced execution`, { filePath, details: { revertedEntryId: entry.id } });
    } else {
      await emitExecution(execution, "edit", "running", `Reverting ${filePath} from the referenced execution`, { filePath });
      const result = await access.writeFile(filePath, entry.beforeContent ?? "");
      if (!isRevertOk(result)) {
        return { status: "failed", blocker: `Could not revert ${filePath}: ${result.reason ?? "the write was not verified."}`, filePaths: reverted };
      }
      await emitExecution(execution, "edit", "completed", `Reverted ${filePath} from the referenced execution`, { filePath, output: result.diff, details: { revertedEntryId: entry.id } });
    }
    await markJournalEntryReverted(projectId, entry.id);
    if (!reverted.includes(filePath)) reverted.push(filePath);
  }
  return { status: "passed", filePaths: reverted };
}

async function handleWholeProjectDeletion(input: {
  access: ProjectAccess;
  execution: ExecutionContext;
  requestedTask: string;
  approvalResponse?: ApprovalResponse;
  parentMission?: MissionParentContext;
  signal?: AbortSignal;
}): Promise<{
  status: FactoryProjectResult["status"];
  blocker?: string;
  changedFiles: string[];
  sessionSummary?: FactorySessionSummary;
  verification?: ExecutionMissionVerification[];
  events: string[];
  projectDeleted?: boolean;
} | undefined> {
  const originalRequest = input.parentMission?.source_requirements.join("\n") || input.requestedTask;
  if (!isWholeProjectDeletionRequest(originalRequest)) return undefined;

  const projectPath = input.access.rootLabel;
  const exactAction = projectDeletionApprovalCommand(projectPath);
  const rootEntries = await input.access.listDir("").catch(() => []);
  const visibleFiles = await listProjectFilesRecursively(input.access).catch(() => []);
  const checklistItem: FactoryObjectiveChecklistItem = {
    id: "delete-project-root",
    label: `Delete the project folder at ${projectPath}`,
    status: "blocked",
    phase: "Project deletion",
    evidence: "Waiting for explicit approval of this exact project path.",
  };
  input.execution.checklist.splice(0, input.execution.checklist.length, checklistItem);

  if (!input.approvalResponse) {
    const blocker = `Permission required to permanently delete the project at ${projectPath}.`;
    await emitExecution(input.execution, "blocked", "warning", "Permission needed to delete this project", {
      tier: "flag",
      command: exactAction,
      filePath: projectPath,
      rationale: `The user asked to delete the connected project. Foundry paused before the single irreversible project-root action at ${projectPath}.`,
      details: {
        actionKind: "delete-project",
        category: "deletes",
        projectPath,
        reason: "This permanently deletes the project folder and everything inside it.",
        topLevelEntries: rootEntries.length,
        discoveredFiles: visibleFiles.length,
        irreversible: true,
      },
    });
    return { status: "awaiting-approval", blocker, changedFiles: [], events: [blocker] };
  }

  if (input.approvalResponse.requestedCommand !== exactAction) {
    const blocker = "The approval did not match the exact project path, so Foundry did not delete anything.";
    checklistItem.evidence = blocker;
    await emitExecution(input.execution, "summary", "error", "Project deletion approval did not match", { details: { blocker, projectPath } });
    return { status: "failed", blocker, changedFiles: [], events: [blocker] };
  }

  if (input.approvalResponse.decision === "deny") {
    checklistItem.status = "skipped";
    checklistItem.evidence = `The user kept the project at ${projectPath}.`;
    await emitExecution(input.execution, "summary", "completed", "Project kept — no files were deleted", {
      details: { projectPath, decision: "deny" },
    });
    return {
      status: "passed",
      changedFiles: [],
      verification: [{ check_type: "checklist", result: "skipped", evidence: `Deletion denied; ${projectPath} was left unchanged.` }],
      events: [`Kept project: ${projectPath}`],
    };
  }

  if (input.approvalResponse.decision !== "approve-once") {
    const blocker = "Whole-project deletion requires one explicit approval for this exact path; standing command or category grants are not accepted.";
    checklistItem.evidence = blocker;
    await emitExecution(input.execution, "summary", "error", "Project deletion requires exact one-time approval", { details: { blocker, projectPath } });
    return { status: "failed", blocker, changedFiles: [], events: [blocker] };
  }
  if (!input.access.deleteRoot) {
    const blocker = "This project connection cannot atomically delete and verify the project root, so Foundry did not delete anything.";
    checklistItem.evidence = blocker;
    await emitExecution(input.execution, "summary", "error", "Project-root deletion is unavailable", { details: { blocker, projectPath } });
    return { status: "unsupported", blocker, changedFiles: [], events: [blocker] };
  }
  if (input.signal?.aborted) {
    const blocker = "Stopped by user before project deletion started.";
    checklistItem.evidence = blocker;
    return { status: "stopped", blocker, changedFiles: [], events: [blocker] };
  }

  checklistItem.status = "running";
  checklistItem.evidence = `Exact path approved once: ${projectPath}`;
  await emitExecution(input.execution, "edit", "running", "Deleting the approved project folder", {
    filePath: projectPath,
    details: { actionKind: "delete-project", projectPath, topLevelEntries: rootEntries.length, discoveredFiles: visibleFiles.length },
  });
  const deleted = await input.access.deleteRoot();
  if (!deleted.verified) {
    const blocker = `Project deletion could not be verified: ${deleted.reason ?? "the project folder still exists."}`;
    checklistItem.status = "blocked";
    checklistItem.evidence = blocker;
    await emitExecution(input.execution, "edit", "error", "Project folder was not deleted", { filePath: projectPath, details: { blocker, projectPath } });
    return { status: "failed", blocker, changedFiles: [], events: [blocker] };
  }

  checklistItem.status = "completed";
  checklistItem.evidence = `Verified that the approved project root no longer exists: ${projectPath}`;
  await emitExecution(input.execution, "edit", "completed", "Project folder deleted", {
    filePath: projectPath,
    details: { actionKind: "delete-project", projectPath, deletedFiles: visibleFiles.length, verifiedAbsent: true },
  });
  await emitExecution(input.execution, "summary", "completed", "The approved project was deleted", {
    details: { projectPath, deletedFiles: visibleFiles.length, verifiedAbsent: true },
  });
  return {
    status: "passed",
    changedFiles: [],
    sessionSummary: {
      outcome: `The approved project folder was permanently deleted: ${projectPath}`,
      changes: [`Removed the entire approved project folder in one verified root-level action (${visibleFiles.length} discovered files).`],
      preserved: ["The Foundry mission record and deletion verification evidence remain available."],
      flags: ["This irreversible action ran only after one-time approval of the exact absolute path."],
    },
    verification: [{ check_type: "checklist", result: "pass", evidence: `Verified project folder deletion: ${projectPath}` }],
    events: [`Deleted project: ${projectPath}`],
    projectDeleted: true,
  };
}

async function listProjectFilesRecursively(access: ProjectAccess, relativePath = "", depth = 0): Promise<string[]> {
  if (depth > 20) throw new Error("Project directory nesting exceeds the safe deletion traversal limit.");
  const entries = await access.listDir(relativePath);
  const files: string[] = [];
  for (const entry of entries) {
    const child = relativePath ? `${relativePath.replace(/\/$/, "")}/${entry.name}` : entry.name;
    if (entry.kind === "directory") files.push(...await listProjectFilesRecursively(access, child, depth + 1));
    else files.push(child);
    if (files.length > 5_000) throw new Error("Project contains more than 5,000 files; use a separately reviewed cleanup plan instead of a bulk delete.");
  }
  return files;
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

async function detectStackProfileAndEntriesForAccess(access: ProjectAccess): Promise<{ profile: StackProfile; rootEntries: string[]; verificationProfile: VerificationProfile }> {
  const rootEntries = (await access.listDir("")).map((entry) => entry.name);
  const manifestPaths = await discoverNestedManifestPaths(access);
  const detectionEntries = [...new Set([...rootEntries, ...manifestPaths])];
  let packageJsonContent: string | undefined;
  const packageJsonPath = detectionEntries.find((name) => name.toLowerCase() === "package.json")
    ?? detectionEntries.find((name) => name.toLowerCase().endsWith("/package.json"));
  if (packageJsonPath) {
    const read = await access.readFile(packageJsonPath, { limitBytes: 6000 }).catch(() => undefined);
    if (read?.exists) packageJsonContent = read.content;
  }

  let javaBuildFileContent: string | undefined;
  const javaBuildFileName = detectionEntries.find((name) => ["pom.xml", "build.gradle", "build.gradle.kts"].includes(path.posix.basename(name).toLowerCase()));
  if (javaBuildFileName) {
    const read = await access.readFile(javaBuildFileName, { limitBytes: 6000 }).catch(() => undefined);
    if (read?.exists) javaBuildFileContent = read.content;
  }

  let dotnetProjectFileContent: string | undefined;
  const dotnetProjectFileName = detectionEntries.find((name) => name.toLowerCase().endsWith(".csproj"));
  if (dotnetProjectFileName) {
    const read = await access.readFile(dotnetProjectFileName, { limitBytes: 6000 }).catch(() => undefined);
    if (read?.exists) dotnetProjectFileContent = read.content;
  }

  const profile = detectStackProfile({ rootEntries: detectionEntries, packageJsonContent, javaBuildFileContent, dotnetProjectFileContent });
  const verificationFiles: Record<string, string | undefined> = {
    "package.json": packageJsonContent,
    "pyproject.toml": await readAccessFileIfPresent(access, rootEntries, "pyproject.toml"),
    "composer.json": await readAccessFileIfPresent(access, rootEntries, "composer.json"),
  };
  const verificationProfile = detectVerificationProfile({
    rootEntries,
    files: verificationFiles,
    platform: process.platform === "darwin" || process.platform === "linux" ? process.platform : "win32",
  });
  return { profile, rootEntries, verificationProfile };
}

async function readAccessFileIfPresent(access: ProjectAccess, rootEntries: string[], fileName: string) {
  const actualName = rootEntries.find((entry) => entry.toLowerCase() === fileName.toLowerCase());
  if (!actualName) return undefined;
  const read = await access.readFile(actualName, { limitBytes: 12_000 }).catch(() => undefined);
  return read?.exists ? read.content : undefined;
}

function accessForCapabilityLevel(access: ProjectAccess, level: StackCapabilityLevel): ProjectAccess {
  if (level >= 3 || !access.capabilities.canRunCommands) return access;
  return { ...access, capabilities: { ...access.capabilities, canRunCommands: false } };
}

async function discoverNestedManifestPaths(access: ProjectAccess) {
  const manifests = /^(?:package\.json|pyproject\.toml|composer\.json|pom\.xml|build\.gradle(?:\.kts)?|cargo\.toml|go\.mod|pubspec\.yaml|androidmanifest\.xml|[^/]+\.(?:csproj|sln))$/i;
  const ignored = /^(?:node_modules|\.git|\.next|bin|obj|dist|build|artifacts|coverage)$/i;
  const found: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: "", depth: 0 }];
  while (queue.length) {
    const current = queue.shift() as { path: string; depth: number };
    const entries = await access.listDir(current.path).catch(() => []);
    for (const entry of entries) {
      const relative = current.path ? `${current.path}/${entry.name}` : entry.name;
      if (entry.kind === "file" && manifests.test(entry.name)) found.push(relative);
      if (entry.kind === "directory" && current.depth < 2 && !ignored.test(entry.name) && queue.length < 80) queue.push({ path: relative, depth: current.depth + 1 });
    }
  }
  return found;
}

/**
 * A resolved narrow follow-up is enforced where writes actually happen, not only in a prompt. Reads remain
 * broad so the engineer can verify dependencies; any extra write is stopped and recorded instead of being
 * silently justified after the fact.
 */
function constrainAccessToFollowUpScope(
  access: ProjectAccess,
  resolution: FollowUpResolutionRecord | undefined,
  execution: ExecutionContext,
  currentInstruction = "",
): ProjectAccess {
  if (!resolution || resolution.continuity !== "carry_forward_plan" || resolution.relevantFiles.length === 0) return access;
  const explicitFiles = explicitScopeFilesFromTask(currentInstruction);
  const allowedFiles = Array.from(new Set([...resolution.relevantFiles, ...explicitFiles]));
  const allowed = new Set(allowedFiles.map(normalizeScopePath));
  const isAllowed = (relativePath: string) => allowed.has(normalizeScopePath(relativePath));
  const scopeReason = (relativePath: string) => `Blocked ${relativePath}: it is outside the accepted follow-up scope (${allowedFiles.join(", ")}). A dependency expansion must be resolved and recorded before this file can change.`;

  return {
    ...access,
    async writeFile(relativePath, content) {
      if (isAllowed(relativePath)) return access.writeFile(relativePath, content);
      const reason = scopeReason(relativePath);
      await emitExecution(execution, "blocked", "warning", "Follow-up scope prevented an unrelated file change", {
        tier: "flag",
        filePath: relativePath,
        details: { reason, expectedScope: resolution.expectedScope, allowedFiles: resolution.relevantFiles },
      });
      return { existedBefore: false, verified: false, contentChanged: false, reason };
    },
    deleteFile: access.deleteFile
      ? async (relativePath) => {
          if (isAllowed(relativePath)) return access.deleteFile!(relativePath);
          const reason = scopeReason(relativePath);
          await emitExecution(execution, "blocked", "warning", "Follow-up scope prevented an unrelated file deletion", {
            tier: "flag",
            filePath: relativePath,
            details: { reason, expectedScope: resolution.expectedScope, allowedFiles: resolution.relevantFiles },
          });
          return { existed: true, verified: false, reason };
        }
      : undefined,
  };
}

function explicitScopeFilesFromTask(task: string) {
  const matches = task.match(/[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)*\.(?:json|[cm]?[jt]sx?|css|scss|html|md|py|cs|xaml|xml|ya?ml|toml)/gi) ?? [];
  return matches.map((entry) => entry.replace(/^[`'"(]+|[`'"),.;:]+$/g, ""));
}

function normalizeScopePath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
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
    artifact: preview?.artifact,
    exportUrl: `/api/factory/export?projectId=${encodeURIComponent(projectId)}`,
  };
}

export async function listProjectFiles(projectPath: string, root = projectPath): Promise<FactoryFileEntry[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !isGeneratedProjectDirectory(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) return listProjectFiles(projectPath, fullPath);
        const details = await stat(fullPath);
        return [{ path: path.relative(projectPath, fullPath).replace(/\\/g, "/"), status: "created" as const, size: details.size }];
      }),
  );

  return files.flat().sort((a, b) => a.path.localeCompare(b.path));
}

function isGeneratedProjectDirectory(name: string) {
  return /^(?:node_modules|\.next|dist|build|target|bin|obj|coverage|\.gradle|\.dart_tool|\.terraform|\.foundry-artifacts|library|temp|logs|packages|\.venv|venv)$/i.test(name);
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
  const access = createServerProjectAccess(projectPath, "local-folder");
  const stackProfile = await detectStackProfileAndEntriesForAccess(access);
  if (apiKey && isReadOnlyDiagnosticInspection(task)) {
    const inspection = await runReadOnlyInspection({ message: task, access, apiKey, provider, tier, onEvent: async () => {} });
    return {
      projectPath,
      stack: stackProfile.profile.label,
      files: files.map((file) => ({ path: file.path, size: file.size })),
      answer: inspection.answer,
    };
  }
  return {
    projectPath,
    stack: stackProfile.profile.label,
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
  const stackProfile = await detectStackProfileAndEntriesForAccess(access);
  if (apiKey && isReadOnlyDiagnosticInspection(task)) {
    const inspection = await runReadOnlyInspection({ message: task, access, apiKey, provider, tier, onEvent: async () => {} });
    return {
      projectPath: localConnector.rootLabel || localConnector.url,
      stack: stackProfile.profile.label,
      files: files.map((file) => ({ path: file.path, size: file.size })),
      answer: inspection.answer,
    };
  }
  return {
    projectPath: localConnector.rootLabel || localConnector.url,
    stack: stackProfile.profile.label,
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
  projectDeleted,
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
  projectDeleted?: boolean;
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
    artifact: preview?.artifact,
    projectDeleted,
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
  return capabilityLevelForStackChoice(stack).level === 4;
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
  const executable: Partial<Record<string, string>> = {
    nextjs: "node", node: "node", "node-express": "node", react: "node", vue: "node", angular: "node", electron: "node", "react-native": "node",
    python: "python", php: "php", java: "java", android: "gradle", flutter: "flutter", "dotnet-web": "dotnet", "dotnet-desktop": "dotnet",
    go: "go", rust: "cargo", tauri: "cargo", docker: "docker", terraform: "terraform", kubernetes: "kubectl", godot: "godot",
  };
  const command = executable[stackId];
  return command ? executableAvailable(command) : false;
}

const executableAvailability = new Map<string, boolean>();
function executableAvailable(command: string) {
  const cached = executableAvailability.get(command);
  if (cached != null) return cached;
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { stdio: "ignore", windowsHide: true });
  const available = probe.status === 0;
  executableAvailability.set(command, available);
  return available;
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
    const commandEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: isBuildCommand(command, args) ? "production" : process.env.NODE_ENV };
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (process.platform === "win32" && nodeMajor >= 22 && !/(?:^|\s)--use-system-ca(?:\s|$)/.test(commandEnv.NODE_OPTIONS ?? "")) {
      commandEnv.NODE_OPTIONS = `${commandEnv.NODE_OPTIONS ?? ""} --use-system-ca`.trim();
    }
    const child = spawn(command, args, { cwd, shell: true, windowsHide: true, env: commandEnv });
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

type PreviewOutcome = { previewUrl?: string; previewState: FactoryPreviewState; previewPlatform: FactoryPreviewPlatform; previewReason?: string; previewOwnershipToken?: string; artifact?: FactoryArtifact };

function missionHasPreviewableWork(mission: { changedFiles: string[]; commands?: Array<{ exitCode: number | null }> }) {
  return mission.changedFiles.length > 0 || Boolean(mission.commands?.some((command) => command.exitCode === 0));
}

async function ensureRequestedStackScaffold(projectPath: string, stack: StackProfile, projectName: string, execution: ExecutionContext, events: string[]): Promise<string[]> {
  if (existsSync(path.join(projectPath, "package.json"))) return [];
  const safeName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "foundry-project";
  if (stack.id === "nextjs") {
    const manifest = `${JSON.stringify({
      name: safeName,
      version: "0.1.0",
      private: true,
      scripts: { dev: "next dev", build: "next build", start: "next start" },
      dependencies: { next: "^15.5.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      devDependencies: { typescript: "^5.0.0", "@types/node": "^20.0.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", tailwindcss: "^3.4.0", postcss: "^8.0.0", autoprefixer: "^10.0.0" },
    }, null, 2)}\n`;
    const tsconfig = `${JSON.stringify({
      compilerOptions: {
        target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true,
        strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler",
        resolveJsonModule: true, isolatedModules: true, jsx: "preserve", incremental: true,
        plugins: [{ name: "next" }], paths: { "@/*": ["./src/*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    }, null, 2)}\n`;
    await writeFile(path.join(projectPath, "package.json"), manifest, "utf8");
    if (!existsSync(path.join(projectPath, "tsconfig.json"))) await writeFile(path.join(projectPath, "tsconfig.json"), tsconfig, "utf8");
    events.push("Created stack scaffold: package.json", "Created stack scaffold: tsconfig.json");
    await emitExecution(execution, "file", "completed", "Created verified Next.js project scaffold", {
      fileName: "package.json",
      filePath: "package.json",
      details: { reason: "The selected stack requires a real manifest and build scripts before preview or verification can begin." },
    });
    return ["package.json", "tsconfig.json"];
  }
  if (stack.id === "react-native") {
    const manifest = `${JSON.stringify({
      name: safeName,
      version: "1.0.0",
      private: true,
      main: "expo-router/entry",
      scripts: { start: "expo start", android: "expo start --android", ios: "expo start --ios", web: "expo start --web", typecheck: "tsc --noEmit", build: "expo export --platform web" },
      dependencies: {
        "@expo/vector-icons": "^15.0.3", expo: "^54.0.0", "expo-router": "^6.0.0", "expo-status-bar": "^3.0.0",
        react: "19.1.0", "react-dom": "19.1.0", "react-native": "0.81.5", "react-native-safe-area-context": "~5.6.0",
        "react-native-screens": "~4.16.0", "react-native-web": "~0.21.0",
      },
      devDependencies: { "@types/react": "^19.1.0", "babel-preset-expo": "^54.0.0", typescript: "^5.9.0" },
    }, null, 2)}\n`;
    const appConfig = `${JSON.stringify({ expo: { name: projectName, slug: safeName, version: "1.0.0", orientation: "portrait", userInterfaceStyle: "automatic", scheme: safeName, plugins: ["expo-router"], experiments: { typedRoutes: true }, web: { bundler: "metro", output: "static" } } }, null, 2)}\n`;
    const tsconfig = `${JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: { strict: true, paths: { "@/*": ["./*"] } }, include: ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"] }, null, 2)}\n`;
    const layout = `import { Stack } from "expo-router";\n\nexport default function RootLayout() {\n  return <Stack screenOptions={{ headerShown: false }} />;\n}\n`;
    const entry = `import { StyleSheet, Text, View } from "react-native";\nimport { SafeAreaView } from "react-native-safe-area-context";\n\nexport default function HomeScreen() {\n  return (\n    <SafeAreaView style={styles.safe}>\n      <View style={styles.container}>\n        <Text accessibilityRole="header" style={styles.title}>${projectName.replace(/`/g, "")}</Text>\n        <Text style={styles.body}>Preparing the first verified field workflow…</Text>\n      </View>\n    </SafeAreaView>\n  );\n}\n\nconst styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: "#f4f7f8" }, container: { flex: 1, padding: 24, justifyContent: "center" }, title: { color: "#102a33", fontSize: 30, fontWeight: "700" }, body: { color: "#47636c", fontSize: 16, marginTop: 12 } });\n`;
    await mkdir(path.join(projectPath, "app"), { recursive: true });
    await writeFile(path.join(projectPath, "package.json"), manifest, "utf8");
    await writeFile(path.join(projectPath, "app.json"), appConfig, "utf8");
    await writeFile(path.join(projectPath, "tsconfig.json"), tsconfig, "utf8");
    await writeFile(path.join(projectPath, "expo-env.d.ts"), "/// <reference types=\"expo/types\" />\n", "utf8");
    await writeFile(path.join(projectPath, "app", "_layout.tsx"), layout, "utf8");
    await writeFile(path.join(projectPath, "app", "index.tsx"), entry, "utf8");
    const files = ["package.json", "app.json", "tsconfig.json", "expo-env.d.ts", "app/_layout.tsx", "app/index.tsx"];
    events.push(...files.map((file) => `Created stack scaffold: ${file}`));
    await emitExecution(execution, "file", "completed", "Created verified Expo project scaffold", {
      fileName: "package.json",
      filePath: "package.json",
      details: { reason: "The selected React Native stack requires a real Expo manifest, typed configuration, router entry, and runnable screen before model-driven product implementation begins.", files },
    });
    return files;
  }
  if (stack.id !== "astro") return [];
  const manifest = `${JSON.stringify({
    name: safeName,
    type: "module",
    version: "0.1.0",
    private: true,
    scripts: { dev: "astro dev", build: "astro build", preview: "astro preview" },
    dependencies: { astro: "^5.0.0" },
  }, null, 2)}\n`;
  const tsconfig = `${JSON.stringify({ extends: "astro/tsconfigs/strict" }, null, 2)}\n`;
  const postcssConfig = "export default { plugins: {} };\n";
  await writeFile(path.join(projectPath, "package.json"), manifest, "utf8");
  await writeFile(path.join(projectPath, "tsconfig.json"), tsconfig, "utf8");
  await writeFile(path.join(projectPath, "postcss.config.mjs"), postcssConfig, "utf8");
  events.push("Created stack scaffold: package.json", "Created stack scaffold: tsconfig.json", "Created stack isolation: postcss.config.mjs");
  await emitExecution(execution, "file", "completed", "Created verified Astro project scaffold", {
    fileName: "package.json",
    filePath: "package.json",
    details: { reason: "The selected stack requires a real manifest and build scripts before model-driven implementation begins." },
  });
  return ["package.json", "tsconfig.json", "postcss.config.mjs"];
}

function isProductionBuildCommand(command: string) {
  return /\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?build\b/i.test(command)
    || /\bdotnet\s+(?:build|publish)\b/i.test(command)
    || /\bcargo\s+build\b[^\r\n]*--release\b/i.test(command)
    || /\bgo\s+build\b/i.test(command)
    || /\b(?:gradle|gradlew(?:\.bat)?)\b[^\r\n]*\b(?:build|assembleRelease|bundleRelease)\b/i.test(command)
    || /\bflutter\s+build\b/i.test(command)
    || /\bmvn(?:\.cmd)?\b[^\r\n]*\b(?:package|verify)\b/i.test(command);
}

function isAutomatedTestCommand(command: string) {
  return /\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?test\b/i.test(command)
    || /\bdotnet\s+test\b/i.test(command)
    || /\bdotnet\s+run\b[^\r\n]*--project\s+[^\r\n]*(?:tests?|specs?)(?:[\\/.\s]|$)/i.test(command)
    || /\b(?:cargo|go)\s+test\b/i.test(command)
    || /\b(?:pytest|python\s+-m\s+pytest)\b/i.test(command)
    || /\b(?:gradle|gradlew(?:\.bat)?)\b[^\r\n]*\btest\b/i.test(command)
    || /\bmvn(?:\.cmd)?\b[^\r\n]*\btest\b/i.test(command);
}

function previewPlatformForStack(stack: string): FactoryPreviewPlatform {
  if (/game|phaser|three\.js|webgl/i.test(stack)) return "game";
  if (/android|gradle/i.test(stack)) return "android";
  if (/flutter|react native|swift|ios/i.test(stack)) return "mobile";
  if (/\.net|c#|wpf|winforms|unity|godot/i.test(stack)) return "desktop";
  if (/node\/express|express|fastapi|django|flask|\bapi\b|backend|microservice/i.test(stack)) return "api";
  if (/\bcli\b|command.line|terminal/i.test(stack)) return "cli";
  if (/database|schema|sql|postgres|mysql|sqlite|prisma/i.test(stack)) return "database";
  if (/report|document|pdf|analytics|dashboard/i.test(stack)) return "report";
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
    const sameProject = path.resolve(existing.projectPath) === path.resolve(projectPath);
    const ownedProcessAlive = !existing.processId || processIsAlive(existing.processId);
    if (sameProject && ownedProcessAlive && await previewResponds(existing.previewUrl, existing.ownershipToken)) {
      existing.lastUsedAt = Date.now();
      return { previewUrl: existing.previewUrl, previewState: "ready", previewPlatform: platform, previewOwnershipToken: existing.ownershipToken };
    }
    stopPreview(projectId);
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
      const file = await stat(executable);
      const relativeArtifactPath = path.relative(projectPath, executable).replace(/\\/g, "/");
      const artifact: FactoryArtifact = {
        name: path.basename(executable),
        platform: desktopPlatformForPath(executable),
        version: await desktopVersionForProject(projectPath),
        fileType: "Windows executable (.exe)",
        sizeBytes: file.size,
        createdAt: file.mtime.toISOString(),
        buildStatus: "verified",
        downloadUrl: `/api/factory/artifact?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(relativeArtifactPath)}`,
      };
      const reason = `Desktop build ready: ${path.basename(executable)}. Use Launch desktop app to run it.`;
      if (execution) await emitExecution(execution, "preview", "completed", "Desktop app ready to launch", { details: { executable: path.basename(executable), sizeBytes: file.size, platform: artifact.platform } });
      return { previewState: "ready", previewPlatform: "desktop", previewReason: reason, artifact };
    }
  }

  const reason = previewUnavailableReason(platform, stack);
  if (execution) await emitExecution(execution, "preview", "skipped", "Preview unavailable", { details: { reason, stack } });
  return { previewState: "unavailable", previewPlatform: platform, previewReason: reason };
}

async function findDesktopExecutable(projectPath: string): Promise<string | undefined> {
  const queue = [projectPath];
  const candidates: string[] = [];
  while (queue.length) {
    const current = queue.shift() as string;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "obj") continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (queue.length < 200) queue.push(fullPath);
      } else if (entry.name.toLowerCase().endsWith(".exe") && /[\\/](?:bin|artifacts?)[\\/]/i.test(fullPath)) {
        candidates.push(fullPath);
      }
    }
  }
  return candidates.sort((left, right) => desktopExecutableRank(left) - desktopExecutableRank(right))[0];
}

function processIsAlive(processId: number) {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function desktopExecutableRank(filePath: string) {
  if (/[\\/]artifacts?[\\/]/i.test(filePath)) return 0;
  if (/[\\/]publish[\\/]/i.test(filePath)) return 1;
  if (/[\\/]bin[\\/]Release[\\/]/i.test(filePath)) return 2;
  return 3;
}

export function launchDesktopPreview(projectId: string) {
  const executable = desktopPreviewTargets.get(projectId);
  if (!executable || !existsSync(executable)) return { ok: false, error: "No built desktop executable is available for this project yet." };
  const child = spawn(executable, [], { cwd: path.dirname(executable), detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { ok: true, executable: path.basename(executable) };
}

async function startStaticPreview(projectId: string, projectPath: string, entryFile: string, events: string[], execution?: ExecutionContext): Promise<PreviewOutcome> {
  const scriptPath = path.join(process.cwd(), "scripts", "foundry-static-preview.cjs");
  const attemptedPorts = new Set<number>();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await findPreviewPort(attemptedPorts);
    attemptedPorts.add(port);
    const ownershipToken = `${projectId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (execution) await emitExecution(execution, "preview", "running", attempt === 1 ? "Starting interactive static preview" : "Retrying preview on a clean port", { details: { port, entryFile, attempt } });
    const child = spawn(process.execPath, [scriptPath, projectPath, String(port), ownershipToken], { cwd: projectPath, detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    const previewUrl = `http://127.0.0.1:${port}/${encodeURIComponent(entryFile)}`;
    previewProcesses.set(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "static", ownershipToken });
    const ready = await waitForStaticPreviewReady(previewUrl, ownershipToken);
    if (ready) {
      events.push(`Interactive preview ready: ${previewUrl}`);
      if (execution) await emitExecution(execution, "preview", "completed", "Interactive preview ready", { details: { previewUrl, port, entryFile, ready, attempt } });
      return { previewUrl, previewState: "ready", previewPlatform: "web", previewOwnershipToken: ownershipToken };
    }
    stopPreview(projectId);
  }

  const reason = "Foundry could not bind an owned preview server after three clean-port attempts; no stale preview was shown.";
  events.push(reason);
  if (execution) await emitExecution(execution, "preview", "error", "Preview could not start", { details: { reason, attemptedPorts: Array.from(attemptedPorts, String) } });
  return { previewState: "error", previewPlatform: "web", previewReason: reason };
}

async function startNextPreview(projectId: string, projectPath: string, events: string[], execution: ExecutionContext | undefined, platform: FactoryPreviewPlatform): Promise<PreviewOutcome> {
  const startScript = await detectNodeStartScript(projectPath);
  if (!startScript) {
    const reason = "The Next.js project has no runnable package.json dev/start script, so Foundry did not open a preview.";
    if (execution) await emitExecution(execution, "preview", "error", "Preview unavailable", { details: { reason } });
    return { previewState: "error", previewPlatform: platform, previewReason: reason };
  }
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
  const previewUrl = `http://127.0.0.1:${port}`;
  previewProcesses.set(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "app" });
  // A different process can occupy a port between the availability probe and spawn. Give npm a
  // moment to fail before accepting any HTTP response on that port as this project's preview.
  await new Promise((resolve) => setTimeout(resolve, 250));
  const ready = child.exitCode == null && await waitForPreviewReady(port);
  if (!ready) stopPreview(projectId);
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
  const frameworkArgs = await nodePreviewPortArgs(projectPath, port);
  const commandArgs = ["run", script, ...frameworkArgs];
  if (execution) await emitExecution(execution, "preview", "running", "Starting development server", { command: `npm.cmd ${commandArgs.join(" ")}`, details: { port, script } });
  const child = spawn("npm.cmd", commandArgs, {
    cwd: projectPath,
    shell: true,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
  const previewUrl = `http://127.0.0.1:${port}`;
  previewProcesses.set(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "app" });
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
      const response = await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal });
      clearTimeout(timeout);
      // A 404 means some other/stale server owns the port or the intended entry point is not ready.
      // Only a successful response proves this preview can be handed to browser verification.
      if (response.ok) return true;
    } catch {
      // Not ready yet — the dev server is likely still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function waitForStaticPreviewReady(previewUrl: string, ownershipToken: string, attempts = 10, delayMs = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(previewUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok && response.headers.get("x-foundry-preview") === ownershipToken) return true;
    } catch {
      // The dedicated static server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function previewResponds(previewUrl: string, expectedOwnershipToken?: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(previewUrl, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok && (!expectedOwnershipToken || response.headers.get("x-foundry-preview") === expectedOwnershipToken);
  } catch {
    return false;
  }
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
    stopPreviewProcessTree(preview.processId);
  }
  previewProcesses.delete(projectId);
}

function stopPreviewProcessTree(processId: number) {
  if (process.platform === "win32") {
    // Static/framework previews are detached so they survive the request that launched them. On
    // Windows, process.kill() does not reliably terminate a detached child tree and can leave its
    // working directory locked. taskkill receives a numeric pid directly (no shell interpolation).
    const stopped = spawnSync("taskkill.exe", ["/pid", String(processId), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    if (stopped.status === 0) return;
  }
  try {
    process.kill(processId);
  } catch {
    // The process may have already exited.
  }
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

export async function getPreviewStatus(projectId: string): Promise<{ previewState: FactoryPreviewState; previewUrl?: string; previewReason?: string }> {
  const preview = previewProcesses.get(projectId);
  if (!preview) return { previewState: "unavailable" };
  const reachable = await waitForPreviewReady(preview.port, 1, 0);
  if (!reachable) {
    stopPreview(projectId);
    return { previewState: "unavailable", previewReason: "The preview process is no longer reachable." };
  }
  preview.lastUsedAt = Date.now();
  return { previewState: "ready", previewUrl: preview.previewUrl };
}

async function nodePreviewPortArgs(projectPath: string, port: number): Promise<string[]> {
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    if (dependencies.astro || dependencies.vite || dependencies.vue || dependencies.svelte) {
      return ["--", "--host", "127.0.0.1", "--port", String(port)];
    }
  } catch {
    // A non-framework Node server normally honors PORT from the environment below.
  }
  return [];
}

/** Reconstructs preview/artifact truth from the current project files after a reload or older result. */
export async function refreshPreviewForProject(projectId: string) {
  let projectPath: string;
  try {
    projectPath = safeProjectPath(projectId);
  } catch (error) {
    return {
      previewState: "unavailable" as const,
      previewPlatform: "web" as const,
      previewReason: error instanceof Error && error.message === "Invalid project id."
        ? "The preview request did not identify a valid Foundry project."
        : "The project folder is no longer available inside the Foundry workspace.",
    };
  }
  const access = createServerProjectAccess(projectPath, "local-folder");
  const detected = await detectStackProfileAndEntriesForAccess(access);
  let stack = detected.profile.label;
  if (detected.profile.id === "unknown") {
    const brief = await access.readFile("foundry-brief.md", { limitBytes: 100_000 }).catch(() => undefined);
    stack = brief?.content.match(/^Selected stack:\s*(.+)$/im)?.[1]?.trim() || stack;
  }
  return startPreview(projectId, projectPath, stack, []);
}

function desktopPlatformForPath(executable: string) {
  const match = executable.match(/[\\/](win-(?:x64|x86|arm64))[\\/]/i);
  return match?.[1]?.toLowerCase() ?? "Windows";
}

async function desktopVersionForProject(projectPath: string) {
  const queue = [projectPath];
  while (queue.length) {
    const current = queue.shift() as string;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && !["bin", "obj", "node_modules", ".git"].includes(entry.name) && queue.length < 80) queue.push(fullPath);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".csproj")) {
        const content = await readFile(fullPath, "utf8").catch(() => "");
        return content.match(/<(?:Version|AssemblyVersion)>([^<]+)<\/(?:Version|AssemblyVersion)>/i)?.[1]?.trim() || "1.0.0";
      }
    }
  }
  return "1.0.0";
}

export function stopPreviewForProject(projectId: string) {
  stopPreview(projectId);
}

async function findPreviewPort(excludedPorts = new Set<number>()) {
  const usedPorts = new Set(Array.from(previewProcesses.values()).map((process) => process.port));
  for (let port = 3100; port < 3300; port += 1) {
    if (!excludedPorts.has(port) && !usedPorts.has(port) && !(await isPortReachable(port)) && (await isPortAvailable(port))) return port;
  }
  throw new Error("No managed preview port is currently available.");
}

function isPortReachable(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (reachable: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
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
    costScopeId: crypto.randomUUID(),
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
  if (/\b(dynamic|configurable|configured|configuration|hardcoded|hard-coded)\b[^.\n]{0,60}\b(fields?|columns?|mapping)\b/.test(text) ||
      /\b(add|edit|remove|required|optional)\b[^.\n]{0,40}\b(fields?|columns?)\b/.test(text) ||
      /\b(excel|spreadsheet|upload|payload)\b[^.\n]{0,60}\b(field|column|mapping|schema)\b/.test(text)) {
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

  // Destructive replacement questions are commonly phrased as a yes/no sentence rather than an
  // explicit "A or B" choice. Present the actual outcomes instead of making the user translate a
  // safety decision into chat text. Keep the safe, non-destructive outcome first.
  const deletesWholeProject = /\b(?:delet(?:e|ing)|remov(?:e|ing)|wipe|clear)\b/i.test(normalized)
    && /\b(?:entire|whole|all)\b/i.test(normalized)
    && /\b(?:project|directory|folder|current files?)\b/i.test(normalized);
  if (deletesWholeProject) {
    return ["Keep current files", "Delete entire project"];
  }

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
