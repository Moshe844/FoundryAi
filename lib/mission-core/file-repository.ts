import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MissionRecord } from "./model";
import { MissionNotFoundError, MissionRevisionConflictError, type MissionRepository } from "./repository";

export class FileMissionRepository implements MissionRepository {
  constructor(private readonly rootDirectory: string) {}

  async get(id: string): Promise<MissionRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.filePath(id), "utf8")) as MissionRecord;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async listByProject(projectId: string): Promise<MissionRecord[]> {
    await mkdir(this.rootDirectory, { recursive: true });
    const files = await readdir(this.rootDirectory);
    const records = await Promise.all(files.filter((file) => file.endsWith(".json")).map((file) => this.readPath(path.join(this.rootDirectory, file))));
    return records.filter((record): record is MissionRecord => Boolean(record && record.projectId === projectId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async create(record: MissionRecord): Promise<MissionRecord> {
    await mkdir(this.rootDirectory, { recursive: true });
    if (await this.get(record.id)) throw new Error(`Mission already exists: ${record.id}`);
    await this.atomicWrite(record);
    return structuredClone(record);
  }

  async save(record: MissionRecord, expectedRevision: number): Promise<MissionRecord> {
    const current = await this.get(record.id);
    if (!current) throw new MissionNotFoundError(record.id);
    if (current.revision !== expectedRevision) throw new MissionRevisionConflictError(record.id, expectedRevision, current.revision);
    await this.atomicWrite(record);
    return structuredClone(record);
  }

  private filePath(id: string) {
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.rootDirectory, `${safeId}.json`);
  }

  private async readPath(filePath: string) {
    try { return JSON.parse(await readFile(filePath, "utf8")) as MissionRecord; }
    catch { return undefined; }
  }

  private async atomicWrite(record: MissionRecord) {
    await mkdir(this.rootDirectory, { recursive: true });
    const target = this.filePath(record.id);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(record, null, 2), "utf8");
    await rename(temporary, target);
  }
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
