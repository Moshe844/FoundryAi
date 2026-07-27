import type { MissionRecord, MissionStatus } from "./model";

const terminalStatuses = new Set<MissionStatus>(["completed", "completed_with_warnings", "failed", "canceled"]);

const transitions: Record<MissionStatus, ReadonlySet<MissionStatus>> = {
  draft: new Set(["understanding", "canceled"]),
  understanding: new Set(["awaiting_clarification", "planned", "blocked", "failed", "canceled"]),
  awaiting_clarification: new Set(["understanding", "planned", "canceled"]),
  planned: new Set(["awaiting_approval", "executing", "blocked", "canceled"]),
  awaiting_approval: new Set(["executing", "blocked", "canceled"]),
  executing: new Set(["awaiting_approval", "verifying", "repairing", "previewing", "blocked", "failed", "canceled"]),
  verifying: new Set(["repairing", "previewing", "completed", "completed_with_warnings", "blocked", "failed", "canceled"]),
  repairing: new Set(["executing", "verifying", "blocked", "failed", "canceled"]),
  previewing: new Set(["repairing", "verifying", "completed", "completed_with_warnings", "blocked", "failed", "canceled"]),
  completed: new Set(),
  completed_with_warnings: new Set(),
  blocked: new Set(["understanding", "planned", "awaiting_approval", "executing", "repairing", "verifying", "canceled"]),
  failed: new Set(),
  canceled: new Set(),
};

export class InvalidMissionTransitionError extends Error {
  constructor(readonly from: MissionStatus, readonly to: MissionStatus) {
    super(`Invalid mission transition: ${from} -> ${to}`);
    this.name = "InvalidMissionTransitionError";
  }
}

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  return from === to || transitions[from].has(to);
}

export function transitionMission(record: MissionRecord, to: MissionStatus, input: { now?: string; reason?: string } = {}): MissionRecord {
  if (!canTransitionMission(record.status, to)) throw new InvalidMissionTransitionError(record.status, to);
  if (record.status === to) return record;

  const now = input.now ?? new Date().toISOString();
  return {
    ...record,
    status: to,
    revision: record.revision + 1,
    blocker: to === "blocked" ? input.reason || record.blocker : undefined,
    updatedAt: now,
    completedAt: terminalStatuses.has(to) ? now : undefined,
    journal: [
      ...record.journal,
      {
        id: `${record.id}:state:${record.revision + 1}`,
        missionId: record.id,
        at: now,
        type: "state",
        message: input.reason ? `${record.status} -> ${to}: ${input.reason}` : `${record.status} -> ${to}`,
      },
    ],
  };
}

export function assertMissionMayMutate(record: MissionRecord): void {
  if (terminalStatuses.has(record.status)) throw new Error(`Mission ${record.id} is terminal (${record.status}) and cannot be mutated.`);
}
