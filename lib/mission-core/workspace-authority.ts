import type { MissionRecord } from "./model";

export type DurableWorkspaceBinding = {
  workspaceMissionId: string;
  durableMissionId: string;
  revision: number;
  updatedAt: string;
};

export type DurableWorkspaceSnapshot = {
  bindings: Record<string, DurableWorkspaceBinding>;
  missions: Record<string, MissionRecord>;
};

export const durableWorkspaceStorageKey = "foundry.durableMissionAuthority.v1";
export const legacyWorkspaceStorageKey = "foundry.missionThreads.v9";

export function emptyDurableWorkspaceSnapshot(): DurableWorkspaceSnapshot {
  return { bindings: {}, missions: {} };
}

export function normalizeDurableWorkspaceSnapshot(value: unknown): DurableWorkspaceSnapshot {
  if (!value || typeof value !== "object") return emptyDurableWorkspaceSnapshot();
  const candidate = value as Partial<DurableWorkspaceSnapshot>;
  return {
    bindings: candidate.bindings && typeof candidate.bindings === "object" ? candidate.bindings : {},
    missions: candidate.missions && typeof candidate.missions === "object" ? candidate.missions : {},
  };
}

export function bindWorkspaceMission(
  snapshot: DurableWorkspaceSnapshot,
  workspaceMissionId: string,
  mission: MissionRecord,
): DurableWorkspaceSnapshot {
  const existing = snapshot.missions[mission.id];
  if (existing && existing.revision > mission.revision) return snapshot;
  const updatedAt = mission.updatedAt || new Date().toISOString();
  return {
    bindings: {
      ...snapshot.bindings,
      [workspaceMissionId]: {
        workspaceMissionId,
        durableMissionId: mission.id,
        revision: mission.revision,
        updatedAt,
      },
    },
    missions: { ...snapshot.missions, [mission.id]: mission },
  };
}

export function applyAuthoritativeMission(
  snapshot: DurableWorkspaceSnapshot,
  mission: MissionRecord,
): DurableWorkspaceSnapshot {
  const existing = snapshot.missions[mission.id];
  if (existing && existing.revision > mission.revision) return snapshot;
  const bindings = Object.fromEntries(Object.entries(snapshot.bindings).map(([key, binding]) => [
    key,
    binding.durableMissionId === mission.id
      ? { ...binding, revision: mission.revision, updatedAt: mission.updatedAt }
      : binding,
  ]));
  return { bindings, missions: { ...snapshot.missions, [mission.id]: mission } };
}

export function durableMissionForWorkspace(
  snapshot: DurableWorkspaceSnapshot,
  workspaceMissionId: string,
): MissionRecord | undefined {
  const binding = snapshot.bindings[workspaceMissionId];
  return binding ? snapshot.missions[binding.durableMissionId] : undefined;
}

export function extractDurableBindingFromFactoryResult(value: unknown): { durableMissionId: string; durableMissionRevision: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { durableMissionId?: unknown; durableMissionRevision?: unknown };
  if (typeof candidate.durableMissionId !== "string" || !candidate.durableMissionId.trim()) return undefined;
  const revision = typeof candidate.durableMissionRevision === "number" && Number.isFinite(candidate.durableMissionRevision)
    ? candidate.durableMissionRevision
    : 0;
  return { durableMissionId: candidate.durableMissionId, durableMissionRevision: revision };
}

export function discoverDurableBindingsFromWorkspace(value: unknown): DurableWorkspaceBinding[] {
  if (!value || typeof value !== "object") return [];
  const candidate = value as { missions?: unknown[] };
  if (!Array.isArray(candidate.missions)) return [];
  const bindings: DurableWorkspaceBinding[] = [];

  for (const rawMission of candidate.missions) {
    if (!rawMission || typeof rawMission !== "object") continue;
    const mission = rawMission as { missionId?: unknown; createdArtifacts?: unknown[]; updatedAt?: unknown };
    if (typeof mission.missionId !== "string") continue;
    const artifacts = Array.isArray(mission.createdArtifacts) ? mission.createdArtifacts : [];
    for (const rawArtifact of [...artifacts].reverse()) {
      if (!rawArtifact || typeof rawArtifact !== "object") continue;
      const artifact = rawArtifact as { title?: unknown; body?: unknown };
      if (artifact.title !== "Project Execution" || typeof artifact.body !== "string") continue;
      try {
        const result = extractDurableBindingFromFactoryResult(JSON.parse(artifact.body));
        if (!result) continue;
        bindings.push({
          workspaceMissionId: mission.missionId,
          durableMissionId: result.durableMissionId,
          revision: result.durableMissionRevision,
          updatedAt: typeof mission.updatedAt === "string" ? mission.updatedAt : new Date(0).toISOString(),
        });
        break;
      } catch {
        // Ignore malformed legacy artifacts and continue searching older execution results.
      }
    }
  }
  return bindings;
}
