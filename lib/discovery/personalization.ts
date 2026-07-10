import type { MissionState } from "@/lib/mission-engine";
import { deriveMissionDisplayStatus, isSoftwareProjectMission, projectTitleFor } from "@/lib/mission/status";

/**
 * Pure, deterministic ranking functions over already-durable mission history (IndexedDB via
 * WorkspaceShell's workspace.missions) — no LLM calls, no new persistence. Powers FactoryHome's
 * personalized card sections. Every function returns [] on empty history so a first-time user sees
 * exactly today's static starter grid with no special-casing required by the caller.
 */
export type PersonalizedCardKind = "continue" | "resume-interrupted" | "recent" | "frequently-built" | "suggested-domain";

export type PersonalizedCard = {
  id: string;
  kind: PersonalizedCardKind;
  missionId: string;
  title: string;
  subtitle: string;
};

function softwareProjectMissions(missions: MissionState[]): MissionState[] {
  return missions.filter(isSoftwareProjectMission);
}

/** Mission whose most recent execution mission is non-terminal — i.e. genuinely mid-flow, not just "exists." */
function isInProgress(mission: MissionState): boolean {
  const status = deriveMissionDisplayStatus(mission);
  return status.state !== "idle" && status.state !== "complete" && status.state !== "cancelled" && status.state !== "failed";
}

/**
 * The single most relevant paused/mid-flow mission, excluding the currently active one. Label
 * differs by state: an approval pause reads as "Resume Interrupted Build" (something stopped and is
 * waiting on the user specifically), anything else non-terminal reads as "Continue Previous Mission."
 */
export function continueOrResumeMission(missions: MissionState[], activeMissionId?: string): PersonalizedCard | null {
  const candidates = softwareProjectMissions(missions)
    .filter((mission) => mission.missionId !== activeMissionId && isInProgress(mission))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const mission = candidates[0];
  if (!mission) return null;
  const status = deriveMissionDisplayStatus(mission);
  const isPausedForApproval = status.state === "waiting_for_approval";
  return {
    id: `${mission.missionId}-continue`,
    kind: isPausedForApproval ? "resume-interrupted" : "continue",
    missionId: mission.missionId,
    title: isPausedForApproval ? "Resume Interrupted Build" : "Continue Previous Mission",
    subtitle: `${projectTitleFor(mission)} — ${status.label}`,
  };
}

export function recentProjects(missions: MissionState[], excludeMissionId?: string, limit = 3): PersonalizedCard[] {
  return softwareProjectMissions(missions)
    .filter((mission) => mission.missionId !== excludeMissionId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
    .map((mission) => ({
      id: `${mission.missionId}-recent`,
      kind: "recent" as const,
      missionId: mission.missionId,
      title: projectTitleFor(mission),
      subtitle: deriveMissionDisplayStatus(mission).label,
    }));
}

/**
 * Coarse, self-contained domain bucketing over mission title/objective text — deliberately NOT a
 * reuse of BuildDashboard.tsx's categoryForProject(), since that function is deleted once dynamic
 * stack_options land (Discovery Engine rebuild, step 5/14) and this module must not break when it
 * goes. Keeping this list small and independent is intentional, not an oversight.
 */
const DOMAIN_BUCKETS: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: "inventory", label: "Inventory", pattern: /\binventory|stock|warehouse|sku\b/i },
  { id: "commerce", label: "E-commerce", pattern: /\be-?commerce|storefront|checkout|shopping cart\b/i },
  { id: "pos", label: "POS", pattern: /\bpos\b|point of sale|register|receipt/i },
  { id: "dashboard", label: "Dashboard", pattern: /\bdashboard|analytics|metrics|kpi\b/i },
  { id: "website", label: "Website", pattern: /\bwebsite|marketing site|portfolio|landing page\b/i },
  { id: "mobile", label: "Mobile App", pattern: /\bmobile app|ios|android app\b/i },
  { id: "game", label: "Game", pattern: /\bgame\b|gameplay|hud\b/i },
  { id: "api", label: "API", pattern: /\bapi\b|rest|graphql|backend service/i },
  { id: "ai", label: "AI Application", pattern: /\bai (app|application)|chatbot|rag\b|agent\b/i },
  { id: "desktop", label: "Desktop App", pattern: /\bdesktop app|wpf|winforms|electron|tauri\b/i },
];

function domainBucketFor(mission: MissionState): { id: string; label: string } | null {
  const text = `${mission.title} ${mission.conversationTitle} ${mission.objective}`;
  const bucket = DOMAIN_BUCKETS.find((entry) => entry.pattern.test(text));
  return bucket ? { id: bucket.id, label: bucket.label } : null;
}

export function frequentlyBuilt(missions: MissionState[], limit = 3): PersonalizedCard[] {
  const counts = new Map<string, { label: string; count: number; mostRecent: MissionState }>();
  for (const mission of softwareProjectMissions(missions)) {
    const bucket = domainBucketFor(mission);
    if (!bucket) continue;
    const existing = counts.get(bucket.id);
    if (existing) {
      existing.count += 1;
      if (new Date(mission.updatedAt).getTime() > new Date(existing.mostRecent.updatedAt).getTime()) existing.mostRecent = mission;
    } else {
      counts.set(bucket.id, { label: bucket.label, count: 1, mostRecent: mission });
    }
  }
  return Array.from(counts.entries())
    .filter(([, entry]) => entry.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([id, entry]) => ({
      id: `${id}-frequent`,
      kind: "frequently-built" as const,
      missionId: entry.mostRecent.missionId,
      title: `Frequently Built: ${entry.label}`,
      subtitle: `Built ${entry.count} times`,
    }));
}

/** Template string over the single most-recent completed project's domain — no LLM needed for the label. */
export function suggestedFromRecentDomain(missions: MissionState[]): PersonalizedCard | null {
  const mostRecent = softwareProjectMissions(missions)
    .filter((mission) => deriveMissionDisplayStatus(mission).state === "complete")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  if (!mostRecent) return null;
  const bucket = domainBucketFor(mostRecent);
  if (!bucket) return null;
  return {
    id: `${mostRecent.missionId}-suggested`,
    kind: "suggested-domain",
    missionId: mostRecent.missionId,
    title: `Suggested Because You Built ${bucket.label}`,
    subtitle: "Extend or start something related",
  };
}
