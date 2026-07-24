import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type OwnedDesktopProcessRecord = {
  projectId: string;
  projectPath: string;
  executable: string;
  args: string[];
  processId: number;
  recordedAt: number;
};

type OwnedDesktopProcessGlobal = typeof globalThis & {
  __foundryOwnedDesktopProcesses?: Map<number, OwnedDesktopProcessRecord>;
  __foundryOwnedDesktopProcessesRestored?: boolean;
};

const processGlobal = globalThis as OwnedDesktopProcessGlobal;
const ownedDesktopProcesses = processGlobal.__foundryOwnedDesktopProcesses ??= new Map<number, OwnedDesktopProcessRecord>();
const registryDirectory = path.join(process.cwd(), ".foundry-data", "desktop-processes-v1");

function recordPath(record: Pick<OwnedDesktopProcessRecord, "projectId" | "processId">) {
  const identity = createHash("sha256").update(`${record.projectId}:${record.processId}`).digest("hex");
  return path.join(registryDirectory, `${identity}.json`);
}

function canonicalPath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathIsInside(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function projectsOverlap(left: string, right: string) {
  return pathIsInside(left, right) || pathIsInside(right, left);
}

function processIsAlive(processId: number) {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function runningExecutablePath(processId: number) {
  if (!Number.isInteger(processId) || processId <= 0 || !processIsAlive(processId)) return undefined;
  if (process.platform === "win32") {
    try {
      const command = `$process = Get-CimInstance Win32_Process -Filter \"ProcessId = ${processId}\" -ErrorAction Stop; $process.ExecutablePath`;
      return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: 4_000,
      }).trim() || undefined;
    } catch {
      return undefined;
    }
  }
  try {
    return readFileSync(`/proc/${processId}/cmdline`, "utf8").split("\0")[0] || undefined;
  } catch {
    return undefined;
  }
}

function persist(record: OwnedDesktopProcessRecord) {
  try {
    mkdirSync(registryDirectory, { recursive: true });
    writeFileSync(recordPath(record), JSON.stringify(record), "utf8");
  } catch {
    // The process-global registry remains authoritative for this Foundry server lifetime.
  }
}

function forget(record: OwnedDesktopProcessRecord) {
  ownedDesktopProcesses.delete(record.processId);
  try {
    rmSync(recordPath(record), { force: true });
  } catch {
    // A stale disk record is harmless and will be rejected by identity validation on restore.
  }
}

function restoreOwnedDesktopProcesses() {
  if (processGlobal.__foundryOwnedDesktopProcessesRestored) return;
  processGlobal.__foundryOwnedDesktopProcessesRestored = true;
  let names: string[] = [];
  try {
    names = readdirSync(registryDirectory).filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }
  for (const name of names) {
    const filePath = path.join(registryDirectory, name);
    try {
      const record = JSON.parse(readFileSync(filePath, "utf8")) as OwnedDesktopProcessRecord;
      const valid = Boolean(
        record.projectId
        && record.projectPath
        && record.executable
        && Number.isInteger(record.processId)
        && record.processId > 0
        && Date.now() - Number(record.recordedAt || 0) < 604_800_000
        && pathIsInside(record.projectPath, record.executable)
        && canonicalPath(runningExecutablePath(record.processId) || "") === canonicalPath(record.executable),
      );
      if (!valid) {
        rmSync(filePath, { force: true });
        continue;
      }
      ownedDesktopProcesses.set(record.processId, record);
    } catch {
      try { rmSync(filePath, { force: true }); } catch { /* Ignore an unreadable stale record. */ }
    }
  }
}

restoreOwnedDesktopProcesses();

export function commandProducesBuildArtifacts(command: string) {
  const normalized = command.trim().replace(/\s+/g, " ");
  return /\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:build|compile|package)\b/i.test(normalized)
    || /\bdotnet\s+(?:build|publish|pack|test)\b/i.test(normalized)
    || /\b(?:msbuild|xbuild)(?:\.exe)?\b/i.test(normalized)
    || /\b(?:cargo|swift)\s+(?:build|test)\b/i.test(normalized)
    || /\bgo\s+(?:build|install|test)\b/i.test(normalized)
    || /\b(?:gradle|gradlew)(?:\.bat)?\b[^\r\n]*(?:build|assemble|bundle|test)\b/i.test(normalized)
    || /\bmvnw?(?:\.cmd)?\b[^\r\n]*(?:package|verify|install|test)\b/i.test(normalized)
    || /\b(?:cmake\s+--build|ninja\b|make\b|xcodebuild\b|flutter\s+build\b|python(?:3)?\s+-m\s+build\b|mix\s+(?:compile|test)\b)/i.test(normalized);
}

export function registerOwnedDesktopProcess(input: Omit<OwnedDesktopProcessRecord, "recordedAt">) {
  if (!Number.isInteger(input.processId) || input.processId <= 0) return undefined;
  if (!pathIsInside(input.projectPath, input.executable) || !existsSync(input.executable)) return undefined;
  const record: OwnedDesktopProcessRecord = {
    ...input,
    projectPath: path.resolve(input.projectPath),
    executable: path.resolve(input.executable),
    args: input.args.map(String),
    recordedAt: Date.now(),
  };
  ownedDesktopProcesses.set(record.processId, record);
  persist(record);
  return record;
}

export function forgetOwnedDesktopProcess(processId: number) {
  const record = ownedDesktopProcesses.get(processId);
  if (record) forget(record);
}

async function waitForExit(processId: number, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(processId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processIsAlive(processId);
}

async function terminateOwnedProcessTree(processId: number) {
  if (process.platform !== "win32") {
    try { process.kill(processId, "SIGTERM"); } catch { /* Verify below. */ }
    return;
  }
  await new Promise<void>((resolve) => {
    const child = spawn("taskkill.exe", ["/pid", String(processId), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    let settled = false;
    const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* taskkill may already have exited. */ }
      try { process.kill(processId, "SIGKILL"); } catch { /* Target may already have exited. */ }
      finish();
    }, 2_500);
    child.once("close", finish);
    child.once("error", () => {
      try { process.kill(processId, "SIGKILL"); } catch { /* Target may already have exited. */ }
      finish();
    });
  });
}

export async function suspendOwnedDesktopProcesses(projectPath: string) {
  restoreOwnedDesktopProcesses();
  const matching = Array.from(ownedDesktopProcesses.values()).filter((record) => projectsOverlap(projectPath, record.projectPath));
  const suspended: OwnedDesktopProcessRecord[] = [];
  const failed: OwnedDesktopProcessRecord[] = [];
  for (const record of matching) {
    if (!processIsAlive(record.processId)) {
      forget(record);
      continue;
    }
    if (canonicalPath(runningExecutablePath(record.processId) || "") !== canonicalPath(record.executable)) {
      forget(record);
      continue;
    }
    await terminateOwnedProcessTree(record.processId);
    if (await waitForExit(record.processId)) {
      suspended.push(record);
      forget(record);
    } else {
      failed.push(record);
    }
  }
  return { suspended, failed };
}

export async function resumeOwnedDesktopProcesses(records: OwnedDesktopProcessRecord[]) {
  const resumed: OwnedDesktopProcessRecord[] = [];
  const failed: Array<{ record: OwnedDesktopProcessRecord; reason: string }> = [];
  for (const record of records) {
    if (!existsSync(record.executable)) {
      failed.push({ record, reason: "The rebuilt executable was not produced." });
      continue;
    }
    try {
      const child = spawn(record.executable, record.args, {
        cwd: path.dirname(record.executable),
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
      });
      if (typeof child.pid !== "number") throw new Error("Windows did not return a process id.");
      child.unref();
      const resumedRecord = registerOwnedDesktopProcess({
        projectId: record.projectId,
        projectPath: record.projectPath,
        executable: record.executable,
        args: record.args,
        processId: child.pid,
      });
      if (resumedRecord) {
        child.once("exit", () => forgetOwnedDesktopProcess(child.pid!));
        resumed.push(resumedRecord);
      }
    } catch (error) {
      failed.push({ record, reason: error instanceof Error ? error.message : "The rebuilt desktop app could not be relaunched." });
    }
  }
  return { resumed, failed };
}

export function actionableBuildLockMessage(output: string) {
  const cleaned = output.replace(/\x1b\[[0-9;]*m/g, " ").replace(/\s+/g, " ").trim();
  if (!/(?:MSB3026|MSB3027|MSB3021|being used by another process|resource busy|text file busy|EBUSY)/i.test(cleaned)) return undefined;
  const owner = cleaned.match(/locked by:\s*["']?([^"'\[]+?)(?:\s*\((\d+)\))?["']?\s*(?:\[|$)/i);
  const file = cleaned.match(/(?:copy|access)(?:ing)?\s+["']([^"']+)["']/i)?.[1];
  const ownerLabel = owner?.[1]?.trim();
  const pid = owner?.[2];
  const subject = ownerLabel ? `${ownerLabel}${pid ? ` (PID ${pid})` : ""}` : "another running process";
  return `Build output is locked by ${subject}${file ? ` while Foundry updates ${path.basename(file)}` : ""}. Foundry automatically pauses apps it launched; this process was not safely identified as Foundry-owned. Close the running app, then choose Verify again.`;
}
