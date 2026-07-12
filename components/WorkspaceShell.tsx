"use client";

import { useEffect, useRef, useState } from "react";
import { appendAssistantMessage, applyUserMessage, classifyMessage, createInitialMission, decideWorkThread, looksLikeDiagnosticPaste, shouldUseReasoning } from "@/lib/mission-engine";
import type { CreatedArtifact, ExecutionMission, ExecutionMissionState, MissionState } from "@/lib/mission-engine";
import { computeMissionState, verificationStatusFrom } from "@/lib/mission/state";
import { deriveMissionDisplayStatus, getActiveExecutionMission } from "@/lib/mission/status";
import { BuildDashboard } from "@/components/BuildDashboard";
import { StatusBar } from "@/components/StatusBar";
import { TopBar } from "@/components/TopBar";
import { createReasoningRequest } from "@/lib/ai/context";
import { approvalScopeLabel } from "@/lib/ai/mission/command-permissions";
import { hasFollowUpIntentShape, hasRecommendationFollowUpShape } from "@/lib/ai/intent-resolution";
import { artifactKindForOutcome } from "@/lib/artifacts";
import { classifyEvidenceKind, ingestFile } from "@/lib/files";
import { executeBrowserFolderTask, getBrowserFolderHandle, readBrowserFolderFiles } from "@/lib/factory/browser-folder";
import type { FactoryExecutionEvent, FactoryExistingProjectRequest, FactoryProjectResult, FactoryUploadedFile, MissionParentContext, StructuredDiscovery } from "@/lib/factory/types";
import type { WorkspaceAttachment } from "@/lib/files";
import type { SourceReference } from "@/lib/sources/types";
import { createVisualArtifact, isExplicitVisualArtifactRequest, isTextVisualFormatRequest, isVisualOutcome, shouldReviseExistingVisual } from "@/lib/visual-artifacts";
import type { VisualArtifact } from "@/lib/visual-artifacts";
import { readStoredModelMode } from "@/lib/ai/model-mode";
import { readStoredMissionQuality } from "@/lib/ai/mission/quality-mode";

export type WorkspaceNote = {
  id: string;
  author: string;
  initials: string;
  time: string;
  body: string;
  tone: "human" | "system" | "note";
  tags?: string[];
  attachments?: WorkspaceAttachment[];
  sources?: SourceReference[];
  visualArtifact?: VisualArtifact;
};

export type StagedAttachment = WorkspaceAttachment;

type WorkspaceState = {
  activeMissionId: string;
  missions: MissionState[];
};

type InlineProgress = {
  noteId: string;
  steps: string[];
  stepIndex: number;
};

type PendingWork = InlineProgress & {
  missionId: string;
};

type ProjectMessageIntent = "question" | "inspection" | "diagnose" | "status" | "debug" | "edit" | "undo" | "continue" | "retrospective" | "clarify";

const projectMessageIntents: ProjectMessageIntent[] = ["question", "inspection", "diagnose", "status", "debug", "edit", "undo", "continue", "retrospective", "clarify"];

type ProjectMessageIntentResolution = {
  intent: ProjectMessageIntent;
  continuity: "carry_forward_plan" | "fresh_plan" | "not_applicable";
  clarifyingQuestion: string;
  clarifyingOptions: string[];
};

type ReasonApiResponse = {
  answer?: string;
  sources?: SourceReference[];
  retryable?: boolean;
  retryAfterMs?: number;
};

function createInitialWorkspace(): WorkspaceState {
  const mission = createInitialMission();

  return {
    activeMissionId: mission.missionId,
    missions: [mission],
  };
}

const missionStorageKey = "foundry.missionThreads.v9";
const workspaceDbName = "foundry-workspace";
const workspaceDbVersion = 1;
const workspaceStoreName = "workspace";
const seedConversationTitle = "New Work Item";
const legacySeedConversationTitle = "New Conversation";
const blankConversationTitle = "New Work Item";

function openWorkspaceDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(workspaceDbName, workspaceDbVersion);

    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(workspaceStoreName)) {
        db.createObjectStore(workspaceStoreName);
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(browserStorageError(request.error, "Could not open workspace storage.")));
    request.addEventListener("blocked", () => reject(new Error("Workspace storage is blocked by another open tab.")));
  });
}

async function readIndexedDbValue(key: string) {
  const db = await openWorkspaceDb();

  return new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction(workspaceStoreName, "readonly");
    const store = transaction.objectStore(workspaceStoreName);
    const request = store.get(key);

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(browserStorageError(request.error, "Could not read workspace storage.")));
    transaction.addEventListener("complete", () => db.close());
    transaction.addEventListener("abort", () => {
      db.close();
      reject(browserStorageError(transaction.error, "Workspace storage read was aborted."));
    });
  });
}

async function writeIndexedDbValue(key: string, value: unknown) {
  const db = await openWorkspaceDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(workspaceStoreName, "readwrite");
    const store = transaction.objectStore(workspaceStoreName);
    const request = store.put(value, key);

    request.addEventListener("error", () => reject(browserStorageError(request.error, "Could not write workspace storage.")));
    transaction.addEventListener("complete", () => {
      db.close();
      resolve();
    });
    transaction.addEventListener("abort", () => {
      db.close();
      reject(browserStorageError(transaction.error, "Workspace storage write was aborted."));
    });
  });
}

async function readWorkspaceFromIndexedDb() {
  return readIndexedDbValue(missionStorageKey);
}

async function writeWorkspaceToIndexedDb(workspace: WorkspaceState) {
  return writeIndexedDbValue(missionStorageKey, workspace);
}

const approvalsStorageKey = "foundry.commandApprovals.v1";

type CommandApprovals = {
  categories: Record<string, string[]>;
  commands: Record<string, string[]>;
};

function normalizeCommandApprovals(value: unknown): CommandApprovals {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<CommandApprovals>;
  return {
    categories: candidate.categories && typeof candidate.categories === "object" ? candidate.categories : {},
    commands: candidate.commands && typeof candidate.commands === "object" ? candidate.commands : {},
  };
}

async function readPersistedCommandApprovals(): Promise<CommandApprovals> {
  try {
    const stored = await readIndexedDbValue(approvalsStorageKey);
    if (stored) return normalizeCommandApprovals(stored);
  } catch {
    // Fall back to legacy localStorage below.
  }
  try {
    const stored = window.localStorage.getItem(approvalsStorageKey);
    if (stored) return normalizeCommandApprovals(JSON.parse(stored));
  } catch {
    // No persisted approvals available yet.
  }
  return { categories: {}, commands: {} };
}

async function writePersistedCommandApprovals(approvals: CommandApprovals) {
  await writeIndexedDbValue(approvalsStorageKey, approvals);
  try {
    window.localStorage.setItem(approvalsStorageKey, JSON.stringify(approvals));
  } catch {
    // localStorage is only a fallback mirror; IndexedDB is the source of truth.
  }
}

function browserStorageError(error: unknown, fallback: string) {
  if (error instanceof Error) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return new Error(error.message);
  }
  return new Error(fallback);
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readPersistedWorkspace() {
  try {
    const indexedWorkspace = await readWorkspaceFromIndexedDb();
    if (indexedWorkspace) return indexedWorkspace;
  } catch {
    // Fall back to legacy localStorage below.
  }

  const stored = window.localStorage.getItem(missionStorageKey);
  return stored ? JSON.parse(stored) : undefined;
}

function compactWorkspaceForLocalStorage(workspace: WorkspaceState): WorkspaceState {
  return {
    ...workspace,
    missions: workspace.missions.map((mission) => ({
      ...mission,
      attachments: compactAttachments(mission.attachments),
      messages: mission.messages.map((message) => ({
        ...message,
        attachments: compactAttachments(message.attachments ?? []),
      })),
    })),
  };
}

function compactAttachments(attachments: WorkspaceAttachment[]) {
  return attachments.map((attachment) => ({
    ...attachment,
    rawText: attachment.rawText.length > 12000 ? `${attachment.rawText.slice(0, 12000)}\n\n[Content truncated in legacy storage. Full content is saved in browser database storage.]` : attachment.rawText,
    dataUrl: attachment.dataUrl && attachment.dataUrl.length > 500000 ? undefined : attachment.dataUrl,
  }));
}

function normalizeWorkspaceState(value: unknown): WorkspaceState {
  if (!value || typeof value !== "object") return createInitialWorkspace();

  const candidate = value as Partial<WorkspaceState> & Partial<MissionState>;

  if (Array.isArray(candidate.missions) && candidate.missions.length > 0) {
    const activeMissionId =
      typeof candidate.activeMissionId === "string" && candidate.missions.some((mission) => mission.missionId === candidate.activeMissionId)
        ? candidate.activeMissionId
        : candidate.missions[0].missionId;

    return {
      activeMissionId,
      missions: candidate.missions.map(normalizeMission),
    };
  }

  if (typeof candidate.missionId === "string") {
    const mission = normalizeMission(candidate as MissionState);
    return {
      activeMissionId: mission.missionId,
      missions: [mission],
    };
  }

  return createInitialWorkspace();
}

function normalizeMission(mission: MissionState): MissionState {
  const messages = (mission.messages ?? []).map((message) => ({
    ...message,
    sources: message.sources ?? [],
    attachments: normalizeAttachments(message.attachments ?? []),
    visualArtifact: message.visualArtifact ? normalizeVisualArtifact(message.visualArtifact, mission.missionId) : undefined,
  }));

  return {
    ...mission,
    title: mission.title === legacySeedConversationTitle && messages.length === 0 ? blankConversationTitle : mission.title,
    conversationTitle:
      mission.conversationTitle === legacySeedConversationTitle && messages.length === 0 ? blankConversationTitle : mission.conversationTitle,
    attachments: normalizeAttachments(mission.attachments ?? []),
    createdArtifacts: (mission.createdArtifacts ?? []).map((artifact) => ({
      ...artifact,
      visualArtifact: artifact.visualArtifact ? normalizeVisualArtifact(artifact.visualArtifact, mission.missionId) : undefined,
    })),
    sources: mission.sources ?? [],
    workMemory: mission.workMemory ?? {
      currentGoal: mission.objective ?? "",
      currentBlocker: "",
      completedWork: [],
      resolvedErrors: [],
      rejectedHypotheses: [],
      latestEvidence: [],
      relevantFiles: (mission.attachments ?? []).map((attachment) => attachment.fileName),
      recommendedNextAction: "",
      summary: "No working memory has been established yet.",
      updatedAt: mission.updatedAt ?? new Date().toISOString(),
    },
    liveWorkEvents: mission.liveWorkEvents ?? [],
    executionMissions: normalizeExecutionMissions(mission),
    activeExecutionMissionId: normalizeActiveExecutionMissionId(mission),
    messages,
  };
}

function normalizeExecutionMissions(mission: MissionState): ExecutionMission[] {
  const existing = Array.isArray(mission.executionMissions) ? mission.executionMissions : [];
  if (existing.length) {
    return existing.map((item) => ({
      ...item,
      source_requirements: item.source_requirements ?? [],
      verification_status: item.verification_status ?? verificationStatusFrom(item.verification ?? []),
      plan: item.plan ?? [],
      files_touched: item.files_touched ?? [],
      commands_run: item.commands_run ?? [],
      verification: item.verification ?? [],
      timeline: item.timeline ?? [],
      created_at: item.created_at ?? mission.createdAt ?? new Date().toISOString(),
      updated_at: item.updated_at ?? mission.updatedAt ?? new Date().toISOString(),
    }));
  }

  const execution = projectExecutionFromWorkspaceMission(mission);
  if (!execution) return [];
  return [executionMissionFromResult(mission, execution, mission.objective || execution.objective || "Project execution")];
}

function normalizeActiveExecutionMissionId(mission: MissionState) {
  if (mission.activeExecutionMissionId && mission.executionMissions?.some((item) => item.id === mission.activeExecutionMissionId)) return mission.activeExecutionMissionId;
  return mission.executionMissions?.at(-1)?.id;
}

function normalizeAttachments(attachments: WorkspaceAttachment[]) {
  return attachments.map((attachment) => ({
    ...attachment,
    evidenceKind: attachment.evidenceKind ?? classifyEvidenceKind(attachment.fileName, attachment.fileType),
  }));
}

function normalizeVisualArtifact(visual: VisualArtifact, missionId: string): VisualArtifact {
  const artifactId = visual.artifactId ?? visual.id ?? `visual-${Date.now()}`;
  const version = visual.version ?? 1;

  return {
    ...visual,
    id: visual.id ?? `${artifactId}-v${version}`,
    artifactId,
    missionId: visual.missionId ?? missionId,
    sourcePrompt: visual.sourcePrompt ?? visual.prompt ?? visual.title,
    revisionNotes: visual.revisionNotes ?? "Imported visual artifact",
    version,
    spec: {
      ...(visual.spec ?? {
        artifactType: visual.kind === "diagram" ? "diagram" : "interface",
        purpose: visual.prompt ?? visual.title,
        title: visual.title,
        sections: [],
        components: [],
        labels: [],
        style: "calm professional",
        layout: "balanced",
        revisionNotes: visual.revisionNotes ?? "Imported visual artifact",
      }),
      visualStyleVariant: visual.spec?.visualStyleVariant ?? "classic",
      visualVariantIndex: visual.spec?.visualVariantIndex ?? 0,
    },
  };
}

export function WorkspaceShell() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createInitialWorkspace());
  const [hasLoadedMission, setHasLoadedMission] = useState(false);
  const [pendingWork, setPendingWork] = useState<PendingWork[]>([]);
  const [stagedAttachments, setStagedAttachments] = useState<WorkspaceAttachment[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [queuedTasks, setQueuedTasks] = useState<Record<string, string>>({});
  const [approvedCommandCategories, setApprovedCommandCategories] = useState<Record<string, string[]>>({});
  const [approvedCommands, setApprovedCommands] = useState<Record<string, string[]>>({});
  const [hasLoadedApprovals, setHasLoadedApprovals] = useState(false);
  const activeControllersRef = useRef(new Map<string, AbortController>());
  const mission = workspace.missions.find((item) => item.missionId === workspace.activeMissionId) ?? workspace.missions[0];
  const selectedArtifact = mission.createdArtifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;
  const activeProgress = pendingWork.filter((item) => item.missionId === mission.missionId);
  // A mission with any ExecutionMission turns is the project/execution canvas — its footer status must
  // always be the same canonical derivation as the header pill and composer, never the legacy simulated
  // "typing" steps below (those exist only for the plain-chat path, which has no ExecutionMission turns).
  // Letting pendingWork override it here was one of four independently-computed status strings that could
  // disagree with each other (header said "Working", footer said "Ready", or vice versa).
  const statusText = mission.executionMissions.length
    ? deriveMissionDisplayStatus(mission).label
    : (activeProgress[0]?.steps[activeProgress[0].stepIndex] ?? "Ready");

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      try {
        const stored = await readPersistedWorkspace();
        if (!cancelled && stored) {
          setWorkspace(normalizeWorkspaceState(stored));
        }
      } catch {
        // Keep the in-memory starter workspace if persisted storage is unavailable.
      } finally {
        if (!cancelled) setHasLoadedMission(true);
      }
    }

    void loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedMission) return;

    void writeWorkspaceToIndexedDb(workspace).catch(() => {
      // Keep the workspace usable even if browser database storage is unavailable.
    });

    try {
      window.localStorage.setItem(missionStorageKey, JSON.stringify(compactWorkspaceForLocalStorage(workspace)));
    } catch {
      // localStorage is only a compact migration fallback. IndexedDB is the source of truth.
    }
  }, [hasLoadedMission, workspace]);

  // Command approvals ("allow for this project", "always allow this command") must survive reloads,
  // browser restarts, and long absences indefinitely — there is no expiry on a trust grant.
  useEffect(() => {
    let cancelled = false;

    async function loadApprovals() {
      try {
        const stored = await readPersistedCommandApprovals();
        if (!cancelled) {
          setApprovedCommandCategories(stored.categories);
          setApprovedCommands(stored.commands);
        }
      } catch {
        // Keep grants empty if persisted storage is unavailable; nothing was approved yet anyway.
      } finally {
        if (!cancelled) setHasLoadedApprovals(true);
      }
    }

    void loadApprovals();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedApprovals) return;
    void writePersistedCommandApprovals({ categories: approvedCommandCategories, commands: approvedCommands }).catch(() => {
      // Grants stay usable for this session even if browser database storage is unavailable.
    });
  }, [hasLoadedApprovals, approvedCommandCategories, approvedCommands]);

  useEffect(() => {
    if (pendingWork.length === 0) return;

    const interval = window.setInterval(() => {
      setPendingWork((current) =>
        current.map((item) => ({
          ...item,
          stepIndex: Math.min(item.stepIndex + 1, Math.max(item.steps.length - 2, 0)),
        })),
      );
    }, 950);

    return () => window.clearInterval(interval);
  }, [pendingWork.length]);

  function updateActiveMission(update: (mission: MissionState) => MissionState) {
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) => (item.missionId === current.activeMissionId ? update(item) : item)),
    }));
  }

  async function addAttachments(files: FileList | File[] | null) {
    if (!files) return;

    let ingested: WorkspaceAttachment[];
    try {
      ingested = await Promise.all(Array.from(files).map((file) => ingestFile(file, mission.missionId)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "The file could not be read.";
      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) =>
          item.missionId === current.activeMissionId
            ? appendAssistantMessage(item, `I could not attach that file: ${message}`, new Date())
            : item,
        ),
      }));
      return;
    }

    setStagedAttachments((current) => {
      const next = new Map(current.map((item) => [item.fileId, item]));
      ingested.forEach((attachment) => next.set(attachment.fileId, attachment));
      return Array.from(next.values());
    });
  }

  function removeAttachment(id: string) {
    setStagedAttachments((current) => current.filter((item) => item.fileId !== id));
    updateActiveMission((currentMission) => ({
      ...currentMission,
      attachments: currentMission.attachments.filter((item) => item.fileId !== id),
      updatedAt: new Date().toISOString(),
    }));
  }

  function deleteMission(missionId: string) {
    setPendingWork((current) => current.filter((item) => item.missionId !== missionId));
    setWorkspace((current) => {
      const remaining = current.missions.filter((item) => item.missionId !== missionId);

      if (remaining.length === 0) {
        return createInitialWorkspace();
      }

      return {
        activeMissionId: current.activeMissionId === missionId ? remaining[0].missionId : current.activeMissionId,
        missions: remaining,
      };
    });
  }

  function createNewMissionThread() {
    const now = new Date();
    const blankMission: MissionState = {
      ...createInitialMission(now),
      missionId: `mission-${now.getTime()}`,
      conversationTitle: blankConversationTitle,
      title: blankConversationTitle,
      objective: "",
      messages: [],
      attachments: [],
      createdArtifacts: [],
      sources: [],
      lastResult: "",
      liveWorkEvents: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    setSelectedArtifactId(null);
    setStagedAttachments([]);
    setWorkspace((current) => ({
      activeMissionId: blankMission.missionId,
      missions: [blankMission, ...current.missions],
    }));
  }

  function updateProjectExecution(missionId: string, result: FactoryProjectResult, task = "Build the initial project") {
    const now = new Date();
    const resultNote: WorkspaceNote = {
      id: `message-${now.getTime()}-factory-rebuild`,
      author: "Foundry",
      initials: "FW",
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      body: factoryResultMessage(result),
      tone: result.status === "failed" || result.status === "unsupported" ? "system" : "note",
      // "Project answer" is what answerForProjectRequest scans for to pair a result with its request —
      // without it, the compact Foundry response bubble under the request never rendered for a
      // brand-new project's first build (only MissionSummary did, disconnected from the request above it).
      tags: ["Factory result", "Project answer"],
      attachments: [],
      sources: [],
    };

    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) => {
        if (item.missionId !== missionId) return item;

        const nextArtifact: CreatedArtifact = {
          id: `artifact-${resultNote.id}`,
          sourceMessageId: resultNote.id,
          type: "project",
          kind: artifactKindForOutcome("project"),
          title: "Project Execution",
          body: JSON.stringify(result, null, 2),
          description: `Factory execution ${result.status}.`,
          createdAt: now.toISOString(),
        };
        // Merge into whatever activeExecutionMissionId currently points to — the eager placeholder created
        // for THIS submission (fresh mission) or the earlier still-open mission restored by
        // retractPendingExecutionMission (a real continuation). Either way, activeExecutionMissionId is
        // already correct by the time this runs — forcing an append here regardless of that (an earlier,
        // broken version of this fix) orphaned the placeholder as a duplicate ghost for every fresh mission.
        const existingExecutionMission = item.executionMissions.find((entry) => entry.id === item.activeExecutionMissionId) ?? item.executionMissions.at(-1);
        const nextExecutionMission = executionMissionFromResult(item, result, task, existingExecutionMission);
        const executionMissions = existingExecutionMission
          ? item.executionMissions.map((entry) => (entry.id === existingExecutionMission.id ? nextExecutionMission : entry))
          : [...item.executionMissions, nextExecutionMission];

        return {
          ...item,
          messages: [...item.messages, resultNote],
          createdArtifacts: [nextArtifact, ...item.createdArtifacts.filter((artifact) => artifact.title !== "Project Execution")],
          executionMissions,
          activeExecutionMissionId: nextExecutionMission.id,
          lastResult: factoryResultMessage(result),
          liveWorkEvents: result.timeline ? liveWorkEventsForTimeline(result.timeline) : result.events,
          workMemory: {
            ...item.workMemory,
            currentBlocker: result.blocker ?? "",
            completedWork: result.checklist?.filter((entry) => entry.status === "completed").map((entry) => entry.label) ?? result.events,
            latestEvidence: [`Project path: ${result.projectPath}`, `${result.files.length} files available`],
            relevantFiles: result.files.map((file) => file.path),
            recommendedNextAction:
              result.status === "passed"
                ? "Preview, view files, rebuild, or export the project."
                : result.status === "awaiting-approval"
                  ? "Allow once, allow for this project, or deny the pending command before Foundry continues."
                  : result.status === "awaiting-mock-approval"
                    ? "Open the preview, react to the first working mock, or say it looks good to continue building."
                    : "Review the build output and blocker.",
            summary: `Factory execution ${result.status} for ${result.projectName}.`,
            updatedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        };
      }),
    }));
  }

  async function executeProjectMission(missionId: string, task: string, approvalResponse?: FactoryExistingProjectRequest["approvalResponse"]) {
    const isBusy = activeControllersRef.current.has(missionId);
    const targetMission = workspace.missions.find((item) => item.missionId === missionId);
    const activeExecution = targetMission ? getActiveExecutionMission(targetMission) : undefined;
    // Only a blocked-command approval genuinely requires one of the button-generated synthetic
    // replies — arbitrary text can't resolve "should this shell command run?". A "waiting_for_user"
    // pause (a clarification question, or mock-review feedback) is the opposite: typed free text is
    // exactly the expected resolution, so it must flow straight through to "run", not get parked here.
    const pendingCommandApproval = activeExecution?.state === "waiting_for_approval";
    const followUp = classifyProjectFollowUp(task, isBusy, pendingCommandApproval);

    if (followUp === "hardStop") {
      activeControllersRef.current.get(missionId)?.abort();
      setQueuedTasks((current) => {
        const next = { ...current };
        delete next[missionId];
        return next;
      });
      appendProjectFollowUpNote(missionId, task, "Stopping the current mission now.");
      return;
    }

    if (followUp === "queue") {
      setQueuedTasks((current) => ({ ...current, [missionId]: task }));
      appendProjectFollowUpNote(missionId, task, "Queued — Foundry will start this once the current mission finishes.");
      return;
    }

    if (followUp === "resolvePending") {
      appendProjectFollowUpNote(
        missionId,
        task,
        "There's a pending command approval on this mission — use Allow once, Allow for this project, Always allow, or Deny above before sending a new request.",
      );
      return;
    }

    await executeProjectMissionNow(missionId, task, approvalResponse);

    const queuedTask = queuedTasks[missionId];
    if (queuedTask) {
      setQueuedTasks((current) => {
        const next = { ...current };
        delete next[missionId];
        return next;
      });
      await executeProjectMission(missionId, queuedTask);
    }
  }

  function appendProjectFollowUpNote(missionId: string, task: string, assistantBody: string) {
    const now = new Date();
    const requestNote: WorkspaceNote = {
      id: `message-${now.getTime()}-project-request`,
      author: "You",
      initials: "ME",
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      body: task,
      tone: "human",
      tags: ["Project request"],
      attachments: [],
      sources: [],
    };
    const assistantNote: WorkspaceNote = {
      id: `message-${now.getTime()}-project-followup`,
      author: "Foundry",
      initials: "FW",
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      body: assistantBody,
      tone: "system",
      tags: ["Project answer"],
      attachments: [],
      sources: [],
    };

    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) =>
        item.missionId === missionId ? { ...item, messages: [...item.messages, requestNote, assistantNote], updatedAt: now.toISOString() } : item,
      ),
    }));
  }

  /** Undoes the eager "pending" placeholder mission created at the start of executeProjectMissionNow, restoring
   * the mission that was actually active before this request — used whenever this request turns out to be a
   * continuation (or a read-only answer with its own entry) rather than a genuinely new mission, so the
   * mission it interrupted doesn't get abandoned mid-state as a permanent ghost in Previous Missions. */
  function retractPendingExecutionMission(missionId: string, pendingExecutionId: string, previousActiveExecutionMissionId: string | undefined) {
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) =>
        item.missionId === missionId
          ? {
              ...item,
              executionMissions: item.executionMissions.filter((entry) => entry.id !== pendingExecutionId),
              activeExecutionMissionId: previousActiveExecutionMissionId,
            }
          : item,
      ),
    }));
  }

  async function executeProjectMissionNow(missionId: string, task: string, approvalResponse?: FactoryExistingProjectRequest["approvalResponse"]) {
    const targetMission = workspace.missions.find((item) => item.missionId === missionId);
    if (!targetMission) return;

    const requestedAt = new Date();
    const requestNote: WorkspaceNote = {
      id: `message-${requestedAt.getTime()}-project-request`,
      author: "You",
      initials: "ME",
      time: requestedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      body: task,
      tone: "human",
      tags: ["Project request"],
      attachments: [],
      sources: [],
    };
    const pendingExecutionId = `execution-${requestNote.id}`;
    const previousActiveExecutionMissionId = targetMission.activeExecutionMissionId;

    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) =>
        item.missionId === missionId
          ? {
              ...item,
              messages: [...item.messages, requestNote],
              executionMissions: [
                ...item.executionMissions,
                createPendingExecutionMission(item, task, requestNote.id),
              ],
              activeExecutionMissionId: pendingExecutionId,
              // Any new turn supersedes a still-open clarify prompt — whether this turn IS the answer
              // (resolved via DecisionPrompt) or an unrelated new message that makes the question moot.
              pendingClarification: undefined,
              liveWorkEvents: ["Understanding request"],
              lastResult: "Understanding request.",
              updatedAt: requestedAt.toISOString(),
            }
          : item,
      ),
    }));

    const activeBeforeRequest = getActiveExecutionMission(targetMission);
    const resolvesExecutionDecisions = activeBeforeRequest?.state === "waiting_for_user" && /^Resolved project decisions:/i.test(task.trim());
    const resolvedIntent = await resolveProjectMessageIntent(targetMission, task);
    const projectIntent = resolvesExecutionDecisions ? "edit" : resolvedIntent.intent;
    const continuity = resolvesExecutionDecisions ? "carry_forward_plan" : resolvedIntent.continuity;
    const { clarifyingQuestion, clarifyingOptions } = resolvedIntent;

    if (projectIntent === "clarify") {
      // Ambiguous follow-up: ask instead of guessing. Retract the pending execution mission created above
      // so ambiguity never leaves a phantom entry in the mission timeline/history, and surface the question
      // as an inline one-at-a-time DecisionPrompt (pendingClarification) — not a passive chat note. Answering
      // it resumes THIS mission thread with the original request + the answer (see resolveClarificationTask
      // in BuildDashboard); any new turn clears the prompt below at the top of executeProjectMissionNow.
      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) =>
          item.missionId === missionId
            ? {
                ...item,
                executionMissions: item.executionMissions.filter((entry) => entry.id !== pendingExecutionId),
                activeExecutionMissionId: previousActiveExecutionMissionId,
                liveWorkEvents: [],
                lastResult: clarifyingQuestion || "Could you clarify what you'd like me to do here?",
                pendingClarification: {
                  question: clarifyingQuestion || "Could you clarify what you'd like me to do here?",
                  options: clarifyingOptions.length ? clarifyingOptions : undefined,
                  originalTask: task,
                },
                updatedAt: requestedAt.toISOString(),
              }
            : item,
        ),
      }));
      return;
    }

    const engineeringNote: WorkspaceNote | null =
      isMutatingProjectIntent(projectIntent)
        ? {
            id: `message-${requestedAt.getTime()}-engineering-note`,
            author: "Foundry",
            initials: "FW",
            time: requestedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            body: engineeringOpeningForTask(task, projectIntent, targetMission),
            tone: "note",
            tags: ["Project answer", "Engineering note"],
            attachments: [],
            sources: [],
          }
        : null;

    const isExistingProjectPlan = /^Mode:\s*Work on existing project/im.test(targetMission.objective);

    const brief = `${targetMission.objective}\n\nCurrent task: ${task}`;
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) =>
        item.missionId === missionId
          ? {
              ...item,
              messages: engineeringNote ? [...item.messages, engineeringNote] : item.messages,
              liveWorkEvents:
                projectIntent === "inspection" || projectIntent === "diagnose" || projectIntent === "question"
                  ? ["Reading the project"]
                  : projectIntent === "status"
                    ? ["Reading previous project result"]
                    : projectIntent === "retrospective"
                      ? ["Checking mission memory"]
                      : ["Getting started"],
              lastResult:
                projectIntent === "inspection" || projectIntent === "diagnose" || projectIntent === "question"
                  ? "Reading the project."
                  : projectIntent === "status"
                    ? "Reading previous project result."
                    : projectIntent === "retrospective"
                      ? "Checking mission memory."
                      : "Getting started.",
              updatedAt: requestedAt.toISOString(),
            }
          : item,
      ),
    }));

    if (projectIntent === "inspection" || projectIntent === "diagnose" || projectIntent === "question" || projectIntent === "status" || projectIntent === "retrospective") {
      // A read-only answer gets its own Mission entry (executionMissionFromAnswer, Section 16) — the
      // placeholder created above must not also stick around as a second, permanently-"pending" ghost entry.
      retractPendingExecutionMission(missionId, pendingExecutionId, previousActiveExecutionMissionId);
      await answerProjectReadOnlyMessage(missionId, targetMission, task, projectIntent);
      return;
    }

    const parentMission = isMutatingProjectIntent(projectIntent) ? parentMissionContextFor(targetMission) : undefined;
    // An "Approved: run X" / "Denied approval to run X" reply is, by construction, always a continuation of
    // the mission that's currently paused waiting for it — trust that over the classifier's own read, since
    // forking a new mission entry here is exactly what left "waiting for approval" ghosts stuck in history.
    const isApprovalReply = isApprovalReplyMessage(task);
    const missionContinuity: "carry_forward_plan" | undefined =
      parentMission && (continuity === "carry_forward_plan" || isApprovalReply) ? "carry_forward_plan" : undefined;
    if (missionContinuity === "carry_forward_plan") {
      // Continue the SAME mission entry instead of leaving the one just paused ("waiting for approval"/
      // "waiting for user") stranded forever while a brand-new entry takes over as active (Section 16).
      retractPendingExecutionMission(missionId, pendingExecutionId, previousActiveExecutionMissionId);
      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) =>
          item.missionId === missionId
            ? {
                ...item,
                executionMissions: updateActiveExecutionMission(item, { state: "planning", updated_at: new Date().toISOString() }),
                liveWorkEvents: ["Resuming the existing mission"],
                lastResult: "Resuming the existing mission.",
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      }));
    }

    if (isExistingProjectPlan) {
      const localConnector = localConnectorFromMission(targetMission);
      if (localConnector?.url) {
        await runExistingProjectExecutionForMission(missionId, targetMission.objective, task, uploadedProjectFilesFromMission(targetMission), localProjectPathFromMission(targetMission), localConnector, parentMission, missionContinuity, approvalResponse);
        return;
      }
      const browserFolderHandleId = browserFolderHandleIdFromMission(targetMission);
      if (browserFolderHandleId) {
        await runBrowserFolderExecutionForMission(missionId, targetMission.objective, task, browserFolderHandleId);
        return;
      }
      await runExistingProjectExecutionForMission(missionId, targetMission.objective, task, uploadedProjectFilesFromMission(targetMission), localProjectPathFromMission(targetMission), undefined, parentMission, missionContinuity, approvalResponse);
      return;
    }

    const previousExecutionPath = projectExecutionPathFromMission(targetMission);
    if (previousExecutionPath) {
      await runExistingProjectExecutionForMission(missionId, targetMission.objective, task, [], previousExecutionPath, undefined, parentMission, missionContinuity, approvalResponse);
      return;
    }

    await runFactoryExecutionForMission(missionId, brief);
  }

  function createPendingExecutionMission(mission: MissionState, task: string, requestMessageId?: string): ExecutionMission {
    const now = new Date().toISOString();
    const previous = mission.executionMissions.at(-1);
    return {
      id: `execution-${requestMessageId ?? Date.now()}`,
      title: taskTitle(task),
      source_requirements: [task],
      state: "understanding",
      verification_status: "none",
      plan: [],
      files_touched: [],
      commands_run: [],
      verification: [],
      summary: "",
      parent_mission_id: previous?.id,
      request_message_id: requestMessageId,
      timeline: [],
      created_at: now,
      updated_at: now,
    };
  }

  async function answerProjectReadOnlyMessage(missionId: string, targetMission: MissionState, task: string, intent: ProjectMessageIntent) {
    const now = new Date();
    let answer = "";

    if (intent === "status") {
      answer = projectStatusAnswer(targetMission);
    } else if (intent === "retrospective") {
      answer =
        missionMemoryAnswer(targetMission, task) ??
        "I don't have a recorded reason for that in this mission's history yet. Ask me to inspect the file directly, or mention the specific file or command you mean.";
    } else {
      answer = await inspectProjectForAnswer(targetMission, task);
    }

    const answerNote: WorkspaceNote = {
      id: `message-${now.getTime()}-project-answer`,
      author: "Foundry",
      initials: "FW",
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      body: answer,
      tone: "note",
      tags: ["Project answer"],
      attachments: [],
      sources: [],
    };

    setWorkspace((current) => ({
      activeMissionId: missionId,
      missions: current.missions.map((item) => {
        if (item.missionId !== missionId) return item;
        // Every project request gets a Mission entry — even read-only ones — so "Previous Missions" is
        // the single unified history (Section 16), not a separate plain-text message count. It must also
        // become the active one immediately: leaving activeExecutionMissionId pointed at whatever was
        // active before is what made every read-only follow-up (the most common kind) file itself straight
        // into "Previous Missions" while its text rendered elsewhere — the single root cause behind the new
        // message appearing in the wrong place, stale status pills, and stale suggestions surviving it.
        const answerMission = executionMissionFromAnswer(task, answer, item.activeExecutionMissionId, answerNote.id);
        return {
          ...item,
          messages: [...item.messages, answerNote],
          liveWorkEvents: [],
          lastResult: answer,
          executionMissions: [...item.executionMissions, answerMission],
          activeExecutionMissionId: answerMission.id,
          workMemory: {
            ...item.workMemory,
            latestEvidence: [intent === "status" ? "Read previous project result" : "Inspected project without writing files"],
            recommendedNextAction: "Ask a follow-up question or describe the change you want Foundry to make.",
            updatedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        };
      }),
    }));
  }

  async function inspectProjectForAnswer(targetMission: MissionState, task: string) {
    const localConnector = localConnectorFromMission(targetMission);
    if (localConnector?.url) {
      const response = await fetch("/api/factory/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localConnector, task, mode: readStoredModelMode() }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        return `I could not inspect the local agent project: ${error.error ?? "Agent inspection failed."}`;
      }
      const result = (await response.json()) as { answer?: string };
      return result.answer || "I inspected the local agent project, but could not produce a useful summary.";
    }

    const browserFolderHandleId = browserFolderHandleIdFromMission(targetMission);
    if (browserFolderHandleId) {
      const handle = await getBrowserFolderHandle(browserFolderHandleId);
      if (!handle) return "I cannot inspect that live folder because the browser folder handle is no longer available. Re-open the folder, then ask again.";
      const files = await readBrowserFolderFiles(handle);
      return projectInspectionAnswerFromFiles(files, task);
    }

    const uploadedFiles = uploadedProjectFilesFromMission(targetMission);
    if (uploadedFiles.length) return projectInspectionAnswerFromFiles(uploadedFiles, task);

    const localPath = localProjectPathFromMission(targetMission) || projectExecutionPathFromMission(targetMission);
    if (localPath) {
      const response = await fetch("/api/factory/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localPath, task, mode: readStoredModelMode() }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        return `I could not inspect the local project folder: ${error.error ?? "Project inspection failed."}`;
      }
      const result = (await response.json()) as { answer?: string };
      return result.answer || "I inspected the project, but could not produce a useful summary.";
    }

    return "I do not have readable project files for this workspace yet. Open a local folder or upload the project files, then ask me to inspect it again.";
  }

  async function createProjectBriefMission(brief: string, uploadedFiles: FactoryUploadedFile[] = [], discovery?: StructuredDiscovery) {
    const now = new Date();
    const iso = now.toISOString();
    const projectTitle = titleFromProjectBrief(brief);
    const briefNoteId = `message-${now.getTime()}-brief`;
    const statusNoteId = `message-${now.getTime()}-status`;
    const briefNote: WorkspaceNote = {
      id: briefNoteId,
      author: "You",
      initials: "ME",
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      body: brief,
      tone: "human",
      // "Project request" is what ProjectWorkConversation actually scans for to find the active
      // mission's request (BuildDashboard.tsx's requestMessages filter) — every follow-up gets it, but
      // the very first message of a brand-new project only had the legacy "Project brief" tag, so the
      // canvas permanently rendered "Ready for the next instruction" (the zero-messages empty state)
      // instead of the real request/checklist/timeline, for every first build. Keep "Project brief" too
      // since projectBriefFromMission's artifact lookup is unrelated and other code may still expect it.
      tags: ["Project brief", "Project request"],
      attachments: [],
      sources: [],
    };
    const isExistingProjectPlan = /^Mode:\s*Work on existing project/im.test(brief);
    const shouldAutoExecute = shouldAutoExecuteProjectBrief(brief);
    const statusNote: WorkspaceNote = {
      id: statusNoteId,
      author: "Foundry",
      initials: "FW",
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      body: isExistingProjectPlan
        ? existingProjectOpenMessage(brief)
        : shouldAutoExecute
          ? "Factory execution started. Foundry is creating a real workspace, writing files, and running supported build commands."
          : "Project workspace created. Tell Foundry what you would like it to build first.",
      tone: "system",
      tags: isExistingProjectPlan ? ["Existing project"] : shouldAutoExecute ? ["Factory execution"] : ["Project workspace"],
      attachments: [],
      sources: [],
    };
    const missionId = `mission-${now.getTime()}`;
    const projectMission: MissionState = {
      ...createInitialMission(now),
      missionId,
      conversationTitle: projectTitle,
      title: projectTitle,
      objective: brief,
      status: "active",
      currentStage: "ready",
      desiredOutcome: "project",
      artifactType: "project",
      messages: [briefNote, statusNote],
      attachments: [],
      createdArtifacts: [
        {
          id: `artifact-${briefNoteId}`,
          sourceMessageId: briefNoteId,
          type: "project",
          kind: artifactKindForOutcome("project"),
          title: "Project Brief",
          body: brief,
          description: "Saved project brief for factory execution.",
          createdAt: iso,
        },
        ...(uploadedFiles.length
          ? [
              {
                id: `artifact-${briefNoteId}-uploaded-files`,
                sourceMessageId: briefNoteId,
                type: "project" as const,
                kind: artifactKindForOutcome("project"),
                title: "Uploaded Project Files",
                body: JSON.stringify(uploadedFiles),
                description: `${uploadedFiles.length} uploaded project files available for existing-project execution.`,
                createdAt: iso,
              },
            ]
          : []),
      ],
      sources: [],
      lastResult: isExistingProjectPlan ? "Existing project plan created." : shouldAutoExecute ? "Factory execution started." : "Project workspace ready.",
      workMemory: {
        currentGoal: projectTitle,
        currentBlocker: "",
        completedWork: ["Project brief created"],
        resolvedErrors: [],
        rejectedHypotheses: [],
        latestEvidence: ["Saved project brief"],
        relevantFiles: [],
        recommendedNextAction: isExistingProjectPlan ? "Describe the project task to perform next." : shouldAutoExecute ? "Wait for factory execution results." : "Describe the initial project build task.",
        summary: isExistingProjectPlan ? "Existing project plan saved." : shouldAutoExecute ? "Factory execution started from the saved brief." : "Project workspace is ready for a task.",
        updatedAt: iso,
      },
      followUpContext: {
        type: "newMission",
        summary: isExistingProjectPlan ? "Existing project plan saved." : shouldAutoExecute ? "Factory execution started." : "Project workspace ready.",
      },
      liveWorkEvents: isExistingProjectPlan ? ["Existing project plan created"] : shouldAutoExecute ? ["Project brief created", "Factory execution started"] : ["Project workspace ready"],
      createdAt: iso,
      updatedAt: iso,
    };

    const localConnector = isExistingProjectPlan ? localConnectorFromMission(projectMission) : undefined;
    const instructions = brief.match(/^Custom instructions:\s*(.+)$/im)?.[1]?.trim() ?? "";
    const hasRealInstructions = Boolean(instructions && !/^none|no additional instructions?\.?$/i.test(instructions));
    const willExecuteNow = isExistingProjectPlan ? Boolean(localConnector?.url && hasRealInstructions) : shouldAutoExecute;
    // Every follow-up gets a pending ExecutionMission the instant it's submitted (executeProjectMissionNow),
    // which is what makes activeExecutionMissionId resolve during live streaming so the header pill,
    // composer busy state, and detail-level timeline all show real progress. The very first build of a
    // brand-new project skipped that — executionMissions started empty and stayed that way until the
    // entire run finished — so updateActiveExecutionMission's every live update silently no-op'd
    // (it bails out when there's no active id), and the whole build ran with the canvas showing "Ready"
    // and no timeline at all. Mirror the follow-up path here so the first build is live from turn one.
    const pendingExecutionMission = willExecuteNow ? createPendingExecutionMission(projectMission, "Build the initial project", briefNoteId) : undefined;
    const missionToStore: MissionState = pendingExecutionMission
      ? { ...projectMission, executionMissions: [pendingExecutionMission], activeExecutionMissionId: pendingExecutionMission.id }
      : projectMission;

    setSelectedArtifactId(null);
    setStagedAttachments([]);
    setPendingWork((current) => current.filter((item) => item.missionId !== missionId));
    setWorkspace((current) => ({
      activeMissionId: missionToStore.missionId,
      missions: [missionToStore, ...current.missions],
    }));

    if (isExistingProjectPlan) {
      if (localConnector?.url && hasRealInstructions) {
        await runExistingProjectExecutionForMission(
          projectMission.missionId,
          brief,
          instructions,
          [],
          "",
          localConnector,
        );
      }
      return;
    }

    if (!shouldAutoExecute) return;

    await runFactoryExecutionForMission(projectMission.missionId, brief, discovery);
  }

  async function runFactoryExecutionForMission(missionId: string, brief: string, discovery?: StructuredDiscovery) {
    await runProjectExecutionRequest(missionId, "/api/factory/create?stream=1", { brief, discovery, modelMode: readStoredModelMode() }, "Factory execution failed.", "Build the initial project");
  }

  async function runExistingProjectExecutionForMission(missionId: string, brief: string, task: string, files: FactoryUploadedFile[], localPath: string, localConnector?: { url: string; token?: string; rootLabel?: string }, parentMission?: MissionParentContext, continuity?: "carry_forward_plan", approvalResponse?: FactoryExistingProjectRequest["approvalResponse"]) {
    const approvedCategories = approvedCommandCategories[missionId] ?? [];
    const approvedProjectCommands = approvedCommands[missionId] ?? [];
    await runProjectExecutionRequest(missionId, "/api/factory/existing?stream=1", { brief, task, files, localPath, localConnector, approvedCategories, approvedCommands: approvedProjectCommands, parentMission, continuity, approvalResponse, quality: readStoredMissionQuality(), modelMode: readStoredModelMode() }, "Existing project execution failed.", task);
  }

  function approveCommandCategory(missionId: string, category: string) {
    setApprovedCommandCategories((current) => {
      const existing = current[missionId] ?? [];
      if (existing.includes(category)) return current;
      return { ...current, [missionId]: [...existing, category] };
    });
  }

  function approveExactCommand(missionId: string, command: string) {
    const normalized = command.trim().replace(/\s+/g, " ");
    if (!normalized) return;
    setApprovedCommands((current) => {
      const existing = current[missionId] ?? [];
      if (existing.some((entry) => entry.trim().replace(/\s+/g, " ").toLowerCase() === normalized.toLowerCase())) return current;
      return { ...current, [missionId]: [...existing, normalized] };
    });
  }

  async function rollbackToJournalEntry(missionId: string, projectId: string, entryId: string) {
    const targetMission = workspace.missions.find((item) => item.missionId === missionId);
    const localConnector = targetMission ? localConnectorFromMission(targetMission) : undefined;
    const localPath = targetMission ? localProjectPathFromMission(targetMission) : "";
    await runProjectExecutionRequest(missionId, "/api/factory/undo", { projectId, entryId, localPath, localConnector }, "Rollback failed.", "Undo the last change");
  }

  async function runBrowserFolderExecutionForMission(missionId: string, brief: string, task: string, handleId: string) {
    const controller = new AbortController();
    activeControllersRef.current.set(missionId, controller);
    try {
      const result = await executeBrowserFolderTask(brief, task, handleId, (event) => {
        if (controller.signal.aborted) return;
        appendProjectExecutionEvent(missionId, event);
      }, approvedCommandCategories[missionId] ?? []);
      if (controller.signal.aborted) return;
      updateProjectExecution(missionId, result, task);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Live folder execution failed.";
      setWorkspace((current) => ({
        activeMissionId: missionId,
        missions: current.missions.map((item) =>
          item.missionId === missionId
            ? {
                ...item,
                lastResult: message,
                liveWorkEvents: [...item.liveWorkEvents, `Live folder execution failed: ${message}`],
                workMemory: { ...item.workMemory, currentBlocker: message, updatedAt: new Date().toISOString() },
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      }));
    } finally {
      if (activeControllersRef.current.get(missionId) === controller) {
        activeControllersRef.current.delete(missionId);
      }
    }
  }

  function appendProjectExecutionEvent(missionId: string, event: FactoryExecutionEvent) {
    if (event.internal) return;
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) => {
        if (item.missionId !== missionId) return item;
        const artifact = item.createdArtifacts.find((entry) => entry.title === "Project Execution Timeline");
        const previous = artifact ? safeParseTimeline(artifact.body) : [];
        const nextTimeline = [...previous.filter((entry) => entry.id !== event.id), event];
        const now = new Date().toISOString();
        const nextArtifact: CreatedArtifact = {
          id: artifact?.id ?? `artifact-${missionId}-timeline`,
          sourceMessageId: artifact?.sourceMessageId ?? item.messages.at(-1)?.id ?? missionId,
          type: "project",
          kind: artifactKindForOutcome("project"),
          title: "Project Execution Timeline",
          body: JSON.stringify(nextTimeline),
          description: "Live project execution timeline.",
          createdAt: artifact?.createdAt ?? now,
        };
        return {
          ...item,
          createdArtifacts: [nextArtifact, ...item.createdArtifacts.filter((entry) => entry.title !== "Project Execution Timeline")],
          executionMissions: updateActiveExecutionMission(item, {
            state: stateForLiveEvent(event, item),
            timeline: nextTimeline,
            updated_at: now,
          }),
          liveWorkEvents: liveWorkEventsForTimeline(nextTimeline),
          updatedAt: now,
        };
      }),
    }));
  }

  async function runProjectExecutionRequest(missionId: string, endpoint: string, body: unknown, fallbackMessage: string, task?: string) {
    const controller = new AbortController();
    activeControllersRef.current.set(missionId, controller);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error((await response.text()) || fallbackMessage);

      const streamedResult = await readFactoryExecutionStream(response, missionId);
      if (!streamedResult) throw new Error("Factory execution ended without a result.");
      if (task) updateProjectExecution(missionId, streamedResult, task);
      else updateProjectExecution(missionId, streamedResult);
    } catch (error) {
      if (controller.signal.aborted) {
        appendProjectExecutionEvent(missionId, {
          id: `execution-stopped-${Date.now()}`,
          timestamp: new Date().toISOString(),
          kind: "summary",
          status: "warning",
          title: "Stopped by user",
          details: { reason: "The user stopped this mission before it finished." },
        });
        setWorkspace((current) => ({
          ...current,
          missions: current.missions.map((item) =>
            item.missionId === missionId
              ? { ...item, lastResult: "Stopped by user.", liveWorkEvents: [...item.liveWorkEvents, "Stopped by user."], updatedAt: new Date().toISOString() }
              : item,
          ),
        }));
        return;
      }

      const message = error instanceof Error ? error.message : fallbackMessage;
      const failedEvent: FactoryExecutionEvent = {
        id: `execution-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        kind: "summary",
        status: "error",
        title: "Execution request failed",
        output: message,
        details: { blocker: message },
      };
      const targetMission = workspace.missions.find((item) => item.missionId === missionId);
      const previous = targetMission ? projectExecutionFromWorkspaceMission(targetMission) : null;
      const failedResult: FactoryProjectResult = {
        ...(previous ?? {
          projectId: missionId,
          projectName: targetMission?.title || "Project mission",
          projectPath: "",
          briefPath: "",
          stack: "",
          template: "",
          supported: true,
          events: [],
          files: [],
          commands: [],
        }),
        status: "failed",
        blocker: message,
        clarificationQuestions: undefined,
        timeline: [...(previous?.timeline ?? []), failedEvent],
        events: [...(previous?.events ?? []), `Factory execution failed: ${message}`],
      };
      updateProjectExecution(missionId, failedResult, task ?? "Continue project mission");
    } finally {
      if (activeControllersRef.current.get(missionId) === controller) {
        activeControllersRef.current.delete(missionId);
      }
    }
  }

  async function readFactoryExecutionStream(response: Response, missionId: string): Promise<FactoryProjectResult | null> {
    const reader = response.body?.getReader();
    if (!reader) return null;

    const decoder = new TextDecoder();
    let buffer = "";
    let result: FactoryProjectResult | null = null;
    const timeline: FactoryExecutionEvent[] = [];

    async function handleLine(line: string) {
      if (!line.trim()) return;
      const payload = JSON.parse(line) as { type: "event"; event: FactoryExecutionEvent } | { type: "result"; result: FactoryProjectResult } | { type: "error"; error: string };
      if (payload.type === "event") {
        const checklistJson = payload.event.details?.checklistJson;
        if (typeof checklistJson === "string") updateLiveChecklist(missionId, checklistJson);
        if (!payload.event.internal) {
          timeline.push(payload.event);
          updateMissionTimeline(missionId, timeline);
        }
      } else if (payload.type === "result") {
        result = payload.result;
      } else if (payload.type === "error") {
        throw new Error(payload.error);
      }
    }

    while (true) {
      const { value, done } = await readExecutionStreamChunk(reader);
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        await handleLine(line);
      }
      if (done) break;
    }

    if (buffer.trim()) await handleLine(buffer);
    return result;
  }

  async function readExecutionStreamChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("Execution stream became inactive for 150 seconds. The mission was stopped instead of remaining stuck.")), 150_000);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function updateMissionTimeline(missionId: string, timeline: FactoryExecutionEvent[]) {
    const now = new Date().toISOString();
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) => {
        if (item.missionId !== missionId) return item;
        const timelineArtifact: CreatedArtifact = {
          id: `artifact-${missionId}-execution-timeline`,
          sourceMessageId: item.messages[0]?.id ?? missionId,
          type: "project",
          kind: artifactKindForOutcome("project"),
          title: "Project Execution Timeline",
          body: JSON.stringify(timeline, null, 2),
          description: "Live factory execution events.",
          createdAt: now,
        };

        return {
          ...item,
          createdArtifacts: [timelineArtifact, ...item.createdArtifacts.filter((artifact) => artifact.title !== "Project Execution Timeline")],
          executionMissions: updateActiveExecutionMission(item, {
            state: stateForTimeline(timeline, item),
            timeline,
            updated_at: now,
          }),
          liveWorkEvents: liveWorkEventsForTimeline(timeline),
          updatedAt: now,
        };
      }),
    }));
  }

  function updateLiveChecklist(missionId: string, checklistJson: string) {
    const checklist = safeParseChecklist(checklistJson);
    if (!checklist) return;
    const now = new Date().toISOString();
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) => {
        if (item.missionId !== missionId) return item;
        const previousArtifact = item.createdArtifacts.find((entry) => entry.title === "Project Execution");
        const previousResult = previousArtifact ? safeParseExecutionResult(previousArtifact.body) : null;
        const baseResult: FactoryProjectResult = previousResult ?? {
          projectId: "",
          projectName: "",
          projectPath: "",
          briefPath: "",
          stack: "",
          template: "",
          status: "running",
          supported: true,
          events: [],
          files: [],
          commands: [],
        };
        const nextResult: FactoryProjectResult = { ...baseResult, checklist };
        const nextArtifact: CreatedArtifact = {
          id: previousArtifact?.id ?? `artifact-${missionId}-execution`,
          sourceMessageId: previousArtifact?.sourceMessageId ?? item.messages.at(-1)?.id ?? missionId,
          type: "project",
          kind: artifactKindForOutcome("project"),
          title: "Project Execution",
          body: JSON.stringify(nextResult, null, 2),
          description: previousArtifact?.description ?? "Live project execution.",
          createdAt: previousArtifact?.createdAt ?? now,
        };
        return {
          ...item,
          createdArtifacts: [nextArtifact, ...item.createdArtifacts.filter((entry) => entry.title !== "Project Execution")],
          executionMissions: updateActiveExecutionMission(item, {
            state: "planning",
            plan: checklist,
            updated_at: now,
          }),
          updatedAt: now,
        };
      }),
    }));
  }

  function updateMissionMessages(missionId: string, messages: WorkspaceNote[], resetDerivedState = false) {
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) =>
        item.missionId === missionId
          ? resetMissionToMessages(item, messages, resetDerivedState)
          : item,
      ),
    }));
  }

  function editUserMessage(noteId: string, body: string) {
    const noteIndex = mission.messages.findIndex((message) => message.id === noteId);
    if (noteIndex < 0) return;

    const editedMessages = mission.messages.slice(0, noteIndex + 1).map((message) => (message.id === noteId ? { ...message, body } : message));
    const editedMission = resetMissionToMessages(mission, editedMessages, true);
    updateMissionMessages(mission.missionId, editedMessages, true);

    const editedNote = editedMessages[noteIndex];
    if (editedNote?.tone === "human") {
      startProgress(editedMission, editedNote.id, editedNote.body);
      void requestAnswer(editedMission, editedNote.id, editedNote.body);
    }
  }

  function retryFromMessage(noteId: string) {
    const noteIndex = mission.messages.findIndex((message) => message.id === noteId);
    const note = mission.messages[noteIndex];
    if (!note || note.tone !== "human") return;

    const messages = mission.messages.slice(0, noteIndex + 1);
    const retryMission = resetMissionToMessages(mission, messages, true);
    updateMissionMessages(mission.missionId, messages, true);
    startProgress(retryMission, note.id, note.body);
    void requestAnswer(retryMission, note.id, note.body);
  }

  function branchFromMessage(noteId: string) {
    const noteIndex = mission.messages.findIndex((message) => message.id === noteId);
    if (noteIndex < 0) return;

    const now = new Date();
    const branchMessages = mission.messages.slice(0, noteIndex + 1);
    const branchMission: MissionState = {
      ...mission,
      missionId: `mission-${now.getTime()}`,
      conversationTitle: `${mission.conversationTitle} Branch`,
      title: `${mission.title} Branch`,
      messages: branchMessages,
      attachments: attachmentsFromMessages(branchMessages),
      createdArtifacts: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    setWorkspace((current) => ({
      activeMissionId: branchMission.missionId,
      missions: [branchMission, ...current.missions],
    }));
  }

  function deleteArtifact(artifactId: string, noteId: string) {
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) =>
        item.missionId === current.activeMissionId
          ? {
              ...item,
              messages: item.messages.map((message) => (message.id === noteId ? { ...message, visualArtifact: undefined } : message)),
              createdArtifacts: item.createdArtifacts.filter((artifact) => artifact.id !== artifactId),
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    }));
  }

  function startProgress(missionForProgress: MissionState, noteId: string, body: string) {
    setPendingWork((current) => [
      ...current.filter((item) => item.noteId !== noteId),
      {
        missionId: missionForProgress.missionId,
        noteId,
        steps: progressStepsFor(body, missionForProgress),
        stepIndex: 0,
      },
    ]);
  }

  async function requestAnswer(missionForRequest: MissionState, noteId: string, body: string, queueRetryRound = 0) {
    let keepPending = false;

    try {
      if (shouldForceVisualResponse(body, missionForRequest)) {
        const shouldRevise = shouldReviseExistingVisual(body);
        const previousVisual = shouldRevise ? latestVisualArtifact(missionForRequest) : undefined;
        const visual = createVisualArtifact(body, {
          outcome: isVisualOutcome(missionForRequest.desiredOutcome) ? missionForRequest.desiredOutcome : "sketch",
          missionId: missionForRequest.missionId,
          objective: missionForRequest.objective,
          previous: previousVisual,
        });
        const answer =
          visual.version > 1
            ? `Updated **${visual.title}** to version ${visual.version}.`
            : `Created **${visual.title}** as a visual ${visual.kind}.`;

        setWorkspace((current) => ({
          ...current,
          missions: current.missions.map((item) =>
            item.missionId === missionForRequest.missionId ? upsertVisualArtifactMessage(item, answer, visual, new Date()) : item,
          ),
        }));
        return;
      }

      const result = await requestReasonApiWithRetry(createReasoningRequest(missionForRequest, body, noteId));
      if (result.retryable && !result.answer?.trim()) {
        if (queueRetryRound >= 3) {
          const answer = "The provider is still busy, so Foundry paused this answer instead of continuing indefinitely. Send the message again in a moment and it will continue from the preserved workspace context.";
          setWorkspace((current) => ({
            ...current,
            missions: current.missions.map((item) =>
              item.missionId === missionForRequest.missionId && canAppendAnswerForRequest(item, noteId, body)
                ? appendAssistantMessage(item, answer, new Date(), result.sources ?? [])
                : item,
            ),
          }));
          return;
        }
        keepPending = true;
        scheduleQueuedAnswerRetry(missionForRequest, noteId, body, queueRetryRound);
        return;
      }

      const answer = result.answer?.trim() || "I could not complete that answer.";

      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) =>
          item.missionId === missionForRequest.missionId && canAppendAnswerForRequest(item, noteId, body)
            ? appendAssistantMessage(item, answer, new Date(), result.sources ?? [])
            : item,
        ),
      }));
    } catch {
      if (queueRetryRound < 6) {
        keepPending = true;
        scheduleQueuedAnswerRetry(missionForRequest, noteId, body, queueRetryRound);
        return;
      }

      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) =>
          item.missionId === missionForRequest.missionId && canAppendAnswerForRequest(item, noteId, body)
            ? appendAssistantMessage(item, "I could not reach the answer service. Check the server and try again.")
            : item,
        ),
      }));
    } finally {
      if (keepPending) return;

      setPendingWork((current) =>
        current.map((item) => (item.noteId === noteId ? { ...item, stepIndex: item.steps.length - 1 } : item)),
      );
      window.setTimeout(() => {
        setPendingWork((current) => current.filter((item) => item.noteId !== noteId));
      }, 900);
    }
  }

  function scheduleQueuedAnswerRetry(missionForRequest: MissionState, noteId: string, body: string, queueRetryRound: number) {
    const nextRound = queueRetryRound + 1;
    const retryDelay = Math.min(2200 + nextRound * 1600, 15000);

    setPendingWork((current) =>
      current.map((item) =>
        item.noteId === noteId
          ? {
              ...item,
              steps: ["Preparing the answer", "Waiting for capacity", "Continuing automatically", "Answer ready"],
              stepIndex: Math.min(1 + (nextRound % 2), 2),
            }
          : item,
      ),
    );

    window.setTimeout(() => {
      void requestAnswer(missionForRequest, noteId, body, nextRound);
    }, retryDelay);
  }

  async function requestReasonApiWithRetry(payload: ReturnType<typeof createReasoningRequest>) {
    const maxAttempts = 4;
    let lastResult: ReasonApiResponse = {};

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch("/api/reason", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as ReasonApiResponse;
      lastResult = result;

      if (!result.retryable) return result;
      if (attempt === maxAttempts) return result;

      await delay(Math.min(Math.max(result.retryAfterMs ?? attempt * 700, 350), 2600));
    }

    return lastResult;
  }

  async function postNote(body: string, files: File[] = []) {
    const activeMission = mission;
    let submittedAttachments: WorkspaceAttachment[] = [];

    if (files.length) {
      try {
        submittedAttachments = await Promise.all(files.map((file) => ingestFile(file, activeMission.missionId)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "The file could not be read.";
        setWorkspace((current) => ({
          ...current,
          missions: current.missions.map((item) =>
            item.missionId === activeMission.missionId ? appendAssistantMessage(item, `I could not attach that file: ${message}`, new Date()) : item,
          ),
        }));
        return;
      }
    }

    const currentAttachments = mergeAttachments(stagedAttachments, submittedAttachments);
    const workThreadDecision =
      currentAttachments.length > 0 && activeMission.messages.length > 0 ? "continue" : decideWorkThread(body, activeMission);

    if (workThreadDecision === "ambiguous") {
      const updatedMission = applyUserMessage(activeMission, body, currentAttachments, { includeAssistantMessage: false });
      const askMessage =
        "This looks like it might be a separate piece of work. Should I continue here, or start a new work item?";
      setStagedAttachments([]);
      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) =>
          item.missionId === updatedMission.missionId ? appendAssistantMessage(updatedMission, askMessage, new Date()) : item,
        ),
      }));
      return;
    }

    const provisionalMission = applyUserMessage(activeMission, body, currentAttachments, { includeAssistantMessage: false });
    const buildHandoffVisual = isBuildRequest(body) && Boolean(latestVisualArtifact(activeMission) || latestVisualArtifact(provisionalMission));
    const explicitVisualRequest = !buildHandoffVisual && isExplicitVisualArtifactRequest(body);
    const producesVisual = !buildHandoffVisual && (explicitVisualRequest || shouldCreateVisualArtifact(body, provisionalMission, activeMission));
    const needsReasoning =
      !producesVisual &&
      !buildHandoffVisual &&
      (shouldUseReasoning(provisionalMission.desiredOutcome) ||
        isVisualOutcome(provisionalMission.desiredOutcome) ||
        shouldUseReasoningForTurn(body, provisionalMission, activeMission));
    const updatedMission = needsReasoning || producesVisual || buildHandoffVisual ? provisionalMission : applyUserMessage(activeMission, body, currentAttachments);
    const userNote = updatedMission.messages.findLast((message) => message.author === "You");
    setStagedAttachments([]);

    setWorkspace((current) => {
      const startedNewThread = updatedMission.missionId !== activeMission.missionId;

      if (startedNewThread) {
        const replaceSeedThread =
          current.missions.length === 1 &&
          (activeMission.conversationTitle === seedConversationTitle || activeMission.conversationTitle === legacySeedConversationTitle) &&
          activeMission.desiredOutcome === "conversation";
        const replaceBlankThread =
          (activeMission.conversationTitle === blankConversationTitle || activeMission.conversationTitle === legacySeedConversationTitle) &&
          activeMission.messages.length === 0;

        return {
          activeMissionId: updatedMission.missionId,
          missions:
            replaceSeedThread || replaceBlankThread
              ? current.missions.map((item) => (item.missionId === activeMission.missionId ? updatedMission : item))
              : [updatedMission, ...current.missions],
        };
      }

      return {
        ...current,
        missions: current.missions.map((item) => (item.missionId === updatedMission.missionId ? updatedMission : item)),
      };
    });

    if (producesVisual && userNote) {
      const shouldRevise = shouldReviseExistingVisual(body);
      const previousVisual = shouldRevise && updatedMission.missionId === activeMission.missionId ? latestVisualArtifact(activeMission) : undefined;
      startProgress(updatedMission, userNote.id, body);
      window.setTimeout(() => {
        const visual = createVisualArtifact(body, {
          outcome: updatedMission.desiredOutcome,
          missionId: updatedMission.missionId,
          objective: updatedMission.objective,
          previous: previousVisual,
        });
        const answer =
          visual.version > 1
            ? `Updated **${visual.title}** to version ${visual.version}.`
            : `Created **${visual.title}** as a visual ${visual.kind}.`;

        setWorkspace((current) => ({
          ...current,
          missions: current.missions.map((item) =>
            item.missionId === updatedMission.missionId ? upsertVisualArtifactMessage(item, answer, visual, new Date()) : item,
          ),
        }));

        setPendingWork((current) =>
          current.map((item) => (item.noteId === userNote.id ? { ...item, stepIndex: item.steps.length - 1 } : item)),
        );
        window.setTimeout(() => setPendingWork((current) => current.filter((item) => item.noteId !== userNote.id)), 900);
      }, 900);
      return;
    }

    if (buildHandoffVisual && userNote) {
      const selectedVisual = latestVisualArtifact(activeMission) || latestVisualArtifact(updatedMission);
      const answer = selectedVisual
        ? [
            `I have **${selectedVisual.title} version ${selectedVisual.version}** selected for the build handoff.`,
            "",
            "Project building is not implemented yet, so I cannot create files, install packages, or run the app from it yet.",
            "",
            "When the build phase is available, this exact artifact version should be used as the starting point.",
          ].join("\n")
        : "I can prepare this for the build flow, but project building is not implemented yet.";

      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) =>
          item.missionId === updatedMission.missionId ? appendAssistantMessage(item, answer, new Date()) : item,
        ),
      }));
      return;
    }

    if (needsReasoning && userNote) {
      startProgress(updatedMission, userNote.id, body);
      void requestAnswer(updatedMission, userNote.id, body);
    }
  }

  return (
    <>
      <div className="workspace-background fixed inset-0" aria-hidden="true" />
      <div className="relative z-10 grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <TopBar />
        <BuildDashboard
          missions={workspace.missions}
          activeMissionId={mission.missionId}
          queuedTask={queuedTasks[mission.missionId]}
          onCreateMission={createNewMissionThread}
          onDeleteMission={deleteMission}
          onCreateProject={createProjectBriefMission}
          onUpdateProjectExecution={updateProjectExecution}
          onExecuteProject={executeProjectMission}
          onRollbackToEntry={rollbackToJournalEntry}
          onApproveCategory={approveCommandCategory}
          onApproveCommand={approveExactCommand}
          onSelectMission={(missionId) => {
            setSelectedArtifactId(null);
            setWorkspace((current) => ({ ...current, activeMissionId: missionId }));
          }}
        />
        <StatusBar attachmentCount={mission.attachments.length + stagedAttachments.length} statusText={statusText} />
      </div>
    </>
  );
}

function attachmentsFromMessages(messages: WorkspaceNote[]) {
  const merged = new Map<string, WorkspaceAttachment>();

  messages.forEach((message) => {
    message.attachments?.forEach((attachment) => merged.set(attachment.fileId, attachment));
  });

  return Array.from(merged.values());
}

/** Approval/clarification "Allow once" / "Deny" etc. actions replay as one of these synthetic control strings, generated internally — never typed by the user — so they're safe to recognize literally here without turning this into a general keyword-based intent classifier. */
function isApprovalReplyMessage(message: string) {
  return /^(approved:\s*run\s|denied approval to run\s)/i.test(message.trim());
}

function classifyProjectFollowUp(message: string, isBusy: boolean, pendingCommandApproval = false): "hardStop" | "queue" | "run" | "resolvePending" {
  const text = message.trim().toLowerCase();
  if (isBusy && /^(stop|halt|cancel|wait[, ]+stop)\b/.test(text)) return "hardStop";
  if (isBusy) return "queue";
  if (pendingCommandApproval && !isApprovalReplyMessage(message) && !/^(stop|halt|cancel)\b/.test(text)) return "resolvePending";
  return "run";
}

async function resolveProjectMessageIntent(mission: MissionState, message: string): Promise<ProjectMessageIntentResolution> {
  try {
    const response = await fetch("/api/factory/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        mode: readStoredModelMode(),
        context: projectIntentContextForMission(mission),
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; intent?: unknown; continuity?: unknown; clarifyingQuestion?: unknown; clarifyingOptions?: unknown }
      | null;
    const modelIntent = normalizeProjectMessageIntent(payload?.intent);
    if (response.ok && payload?.ok && modelIntent) {
      const continuity =
        payload.continuity === "carry_forward_plan" || payload.continuity === "fresh_plan" ? payload.continuity : "not_applicable";
      const clarifyingOptions = Array.isArray(payload.clarifyingOptions)
        ? payload.clarifyingOptions.map((option) => String(option).trim()).filter(Boolean).slice(0, 4)
        : [];
      return { intent: modelIntent, continuity, clarifyingQuestion: String(payload.clarifyingQuestion ?? "").trim(), clarifyingOptions };
    }
  } catch {
    // Fall through to the local fallback when the model-backed router is unavailable.
  }

  return { intent: classifyProjectMessageIntentFallback(message), continuity: "not_applicable", clarifyingQuestion: "", clarifyingOptions: [] };
}

function normalizeProjectMessageIntent(value: unknown): ProjectMessageIntent | null {
  return projectMessageIntents.find((intent) => intent === value) ?? null;
}

function isMutatingProjectIntent(intent: ProjectMessageIntent) {
  return intent === "edit" || intent === "debug" || intent === "undo" || intent === "continue";
}

function projectIntentContextForMission(mission: MissionState) {
  const execution = projectExecutionFromWorkspaceMission(mission);
  const activeExecution = getActiveExecutionMission(mission);
  const localConnector = localConnectorFromMission(mission);
  const source = localConnector?.url
    ? `local-agent:${localConnector.rootLabel || localConnector.url}`
    : browserFolderHandleIdFromMission(mission)
      ? "browser-folder"
      : localProjectPathFromMission(mission)
        ? `local-path:${localProjectPathFromMission(mission)}`
        : uploadedProjectFilesFromMission(mission).length
          ? "uploaded-copy"
          : projectExecutionPathFromMission(mission)
            ? `previous-execution:${projectExecutionPathFromMission(mission)}`
            : "unknown";

  return {
    missionTitle: mission.conversationTitle,
    objective: mission.objective,
    lastResult: mission.lastResult,
    source,
    execution: activeExecution
      ? {
          status: activeExecution.state,
          objective: activeExecution.source_requirements.join("\n"),
          blocker: activeExecution.blocked_reason,
          changedFiles: activeExecution.files_touched.map((file) => `${file.status ?? "changed"} ${file.path}${file.verified ? " (verified)" : " (unverified)"}`),
          checklist: activeExecution.plan.map((item) => ({
            label: item.label,
            status: item.status,
            evidence: item.evidence,
          })),
        }
      : execution
      ? {
          status: execution.status,
          objective: execution.objective,
          blocker: execution.blocker,
          changedFiles: execution.files.filter((file) => file.status === "created" || file.status === "edited").map((file) => `${file.status} ${file.path}`),
          checklist: execution.checklist?.map((item) => ({
            label: item.label,
            status: item.status,
            evidence: item.evidence,
          })),
        }
      : null,
    recentMissionMemory: mission.executionMissions.slice(-5).map((run) => ({
      task: run.source_requirements.join("\n") || run.title,
      status: run.state,
      summary: run.summary || run.blocked_reason,
      filesChanged: run.files_touched.map((file) => ({
        path: file.path,
        status: file.status,
        rationale: file.evidence,
      })),
      commandsRun: run.commands_run.map((command) => ({
        command: command.command,
        exitCode: command.exitCode,
      })),
    })),
  };
}

function classifyProjectMessageIntentFallback(message: string): ProjectMessageIntent {
  const text = message.trim().toLowerCase();
  if (/^(undo|revert|roll back|rollback)\b/.test(text) || /\bundo that\b/.test(text)) return "undo";
  if (
    /^(continue|keep going|resume|carry on)\b/.test(text) ||
    /\b(try (another|a different) approach|another approach|different approach|do (it|that) differently|let'?s try (this|that) differently)\b/.test(text)
  )
    return "continue";
  if (/\b(what changed|what did you change|show changes|status|last run|previous run|what happened|summary)\b/.test(text) && !hasEditVerb(text)) return "status";
  if (
    /\bwhy (did|do|does|would) you\b/.test(text) ||
    /\bwhy (was|is) (that|this|it)\b/.test(text) ||
    /\bwhat (exactly |precisely )?(fixed|caused|resolved|broke)\b/.test(text) ||
    /\bwhat was (the )?(fix|root cause|cause)\b/.test(text)
  )
    return "retrospective";
  if (isDiagnosticProjectRequest(text)) return isReadOnlyDiagnosticRequest(text) ? "diagnose" : "debug";
  if (/\b(can you see|what does .*do|what my project does|inspect|look at|review|explain|summarize|understand)\b/.test(text) && !hasEditVerb(text)) return "inspection";
  if (isExplicitProjectEditRequest(text)) return "edit";
  if (hasEditVerb(text)) return "edit";
  if (isVagueCreateOrEditRequest(text)) return "question";
  // A "Can/could/would/will you ...?" request is almost always a work request phrased politely,
  // even when its verb is misspelled or not in hasEditVerb's list (e.g. "mkae", "lighten", "tweak").
  // Only exclude phrasings that are clearly asking to look at or explain something, not change it.
  if (
    /^(can|could|would|will) you\b/.test(text) &&
    !/\b(explain|describe|tell me|show me|summarize|walk me through|check|confirm|verify|see|look|review|understand|find out)\b/.test(text)
  )
    return "edit";
  if (text.endsWith("?") && !hasEditVerb(text)) return /\b(failing|failed|error|bug|broken|why)\b/.test(text) ? "diagnose" : "question";
  if (/\b(why is|why does|failing|failed|error|bug|broken|crash|diagnose)\b/.test(text)) return isReadOnlyDiagnosticRequest(text) ? "diagnose" : "debug";
  return "edit";
}

function engineeringOpeningForTask(task: string, intent: ProjectMessageIntent, mission: MissionState) {
  void task;
  void mission;
  if (intent === "undo") return "Looking at the recent change to figure out what to undo.";
  if (intent === "continue") return "Picking up where we left off.";
  if (intent === "debug") return "Looking into this now.";
  return "Looking at the project now — I'll say more as soon as I know what's involved.";
}

function hasEditVerb(text: string) {
  return /\b(add|create|make|build|generate|implement|edit|change|update|modify|fix|repair|separate|split|extract|move|delete|remove|rename|refactor|install|allow|enable|wire|replace)\b/.test(text);
}

function isDiagnosticProjectRequest(text: string) {
  return (
    /\b(getting|seeing|hit|hitting|throws?|throwing|fails?|failing|failed|broken|crash(?:es|ing)?|bug|issue|problem|diagnose|debug)\b.{0,100}\b(error|exception|failure|failed|parse|parser|json|upload|request|response|stack|trace|console|terminal)\b/.test(text) ||
    /\b(error|exception|failure|failed|parse|parser|json|upload|request|response|stack trace|console error|terminal error)\b.{0,100}\b(when|while|after|during|on|in)\b/.test(text) ||
    /\b(upload failed|json parse|unexpected character|syntaxerror|typeerror|referenceerror|uncaught|stack trace|traceback|500|404|403|401)\b/.test(text)
  );
}

function isReadOnlyDiagnosticRequest(text: string) {
  const asksForFixInstructions =
    /\b(how (do|can|should) i fix|how to fix|tell me how to fix|what (do|should) i (change|fix|update)|what would fix|what's the fix|what is the fix)\b/.test(text);
  const asksForRootCause =
    /\b(figure out why|find out why|tell me why|explain why|diagnose|root cause|what'?s wrong|what is wrong|why is|why does|why am i|what causes|what caused|what is causing|what's causing)\b/.test(text);
  const asksToApplyRepair = /\b(fix this|fix it|repair this|repair it|apply the fix|make it work|resolve this|update the code|change the code|edit the file)\b/.test(text);
  return (asksForFixInstructions || asksForRootCause) && !asksToApplyRepair;
}

function isVagueCreateOrEditRequest(text: string) {
  if (/```/.test(text) || /\b(?:content|with contents?|write)\s*:/i.test(text)) return false;
  if (isExplicitProjectEditRequest(text)) return false;
  return /\b(create|add|write|make|generate)\b/.test(text) && /\b[\w./-]+\.[a-z0-9]{1,12}\b/i.test(text);
}

function isExplicitProjectEditRequest(text: string) {
  const mentionsCss = /\b(css|style|styles|stylesheet|styling)\b/.test(text);
  const mentionsJs = /\b(js|javascript|script|scripts)\b/.test(text);
  const asksForAssetSeparation =
    /\b(separate|split|extract|move)\b/.test(text) ||
    /\bseparate\s+files?\b/.test(text) ||
    /\bcreate\b.{0,80}\b(files?|stylesheet|script)\b/.test(text);
  const asksToRemoveInline = /\b(remove|delete|strip|take out)\b.{0,80}\b(inline|inlines|style|script)\b/.test(text);
  const asksForUxChange = /\b(modify|improve|make|change|update|polish)\b.{0,80}\b(ux|ui|style|styling|design|form|border|bordered|nicer|modern)\b/.test(text);

  return (mentionsCss && mentionsJs && (asksForAssetSeparation || asksToRemoveInline)) || asksForUxChange;
}

function projectStatusAnswer(mission: MissionState) {
  const activeExecution = mission.executionMissions.find((item) => item.id === mission.activeExecutionMissionId) ?? mission.executionMissions.at(-1);
  if (activeExecution) {
    const completed = activeExecution.plan.filter((item) => item.status === "completed");
    const remaining = activeExecution.plan.filter((item) => item.status !== "completed" && item.status !== "skipped");
    return [
      `Current mission: ${activeExecution.state}${activeExecution.state === "complete" && activeExecution.verification_status !== "passed" ? " (unverified)" : ""}.`,
      `Request: ${activeExecution.source_requirements.join("; ") || activeExecution.title}`,
      activeExecution.files_touched.length ? `Changed files: ${activeExecution.files_touched.map((file) => `${file.status ?? "changed"} ${file.path}`).join(", ")}` : "Changed files: none reported.",
      activeExecution.plan.length ? `Verified objective items: ${completed.length}/${activeExecution.plan.length}.` : "",
      remaining.length ? `Remaining: ${remaining.map((item) => item.label).join("; ")}` : "",
      activeExecution.commands_run.length ? `Commands: ${activeExecution.commands_run.map((command) => `${command.command} (exit ${command.exitCode ?? "-"})`).join("; ")}` : "",
      activeExecution.blocked_reason ? `Blocker: ${activeExecution.blocked_reason}` : "",
    ].filter(Boolean).join("\n");
  }
  const execution = projectExecutionFromWorkspaceMission(mission);
  if (!execution) return "No project execution has completed yet in this workspace.";
  const changed = execution.files.filter((file) => file.status === "created" || file.status === "edited");
  const completed = execution.checklist?.filter((item) => item.status === "completed") ?? [];
  const remaining = execution.checklist?.filter((item) => item.status === "blocked" || item.status === "pending") ?? [];
  return [
    `Last project run: ${execution.status}.`,
    execution.objective ? `Objective: ${execution.objective}` : "",
    `Project path: ${execution.projectPath}`,
    changed.length ? `Changed files: ${changed.map((file) => `${file.status} ${file.path}`).join(", ")}` : "Changed files: none reported.",
    execution.checklist?.length ? `Verified objective items: ${completed.length}/${execution.checklist.length}.` : "",
    remaining.length ? `Remaining: ${remaining.map((item) => item.label).join("; ")}` : "",
    execution.blocker ? `Blocker: ${execution.blocker}` : "",
  ].filter(Boolean).join("\n");
}

const retrospectiveStopWords = new Set([
  "why", "what", "did", "you", "change", "changed", "exactly", "precisely", "fixed", "fix", "caused", "cause", "resolved", "broke",
  "the", "a", "an", "was", "is", "did", "does", "would", "that", "this", "it", "to", "in", "of", "and", "or", "for", "on", "with",
]);

function significantWords(task: string): string[] {
  return task
    .toLowerCase()
    .replace(/[^\w\s.-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !retrospectiveStopWords.has(word));
}

/** Structured record of the mission this follow-up continues — sent verbatim to the server instead of a flattened prose digest, so the executor can act on real plan/decision state (see MissionParentContext). */
function parentMissionContextFor(mission: MissionState): MissionParentContext | undefined {
  const previous = mission.executionMissions.at(-1);
  if (!previous) return undefined;
  const narrative = previous.timeline.filter((event) => !event.internal && event.rationale);
  return {
    id: previous.id,
    state: previous.state,
    plan: previous.plan,
    files_touched: previous.files_touched.map((file) => ({
      path: file.path,
      status: file.status,
      diffSummary: file.diff ? diffLineSummary(file.diff) : undefined,
      verified: file.verified,
    })),
    commands_run: previous.commands_run.map((command) => ({
      command: command.command,
      exitCode: command.exitCode,
      approval_scope_label: command.approval_scope_label,
    })),
    decisions: narrative.filter((event) => event.tier === "decision").map((event) => event.rationale as string).slice(-10),
    findings: narrative.filter((event) => event.tier === "finding").map((event) => event.rationale as string).slice(-10),
    blocked_reason: previous.blocked_reason,
    summary: previous.summary,
  };
}

function diffLineSummary(diff: string): string {
  const added = (diff.match(/^\+ /gm) ?? []).length;
  const removed = (diff.match(/^- /gm) ?? []).length;
  return `+${added} -${removed} lines`;
}

function missionMemoryAnswer(mission: MissionState, task: string): string | null {
  const memory = mission.executionMissions ?? [];
  if (!memory.length) return null;

  const label = (run: ExecutionMission) => run.source_requirements.join("; ") || run.title;

  const mentionedFiles = Array.from(new Set((task.match(/\b[\w./-]+\.[a-z0-9]{1,12}\b/gi) ?? []).map((path) => path.toLowerCase())));
  for (const run of [...memory].reverse()) {
    const hit = run.files_touched.find((file) => mentionedFiles.some((name) => file.path.toLowerCase().endsWith(name)));
    if (hit) return `In "${label(run)}" I ${hit.status ?? "changed"} ${hit.path}. ${hit.evidence || run.summary}`;
  }

  const keywords = significantWords(task);
  if (!keywords.length) return null;
  for (const run of [...memory].reverse()) {
    const haystack = `${label(run)} ${run.summary} ${run.commands_run.map((cmd) => cmd.command).join(" ")}`.toLowerCase();
    if (keywords.some((keyword) => haystack.includes(keyword))) return `In "${label(run)}": ${run.summary}`;
  }

  return null;
}

function projectInspectionAnswerFromFiles(files: FactoryUploadedFile[], task: string) {
  const paths = files.map((file) => file.path.replace(/\\/g, "/"));
  const stack = detectProjectStackFromPaths(paths);
  const keyFiles = pickInspectionKeyFiles(files);
  const purpose = inferInspectionPurpose(files, stack);
  const askNext = /\b(can you|do you|what|why|how|see|tell|explain|inspect|look)\b/i.test(task)
    ? "Tell me what you want to change next, or ask me to inspect a specific file or behavior."
    : "What would you like Foundry to do next?";

  return [
    "I can see the project files.",
    "",
    `It appears to be a ${stack}.`,
    `What it seems to do: ${purpose}`,
    "",
    "Main files I inspected:",
    ...keyFiles.map((file) => `- ${file.path}${file.note ? `: ${file.note}` : ""}`),
    paths.length > keyFiles.length ? `- ${paths.length - keyFiles.length} more readable file${paths.length - keyFiles.length === 1 ? "" : "s"}.` : "",
    "",
    askNext,
  ].filter(Boolean).join("\n");
}

function detectProjectStackFromPaths(paths: string[]) {
  const lower = paths.map((item) => item.toLowerCase());
  if (lower.some((item) => /next\.config\.(js|mjs|ts)$/.test(item))) return "Next.js project";
  if (lower.some((item) => /vite\.config\.(js|ts)$/.test(item))) return "Vite project";
  if (lower.some((item) => item.endsWith("package.json"))) return "JavaScript project";
  if (lower.some((item) => item.endsWith(".html"))) return "static HTML/CSS/JS project";
  if (lower.some((item) => item.endsWith(".py"))) return "Python project";
  if (lower.some((item) => item.endsWith(".csproj") || item.endsWith(".sln"))) return ".NET project";
  return "software project";
}

function pickInspectionKeyFiles(files: FactoryUploadedFile[]) {
  const priority = [/package\.json$/i, /(^|\/)(index|main|app)\.html$/i, /(^|\/)(index|main|app)\.(js|jsx|ts|tsx)$/i, /README\.md$/i, /\.css$/i];
  return files
    .slice()
    .sort((a, b) => {
      const ai = priority.findIndex((pattern) => pattern.test(a.path));
      const bi = priority.findIndex((pattern) => pattern.test(b.path));
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.path.localeCompare(b.path);
    })
    .slice(0, 8)
    .map((file) => ({ path: file.path, note: inspectionFileRole(file.path) }));
}

function inspectionFileRole(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith("package.json")) return "project metadata and scripts";
  if (lower.endsWith(".html")) return "browser page/markup";
  if (lower.endsWith(".css")) return "styling";
  if (/\.(js|jsx|ts|tsx)$/.test(lower)) return "application logic";
  if (lower.endsWith("readme.md")) return "project documentation";
  return "";
}

function inferInspectionPurpose(files: FactoryUploadedFile[], stack: string) {
  const packageFile = files.find((file) => /(^|\/)package\.json$/i.test(file.path));
  if (packageFile) {
    try {
      const pkg = JSON.parse(packageFile.content) as { name?: string; description?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      if (pkg.description) return pkg.description;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) return "a Next.js web application";
      if (deps.vite || deps["@vitejs/plugin-react"] || deps.react) return "a React/Vite-style web application";
      if (pkg.scripts && Object.keys(pkg.scripts).length) return `a JavaScript project with ${Object.keys(pkg.scripts).join(", ")} script${Object.keys(pkg.scripts).length === 1 ? "" : "s"}`;
      if (pkg.name) return `a JavaScript package named ${pkg.name}`;
    } catch {
      // Fall through to path-based inference.
    }
  }
  if (stack.includes("HTML")) return "a static browser project with HTML, styling, and/or JavaScript";
  if (files.some((file) => /\.(js|jsx|ts|tsx)$/i.test(file.path))) return "a script-based JavaScript project";
  return "I can identify the structure, but there is not enough readable application code to confidently summarize behavior.";
}

function projectExecutionFromWorkspaceMission(mission: MissionState): FactoryProjectResult | null {
  const artifact = mission.createdArtifacts.find((item) => item.title === "Project Execution");
  if (!artifact) return null;
  try {
    return JSON.parse(artifact.body) as FactoryProjectResult;
  } catch {
    return null;
  }
}

function liveWorkEventsForTimeline(timeline: FactoryExecutionEvent[]) {
  const visible = timeline.filter((event) => !event.internal);
  const narrative = visible.filter((event) => event.tier === "finding" || event.tier === "decision" || event.tier === "flag");
  const source = narrative.length ? narrative : visible;
  return source.map((event) => event.narrative?.rationale || event.rationale || event.title);
}

function titleFromProjectBrief(brief: string) {
  const explicitTitle = brief.match(/^Create Project:\s*(.+)$/im)?.[1]?.trim();
  if (explicitTitle) return explicitTitle.slice(0, 80);

  const firstLine = brief
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return (firstLine || "New Project").replace(/^Create Project:\s*/i, "").slice(0, 80) || "New Project";
}

function factoryResultMessage(result: FactoryProjectResult) {
  const completed = result.checklist?.filter((item) => item.status === "completed") ?? [];
  const remaining = result.checklist?.filter((item) => item.status === "blocked" || item.status === "pending") ?? [];
  const changed = result.files.filter((file) => file.status === "created" || file.status === "edited");
  const summary = result.sessionSummary;
  const lines = [
    summary?.outcome ? `Outcome: ${summary.outcome}` : result.objective ? `Objective: ${result.objective}` : `Factory execution ${result.status}.`,
    "",
    `Project path: ${result.projectPath}`,
    result.sourceMode ? `Source mode: ${result.sourceMode}` : "",
    summary?.changes.length ? `Behavior changes: ${summary.changes.join("; ")}` : "",
    summary?.preserved.length ? `Preserved: ${summary.preserved.join("; ")}` : "",
    summary?.flags.length ? `Flags: ${summary.flags.join("; ")}` : "",
    `Changed files: ${changed.length ? changed.map((file) => `${file.status} ${file.path}`).join("; ") : "none"}`,
    result.checklist?.length ? `Completed: ${completed.length}/${result.checklist.length}` : "",
    completed.length ? `Completed items: ${completed.map((item) => item.label).join("; ")}` : "",
    remaining.length ? `Remaining: ${remaining.map((item) => item.label).join("; ")}` : "",
    result.previewUrl ? `Preview URL: ${result.previewUrl}` : "",
    result.blocker ? `Blocker: ${result.blocker}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}

function executionMissionFromResult(mission: MissionState, result: FactoryProjectResult, task: string, existing?: ExecutionMission): ExecutionMission {
  const now = new Date().toISOString();
  const verification = result.verification ?? [];
  const { state, verification_status } = computeMissionState({ rawStatus: result.status, blocker: result.blocker, verification });
  const filesTouched = result.files
    .filter((file) => file.status === "created" || file.status === "edited")
    .map((file) => {
      const matchingEvent = [...(result.timeline ?? [])].reverse().find((event) => event.filePath === file.path && (event.kind === "edit" || event.kind === "file"));
      const verified = verification.some((item) => item.evidence.includes(file.path)) || Boolean(matchingEvent?.status === "completed");
      return {
        path: file.path,
        diff: matchingEvent?.output,
        verified,
        status: file.status,
        evidence: matchingEvent?.rationale || matchingEvent?.title,
      };
    });
  const blockedReason = result.blocker || (state === "complete" ? undefined : result.checklist?.find((item) => item.status === "blocked")?.evidence);
  const humanSummary = result.sessionSummary?.outcome || (state === "complete" && verification.length ? factoryResultMessage(result) : "");
  const pendingMockReview =
    result.status === "awaiting-mock-approval"
      ? { message: result.blocker || "The first working mock is ready for review.", preview_url: result.previewUrl }
      : undefined;
  return {
    id: existing?.id ?? `execution-${Date.now()}`,
    title: taskTitle(task, result),
    source_requirements: [task],
    state,
    verification_status,
    plan: result.checklist ?? existing?.plan ?? [],
    files_touched: filesTouched,
    commands_run: (result.commands ?? []).map((command) => ({
      ...command,
      approved_by: command.approvalScope ? ("user" as const) : ("auto-safe" as const),
      approval_scope_label: approvalScopeLabel(command.approvalScope),
    })),
    verification,
    blocked_reason: blockedReason,
    pending_mock_review: pendingMockReview,
    preview_url: result.previewState === "ready" ? result.previewUrl : existing?.preview_url,
    undo_snapshot: existing?.undo_snapshot,
    summary: humanSummary,
    parent_mission_id: existing?.parent_mission_id,
    request_message_id: existing?.request_message_id,
    result_message_id: existing?.result_message_id,
    timeline: result.timeline ?? existing?.timeline ?? [],
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}

/** A read-only Q&A request never runs the mission executor, so it has no checklist/files/commands — but it
 * still gets a real Mission entry so "Previous Missions" is one unified list instead of a separate plain-text
 * message count (Section 16). */
function executionMissionFromAnswer(task: string, answer: string, parentMissionId: string | undefined, resultMessageId: string): ExecutionMission {
  const now = new Date().toISOString();
  return {
    id: `execution-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: taskTitle(task),
    source_requirements: [task],
    state: "complete",
    verification_status: "unverified",
    plan: [],
    files_touched: [],
    commands_run: [],
    verification: [],
    blocked_reason: undefined,
    undo_snapshot: undefined,
    summary: answer,
    parent_mission_id: parentMissionId,
    request_message_id: undefined,
    result_message_id: resultMessageId,
    timeline: [],
    created_at: now,
    updated_at: now,
  };
}

function taskTitle(task: string, result?: FactoryProjectResult) {
  const source = task || result?.objective || result?.projectName || "Project mission";
  return source.replace(/^Current task:\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Project mission";
}

function updateActiveExecutionMission(mission: MissionState, patch: Partial<ExecutionMission>) {
  const activeId = mission.activeExecutionMissionId ?? mission.executionMissions.at(-1)?.id;
  if (!activeId) return mission.executionMissions;
  return mission.executionMissions.map((item) => (item.id === activeId ? { ...item, ...patch } : item));
}

function stateForLiveEvent(event: FactoryExecutionEvent, mission: MissionState): ExecutionMissionState {
  if (event.kind === "blocked" && event.command) return "waiting_for_approval";
  if (event.kind === "blocked") return "blocked";
  if (event.kind === "summary" && event.status === "error") return "blocked";
  if (event.kind === "summary" && event.status === "warning") return mission.activeExecutionMissionId ? "waiting_for_user" : "blocked";
  if (event.kind === "build" || event.kind === "preview") return "verifying";
  if (event.kind === "planning") return "planning";
  return "executing";
}

function stateForTimeline(timeline: FactoryExecutionEvent[], mission: MissionState): ExecutionMissionState {
  const last = [...timeline].reverse().find((event) => !event.internal);
  return last ? stateForLiveEvent(last, mission) : "executing";
}

function shouldAutoExecuteProjectBrief(brief: string) {
  // New-project briefs always carry a full discovery memo by the time the wizard
  // reaches "Looks good — build it", so execution should start regardless of
  // whether the optional custom-instructions step was filled in.
  return !/^Mode:\s*Work on existing project/im.test(brief);
}

function uploadedProjectFilesFromMission(mission: MissionState): FactoryUploadedFile[] {
  const artifact = mission.createdArtifacts.find((item) => item.title === "Uploaded Project Files");
  if (!artifact) return [];
  try {
    const parsed = JSON.parse(artifact.body) as FactoryUploadedFile[];
    return Array.isArray(parsed)
      ? parsed.filter((file) => typeof file.path === "string" && typeof file.content === "string")
      : [];
  } catch {
    return [];
  }
}

function browserFolderHandleIdFromMission(mission: MissionState) {
  return mission.objective.match(/^Browser folder handle id:\s*(.+)$/im)?.[1]?.trim() ?? "";
}

function localProjectPathFromMission(mission: MissionState) {
  return mission.objective.match(/^Local project path:\s*(.+)$/im)?.[1]?.trim() ?? "";
}

function localConnectorFromMission(mission: MissionState) {
  const url = mission.objective.match(/^Local connector URL:\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (!url) return undefined;
  const token = mission.objective.match(/^Local connector token:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const rootLabel = mission.objective.match(/^Local connector root:\s*(.+)$/im)?.[1]?.trim() ?? "";
  return { url, token, rootLabel };
}

function projectExecutionPathFromMission(mission: MissionState) {
  const artifact = mission.createdArtifacts.find((item) => item.title === "Project Execution");
  if (!artifact) return "";
  try {
    const result = JSON.parse(artifact.body) as FactoryProjectResult;
    return result.projectPath || "";
  } catch {
    return "";
  }
}

function existingProjectOpenMessage(brief: string) {
  if (/^Local connector URL:\s*.+$/im.test(brief)) return "Existing project workspace opened. Local agent connected: commands run for real against your actual project folder.";
  if (/^Browser folder handle id:\s*.+$/im.test(brief)) return "Existing project workspace opened. Connected (live folder): Foundry can edit this folder directly after browser permission.";
  if (/^Local project path:\s*.+$/im.test(brief)) return "Existing project workspace opened. Local folder path mode edits that folder directly.";
  return "Existing project workspace opened. Imported copies edit a Foundry workspace copy and must be exported.";
}

function safeParseTimeline(body: string): FactoryExecutionEvent[] {
  try {
    const parsed = JSON.parse(body) as FactoryExecutionEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseChecklist(body: string): FactoryProjectResult["checklist"] | null {
  try {
    const parsed = JSON.parse(body) as FactoryProjectResult["checklist"];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeParseExecutionResult(body: string): FactoryProjectResult | null {
  try {
    return JSON.parse(body) as FactoryProjectResult;
  } catch {
    return null;
  }
}

function mergeAttachments(...groups: WorkspaceAttachment[][]) {
  const merged = new Map<string, WorkspaceAttachment>();
  groups.flat().forEach((attachment) => merged.set(attachment.fileId, attachment));
  return Array.from(merged.values());
}

function resetMissionToMessages(mission: MissionState, messages: WorkspaceNote[], resetDerivedState: boolean): MissionState {
  const firstHumanMessage = messages.find((message) => message.tone === "human" && message.body.trim());
  const latestHumanMessage = [...messages].reverse().find((message) => message.tone === "human" && message.body.trim());
  const classification = firstHumanMessage ? classifyMessage(firstHumanMessage.body, createInitialMission()) : undefined;
  const objective = firstHumanMessage?.body ?? "";
  const outcome = classification?.outcome ?? mission.desiredOutcome;

  return {
    ...mission,
    objective: resetDerivedState ? objective : mission.objective,
    desiredOutcome: resetDerivedState ? outcome : mission.desiredOutcome,
    artifactType: resetDerivedState ? outcome : mission.artifactType,
    messages,
    attachments: attachmentsFromMessages(messages),
    createdArtifacts: mission.createdArtifacts.filter((artifact) => messages.some((message) => message.id === artifact.sourceMessageId)),
    sources: resetDerivedState ? [] : mission.sources,
    lastResult: resetDerivedState ? "" : mission.lastResult,
    workMemory: resetDerivedState
      ? {
          currentGoal: objective,
          currentBlocker: "",
          completedWork: [],
          resolvedErrors: [],
          rejectedHypotheses: [],
          latestEvidence: [],
          relevantFiles: attachmentsFromMessages(messages).map((attachment) => attachment.fileName),
          recommendedNextAction: "",
          summary: "Working memory reset after editing the message history.",
          updatedAt: new Date().toISOString(),
        }
      : mission.workMemory,
    followUpContext: resetDerivedState
      ? {
          type: messages.length <= 1 ? "newMission" : "followUp",
          summary: latestHumanMessage ? "Recomputed from the edited message history." : "Ready for a new work item.",
        }
      : mission.followUpContext,
    liveWorkEvents: resetDerivedState ? [] : mission.liveWorkEvents,
    updatedAt: new Date().toISOString(),
  };
}

function canAppendAnswerForRequest(mission: MissionState, noteId: string, body: string) {
  const noteIndex = mission.messages.findIndex((message) => message.id === noteId);
  if (noteIndex < 0) return false;

  const note = mission.messages[noteIndex];
  if (note.tone !== "human" || note.body !== body) return false;

  return noteIndex === mission.messages.length - 1;
}

function upsertVisualArtifactMessage(mission: MissionState, body: string, visual: VisualArtifact, now: Date) {
  const existingMessage = [...mission.messages].reverse().find((message) => message.visualArtifact?.artifactId === visual.artifactId);

  if (!existingMessage) {
    return appendAssistantMessage(mission, body, now, [], visual);
  }

  const updatedMessage: WorkspaceNote = {
    ...existingMessage,
    body,
    time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    visualArtifact: visual,
  };
  const existingArtifact = mission.createdArtifacts.find((artifact) => artifact.sourceMessageId === existingMessage.id);
  const updatedArtifact: CreatedArtifact = existingArtifact
    ? {
        ...existingArtifact,
        title: visual.title,
        body,
        description: `${visual.title} version ${visual.version}.`,
        visualArtifact: visual,
        createdAt: now.toISOString(),
      }
    : {
        id: `artifact-${existingMessage.id}`,
        sourceMessageId: existingMessage.id,
        type: mission.desiredOutcome,
        kind: visual.kind === "diagram" ? "diagram" : "sketch",
        title: visual.title,
        body,
        description: `${visual.title} version ${visual.version}.`,
        visualArtifact: visual,
        createdAt: now.toISOString(),
      };

  return {
    ...mission,
    messages: mission.messages.map((message) => (message.id === existingMessage.id ? updatedMessage : message)),
    createdArtifacts: existingArtifact
      ? mission.createdArtifacts.map((artifact) => (artifact.sourceMessageId === existingMessage.id ? updatedArtifact : artifact))
      : [updatedArtifact, ...mission.createdArtifacts],
    lastResult: body,
    liveWorkEvents: ["Understanding visual request", "Creating layout", "Rendering preview", "Preparing actions"],
    updatedAt: now.toISOString(),
  };
}

function progressStepsFor(message: string, mission: MissionState) {
  const questionPreview = summarizeForProgress(message);
  const currentMessage = [...mission.messages].reverse().find((note) => note.tone === "human" && note.body === message);
  const currentAttachments = currentMessage?.attachments ?? [];

  if (shouldShowVisualProgress(message, mission)) {
    return ["Understanding visual request", "Creating layout", "Rendering preview", "Preparing actions", "Ready"];
  }

  if (currentAttachments.length > 0) {
    const hasImageAttachment = currentAttachments.some((attachment) => attachment.uploadStatus === "image");
    const hasMultipleAttachments = currentAttachments.length > 1 || mission.attachments.length > currentAttachments.length;

    if (hasImageAttachment) {
      return [
        `Reading your screenshot for "${questionPreview}"`,
        "Inspecting visible text and UI details",
        hasMultipleAttachments ? "Comparing it with earlier evidence in this work item" : "Checking the screenshot against this thread's context",
        "Preparing an answer from the visual evidence",
        "Answer ready",
      ];
    }

    return [
      `Reading your latest attachment for "${questionPreview}"`,
      "Extracting relevant evidence from the attachment",
      hasMultipleAttachments ? "Comparing new evidence with previous files" : "Decoding file content where possible",
      "Preparing an answer from the evidence",
      "Answer ready",
    ];
  }

  if (needsVerifiedSources(message, mission)) {
    return [
      `Reading "${questionPreview}"`,
      "Checking whether verified sources are needed",
      "Searching verified sources",
      "Reviewing source pages",
      "Preparing a sourced answer",
      "Answer ready",
    ];
  }

  if (isTechnicalDesignQuestion(message)) {
    return ["Understanding requirements", "Choosing data structures", "Checking concurrency tradeoffs", "Preparing final design", "Answer ready"];
  }

  if (isInstructionQuestion(message)) {
    return ["Understanding the goal", "Choosing the recommended path", "Checking prerequisites and options", "Preparing steps and verification", "Answer ready"];
  }

  return [`Reading "${questionPreview}"`, "Checking this thread's context", "Preparing the answer", "Answer ready"];
}

function shouldUseReasoningForTurn(message: string, nextMission: MissionState, previousMission: MissionState) {
  if (looksLikeDiagnosticPaste(message)) return true;
  if (nextMission.attachments.some((attachment) => previousMission.attachments.every((previous) => previous.fileId !== attachment.fileId))) return true;
  if (isInstructionQuestion(message)) return true;
  if (isFocusedFollowUpQuestion(message)) return true;
  if (previousMission.messages.length > 0) return true;

  return false;
}

function isTechnicalDesignQuestion(message: string) {
  const text = message.toLowerCase();
  const asksDesign = /\b(how would|how should|design|architect|approach|implement|build)\b/.test(text);
  const technicalTopic = /\b(cache|lru|concurrency|thread|threads|multithread|lock|mutex|data structure|algorithm|system design|database|queue|worker|api|service|memory|performance|complexity|o\([^)]+\))\b/.test(
    text,
  );

  return asksDesign && technicalTopic;
}

function isInstructionQuestion(message: string) {
  return /\b(how do i|how to|step by step|steps?|instructions?|walkthrough|guide|setup|set up|install|configure|integrate|migrate)\b/i.test(message) || hasRecommendationFollowUpShape(message);
}

function isFocusedFollowUpQuestion(message: string) {
  const text = message.trim().toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 10 && text.endsWith("?")) return true;
  if (hasFollowUpIntentShape(message)) return true;
  if (/\b(recommend|advise|suggest|which|better|best|should i|would you|what about|how about|elaborate|explain|is this correct|does this fix|verify|what changed)\b/.test(text)) {
    return true;
  }
  if (message.split(/\r?\n/).filter((line) => line.trim()).length > 1 && /[?]\s*$/.test(text)) return true;

  return false;
}

function shouldCreateVisualArtifact(message: string, nextMission: MissionState, previousMission: MissionState) {
  if (isBuildRequest(message)) return false;
  if (isTextVisualFormatRequest(message)) return false;
  if (isExplicitVisualArtifactRequest(message)) return true;
  return Boolean((latestVisualArtifact(nextMission) || latestVisualArtifact(previousMission)) && shouldReviseExistingVisual(message));
}

function shouldShowVisualProgress(message: string, mission: MissionState) {
  if (isBuildRequest(message)) return false;
  if (isTextVisualFormatRequest(message)) return false;
  return isExplicitVisualArtifactRequest(message) || Boolean(latestVisualArtifact(mission) && shouldReviseExistingVisual(message));
}

function shouldForceVisualResponse(message: string, mission: MissionState) {
  if (isBuildRequest(message)) return false;
  if (isTextVisualFormatRequest(message)) return false;
  if (isExplicitVisualArtifactRequest(message)) return true;
  if (latestVisualArtifact(mission) && shouldReviseExistingVisual(message)) return true;

  return false;
}

function latestVisualArtifact(mission: MissionState) {
  return (
    [...mission.messages].reverse().find((message) => message.visualArtifact)?.visualArtifact ??
    mission.createdArtifacts.find((artifact) => artifact.visualArtifact)?.visualArtifact
  );
}

function isBuildRequest(message: string) {
  return /\b(build it|build this|build selected|create project|turn this into|make this real)\b/i.test(message);
}

function summarizeForProgress(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= 64) return normalized;
  return `${normalized.slice(0, 61).trim()}...`;
}

function needsVerifiedSources(message: string, mission?: MissionState) {
  const text = message.toLowerCase();
  const intentText = verifiedSourceIntentTextOutsideTranscript(message);
  const explicitIntent = hasExplicitVerifiedSourceIntent(intentText || message);
  if (looksLikeDiagnosticPaste(message) && !explicitIntent) return false;
  if (looksLikeTechnicalTranscript(message) && !hasExplicitVerifiedSourceIntent(intentText)) return false;
  if (/\bsource\s+(code|access|folder|file|files|module|sdk|project|package|tree|repo|repository)\b/i.test(message)) return false;
  const sourceFollowUpWords = ["that source", "that page", "the page", "the docs", "those docs", "same source", "the link"];

  return (
    explicitIntent ||
    Boolean(mission?.sources?.length && sourceFollowUpWords.some((word) => text.includes(word)) && explicitIntent)
  );
}

function hasExplicitVerifiedSourceIntent(message: string) {
  const sourcePhrase =
    /\b(look this up|search (?:the )?(?:web|online)|verify online|verify with sources|cite sources?|official docs?|official link|official url|docs url|docs link|documentation url|release notes?|changelog|download link|sample template|sample file)\b/i;
  const sourceTopic =
    /\b(docs?|documentation|sources?|citations?|release notes?|changelog|vendor|api requirements?|templates?|downloads?|import guide|sample files?|sample templates?|urls?|links?)\b/i;
  const sourceAction =
    /\b(find|send|give|open|show|need|want|search|look up|verify|cite|download|get|where(?:'s| is| can)?|what(?:'s| is)?)\b/i;
  const currentInfo =
    /\b(latest|current|today|newest|most recent)\b.{0,80}\b(version|release|docs?|documentation|url|link|requirements?|changelog|download|template|pricing|status)\b|\b(version|release|docs?|documentation|url|link|requirements?|changelog|download|template|pricing|status)\b.{0,80}\b(latest|current|today|newest|most recent)\b/i;

  return sourcePhrase.test(message) || (sourceAction.test(message) && sourceTopic.test(message)) || (sourceAction.test(message) && currentInfo.test(message));
}

function verifiedSourceIntentTextOutsideTranscript(message: string) {
  return message
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:PS\s+[A-Z]:\\|[A-Z]:\\|>|FAILURE:|BUILD FAILED|\* |Warning:|Certificate |Do you still want|Run with|Get more help|Install the latest PowerShell)/i.test(line))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeTechnicalTranscript(message: string) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  return [
    /^\s*(PS\s+[A-Z]:\\|[A-Z]:\\|>\s*)/i,
    /\bgradlew(?:\.bat)?\b/i,
    /\bGradle\s+\d+(?:\.\d+)?/i,
    /\bJava home\b/i,
    /\bJVM:\b/i,
    /\bOS:\b/i,
    /\bKotlin:\b/i,
    /\bGroovy:\b/i,
    /\bAnt:\b/i,
    /\bLauncher JVM:\b/i,
    /\bDaemon JVM:\b/i,
    /\bDistribution URL:\b/i,
    /\bRevision:\b/i,
  ].some((pattern) => pattern.test(message));
}
