import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PermissionGrant, PermissionGrantStore } from "./permission-coordinator";

export class FilePermissionGrantStore implements PermissionGrantStore {
  constructor(private readonly filePath: string) {}

  async list(projectId: string): Promise<PermissionGrant[]> {
    const grants = await this.readAll();
    return structuredClone(grants.filter((grant) => grant.projectId === projectId));
  }

  async add(grant: PermissionGrant): Promise<void> {
    const grants = await this.readAll();
    const duplicate = grants.some((candidate) =>
      candidate.projectId === grant.projectId
      && candidate.missionId === grant.missionId
      && candidate.category === grant.category
      && candidate.exactAction === grant.exactAction
      && candidate.scope === grant.scope,
    );
    if (!duplicate) await this.writeAll([...grants, grant]);
  }

  async revoke(predicate: (grant: PermissionGrant) => boolean): Promise<number> {
    const grants = await this.readAll();
    const retained = grants.filter((grant) => !predicate(grant));
    if (retained.length !== grants.length) await this.writeAll(retained);
    return grants.length - retained.length;
  }

  private async readAll(): Promise<PermissionGrant[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isGrant) : [];
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  private async writeAll(grants: PermissionGrant[]) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(grants, null, 2), "utf8");
    await rename(temporary, this.filePath);
  }
}

function isGrant(value: unknown): value is PermissionGrant {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PermissionGrant>;
  return typeof candidate.projectId === "string"
    && typeof candidate.scope === "string"
    && typeof candidate.createdAt === "string";
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
