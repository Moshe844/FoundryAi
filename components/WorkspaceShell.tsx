"use client";

import { useEffect, useRef, useState } from "react";
import { createInitialMission } from "@/lib/mission-engine";
import type { CreatedArtifact, ExecutionMission, ExecutionMissionState, MissionState } from "@/lib/mission-engine";
import { computeMissionState, verificationStatusFrom } from "@/lib/mission/state";
import { deriveMissionDisplayStatus, getActiveExecutionMission } from "@/lib/mission/status";
import { BuildDashboard } from "@/components/BuildDashboard";
import { StatusBar } from "@/components/StatusBar";
import { TopBar } from "@/components/TopBar";
import { approvalScopeLabel } from "@/lib/ai/mission/command-permissions";
import { artifactKindForOutcome } from "@/lib/artifacts";
import { classifyEvidenceKind, ingestFile } from "@/lib/files";
import { executeBrowserFolderTask, getBrowserFolderHandle, readBrowserFolderFiles } from "@/lib/factory/browser-folder";
import type { FactoryExecutionEvent, FactoryExistingProjectRequest, FactoryProjectResult, FactoryUploadedFile, MissionParentContext, StructuredDiscovery } from "@/lib/factory/types";
import type { WorkspaceAttachment } from "@/lib/files";
import type { SourceReference } from "@/lib/sources/types";
import type { VisualArtifact } from "@/lib/visual-artifacts";
import { readStoredModelMode } from "@/lib/ai/model-mode";
import { readStoredMissionQuality } from "@/lib/ai/mission/quality-mode";
import {
  classifyFollowUpControl,
  fallbackFollowUpResolution,
  isApprovalReplyMessage,
  isBareContinuationMessage,
  normalizeFollowUpResolution,
  LatestFollowUpQueue,
} from "@/lib/mission/classifyFollowUp";
import type { FollowUpResolutionRecord, ProjectTurnIntent } from "@/lib/mission/classifyFollowUp";

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

type ProjectMessageIntent = ProjectTurnIntent;

const projectMessageIntents: ProjectMessageIntent[] = ["question", "inspection", "diagnose", "status", "debug", "edit", "undo", "continue", "retrospective", "clarify"];

type ProjectMessageIntentResolution = FollowUpResolutionRecord;

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

async function readPersistedWorkspace() {
  let indexedWorkspace: unknown;
  try {
    indexedWorkspace = await readWorkspaceFromIndexedDb();
  } catch {
    // Compare against the local mirror below when browser database storage is unavailable.
  }

  let localWorkspace: unknown;
  try {
    const stored = window.localStorage.getItem(missionStorageKey);
    localWorkspace = stored ? JSON.parse(stored) : undefined;
  } catch {
    localWorkspace = undefined;
  }

  if (!indexedWorkspace) return localWorkspace;
  if (!localWorkspace) return indexedWorkspace;
  return workspaceFreshness(localWorkspace) > workspaceFreshness(indexedWorkspace) ? localWorkspace : indexedWorkspace;
}

function workspaceFreshness(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const candidate = value as Partial<WorkspaceState> & Partial<MissionState>;
  const missions = Array.isArray(candidate.missions) ? candidate.missions : [candidate];
  return missions.reduce((freshest, mission) => {
    const timestamps = [mission.updatedAt, mission.createdAt, ...(mission.executionMissions ?? []).map((item) => item.updated_at)];
    return Math.max(freshest, ...timestamps.map((item) => typeof item === "string" ? Date.parse(item) || 0 : 0));
  }, 0);
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
  const executionMissions = recoverOverwrittenFollowUpTurn(mission, normalizeExecutionMissions(mission), messages);

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
    executionMissions,
    activeExecutionMissionId: normalizeActiveExecutionMissionId({ ...mission, executionMissions }),
    messages,
  };
}

/**
 * Older carry-forward handling reused the previous ExecutionMission record for a normal follow-up.
 * The new request note remained persisted but unreferenced, while the first request disappeared from
 * the collapsed history. Recover that durable evidence on load by splitting the merged timeline at
 * the orphaned request timestamp. Future turns never enter this migration because they keep their
 * own pending execution record.
 */
function recoverOverwrittenFollowUpTurn(mission: MissionState, executions: ExecutionMission[], messages: WorkspaceNote[]): ExecutionMission[] {
  if (!executions.length) return executions;
  const referencedRequestIds = new Set(executions.map((item) => item.request_message_id).filter(Boolean));
  const orphanedRequests = messages.filter((message) =>
    message.author === "You"
    && message.tags?.includes("Project request")
    && !message.tags?.includes("Project brief")
    && !referencedRequestIds.has(message.id),
  );
  const orphanedRequest = orphanedRequests.at(-1);
  if (!orphanedRequest) return executions;

  const activeIndex = executions.findIndex((item) => item.id === mission.activeExecutionMissionId);
  const index = activeIndex >= 0 ? activeIndex : executions.length - 1;
  const active = executions[index];
  if (!active.request_message_id || active.request_message_id === orphanedRequest.id) return executions;

  const requestTimestamp = Number(orphanedRequest.id.match(/^message-(\d+)/)?.[1]);
  if (!Number.isFinite(requestTimestamp)) return executions;
  const requestIso = new Date(requestTimestamp).toISOString();
  const earlierTimeline = active.timeline.filter((event) => Date.parse(event.timestamp) < requestTimestamp);
  const followUpTimeline = active.timeline.filter((event) => Date.parse(event.timestamp) >= requestTimestamp);
  const priorTerminal = [...earlierTimeline].reverse().find((event) => event.kind === "summary");
  const priorFailed = priorTerminal?.status === "error";
  const priorId = `${active.id}-recovered-prior-${requestTimestamp}`;
  const prior: ExecutionMission = {
    ...active,
    id: priorId,
    state: priorFailed ? "failed" : "complete",
    verification_status: priorFailed ? "failed" : "passed",
    plan: [],
    files_touched: [],
    commands_run: [],
    approvals: [],
    verification: [],
    blocked_reason: priorFailed ? priorTerminal?.details?.reason as string | undefined : undefined,
    pending_mock_review: undefined,
    preview_url: undefined,
    summary: priorTerminal?.output || priorTerminal?.title || "Completed before the next project request.",
    timeline: earlierTimeline,
    updated_at: requestIso,
  };
  const current: ExecutionMission = {
    ...active,
    source_requirements: [orphanedRequest.body],
    parent_mission_id: priorId,
    request_message_id: orphanedRequest.id,
    timeline: followUpTimeline.length ? followUpTimeline : active.timeline,
    created_at: requestIso,
  };
  return [...executions.slice(0, index), prior, current, ...executions.slice(index + 1)];
}

function normalizeExecutionMissions(mission: MissionState): ExecutionMission[] {
  const existing = Array.isArray(mission.executionMissions) ? mission.executionMissions : [];
  if (existing.length) {
    return existing.map((item) => {
      const filesTouched = item.files_touched ?? [];
      const legacyProviderTimeout = item.state === "blocked"
        && /Model provider unavailable after retries:[\s\S]*(?:network request|timed?\s*out|timeout|aborted due to timeout)/i.test(item.blocked_reason ?? "");
      const legacyNoActionFailure = item.state === "blocked"
        && /Configured provider fallbacks did not produce a usable action[\s\S]*Model-call limit reached/i.test(item.blocked_reason ?? "");
      const migratedProviderReason = legacyProviderTimeout
        ? `AI providers were temporarily unreachable. ${filesTouched.length ? `${filesTouched.length} changed file${filesTouched.length === 1 ? " was" : "s were"} preserved, but the request was not fully verified.` : "No project files were changed."} The saved request can be retried.`
        : undefined;
      const migratedNoActionReason = legacyNoActionFailure
        ? "The model did not produce an executable edit within this request's call limit. Foundry stopped without making another paid recovery call; no approval is required, and the saved request can be retried."
        : undefined;
      const migratedFailureReason = migratedProviderReason ?? migratedNoActionReason;
      const timeline = item.timeline ?? [];
      const migratedTimeline = migratedFailureReason
        ? timeline.map((event) => event.title === "Mission blocked" && event.status === "error" ? {
            ...event,
            kind: "summary" as const,
            title: legacyNoActionFailure ? "No executable edit was produced" : "AI providers unavailable",
            output: migratedFailureReason,
            details: { ...(event.details ?? {}), reason: migratedFailureReason, retryable: true },
          } : event)
        : timeline;
      return {
        ...item,
        state: legacyProviderTimeout || legacyNoActionFailure ? "failed" as const : item.state,
        blocked_reason: migratedFailureReason ?? item.blocked_reason,
        summary: migratedFailureReason ?? item.summary,
        source_requirements: item.source_requirements ?? [],
        verification_status: item.verification_status ?? verificationStatusFrom(item.verification ?? []),
        plan: item.plan ?? [],
        files_touched: filesTouched,
        commands_run: item.commands_run ?? [],
        verification: item.verification ?? [],
        timeline: migratedTimeline,
        created_at: item.created_at ?? mission.createdAt ?? new Date().toISOString(),
        updated_at: item.updated_at ?? mission.updatedAt ?? new Date().toISOString(),
      };
    });
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
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [hasLoadedMission, setHasLoadedMission] = useState(false);
  const [pendingWork, setPendingWork] = useState<PendingWork[]>([]);
  const [queuedTasks, setQueuedTasks] = useState<Record<string, { task: string; evidenceAttachments: WorkspaceAttachment[] }>>({});
  const queuedTasksRef = useRef(new LatestFollowUpQueue<{ task: string; evidenceAttachments: WorkspaceAttachment[] }>());
  const [approvedCommandCategories, setApprovedCommandCategories] = useState<Record<string, string[]>>({});
  const [approvedCommands, setApprovedCommands] = useState<Record<string, string[]>>({});
  const [hasLoadedApprovals, setHasLoadedApprovals] = useState(false);
  const activeControllersRef = useRef(new Map<string, AbortController>());
  const activeControlIdsRef = useRef(new Map<string, string>());
  const recoveryHandledRef = useRef(false);
  const mission = workspace.missions.find((item) => item.missionId === workspace.activeMissionId) ?? workspace.missions[0];
  const activeProgress = pendingWork.filter((item) => item.missionId === mission.missionId);
  // A mission with any ExecutionMission turns is the project/execution canvas — its footer status must
  // always be the same canonical derivation as the header pill and composer, never the legacy simulated
  // "typing" steps below (those exist only for the plain-chat path, which has no ExecutionMission turns).
  // Letting pendingWork override it here was one of four independently-computed status strings that could
  // disagree with each other (header said "Working", footer said "Ready", or vice versa).
  const statusText = mission.executionMissions.length
    ? deriveMissionDisplayStatus(mission).label
    : (activeProgress.length ? "Request in progress" : "Ready");

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

  useEffect(() => {
    if (!hasLoadedMission || recoveryHandledRef.current) return;
    recoveryHandledRef.current = true;

    const persisted = workspaceRef.current;
    const interrupted = persisted.missions.filter((item) => {
      const active = getActiveExecutionMission(item);
      return active && ["understanding", "planning", "executing", "verifying"].includes(active.state);
    });
    if (!interrupted.length && !persisted.missions.some((item) => item.pendingFollowUp)) return;

    void (async () => {
      // Reload/navigation must not be interpreted as an explicit Stop action.

      const recoveredAt = new Date().toISOString();
      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) => {
          const active = getActiveExecutionMission(item);
          const wasInterrupted = Boolean(active && ["understanding", "planning", "executing", "verifying"].includes(active.state));
          const pending = item.pendingFollowUp;
          return {
            ...item,
            executionMissions: wasInterrupted
              ? updateActiveExecutionMission(item, {
                  state: "executing",
                  blocked_reason: undefined,
                  summary: "Reconnecting to the server execution after page reload.",
                  updated_at: recoveredAt,
                })
              : item.executionMissions,
            activeExecutionMissionId: item.activeExecutionMissionId,
            pendingClarification: pending
              ? {
                  question: `A queued instruction survived the reload: “${pending.task}”. Continue it now?`,
                  options: ["Continue queued instruction", "Discard it"],
                  originalTask: pending.task,
                }
              : item.pendingClarification,
            pendingFollowUp: undefined,
            liveWorkEvents: [],
            updatedAt: wasInterrupted || pending ? recoveredAt : item.updatedAt,
          };
        }),
      }));
    })();

    for (const interruptedMission of interrupted) {
      void (async () => {
        const interruptedExecution = getActiveExecutionMission(interruptedMission);
        const controlId = interruptedExecution?.control_id;
        if (!controlId) {
          const missingAt = new Date().toISOString();
          setWorkspace((current) => ({
            ...current,
            missions: current.missions.map((mission) => mission.missionId === interruptedMission.missionId ? {
              ...mission,
              executionMissions: updateActiveExecutionMission(mission, {
                state: "cancelled",
                blocked_reason: undefined,
                summary: "The previous execution was interrupted before a recoverable server snapshot was recorded. No work was replayed automatically.",
                updated_at: missingAt,
              }),
              updatedAt: missingAt,
            } : mission),
          }));
          return;
        }
        while (true) {
          const response = await fetch(`/api/factory/execution?controlId=${encodeURIComponent(controlId)}`, { cache: "no-store" }).catch(() => undefined);
          if (!response?.ok) {
            const missingAt = new Date().toISOString();
            setWorkspace((current) => ({
              ...current,
              missions: current.missions.map((mission) => mission.missionId === interruptedMission.missionId ? {
                ...mission,
                executionMissions: updateActiveExecutionMission(mission, {
                  state: "cancelled",
                  blocked_reason: undefined,
                  summary: "The previous execution was interrupted by a server restart. No work was replayed automatically.",
                  updated_at: missingAt,
                }),
                updatedAt: missingAt,
              } : mission),
            }));
            return;
          }
          const snapshot = await response.json() as {
            state: "running" | "completed" | "failed" | "stopped";
            events?: FactoryExecutionEvent[];
            result?: FactoryProjectResult;
            error?: string;
          };
          for (const event of snapshot.events ?? []) appendProjectExecutionEvent(interruptedMission.missionId, event);
          if (snapshot.state === "running") {
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
            continue;
          }
          if (snapshot.state === "completed" && snapshot.result) {
            updateProjectExecution(interruptedMission.missionId, snapshot.result);
            return;
          }
          const finishedAt = new Date().toISOString();
          setWorkspace((current) => ({
            ...current,
            missions: current.missions.map((mission) => mission.missionId === interruptedMission.missionId ? {
              ...mission,
              executionMissions: updateActiveExecutionMission(mission, {
                state: snapshot.state === "stopped" ? "cancelled" : "blocked",
                blocked_reason: snapshot.error ?? (snapshot.state === "stopped" ? "Stopped by user." : "Execution failed after reconnection."),
                summary: snapshot.error ?? "Recovered execution did not complete.",
                updated_at: finishedAt,
              }),
              updatedAt: finishedAt,
            } : mission),
          }));
          return;
        }
      })();
    }
  }, [hasLoadedMission]);

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

  async function executeProjectMission(missionId: string, task: string, approvalResponse?: FactoryExistingProjectRequest["approvalResponse"], evidenceFiles: File[] = []) {
    const targetMission = workspaceRef.current.missions.find((item) => item.missionId === missionId);
    const recoveryQuestion = targetMission?.pendingClarification?.question.startsWith("A queued instruction survived the reload:");
    if (recoveryQuestion && /^Discard it\b/i.test(task.trim())) {
      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) => item.missionId === missionId
          ? { ...item, pendingClarification: undefined, pendingFollowUp: undefined, lastResult: "Queued instruction discarded without execution.", updatedAt: new Date().toISOString() }
          : item),
      }));
      return;
    }
    if (recoveryQuestion && /^Continue queued instruction\b/i.test(task.trim()) && targetMission?.pendingClarification) {
      task = targetMission.pendingClarification.originalTask;
    }
    const evidenceAttachments = evidenceFiles.length ? await Promise.all(evidenceFiles.map((file) => ingestFile(file, missionId))) : [];
    const activeExecution = targetMission ? getActiveExecutionMission(targetMission) : undefined;
    // A reload intentionally detaches the browser's fetch controller while the server keeps the
    // mission alive. Treat the recovered persisted execution state as busy too; otherwise the
    // visible Stop button submits the literal word "stop" as a brand-new mission after reload.
    const isBusy = activeControllersRef.current.has(missionId)
      || ["understanding", "planning", "executing", "verifying", "reconnecting"].includes(activeExecution?.state ?? "");
    // Only a blocked-command approval genuinely requires one of the button-generated synthetic
    // replies — arbitrary text can't resolve "should this shell command run?". A "waiting_for_user"
    // pause (a clarification question, or mock-review feedback) is the opposite: typed free text is
    // exactly the expected resolution, so it must flow straight through to "run", not get parked here.
    const pendingCommandApproval = activeExecution?.state === "waiting_for_approval";
    const followUp = classifyFollowUpControl({ message: task, isBusy, pendingApproval: pendingCommandApproval, hasApprovalResponse: Boolean(approvalResponse) });

    if (followUp === "hard_stop") {
      const activeControlId = activeControlIdsRef.current.get(missionId) ?? activeExecution?.control_id;
      await fetch("/api/factory/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ controlId: activeControlId ?? missionId }),
      }).catch(() => undefined);
      activeControllersRef.current.get(missionId)?.abort();
      queuedTasksRef.current.clear(missionId);
      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) => item.missionId === missionId ? { ...item, pendingFollowUp: undefined } : item),
      }));
      setQueuedTasks((current) => {
        const next = { ...current };
        delete next[missionId];
        return next;
      });
      return;
    }

    if (followUp === "queue") {
      queuedTasksRef.current.replace(missionId, { task, evidenceAttachments });
      setQueuedTasks((current) => ({ ...current, [missionId]: { task, evidenceAttachments } }));
      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) => item.missionId === missionId
          ? { ...item, pendingFollowUp: { task, evidenceAttachments, queuedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() }
          : item),
      }));
      return;
    }

    if (followUp === "resolve_approval") {
      appendProjectFollowUpNote(
        missionId,
        task,
        "There's a pending command approval on this mission — use Allow once, Allow for this project, Always allow, or Deny above before sending a new request.",
      );
      return;
    }

    await executeProjectMissionNow(missionId, task, approvalResponse, evidenceAttachments);

    let queuedTask = takeQueuedTask(missionId);
    while (queuedTask) {
      await executeProjectMissionNow(missionId, queuedTask.task, undefined, queuedTask.evidenceAttachments);
      queuedTask = takeQueuedTask(missionId);
    }
  }

  function takeQueuedTask(missionId: string) {
    const queued = queuedTasksRef.current.take(missionId);
    if (!queued) return undefined;
    setQueuedTasks((current) => {
      if (current[missionId]?.task !== queued.task) return current;
      const next = { ...current };
      delete next[missionId];
      return next;
    });
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) => item.missionId === missionId ? { ...item, pendingFollowUp: undefined } : item),
    }));
    return queued;
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

  async function executeProjectMissionNow(missionId: string, task: string, approvalResponse?: FactoryExistingProjectRequest["approvalResponse"], evidenceAttachments: WorkspaceAttachment[] = []) {
    const targetMission = workspaceRef.current.missions.find((item) => item.missionId === missionId);
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
      attachments: evidenceAttachments,
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
              attachments: mergeAttachments(item.attachments, evidenceAttachments),
              executionMissions: [
                ...item.executionMissions,
                createPendingExecutionMission(item, task, requestNote.id),
              ],
              activeExecutionMissionId: pendingExecutionId,
              // Any new turn supersedes a still-open clarify prompt — whether this turn IS the answer
              // (resolved via DecisionPrompt) or an unrelated new message that makes the question moot.
              pendingClarification: undefined,
              // The request itself is visible above. Activity stays empty until the runtime emits a
              // real event; an honest quiet gap is preferable to a scripted progress claim.
              liveWorkEvents: [],
              updatedAt: requestedAt.toISOString(),
            }
          : item,
      ),
    }));

    const activeBeforeRequest = getActiveExecutionMission(targetMission);
    const resolvesExecutionDecisions = activeBeforeRequest?.state === "waiting_for_user" && /^Resolved project decisions:/i.test(task.trim());
    const explicitMissionContinuation = Boolean(
      activeBeforeRequest
      && isBareContinuationMessage(task)
      && executionNeedsContinuation(activeBeforeRequest),
    );
    const context = projectIntentContextForMission(targetMission);
    const resolvedIntent = approvalResponse
      ? { ...fallbackFollowUpResolution(task, context), currentIntent: "edit" as const, continuity: "carry_forward_plan" as const, referenceConfidence: 1, plannedAction: `Resolve the recorded approval decision for ${approvalResponse.requestedCommand}.` }
      : explicitMissionContinuation
        ? fallbackFollowUpResolution(task, context)
        : await resolveProjectMessageIntent(targetMission, task);
    const projectIntent = resolvesExecutionDecisions ? "edit" : resolvedIntent.currentIntent;
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

    const isExistingProjectPlan = /^Mode:\s*Work on existing project/im.test(targetMission.objective);

    const brief = `${targetMission.objective}\n\nCurrent task: ${task}`;
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((item) =>
        item.missionId === missionId
          ? {
              ...item,
              executionMissions: updateActiveExecutionMission(item, { follow_up_resolution: resolvedIntent }),
              liveWorkEvents: [],
              updatedAt: requestedAt.toISOString(),
            }
          : item,
      ),
    }));

    if (projectIntent === "inspection" || projectIntent === "diagnose" || projectIntent === "question" || projectIntent === "status" || projectIntent === "retrospective") {
      // A read-only answer gets its own Mission entry (executionMissionFromAnswer, Section 16) — the
      // placeholder created above must not also stick around as a second, permanently-"pending" ghost entry.
      retractPendingExecutionMission(missionId, pendingExecutionId, previousActiveExecutionMissionId);
      await answerProjectReadOnlyMessage(missionId, targetMission, task, projectIntent, resolvedIntent);
      return;
    }

    const parentMission = isMutatingProjectIntent(projectIntent) ? parentMissionContextFor(targetMission) : undefined;
    // An "Approved: run X" / "Denied approval to run X" reply is, by construction, always a continuation of
    // the mission that's currently paused waiting for it — trust that over the classifier's own read, since
    // forking a new mission entry here is exactly what left "waiting for approval" ghosts stuck in history.
    const isApprovalReply = isApprovalReplyMessage(task);
    const missionContinuity: "carry_forward_plan" | undefined =
      parentMission && (continuity === "carry_forward_plan" || isApprovalReply) ? "carry_forward_plan" : undefined;
    const resumesSameExecution = Boolean(parentMission && (isApprovalReply || resolvesExecutionDecisions || explicitMissionContinuation));
    if (resumesSameExecution) {
      // Continue the SAME mission entry instead of leaving the one just paused ("waiting for approval"/
      // "waiting for user") stranded forever while a brand-new entry takes over as active (Section 16).
      // Ordinary edits may still carry the previous plan into the executor, but remain distinct visible
      // turns so the original request collapses above the new follow-up instead of being overwritten.
      retractPendingExecutionMission(missionId, pendingExecutionId, previousActiveExecutionMissionId);
      setWorkspace((current) => ({
        ...current,
        missions: current.missions.map((item) =>
          item.missionId === missionId
            ? {
                ...item,
                executionMissions: updateActiveExecutionMission(item, { state: "planning", follow_up_resolution: resolvedIntent, updated_at: new Date().toISOString() }),
                liveWorkEvents: [],
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      }));
    }

    if (isExistingProjectPlan) {
      const localConnector = localConnectorFromMission(targetMission);
      if (localConnector?.url) {
        await runExistingProjectExecutionForMission(missionId, targetMission.objective, task, uploadedProjectFilesFromMission(targetMission), localProjectPathFromMission(targetMission), localConnector, parentMission, missionContinuity, approvalResponse, evidenceAttachments, resolvedIntent);
        return;
      }
      const browserFolderHandleId = browserFolderHandleIdFromMission(targetMission);
      if (browserFolderHandleId) {
        await runBrowserFolderExecutionForMission(missionId, targetMission.objective, task, browserFolderHandleId);
        return;
      }
      await runExistingProjectExecutionForMission(missionId, targetMission.objective, task, uploadedProjectFilesFromMission(targetMission), localProjectPathFromMission(targetMission), undefined, parentMission, missionContinuity, approvalResponse, evidenceAttachments, resolvedIntent);
      return;
    }

    const previousExecutionPath = projectExecutionPathFromMission(targetMission);
    if (previousExecutionPath) {
      await runExistingProjectExecutionForMission(missionId, targetMission.objective, task, [], previousExecutionPath, undefined, parentMission, missionContinuity, approvalResponse, evidenceAttachments, resolvedIntent);
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

  async function answerProjectReadOnlyMessage(missionId: string, targetMission: MissionState, task: string, intent: ProjectMessageIntent, resolution: FollowUpResolutionRecord) {
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
        const answerMission = executionMissionFromAnswer(task, answer, item.activeExecutionMissionId, answerNote.id, resolution);
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
      const result = (await response.json()) as { answer?: string; modelSelection?: { provider: string; model: string; tier: string } };
      const answer = result.answer || "I inspected the local agent project, but could not produce a useful summary.";
      return result.modelSelection ? `${answer}\n\n_Model · ${result.modelSelection.provider}/${result.modelSelection.model} · ${result.modelSelection.tier}_` : answer;
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
      const result = (await response.json()) as { answer?: string; modelSelection?: { provider: string; model: string; tier: string } };
      const answer = result.answer || "I inspected the project, but could not produce a useful summary.";
      return result.modelSelection ? `${answer}\n\n_Model · ${result.modelSelection.provider}/${result.modelSelection.model} · ${result.modelSelection.tier}_` : answer;
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
    await runProjectExecutionRequest(missionId, "/api/factory/create?stream=1", { brief, discovery, modelMode: readStoredModelMode(), quality: readStoredMissionQuality() }, "Factory execution failed.", "Build the initial project");
  }

  async function runExistingProjectExecutionForMission(missionId: string, brief: string, task: string, files: FactoryUploadedFile[], localPath: string, localConnector?: { url: string; token?: string; rootLabel?: string }, parentMission?: MissionParentContext, continuity?: "carry_forward_plan", approvalResponse?: FactoryExistingProjectRequest["approvalResponse"], evidenceAttachments: WorkspaceAttachment[] = [], followUpResolution?: FollowUpResolutionRecord) {
    const approvedCategories = approvedCommandCategories[missionId] ?? [];
    const approvedProjectCommands = approvedCommands[missionId] ?? [];
    const evidenceImages = evidenceAttachments.filter((attachment) => attachment.uploadStatus === "image" && attachment.dataUrl).map((attachment) => ({ fileName: attachment.fileName, mediaType: attachment.fileType || "image/png", dataUrl: attachment.dataUrl! }));
    await runProjectExecutionRequest(missionId, "/api/factory/existing?stream=1", { brief, task, files, localPath, localConnector, approvedCategories, approvedCommands: approvedProjectCommands, parentMission, followUpResolution, continuity, approvalResponse, quality: readStoredMissionQuality(), modelMode: readStoredModelMode(), evidenceImages }, "Existing project execution failed.", task);
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
    const targetMission = workspaceRef.current.missions.find((item) => item.missionId === missionId);
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
    const controlId = `${missionId}:${crypto.randomUUID()}`;
    activeControllersRef.current.set(missionId, controller);
    activeControlIdsRef.current.set(missionId, controlId);
    const controlRecordedAt = new Date().toISOString();
    setWorkspace((current) => ({
      ...current,
      missions: current.missions.map((mission) => mission.missionId === missionId ? {
        ...mission,
        executionMissions: updateActiveExecutionMission(mission, { control_id: controlId, updated_at: controlRecordedAt }),
        updatedAt: controlRecordedAt,
      } : mission),
    }));
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(body as Record<string, unknown>), controlId }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error((await response.text()) || fallbackMessage);

      const streamedResult = await readFactoryExecutionStream(response, missionId);
      if (!streamedResult) throw new Error("Factory execution ended without a result.");
      if (task) updateProjectExecution(missionId, streamedResult, task);
      else updateProjectExecution(missionId, streamedResult);
    } catch (error) {
      if (controller.signal.aborted) {
        const stoppedAt = new Date().toISOString();
        const stoppedEvent: FactoryExecutionEvent = {
          id: `execution-stopped-${Date.now()}`,
          timestamp: stoppedAt,
          kind: "summary",
          status: "warning",
          title: "Stopped by user",
          details: { reason: "The user stopped this mission before it finished." },
        };
        appendProjectExecutionEvent(missionId, stoppedEvent);
        setWorkspace((current) => ({
          ...current,
          missions: current.missions.map((item) =>
            item.missionId === missionId
              ? {
                  ...item,
                  executionMissions: updateActiveExecutionMission(item, {
                    state: "cancelled",
                    blocked_reason: "Stopped by user before completion.",
                    summary: "Stopped by user before completion.",
                    updated_at: stoppedAt,
                  }),
                  lastResult: "Stopped by user before completion.",
                  liveWorkEvents: [],
                  updatedAt: stoppedAt,
                }
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
      const targetMission = workspaceRef.current.missions.find((item) => item.missionId === missionId);
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
      if (activeControlIdsRef.current.get(missionId) === controlId) {
        activeControlIdsRef.current.delete(missionId);
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

    try {
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
    } catch (error) {
      const concreteFailure = [...timeline].reverse().find((event) => event.status === "error");
      const reason = concreteFailure
        ? String(concreteFailure.details?.reason || concreteFailure.details?.blocker || concreteFailure.output || concreteFailure.title)
        : "The live execution connection ended before Foundry returned a final result.";
      const transport = error instanceof Error ? error.message : "connection interrupted";
      throw new Error(`${reason} The project history was preserved and this mission can be retried without starting over. Connection detail: ${transport}`);
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
        // A checklist update carries *plan* data, not a phase transition. It must never drag the state
        // machine backward: internal "Checklist updated" events keep arriving during executing/verifying,
        // and forcing "planning" here made the status pill regress to "Planning" mid-verification (and
        // flicker on every non-internal checklist event, since updateMissionTimeline then re-derives the
        // real state in a second render). Only advance INTO planning from the pre-plan phases; otherwise
        // leave state untouched and let updateMissionTimeline own it.
        const activeState = getActiveExecutionMission(item)?.state;
        const enterPlanning = activeState === undefined || activeState === "idle" || activeState === "understanding";
        return {
          ...item,
          createdArtifacts: [nextArtifact, ...item.createdArtifacts.filter((entry) => entry.title !== "Project Execution")],
          executionMissions: updateActiveExecutionMission(item, {
            ...(enterPlanning ? { state: "planning" as const } : {}),
            plan: checklist,
            updated_at: now,
          }),
          updatedAt: now,
        };
      }),
    }));
  }


  return (
    <>
      <div className="workspace-background fixed inset-0" aria-hidden="true" />
      <div className="relative z-10 grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <TopBar />
        <BuildDashboard
          missions={workspace.missions}
          activeMissionId={mission.missionId}
          queuedTask={queuedTasks[mission.missionId]?.task}
          onCreateMission={createNewMissionThread}
          onDeleteMission={deleteMission}
          onCreateProject={createProjectBriefMission}
          onUpdateProjectExecution={updateProjectExecution}
          onExecuteProject={executeProjectMission}
          onRollbackToEntry={rollbackToJournalEntry}
          onApproveCategory={approveCommandCategory}
          onApproveCommand={approveExactCommand}
          onSelectMission={(missionId) => {
            setWorkspace((current) => ({ ...current, activeMissionId: missionId }));
          }}
        />
        <StatusBar attachmentCount={mission.attachments.length} statusText={statusText} />
      </div>
    </>
  );
}


/** Approval/clarification "Allow once" / "Deny" etc. actions replay as one of these synthetic control strings, generated internally — never typed by the user — so they're safe to recognize literally here without turning this into a general keyword-based intent classifier. */
function executionNeedsContinuation(execution: ExecutionMission) {
  return execution.state !== "complete"
    || execution.plan.some((item) => item.status !== "completed" && item.status !== "skipped");
}

async function resolveProjectMessageIntent(mission: MissionState, message: string): Promise<ProjectMessageIntentResolution> {
  const context = projectIntentContextForMission(mission);
  try {
    const response = await fetch("/api/factory/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        mode: readStoredModelMode(),
        context,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; resolution?: Partial<FollowUpResolutionRecord>; intent?: unknown; continuity?: unknown; clarifyingQuestion?: unknown; clarifyingOptions?: unknown }
      | null;
    const modelIntent = normalizeProjectMessageIntent(payload?.intent);
    if (response.ok && payload?.ok && modelIntent) {
      return normalizeFollowUpResolution(
        payload.resolution ?? {
          currentIntent: modelIntent,
          continuity: payload.continuity === "carry_forward_plan" || payload.continuity === "fresh_plan" ? payload.continuity : "not_applicable",
          clarifyingQuestion: String(payload.clarifyingQuestion ?? "").trim(),
          clarifyingOptions: Array.isArray(payload.clarifyingOptions) ? payload.clarifyingOptions.map(String) : [],
        },
        message,
        context,
      );
    }
  } catch {
    // Fall through to the local fallback when the model-backed router is unavailable.
  }

  return fallbackFollowUpResolution(message, context);
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
          id: activeExecution.id,
          status: activeExecution.state,
          objective: activeExecution.source_requirements.join("\n"),
          blocker: activeExecution.blocked_reason,
          changedFiles: activeExecution.files_touched.map((file) => `${file.status ?? "changed"} ${file.path}${file.verified ? " (verified)" : " (unverified)"}`),
          checklist: activeExecution.plan.map((item) => ({
            label: item.label,
            status: item.status,
            evidence: item.evidence,
          })),
          createdAt: activeExecution.created_at,
          updatedAt: activeExecution.updated_at,
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
      id: run.id,
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
      createdAt: run.created_at,
      updatedAt: run.updated_at,
    })),
  };
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
    source_requirements: previous.source_requirements,
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
    denied_actions: previous.timeline
      .filter((event) => event.kind === "blocked" && /^Approval denied:/i.test(event.title) && event.command)
      .map((event) => event.command as string),
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
  const hasIncompletePlan = Boolean(result.checklist?.some((item) => item.status !== "completed" && item.status !== "skipped"));
  const completionContradiction = result.status === "passed" && hasIncompletePlan
    ? "Foundry returned success before completing the mission plan. The mission remains failed and must continue from its unfinished work."
    : undefined;
  const { state, verification_status } = computeMissionState({ rawStatus: result.status, blocker: result.blocker, verification, hasIncompletePlan });
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
  const blockedReason = result.blocker || completionContradiction || (state === "complete" ? undefined : result.checklist?.find((item) => item.status === "blocked")?.evidence);
  const humanSummary = completionContradiction ? "" : result.sessionSummary?.outcome || (state === "complete" && verification.length ? factoryResultMessage(result) : "");
  const pendingMockReview =
    result.status === "awaiting-mock-approval"
      ? { message: result.blocker || "The first working mock is ready for review.", preview_url: result.previewUrl }
      : undefined;
  const continuesExistingRequest = Boolean(existing) && (
    isApprovalReplyMessage(task)
    || /^Resolved project decisions:/i.test(task.trim())
    || /^(?:yes|yes please|go ahead|continue|do it|proceed)[.!]?$/i.test(task.trim())
  );
  const existingApprovals = existing?.approvals ?? [];
  const resolvedApprovals = continuesExistingRequest
    ? existingApprovals.map((approval) => approval.decidedAs ? approval : { ...approval, decidedAs: /^Denied/i.test(task.trim()) ? "deny" as const : "allow_once" as const, decidedAt: now })
    : existingApprovals;
  const blockedEvent = [...(result.timeline ?? [])].reverse().find((event) => event.kind === "blocked" && event.command);
  const approvals = state === "waiting_for_approval" && blockedEvent
    ? [...resolvedApprovals.filter((approval) => approval.decidedAs || approval.command !== blockedEvent.command), {
        id: blockedEvent.id,
        command: blockedEvent.command!,
        category: (blockedEvent.details?.category as ExecutionMission["approvals"] extends Array<infer A> ? A extends { category: infer C } ? C : never : never) ?? "unrecognized",
        reason: (blockedEvent.details?.reason as string | undefined) || blockedEvent.output || result.blocker || "Foundry needs approval before continuing.",
        requestedAt: blockedEvent.timestamp,
      }]
    : resolvedApprovals;
  return {
    id: existing?.id ?? `execution-${Date.now()}`,
    title: taskTitle(task, result),
    source_requirements: continuesExistingRequest ? existing!.source_requirements : [task],
    state,
    verification_status,
    plan: result.checklist ?? existing?.plan ?? [],
    files_touched: filesTouched,
    commands_run: (result.commands ?? []).map((command) => ({
      ...command,
      approved_by: command.approvalScope ? ("user" as const) : ("auto-safe" as const),
      approval_scope_label: approvalScopeLabel(command.approvalScope),
    })),
    approvals,
    verification,
    blocked_reason: blockedReason,
    pending_mock_review: pendingMockReview,
    // A failed/starting result cannot inherit an older URL and present it as this run's surface.
    // The idle MissionCanvas recovery path will re-probe the current project on disk and restore a
    // preview only when the preview API confirms it is actually running.
    preview_url: result.previewState === "ready" ? result.previewUrl : undefined,
    undo_snapshot: existing?.undo_snapshot,
    summary: humanSummary,
    parent_mission_id: existing?.parent_mission_id,
    follow_up_resolution: existing?.follow_up_resolution,
    request_message_id: existing?.request_message_id,
    result_message_id: existing?.result_message_id,
    timeline: existing && result.timeline
      ? mergeExecutionTimeline(existing.timeline, result.timeline)
      : result.timeline ?? existing?.timeline ?? [],
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}

function mergeExecutionTimeline(existing: FactoryExecutionEvent[], incoming: FactoryExecutionEvent[]) {
  const seen = new Set(existing.map((event) => event.id));
  return [...existing, ...incoming.filter((event) => !seen.has(event.id))];
}

/** A read-only Q&A request never runs the mission executor, so it has no checklist/files/commands — but it
 * still gets a real Mission entry so "Previous Missions" is one unified list instead of a separate plain-text
 * message count (Section 16). */
function executionMissionFromAnswer(task: string, answer: string, parentMissionId: string | undefined, resultMessageId: string, resolution: FollowUpResolutionRecord): ExecutionMission {
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
    follow_up_resolution: resolution,
    request_message_id: undefined,
    result_message_id: resultMessageId,
    timeline: [],
    created_at: now,
    updated_at: now,
  };
}

function taskTitle(task: string, result?: FactoryProjectResult) {
  const source = task || result?.objective || result?.projectName || "Project mission";
  const explicitProject = source.match(/(?:^|\n)Create Project:\s*([^\n]+)/i)?.[1]?.trim();
  if (explicitProject) return `Create ${explicitProject}`.slice(0, 80);
  const firstMeaningfulLine = source.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? source;
  return firstMeaningfulLine.replace(/^Current task:\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Project mission";
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
  if (artifact) {
    try {
      const result = JSON.parse(artifact.body) as FactoryProjectResult;
      if (result.projectPath) return result.projectPath;
    } catch {
      // An interrupted first build may not have a final result artifact yet. Fall
      // through to the durable live timeline, which records the created folder.
    }
  }

  const timelineArtifact = mission.createdArtifacts.find((item) => item.title === "Project Execution Timeline");
  if (!timelineArtifact) return "";
  const createdFolder = safeParseTimeline(timelineArtifact.body).find((event) =>
    event.kind === "folder"
    && event.status === "completed"
    && (typeof event.details?.path === "string" || Boolean(event.filePath)),
  );
  return typeof createdFolder?.details?.path === "string" ? createdFolder.details.path : createdFolder?.filePath ?? "";
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
