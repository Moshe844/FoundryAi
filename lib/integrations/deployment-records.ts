import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FactoryDeployment } from "@/lib/factory/types";

const root = path.join(process.cwd(), ".foundry-data", "deployments");

function safeProjectId(projectId: string) {
  const value = projectId.trim();
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(value)) throw new Error("A valid project id is required.");
  return value;
}

function recordPath(projectId: string) {
  return path.join(root, `${safeProjectId(projectId)}.json`);
}

export async function deploymentRecord(projectId: string): Promise<FactoryDeployment | undefined> {
  try {
    return JSON.parse(await readFile(recordPath(projectId), "utf8")) as FactoryDeployment;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function saveDeploymentRecord(projectId: string, deployment: FactoryDeployment) {
  await mkdir(root, { recursive: true });
  const target = recordPath(projectId);
  const temporary = `${target}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(deployment, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  return deployment;
}
