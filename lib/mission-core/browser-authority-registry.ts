import type { MissionRecord } from "./model";

const registryKey = "__foundryDurableMissionRegistryV1";

export type DurableMissionRegistry = {
  byWorkspaceMissionId: Map<string, MissionRecord>;
  revision: number;
};

function registry(): DurableMissionRegistry {
  const root = globalThis as typeof globalThis & { [registryKey]?: DurableMissionRegistry };
  if (!root[registryKey]) {
    root[registryKey] = { byWorkspaceMissionId: new Map(), revision: 0 };
  }
  return root[registryKey];
}

export function registerAuthoritativeWorkspaceMission(workspaceMissionId: string, mission: MissionRecord) {
  const current = registry();
  const existing = current.byWorkspaceMissionId.get(workspaceMissionId);
  if (existing && existing.revision > mission.revision) return false;
  current.byWorkspaceMissionId.set(workspaceMissionId, mission);
  current.revision += 1;
  return true;
}

export function authoritativeMissionForWorkspace(workspaceMissionId: string): MissionRecord | undefined {
  return registry().byWorkspaceMissionId.get(workspaceMissionId);
}

export function durableAuthorityRevision() {
  return registry().revision;
}

export function clearAuthoritativeWorkspaceMission(workspaceMissionId: string) {
  const current = registry();
  if (!current.byWorkspaceMissionId.delete(workspaceMissionId)) return false;
  current.revision += 1;
  return true;
}
