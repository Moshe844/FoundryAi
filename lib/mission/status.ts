import type { ExecutionMission, ExecutionMissionState, MissionState } from "@/lib/mission-engine";

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
};

const busyStates: ExecutionMissionState[] = ["understanding", "planning", "executing", "verifying", "undoing"];

/**
 * The one function every status display in the UI must call — header pill, footer status bar,
 * composer "Working/Ready" indicator, previous-mission labels. Derives everything purely from the
 * active ExecutionMission's canonical `state`; never re-infers busy-ness from regex-matching
 * `lastResult`/`liveWorkEvents` strings, which is what let those surfaces drift out of sync before.
 */
export function deriveMissionDisplayStatus(mission: MissionState): MissionDisplayStatus {
  const activeExecutionMission = getActiveExecutionMission(mission);

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
    isBusy: busyStates.includes(state),
    isPausedForUser: state === "waiting_for_user",
    isPausedForApproval: state === "waiting_for_approval",
    activeExecutionMission,
  };
}

/** Human label for a single ExecutionMission's state — used by the header pill, the footer, and Previous Missions alike. */
export function missionStateLabel(mission: ExecutionMission): string {
  if (mission.state === "idle") return "Ready";
  if (mission.state === "complete") return mission.verification_status === "passed" ? "Complete" : "Complete (unverified)";
  return mission.state.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

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
  const source = mission.title || mission.conversationTitle || mission.objective || "Untitled project";
  return source.replace(/^Create Project:\s*/i, "").trim() || "Untitled project";
}

export function projectBriefFromMission(mission: MissionState) {
  return mission.createdArtifacts.find((artifact) => artifact.type === "project" && artifact.title === "Project Brief")?.body ?? mission.objective;
}
