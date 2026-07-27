import type { MissionRecord } from "./model";

export class MissionNotFoundError extends Error {
  constructor(readonly missionId: string) {
    super(`Mission not found: ${missionId}`);
    this.name = "MissionNotFoundError";
  }
}

export class MissionRevisionConflictError extends Error {
  constructor(readonly missionId: string, readonly expected: number, readonly actual: number) {
    super(`Mission ${missionId} revision conflict: expected ${expected}, found ${actual}`);
    this.name = "MissionRevisionConflictError";
  }
}

export interface MissionRepository {
  get(id: string): Promise<MissionRecord | undefined>;
  listByProject(projectId: string): Promise<MissionRecord[]>;
  create(record: MissionRecord): Promise<MissionRecord>;
  save(record: MissionRecord, expectedRevision: number): Promise<MissionRecord>;
}

export class InMemoryMissionRepository implements MissionRepository {
  private readonly records = new Map<string, MissionRecord>();

  async get(id: string): Promise<MissionRecord | undefined> {
    return clone(this.records.get(id));
  }

  async listByProject(projectId: string): Promise<MissionRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((record) => clone(record)!);
  }

  async create(record: MissionRecord): Promise<MissionRecord> {
    if (this.records.has(record.id)) throw new Error(`Mission already exists: ${record.id}`);
    this.records.set(record.id, clone(record)!);
    return clone(record)!;
  }

  async save(record: MissionRecord, expectedRevision: number): Promise<MissionRecord> {
    const current = this.records.get(record.id);
    if (!current) throw new MissionNotFoundError(record.id);
    if (current.revision !== expectedRevision) throw new MissionRevisionConflictError(record.id, expectedRevision, current.revision);
    this.records.set(record.id, clone(record)!);
    return clone(record)!;
  }
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
