import type { MissionState } from "@/lib/mission-engine";

/** The generated project identity becomes durable at folder creation, before the terminal result. */
export function generatedWorkspaceForMission(mission: MissionState): { projectId: string; projectPath: string } | null {
  const events = mission.executionMissions.flatMap((item) => item.timeline);
  for (const event of [...events].reverse()) {
    if (event.kind !== "folder") continue;
    const candidate = (typeof event.details?.projectPath === "string" ? event.details.projectPath : "")
      || (typeof event.details?.path === "string" ? event.details.path : "")
      || event.filePath
      || "";
    const normalized = candidate.replace(/[\\/]+$/, "");
    const match = normalized.match(/[\\/]projects[\\/]([^\\/]+)$/i);
    if (match) return { projectId: match[1], projectPath: candidate };
  }
  return null;
}
