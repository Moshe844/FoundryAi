import type { ExecutionMission, ExecutionMissionState, MissionState } from "@/lib/mission-engine";
import { busyMissionStates, missionStateLabel } from "@/lib/mission/model";
import { authoritativeMissionForWorkspace } from "@/lib/mission-core/browser-authority-registry";
import { projectDurableMission } from "@/lib/mission-core/browser-projection";
import type { MissionRecord } from "@/lib/mission-core/model";

export { missionStateLabel } from "@/lib/mission/model";

/**
 * Single source of truth for "which ExecutionMission is the active one" — every renderer and every
 * status computation must go through this instead of re-deriving it, otherwise a stale
 * activeExecutionMissionId (or a mission-update path that forgets to set it) silently desyncs the
 * header pill, the footer, the composer, and the previous-missions collapse from each other.
 */
export function getActiveExecutionMission(mission: MissionState): ExecutionMission | undefined {
  return mission.executionMissions.find((item) => item.id === mission.activeExecutionMissionId) ?? mission.executionMissions.at(-1);
}

export type MissionDisplayStatus = {
  /** "idle" when the mission has no execution turns yet. */
  state: ExecutionMissionState;
  /** Human label, e.g. "Executing", "Waiting for approval", "Complete (unverified)". */
  label: string;
  /** True while Foundry is actively streaming work — the only state that should ever read "Working". */
  isBusy: boolean;
  /** True when paused on a clarifying question / mock-review reaction — free text is the expected reply. */
  isPausedForUser: boolean;
  /** True when paused on a command approval — a hard pause; only the approval gate's buttons (or Stop) may proceed. */
  isPausedForApproval: boolean;
  activeExecutionMission: ExecutionMission | undefined;
  /** Server-owned blocker. Local execution history remains presentation-only once this is present. */
  blocker?: string;
  /** Present when the browser has a durable server mission bound to this workspace. */
  durableMission?: MissionRecord;
};

/**
 * The one function every status display in the UI must call — header pill, footer status bar,
 * composer "Working/Ready" indicator, previous-mission labels. Durable mission state wins whenever
 * a workspace binding exists; the older ExecutionMission remains only the detailed presentation
 * history until every canvas block has moved to typed operations and durable journal entries.
 */
export function deriveMissionDisplayStatus(mission: MissionState): MissionDisplayStatus {
  const activeExecutionMission = getActiveExecutionMission(mission);
  const durableMission = authoritativeMissionForWorkspace(mission.missionId);
  const durableView = projectDurableMission(durableMission);

  if (durableMission && durableView) {
    return {
      state: legacyStateForDurable(durableMission.status),
      label: durableView.label,
      isBusy: durableView.isBusy,
      isPausedForUser: durableMission.status === "awaiting_clarification",
      isPausedForApproval: durableMission.status === "awaiting_approval" || Boolean(durableView.pendingApproval),
      activeExecutionMission,
      blocker: durableView.blocker,
      durableMission,
    };
  }

  if (!activeExecutionMission) {
    return {
      state: "idle",
      label: "Ready",
      isBusy: false,
      isPausedForUser: false,
      isPausedForApproval: false,
      activeExecutionMission: undefined,
    };
  }

  const { state } = activeExecutionMission;

  return {
    state,
    label: missionStateLabel(activeExecutionMission),
    isBusy: busyMissionStates.includes(state),
    isPausedForUser: state === "waiting_for_user",
    isPausedForApproval: state === "waiting_for_approval",
    activeExecutionMission,
    blocker: activeExecutionMission.blocked_reason,
  };
}

function legacyStateForDurable(status: MissionRecord["status"]): ExecutionMissionState {
  switch (status) {
    case "draft": return "idle";
    case "understanding": return "understanding";
    case "awaiting_clarification": return "waiting_for_user";
    case "planned": return "planning";
    case "awaiting_approval": return "waiting_for_approval";
    case "executing": return "executing";
    case "verifying": return "verifying";
    case "repairing": return "executing";
    case "previewing": return "verifying";
    case "completed":
    case "completed_with_warnings": return "complete";
    case "blocked": return "blocked";
    case "failed": return "failed";
    case "canceled": return "cancelled";
  }
}

/** Human label for a single ExecutionMission's state — used by the header pill, the footer, and Previous Missions alike. */
/**
 * Relocated from components/BuildDashboard.tsx (Discovery Engine rebuild) so lib/discovery/* can
 * classify/rank mission history without importing a 6,500-line component file. Pure move, no
 * behavior change — every existing call site now imports from here instead of a local definition.
 */
export function isSoftwareProjectMission(mission: MissionState) {
  const title = `${mission.title} ${mission.conversationTitle} ${mission.objective} ${mission.lastResult}`.toLowerCase();
  return (
    mission.desiredOutcome === "project" ||
    mission.desiredOutcome === "patch" ||
    mission.createdArtifacts.some((artifact) => artifact.type === "project" || artifact.type === "patch" || artifact.kind === "code") ||
    /\b(create project|build inventory|build e-commerce|build ecommerce|build pos|build dashboard|build website|build mobile|build game|ai software factory|preferred stack|smart defaults)\b/.test(title)
  );
}

export function projectTitleFor(mission: MissionState) {
  const stored = (mission.title || mission.conversationTitle || "")
    .replace(/^Create Project:\s*/i, "")
    .trim();
  const derived = deriveTitleFromBrief(mission.objective ?? "");
  if (derived) return derived;
  if (stored && !isGenericProjectTitle(stored)) return stored;
  return stored || "Untitled project";
}

const GENERIC_PROJECT_TITLES = new Set([
  "open existing project",
  "convert existing project",
  "clone into another stack",
  "new project",
  "untitled project",
  "untitled",
  "project",
]);

function isGenericProjectTitle(title: string) {
  return GENERIC_PROJECT_TITLES.has(title.toLowerCase().trim());
}

function briefField(brief: string, label: string): string {
  const match = brief.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"));
  const value = match?.[1]?.trim();
  if (!value || /^(not described yet\.?|none|n\/a|no additional instructions\.?|not selected)$/i.test(value)) return "";
  return value;
}

function baseName(pathValue: string): string {
  return pathValue.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function humanizeName(value: string): string {
  const words = value
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/^\s*(?:a|an|the)\s+/i, "")
    .replace(/\b(build|create|make)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => (/^[a-z]/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word));
  return words.join(" ");
}

/** Derive a specific, human title from the durable project brief the mission stores as its objective. */
function deriveTitleFromBrief(brief: string): string {
  if (!brief.trim()) return "";
  const folder = briefField(brief, "Local connector root")
    || briefField(brief, "Local project path")
    || briefField(brief, "Browser folder name");
  if (folder) return humanizeName(baseName(folder));
  const selection = briefField(brief, "Existing project selection");
  if (selection && !/^\d+\s/.test(selection)) return humanizeName(selection);
  const type = briefField(brief, "Project type");
  if (type) return humanizeName(type);
  const name = briefField(brief, "Project name");
  if (name && !isGenericProjectTitle(name)) return humanizeName(name);
  const description = briefField(brief, "Project description") || briefField(brief, "Initial requested task");
  if (description) return humanizeName(description);
  return "";
}

export function projectBriefFromMission(mission: MissionState) {
  return mission.createdArtifacts.find((artifact) => artifact.type === "project" && artifact.title === "Project Brief")?.body ?? mission.objective;
}
