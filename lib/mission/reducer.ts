import type { CommandPermissionCategory } from "@/lib/ai/mission/command-permissions";
import type { ExecutionMissionVerification, FactoryCommandEvent, FactoryExecutionEvent, FactoryObjectiveChecklistItem } from "@/lib/factory/types";
import type { MissionRecommendation } from "@/lib/ai/mission/recommendations";

/**
 * Canonical mission state machine. This file is the ONLY place an ExecutionMission's fields ever
 * change — every component dispatches an action here instead of deriving or mutating mission data
 * itself. Replaces the four previously-competing vocabularies: the old ExecutionMission/ExecutionMissionState
 * shape in lib/mission-engine.ts (now just re-exported from here), the separate derivation functions in
 * lib/mission/state.ts and lib/mission/status.ts (folded into MISSION_STATUS_SET's transitions and the
 * selectors below), and the server's MissionExecutorResult (translated into actions by
 * lib/mission/fromExecutorResult.ts, never read directly by any component).
 */
export type ExecutionMissionState =
  | "idle"
  | "understanding"
  | "planning"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "executing"
  | "verifying"
  | "blocked"
  | "failed"
  | "complete"
  | "cancelled"
  | "undoing";

export type ExecutionMissionVerificationStatus = "none" | "passed" | "failed" | "unverified";

export type MissionSize = "tiny" | "small" | "medium" | "large" | "huge";

export type ApprovalDecision = "allow_once" | "allow_project" | "always_exact" | "deny";

export type ExecutionMissionApproval = {
  id: string;
  /** Exact command or action text shown verbatim in the prompt, e.g. "npm install xlsx". */
  command: string;
  category: CommandPermissionCategory | "unrecognized";
  /** Plain-language reason shown under "Why:" in the approval prompt. */
  reason: string;
  requestedAt: string;
  decidedAs?: ApprovalDecision;
  decidedAt?: string;
};

export type ExecutionMissionFileTouch = {
  path: string;
  diff?: string;
  verified: boolean;
  status?: "created" | "edited" | "uploaded";
  evidence?: string;
};

export type ExecutionMissionCommandRun = FactoryCommandEvent & {
  approved_by?: "user" | "system" | "project-scope" | "exact-command" | "auto-safe";
  approval_scope_label: string;
};

export type ExecutionMission = {
  id: string;
  title: string;
  source_requirements: string[];
  state: ExecutionMissionState;
  verification_status: ExecutionMissionVerificationStatus;
  /** Undefined until classifySize() runs (lib/mission/classifySize.ts) — treat as "medium" (full checklist) until then. */
  size?: MissionSize;
  plan: FactoryObjectiveChecklistItem[];
  activeStep?: string | null;
  files_touched: ExecutionMissionFileTouch[];
  commands_run: ExecutionMissionCommandRun[];
  verification: ExecutionMissionVerification[];
  approvals?: ExecutionMissionApproval[];
  suggestions?: MissionRecommendation[];
  blocked_reason?: string;
  pending_mock_review?: { message: string; preview_url?: string };
  preview_url?: string;
  /** Journal/rollback id from lib/factory/runtime.ts — doubles as the restore point referenced by Undo. */
  undo_snapshot?: string;
  summary: string;
  parent_mission_id?: string;
  request_message_id?: string;
  result_message_id?: string;
  timeline: FactoryExecutionEvent[];
  created_at: string;
  updated_at: string;
};

export type MissionThread = {
  executionMissions: ExecutionMission[];
  activeExecutionMissionId?: string;
};

export type MissionsState = Record<string, MissionThread>;

const emptyThread: MissionThread = { executionMissions: [], activeExecutionMissionId: undefined };

function getThread(state: MissionsState, threadId: string): MissionThread {
  return state[threadId] ?? emptyThread;
}

function getMission(state: MissionsState, threadId: string, missionId: string): ExecutionMission | undefined {
  return getThread(state, threadId).executionMissions.find((mission) => mission.id === missionId);
}

function updateMission(state: MissionsState, threadId: string, missionId: string, updater: (mission: ExecutionMission) => ExecutionMission): MissionsState {
  const thread = getThread(state, threadId);
  const mission = thread.executionMissions.find((item) => item.id === missionId);
  if (!mission) return state;
  const updated = { ...updater(mission), updated_at: new Date().toISOString() };
  return {
    ...state,
    [threadId]: {
      ...thread,
      executionMissions: thread.executionMissions.map((item) => (item.id === missionId ? updated : item)),
    },
  };
}

/**
 * Transitions considered legitimate. Not enforced by throwing (a stray out-of-order network event
 * should never crash the whole canvas) — violations are dev-console-warned so drift is caught during
 * development instead of silently producing a conflicting badge in production.
 */
const ALLOWED_TRANSITIONS: Record<ExecutionMissionState, ExecutionMissionState[]> = {
  idle: ["understanding", "planning", "executing", "cancelled"],
  understanding: ["planning", "executing", "waiting_for_user", "blocked", "failed", "cancelled"],
  planning: ["executing", "waiting_for_user", "blocked", "failed", "cancelled"],
  executing: ["verifying", "waiting_for_approval", "waiting_for_user", "blocked", "failed", "complete", "cancelled"],
  waiting_for_user: ["executing", "planning", "cancelled", "blocked"],
  waiting_for_approval: ["executing", "cancelled", "blocked"],
  verifying: ["complete", "failed", "executing", "cancelled"],
  blocked: ["executing", "understanding", "planning", "cancelled", "undoing"],
  failed: ["executing", "understanding", "cancelled", "undoing"],
  complete: ["undoing", "executing"],
  cancelled: [],
  undoing: ["idle", "complete", "failed"],
};

function assertTransition(mission: ExecutionMission, next: ExecutionMissionState) {
  if (process.env.NODE_ENV === "production") return;
  if (mission.state === next) return;
  const allowed = ALLOWED_TRANSITIONS[mission.state] ?? [];
  if (!allowed.includes(next)) {
    console.warn(`[mission] unexpected transition ${mission.state} -> ${next} for mission ${mission.id}`);
  }
}

export type MissionAction =
  | { type: "MISSION_CREATED"; threadId: string; mission: ExecutionMission }
  | { type: "MISSION_STATUS_SET"; threadId: string; missionId: string; status: ExecutionMissionState; error?: string }
  | { type: "PLAN_SET"; threadId: string; missionId: string; plan: FactoryObjectiveChecklistItem[] | null; size: MissionSize }
  | { type: "STEP_ACTIVATED"; threadId: string; missionId: string; stepId: string | null }
  | { type: "TIMELINE_APPENDED"; threadId: string; missionId: string; event: FactoryExecutionEvent }
  | { type: "APPROVAL_REQUESTED"; threadId: string; missionId: string; approval: ExecutionMissionApproval }
  | { type: "APPROVAL_DECIDED"; threadId: string; missionId: string; approvalId: string; decision: ApprovalDecision }
  | { type: "FILE_TOUCHED"; threadId: string; missionId: string; touch: ExecutionMissionFileTouch }
  | { type: "COMMAND_RECORDED"; threadId: string; missionId: string; run: ExecutionMissionCommandRun }
  | { type: "PREVIEW_UPDATED"; threadId: string; missionId: string; previewUrl: string | undefined }
  | { type: "VERIFICATION_RECORDED"; threadId: string; missionId: string; verification: ExecutionMissionVerification[]; status: ExecutionMissionVerificationStatus }
  | { type: "MISSION_COMPLETED"; threadId: string; missionId: string; summary: string }
  | { type: "MISSION_BLOCKED"; threadId: string; missionId: string; reason: string }
  | { type: "MISSION_FAILED"; threadId: string; missionId: string; error: string }
  | { type: "MISSION_CANCELLED"; threadId: string; missionId: string }
  | { type: "SUGGESTIONS_SET"; threadId: string; missionId: string; suggestions: MissionRecommendation[] }
  | { type: "SUGGESTIONS_CLEARED"; threadId: string; missionId: string }
  | { type: "RESTORE_POINT_SET"; threadId: string; missionId: string; restorePoint: string }
  | { type: "ACTIVE_MISSION_SET"; threadId: string; missionId: string }
  | { type: "HYDRATE_THREAD"; threadId: string; thread: MissionThread };

const TERMINAL_STATES: ExecutionMissionState[] = ["complete", "cancelled", "failed"];

export function missionReducer(state: MissionsState, action: MissionAction): MissionsState {
  switch (action.type) {
    case "MISSION_CREATED": {
      const thread = getThread(state, action.threadId);
      return {
        ...state,
        [action.threadId]: {
          executionMissions: [...thread.executionMissions, action.mission],
          activeExecutionMissionId: action.mission.id,
        },
      };
    }

    case "MISSION_STATUS_SET": {
      const mission = getMission(state, action.threadId, action.missionId);
      if (!mission) return state;
      assertTransition(mission, action.status);
      return updateMission(state, action.threadId, action.missionId, (item) => ({
        ...item,
        state: action.status,
        blocked_reason: action.status === "blocked" ? action.error ?? item.blocked_reason : item.blocked_reason,
      }));
    }

    case "PLAN_SET":
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, plan: action.plan ?? [], size: action.size }));

    case "STEP_ACTIVATED":
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, activeStep: action.stepId }));

    case "TIMELINE_APPENDED": {
      const mission = getMission(state, action.threadId, action.missionId);
      if (!mission || TERMINAL_STATES.includes(mission.state)) return state;
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, timeline: [...item.timeline, action.event] }));
    }

    case "APPROVAL_REQUESTED": {
      const mission = getMission(state, action.threadId, action.missionId);
      if (!mission) return state;
      assertTransition(mission, "waiting_for_approval");
      return updateMission(state, action.threadId, action.missionId, (item) => ({
        ...item,
        state: "waiting_for_approval",
        approvals: [...(item.approvals ?? []), action.approval],
      }));
    }

    case "APPROVAL_DECIDED":
      return updateMission(state, action.threadId, action.missionId, (item) => ({
        ...item,
        approvals: (item.approvals ?? []).map((approval) =>
          approval.id === action.approvalId ? { ...approval, decidedAs: action.decision, decidedAt: new Date().toISOString() } : approval
        ),
      }));

    case "FILE_TOUCHED": {
      const mission = getMission(state, action.threadId, action.missionId);
      if (!mission) return state;
      const existingIndex = mission.files_touched.findIndex((touch) => touch.path === action.touch.path);
      const files_touched =
        existingIndex >= 0
          ? mission.files_touched.map((touch, index) => (index === existingIndex ? action.touch : touch))
          : [...mission.files_touched, action.touch];
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, files_touched }));
    }

    case "COMMAND_RECORDED":
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, commands_run: [...item.commands_run, action.run] }));

    case "PREVIEW_UPDATED":
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, preview_url: action.previewUrl }));

    case "VERIFICATION_RECORDED":
      return updateMission(state, action.threadId, action.missionId, (item) => ({
        ...item,
        verification: action.verification,
        verification_status: action.status,
      }));

    case "MISSION_COMPLETED": {
      const mission = getMission(state, action.threadId, action.missionId);
      if (!mission) return state;
      assertTransition(mission, "complete");
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, state: "complete", summary: action.summary }));
    }

    case "MISSION_BLOCKED": {
      const mission = getMission(state, action.threadId, action.missionId);
      if (!mission) return state;
      assertTransition(mission, "blocked");
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, state: "blocked", blocked_reason: action.reason }));
    }

    case "MISSION_FAILED": {
      const mission = getMission(state, action.threadId, action.missionId);
      if (!mission) return state;
      assertTransition(mission, "failed");
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, state: "failed", blocked_reason: action.error }));
    }

    case "MISSION_CANCELLED": {
      const mission = getMission(state, action.threadId, action.missionId);
      if (!mission) return state;
      assertTransition(mission, "cancelled");
      return updateMission(state, action.threadId, action.missionId, (item) => ({
        ...item,
        state: "cancelled",
        summary: item.summary || "Stopped by user.",
      }));
    }

    case "SUGGESTIONS_SET":
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, suggestions: action.suggestions }));

    case "SUGGESTIONS_CLEARED":
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, suggestions: [] }));

    case "RESTORE_POINT_SET":
      return updateMission(state, action.threadId, action.missionId, (item) => ({ ...item, undo_snapshot: action.restorePoint }));

    case "ACTIVE_MISSION_SET": {
      const thread = getThread(state, action.threadId);
      return { ...state, [action.threadId]: { ...thread, activeExecutionMissionId: action.missionId } };
    }

    case "HYDRATE_THREAD":
      return { ...state, [action.threadId]: action.thread };

    default:
      return state;
  }
}

export const busyMissionStates: ExecutionMissionState[] = ["understanding", "planning", "executing", "verifying", "undoing"];

/** Human label for a single ExecutionMission's state — the one function every status display must call. */
export function missionStateLabel(mission: ExecutionMission): string {
  if (mission.state === "idle") return "Ready";
  if (mission.state === "complete") return mission.verification_status === "passed" ? "Complete" : "Complete (unverified)";
  return mission.state.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

export function pendingApprovalOf(mission: ExecutionMission): ExecutionMissionApproval | undefined {
  return (mission.approvals ?? []).find((approval) => !approval.decidedAs);
}
