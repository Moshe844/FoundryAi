import type { ExecutionMission, ExecutionMissionState, MissionState } from "@/lib/mission-engine";
import { busyMissionStates, missionStateLabel } from "@/lib/mission/model";

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
};

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
    isBusy: busyMissionStates.includes(state),
    isPausedForUser: state === "waiting_for_user",
    isPausedForApproval: state === "waiting_for_approval",
    activeExecutionMission,
  };
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
  // The stored title is usually just the flow's generic label — "Open Existing Project" for an opened
  // project, or the bare template/domain name ("E-commerce Store") for a created one — neither of which
  // says what THIS workspace actually is. Prefer a specific title derived from the durable brief the
  // mission carries (the opened folder's name, or what the user described building). Only fall back to
  // the stored label when the brief yields nothing more specific. Runs at render time, so it also fixes
  // workspaces that were saved before this change.
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
  // Opened/existing projects: the real identity is the folder or upload being worked on.
  const folder = briefField(brief, "Local connector root")
    || briefField(brief, "Local project path")
    || briefField(brief, "Browser folder name");
  if (folder) return humanizeName(baseName(folder));
  const selection = briefField(brief, "Existing project selection");
  if (selection && !/^\d+\s/.test(selection)) return humanizeName(selection);
  // Created projects: prefer what the user described, then the resolved specific type.
  const description = briefField(brief, "Project description") || briefField(brief, "Initial requested task");
  if (description) return humanizeName(description);
  const type = briefField(brief, "Project type");
  if (type) return humanizeName(type);
  const name = briefField(brief, "Project name");
  if (name && !isGenericProjectTitle(name)) return humanizeName(name);
  return "";
}

export function projectBriefFromMission(mission: MissionState) {
  return mission.createdArtifacts.find((artifact) => artifact.type === "project" && artifact.title === "Project Brief")?.body ?? mission.objective;
}
