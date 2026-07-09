import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { decideCommandPermission, type CommandApprovalScope, type CommandPermissionCategory } from "./command-permissions";

const LONG_RUNNING_COMMAND_PATTERN =
  /\b(?:next|vite|nodemon|ts-node-dev)\s+dev\b|\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:dev|start)\b|\bflask\s+run\b|\brails\s+server\b|\bmanage\.py\s+runserver\b|\buvicorn\b|\bgunicorn\b/i;

function isLongRunningServerCommand(command: string) {
  return LONG_RUNNING_COMMAND_PATTERN.test(command);
}

function killProcessTree(pid: number) {
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${pid} /t /f`, { stdio: "ignore" });
    } catch {
      // Process may have already exited.
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process may have already exited.
    }
  }
}

export function normalizeCommandText(command: string) {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Generalized detection for env/secret-shaped file paths — never hardcoded to one project's actual filenames. Matches dotenv files (.env, .env.local, .env.production, ...) and common secret-material filenames/extensions. */
export function isSensitiveFilePath(relativePath: string): boolean {
  const basename = relativePath.replace(/\\/g, "/").split("/").pop() ?? relativePath;
  return (
    /^\.env(\..+)?$/i.test(basename) ||
    /^(secrets?|credentials?)\.(json|ya?ml|toml|txt)$/i.test(basename) ||
    /\.(pem|key|pfx|p12)$/i.test(basename) ||
    /^id_rsa$|^id_ed25519$/i.test(basename)
  );
}

function isCommandBypassAllowed(command: string, permission: { allowed: boolean; status?: string; category?: string }, options?: { approvedCommands?: string[]; approvedCategories?: string[] }) {
  if (permission.status !== "permission-required") return false;
  const exactApproved = options?.approvedCommands?.some((entry) => normalizeCommandText(entry) === normalizeCommandText(command));
  const categoryApproved = Boolean(permission.category && options?.approvedCategories?.includes(permission.category));
  return Boolean(exactApproved || categoryApproved);
}

/** Reports which specific grant authorized a command that needed approval — category match, a standing exact-command grant, or a one-time approval for just this run. Returns undefined if the command never needed approval at all. */
function approvalScopeFor(
  command: string,
  permission: { allowed: boolean; status?: string; category?: CommandPermissionCategory },
  options?: { approvedCommands?: string[]; approvedCategories?: string[]; standingApprovedCommands?: string[] },
): CommandApprovalScope | undefined {
  if (permission.status !== "permission-required") return undefined;
  const categoryApproved = Boolean(permission.category && options?.approvedCategories?.includes(permission.category));
  if (categoryApproved && permission.category) return { kind: "category", category: permission.category };
  const exactApproved = options?.approvedCommands?.some((entry) => normalizeCommandText(entry) === normalizeCommandText(command));
  if (exactApproved) {
    const isStanding = options?.standingApprovedCommands?.some((entry) => normalizeCommandText(entry) === normalizeCommandText(command));
    return isStanding ? { kind: "exact-command", command: normalizeCommandText(command) } : { kind: "one-time" };
  }
  return undefined;
}

function tokenizeCommand(command: string) {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command))) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens.filter(Boolean);
}

function packageNameFromSpec(spec: string) {
  const cleaned = spec.trim();
  if (!cleaned || cleaned.startsWith("-")) return "";
  if (/^(?:file:|https?:|git\+|\.{1,2}[\\/]|[a-z]:[\\/])/i.test(cleaned)) return "";
  if (cleaned.startsWith("@")) {
    const parts = cleaned.split("/");
    if (parts.length < 2) return "";
    const name = `${parts[0]}/${parts[1]}`.replace(/@[^/@]+$/, "");
    return /^@[^/\s]+\/[^/\s]+$/.test(name) ? name : "";
  }
  return cleaned.split("@")[0] || "";
}

function javascriptPackageInstallInfo(command: string) {
  const tokens = tokenizeCommand(command);
  if (!tokens.length) return null;
  const manager = tokens[0].toLowerCase().replace(/\.cmd$/i, "");
  if (!["npm", "pnpm", "yarn", "bun"].includes(manager)) return null;

  const rawAction = tokens[1]?.toLowerCase();
  const action = manager === "yarn" && !rawAction ? "install" : rawAction;
  const packageActions = new Set(["add", "i", "install"]);
  const bareInstallActions = new Set(["ci", "i", "install"]);
  if (!action || (!packageActions.has(action) && !bareInstallActions.has(action))) return null;

  const packages = tokens
    .slice(rawAction ? 2 : 1)
    .filter((token) => !token.startsWith("-") && token !== "--")
    .map(packageNameFromSpec)
    .filter(Boolean);
  return {
    manager,
    action,
    packages: Array.from(new Set(packages)),
    isBareInstall: bareInstallActions.has(action) && packages.length === 0,
  };
}

function dependencyInstallPackages(command: string) {
  const info = javascriptPackageInstallInfo(command);
  return info?.packages.length ? info.packages : null;
}

function isBareDependencyInstallCommand(command: string) {
  return Boolean(javascriptPackageInstallInfo(command)?.isBareInstall);
}

async function projectDependencyInstallAlreadySatisfied(command: string, cwd: string): Promise<ProjectCommandResult | null> {
  if (!isBareDependencyInstallCommand(command)) return null;
  const packageJsonPath = path.join(cwd, "package.json");
  const nodeModulesPath = path.join(cwd, "node_modules");
  if (!existsSync(packageJsonPath) || !existsSync(nodeModulesPath)) return null;

  const evidence = ["package.json", "node_modules"];
  for (const lockfile of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"]) {
    if (existsSync(path.join(cwd, lockfile))) evidence.push(lockfile);
  }

  return {
    exitCode: 0,
    stdout: `JavaScript dependency install skipped: project dependencies already appear installed.\nEvidence: ${evidence.join(", ")}`,
    stderr: "",
    durationMs: 0,
    timedOut: false,
    skipped: "dependency-present",
    reason: "Foundry found package.json and node_modules already present, so it skipped the JavaScript package-manager install instead of asking for approval.",
    category: "dependencies",
  };
}

async function dependencyEvidence(cwd: string, packageName: string) {
  const evidence: string[] = [];
  const packageJsonPath = path.join(cwd, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, Record<string, unknown> | undefined>;
      const dependencyBlocks = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
      const listedIn = dependencyBlocks.filter((key) => Boolean(pkg[key]?.[packageName]));
      if (listedIn.length) evidence.push(`package.json:${listedIn.join(",")}`);
    } catch {
      // Invalid package metadata should not suppress an approval prompt.
    }
  }

  const lockPath = path.join(cwd, "package-lock.json");
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as { dependencies?: Record<string, unknown>; packages?: Record<string, unknown> };
      if (lock.dependencies?.[packageName] || lock.packages?.[`node_modules/${packageName}`]) evidence.push("package-lock.json");
    } catch {
      // Invalid lockfile should not suppress an approval prompt.
    }
  }

  const pnpmLockPath = path.join(cwd, "pnpm-lock.yaml");
  if (existsSync(pnpmLockPath)) {
    try {
      const lockText = await readFile(pnpmLockPath, "utf8");
      if (lockText.includes(`${packageName}:`) || lockText.includes(`/${packageName}@`)) evidence.push("pnpm-lock.yaml");
    } catch {
      // Invalid lockfile should not suppress an approval prompt.
    }
  }

  const yarnLockPath = path.join(cwd, "yarn.lock");
  if (existsSync(yarnLockPath)) {
    try {
      const lockText = await readFile(yarnLockPath, "utf8");
      if (lockText.includes(`${packageName}@`) || lockText.includes(`"node_modules/${packageName}"`)) evidence.push("yarn.lock");
    } catch {
      // Invalid lockfile should not suppress an approval prompt.
    }
  }

  if (existsSync(path.join(cwd, "node_modules", ...packageName.split("/"), "package.json"))) {
    evidence.push("node_modules");
  }

  try {
    execFileSync(process.execPath, ["-e", "require.resolve(process.argv[1])", packageName], { cwd, stdio: "ignore", timeout: 5_000 });
    evidence.push("require.resolve");
  } catch {
    // Missing resolution is useful evidence by absence, but not an error here.
  }

  return evidence;
}

async function javascriptDependencyAlreadySatisfied(command: string, cwd: string): Promise<ProjectCommandResult | null> {
  const projectSatisfied = await projectDependencyInstallAlreadySatisfied(command, cwd);
  if (projectSatisfied) return projectSatisfied;

  const packages = dependencyInstallPackages(command);
  if (!packages) return null;
  const checks = await Promise.all(packages.map(async (packageName) => ({ packageName, evidence: await dependencyEvidence(cwd, packageName) })));
  const missing = checks.filter((check) => !check.evidence.includes("node_modules") && !check.evidence.includes("require.resolve"));
  if (missing.length) return null;
  const lines = [
    "Dependency install skipped: requested package(s) are already available.",
    ...checks.map((check) => `- ${check.packageName}: ${check.evidence.join(", ")}`),
  ];
  return {
    exitCode: 0,
    stdout: lines.join("\n"),
    stderr: "",
    durationMs: 0,
    timedOut: false,
    skipped: "dependency-present",
    reason: "Foundry checked package.json, package manager lockfiles, node_modules, and require.resolve before deciding no install approval was needed.",
    category: "dependencies",
  };
}

function dependencyPresentResult(ecosystemLabel: string, evidenceLines: string[]): ProjectCommandResult {
  return {
    exitCode: 0,
    stdout: [`${ecosystemLabel} dependency install skipped: requested package(s) are already available.`, ...evidenceLines].join("\n"),
    stderr: "",
    durationMs: 0,
    timedOut: false,
    skipped: "dependency-present",
    reason: `Foundry checked ${ecosystemLabel} project files for real evidence before deciding no install approval was needed.`,
    category: "dependencies",
  };
}

async function fileContainsAny(filePath: string, needles: string[]): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  try {
    const text = await readFile(filePath, "utf8");
    return needles.some((needle) => text.toLowerCase().includes(needle.toLowerCase()));
  } catch {
    return false;
  }
}

/** Generalized "add package X" matcher — extracts the sub-command and bare package names for ecosystems whose CLI shape mirrors `<tool> <verb> <package...>`. Never matches JS package managers (handled separately above). */
function genericPackageInstallInfo(command: string, managers: string[], verbs: string[]) {
  const tokens = tokenizeCommand(command);
  if (tokens.length < 2) return null;
  const manager = tokens[0].toLowerCase().replace(/\.exe$/i, "");
  if (!managers.includes(manager)) return null;
  const verbIndex = tokens.findIndex((token, index) => index > 0 && verbs.includes(token.toLowerCase()));
  if (verbIndex === -1) return null;
  const packages = tokens
    .slice(verbIndex + 1)
    .filter((token) => !token.startsWith("-"))
    .map((token) => token.split(/[=<>~!]/)[0].trim())
    .filter(Boolean);
  return packages.length ? { manager, packages } : null;
}

async function pythonDependencyAlreadySatisfied(command: string, cwd: string): Promise<ProjectCommandResult | null> {
  const info = genericPackageInstallInfo(command, ["pip", "pip3", "poetry", "pipenv", "uv"], ["install", "add"]);
  if (!info) return null;
  const checks = await Promise.all(
    info.packages.map(async (packageName) => {
      const normalized = packageName.replace(/[-_.]+/g, "-").toLowerCase();
      const inRequirements = await fileContainsAny(path.join(cwd, "requirements.txt"), [packageName]);
      const inPyproject = await fileContainsAny(path.join(cwd, "pyproject.toml"), [packageName]);
      const venvDirs = ["venv", ".venv", "env"];
      let inSitePackages = false;
      for (const venvDir of venvDirs) {
        const libDir = path.join(cwd, venvDir, "lib");
        if (!existsSync(libDir)) continue;
        try {
          const pythonDirs = await readdir(libDir);
          for (const pythonDir of pythonDirs) {
            const sitePackages = path.join(libDir, pythonDir, "site-packages");
            if (!existsSync(sitePackages)) continue;
            const entries = await readdir(sitePackages);
            if (entries.some((entry) => entry.replace(/[-_.]+/g, "-").toLowerCase().startsWith(normalized))) {
              inSitePackages = true;
              break;
            }
          }
        } catch {
          // Unreadable venv layout should not suppress an approval prompt.
        }
        if (inSitePackages) break;
      }
      const evidence = [inRequirements && "requirements.txt", inPyproject && "pyproject.toml", inSitePackages && "site-packages"].filter(Boolean) as string[];
      return { packageName, evidence };
    }),
  );
  if (checks.some((check) => !check.evidence.length)) return null;
  return dependencyPresentResult("Python", checks.map((check) => `- ${check.packageName}: ${check.evidence.join(", ")}`));
}

async function dotnetDependencyAlreadySatisfied(command: string, cwd: string): Promise<ProjectCommandResult | null> {
  const match = command.match(/\bdotnet\s+add\s+(?:[\w./\\-]+\s+)?package\s+([A-Za-z0-9_.-]+)/i);
  const packageName = match?.[1];
  if (!packageName) return null;
  let projectFiles: string[] = [];
  try {
    projectFiles = (await readdir(cwd)).filter((entry) => /\.(cs|fs|vb)proj$/i.test(entry));
  } catch {
    return null;
  }
  for (const projectFile of projectFiles) {
    if (await fileContainsAny(path.join(cwd, projectFile), [`Include="${packageName}"`, `Include='${packageName}'`])) {
      return dependencyPresentResult(".NET", [`- ${packageName}: ${projectFile}`]);
    }
  }
  if (await fileContainsAny(path.join(cwd, "obj", "project.assets.json"), [`"${packageName.toLowerCase()}"`])) {
    return dependencyPresentResult(".NET", [`- ${packageName}: obj/project.assets.json (already restored)`]);
  }
  return null;
}

async function cargoDependencyAlreadySatisfied(command: string, cwd: string): Promise<ProjectCommandResult | null> {
  const info = genericPackageInstallInfo(command, ["cargo"], ["add"]);
  if (!info) return null;
  const checks = await Promise.all(
    info.packages.map(async (packageName) => {
      const inManifest = await fileContainsAny(path.join(cwd, "Cargo.toml"), [`${packageName} =`, `[dependencies.${packageName}]`]);
      const inLock = await fileContainsAny(path.join(cwd, "Cargo.lock"), [`name = "${packageName}"`]);
      const evidence = [inManifest && "Cargo.toml", inLock && "Cargo.lock"].filter(Boolean) as string[];
      return { packageName, evidence };
    }),
  );
  if (checks.some((check) => !check.evidence.length)) return null;
  return dependencyPresentResult("Rust", checks.map((check) => `- ${check.packageName}: ${check.evidence.join(", ")}`));
}

async function flutterDependencyAlreadySatisfied(command: string, cwd: string): Promise<ProjectCommandResult | null> {
  const info = genericPackageInstallInfo(command, ["flutter"], ["add"]);
  if (!info) return null;
  const checks = await Promise.all(
    info.packages.map(async (packageName) => {
      const inPubspec = await fileContainsAny(path.join(cwd, "pubspec.yaml"), [`${packageName}:`]);
      const inLock = await fileContainsAny(path.join(cwd, "pubspec.lock"), [`  ${packageName}:`]);
      const evidence = [inPubspec && "pubspec.yaml", inLock && "pubspec.lock"].filter(Boolean) as string[];
      return { packageName, evidence };
    }),
  );
  if (checks.some((check) => !check.evidence.length)) return null;
  return dependencyPresentResult("Flutter", checks.map((check) => `- ${check.packageName}: ${check.evidence.join(", ")}`));
}

/** Gradle/Maven commands are gated as a category (they don't have a single "add package X" shape like the others), so the only thing reliably pre-checkable is whether the wrapper itself is already set up — a specific dependency-listing command still always asks, since there's no package name to verify evidence against. */
async function gradleWrapperAlreadySatisfied(command: string, cwd: string): Promise<ProjectCommandResult | null> {
  if (!/\b(gradlew)(?:\.bat|\.cmd)?\s+wrapper\b/i.test(command)) return null;
  const hasWrapper = existsSync(path.join(cwd, "gradlew")) && existsSync(path.join(cwd, "gradle", "wrapper", "gradle-wrapper.jar"));
  if (!hasWrapper) return null;
  return dependencyPresentResult("Gradle", ["- wrapper: gradlew and gradle/wrapper/gradle-wrapper.jar already present"]);
}

async function dependencyInstallAlreadySatisfied(command: string, cwd: string): Promise<ProjectCommandResult | null> {
  // Each check is best-effort and only ever short-circuits to "already satisfied" — a missed or
  // failed check always falls through to the normal approval prompt, never the other way around.
  return (
    (await javascriptDependencyAlreadySatisfied(command, cwd)) ??
    (await pythonDependencyAlreadySatisfied(command, cwd)) ??
    (await dotnetDependencyAlreadySatisfied(command, cwd)) ??
    (await cargoDependencyAlreadySatisfied(command, cwd)) ??
    (await flutterDependencyAlreadySatisfied(command, cwd)) ??
    (await gradleWrapperAlreadySatisfied(command, cwd)) ??
    null
  );
}

type WindowsShellId = "cmd" | "powershell" | "git-bash";

const SHELL_MISMATCH_PATTERNS = [
  /is not recognized as an internal or external command/i,
  /was unexpected at this time/i,
  /is not recognized as the name of a cmdlet/i,
  /is not recognized as the name of a/i,
  /command not found/i,
  /syntax error near unexpected token/i,
  /is not a valid statement separator/i,
  /the term '.*' is not recognized/i,
  /unexpected token .* in expression or statement/i,
];

function isShellMismatchFailure(stdout: string, stderr: string) {
  const combined = `${stderr}\n${stdout}`;
  return SHELL_MISMATCH_PATTERNS.some((pattern) => pattern.test(combined));
}

let cachedGitBashPath: string | null | undefined;

function findGitBashPath(): string | null {
  if (cachedGitBashPath !== undefined) return cachedGitBashPath;
  const candidates = [
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : "",
    "C:\\Program Files\\Git\\bin\\bash.exe",
  ].filter(Boolean);
  cachedGitBashPath = candidates.find((candidate) => existsSync(candidate)) ?? null;
  return cachedGitBashPath;
}

function windowsShellOrder(stickyShellId?: WindowsShellId): WindowsShellId[] {
  const base: WindowsShellId[] = ["cmd", "powershell", "git-bash"];
  if (!stickyShellId) return base;
  return [stickyShellId, ...base.filter((id) => id !== stickyShellId)];
}

function shellInvocation(shellId: WindowsShellId, command: string): { cmd: string; args: string[] } | null {
  if (shellId === "cmd") return { cmd: "cmd.exe", args: ["/d", "/s", "/c", command] };
  if (shellId === "powershell") return { cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", command] };
  const bashPath = findGitBashPath();
  return bashPath ? { cmd: bashPath, args: ["-lc", command] } : null;
}

function childProcessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // This runs in-process inside the Foundry dev/prod server — don't leak its own PORT
  // (or similar runtime-assigned vars) into spawned project commands like "next dev".
  delete env.PORT;
  return env;
}

function spawnCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  keepAliveOnTimeout = false,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; durationMs: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    // A dev/server command (keepAliveOnTimeout) must survive past its own grace-period timeout — detached so
    // it isn't tied to this request's process group, and never killed when the grace period elapses below.
    const child = spawn(cmd, args, { cwd, windowsHide: true, env: childProcessEnv(), detached: keepAliveOnTimeout });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode,
        stdout: stdout.length > 20_000 ? `${stdout.slice(0, 20_000)}\n[output truncated]` : stdout,
        stderr: stderr.length > 20_000 ? `${stderr.slice(0, 20_000)}\n[output truncated]` : stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      if (keepAliveOnTimeout) {
        // The grace period was only ever meant to capture startup output as evidence — actually killing the
        // server here (the previous behavior) contradicted the caller's own claim that it's "still running
        // in the background". Stop listening and let it run for real, independent of this request.
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        finish(null);
        return;
      }
      if (typeof child.pid === "number") killProcessTree(child.pid);
      else child.kill();
      // On Windows, killing a shell-wrapped child does not always fire 'close' for the
      // original process — force resolution instead of hanging the mission forever.
      setTimeout(() => finish(null), 500);
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      stderr = stderr || error.message;
      finish(null);
    });
    child.on("close", (exitCode) => finish(exitCode));
  });
}

async function runCommandWithShellFallback(command: string, cwd: string, session: { stickyShellId?: WindowsShellId }, timeoutMs: number, keepAliveOnTimeout = false): Promise<ProjectCommandResult> {
  const order = windowsShellOrder(session.stickyShellId);
  const firstAttemptedShellId = order.find((id) => shellInvocation(id, command));
  let lastResult: Awaited<ReturnType<typeof spawnCommand>> | null = null;
  let lastShellId: WindowsShellId | undefined;

  for (const shellId of order) {
    const invocation = shellInvocation(shellId, command);
    if (!invocation) continue;
    const result = await spawnCommand(invocation.cmd, invocation.args, cwd, timeoutMs, keepAliveOnTimeout);
    lastResult = result;
    lastShellId = shellId;
    const isMismatch = result.exitCode !== 0 && isShellMismatchFailure(result.stdout, result.stderr);
    if (!isMismatch) {
      if (shellId !== session.stickyShellId) session.stickyShellId = shellId;
      return {
        ...result,
        shellUsed: shellId,
        shellFallbackFrom: shellId !== firstAttemptedShellId ? firstAttemptedShellId : undefined,
      };
    }
  }

  return { ...(lastResult as NonNullable<typeof lastResult>), shellUsed: lastShellId };
}

export type ProjectAccessMode = "local-folder" | "uploaded-copy";

export type ProjectDirEntry = { name: string; kind: "file" | "directory"; size?: number };
export type ProjectReadResult = { exists: boolean; content: string; truncated: boolean; totalBytes: number };
const MAX_SNAPSHOT_BYTES = 200_000;

export type ProjectWriteResult = {
  existedBefore: boolean;
  verified: boolean;
  contentChanged: boolean;
  bytes?: number;
  modifiedAt?: string;
  reason?: string;
  diff?: string;
  beforeContent?: string;
  firstChangedLine?: number;
  lastChangedLine?: number;
};
export type ProjectCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  skipped?: string;
  reason?: string;
  category?: string;
  shellUsed?: string;
  shellFallbackFrom?: string;
  /** Populated whenever the command actually ran after needing approval — reports which grant let it through. Absent when the command never needed approval in the first place. */
  approvalScope?: CommandApprovalScope;
};
export type ProjectSearchHit = { path: string; line?: number; preview?: string };
export type ProjectDeleteResult = { existed: boolean; verified: boolean; reason?: string };

export interface ProjectAccess {
  readonly mode: ProjectAccessMode;
  readonly rootLabel: string;
  readonly capabilities: { canRunCommands: boolean; canSearch: boolean };
  listDir(relativePath: string): Promise<ProjectDirEntry[]>;
  readFile(relativePath: string, opts?: { offsetBytes?: number; limitBytes?: number }): Promise<ProjectReadResult>;
  writeFile(relativePath: string, content: string): Promise<ProjectWriteResult>;
  runCommand?(
    command: string,
    cwd?: string,
    options?: { approvedCommands?: string[]; approvedCategories?: string[]; standingApprovedCommands?: string[] },
  ): Promise<ProjectCommandResult>;
  searchFiles?(query: string, opts?: { maxResults?: number }): Promise<ProjectSearchHit[]>;
  /** Deletes a file inside the project root. Optional — connections that don't support it (e.g. the local connector agent, until it's updated) simply omit this, and callers treat it as unsupported. */
  deleteFile?(relativePath: string): Promise<ProjectDeleteResult>;
}

const EXCLUDED_DIR_PATTERN = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|target|bin|obj)(\/|$)/i;
const MAX_READ_BYTES = 20_000;
const MAX_SEARCH_FILE_BYTES = 300_000;
const COMMAND_TIMEOUT_MS = 120_000;
const DEV_SERVER_GRACE_PERIOD_MS = 6_000;
const MAX_COMMANDS_PER_ROOT = 15;

function normalizeRelativePathForFilter(relativePath: string) {
  return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

function shouldExcludeListedEntry(requestedRelativePath: string, entryRelativePath: string) {
  const requested = normalizeRelativePathForFilter(requestedRelativePath);
  if (requested === "node_modules" || requested.startsWith("node_modules/")) return false;
  return EXCLUDED_DIR_PATTERN.test(entryRelativePath);
}

function resolveContained(root: string, relativePath: string) {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const fullPath = path.resolve(root, cleaned || ".");
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) return null;
  return fullPath;
}

export function simpleDiff(before: string, after: string) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let added = 0;
  let removed = 0;
  let firstChangedLine: number | undefined;
  let lastChangedLine: number | undefined;
  const rows: string[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    const previous = beforeLines[index] ?? "";
    const next = afterLines[index] ?? "";
    if (previous === next) continue;
    if (firstChangedLine === undefined) firstChangedLine = index + 1;
    lastChangedLine = index + 1;
    if (previous) {
      removed += 1;
      if (rows.length < 80) rows.push(`- ${previous}`);
    }
    if (next) {
      added += 1;
      if (rows.length < 80) rows.push(`+ ${next}`);
    }
  }
  return { added, removed, text: rows.join("\n"), firstChangedLine, lastChangedLine };
}

export function createServerProjectAccess(root: string, mode: ProjectAccessMode): ProjectAccess {
  const resolvedRoot = path.resolve(root);
  let commandsRun = 0;
  const shellSession: { stickyShellId?: WindowsShellId } = {};

  return {
    mode,
    rootLabel: resolvedRoot,
    capabilities: { canRunCommands: true, canSearch: true },

    async listDir(relativePath) {
      const fullPath = resolveContained(resolvedRoot, relativePath);
      if (!fullPath || !existsSync(fullPath)) return [];
      try {
        const entries = await readdir(fullPath, { withFileTypes: true });
        const results: ProjectDirEntry[] = [];
        for (const entry of entries) {
          const entryRelative = path.relative(resolvedRoot, path.join(fullPath, entry.name)).replace(/\\/g, "/");
          if (shouldExcludeListedEntry(relativePath, entryRelative)) continue;
          if (entry.isDirectory()) {
            results.push({ name: entry.name, kind: "directory" });
          } else {
            const details = await stat(path.join(fullPath, entry.name));
            results.push({ name: entry.name, kind: "file", size: details.size });
          }
        }
        return results.sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        return [];
      }
    },

    async readFile(relativePath, opts = {}) {
      const fullPath = resolveContained(resolvedRoot, relativePath);
      if (!fullPath || !existsSync(fullPath)) return { exists: false, content: "", truncated: false, totalBytes: 0 };
      try {
        const details = await stat(fullPath);
        if (!details.isFile()) return { exists: false, content: "", truncated: false, totalBytes: 0 };
        const raw = await readFile(fullPath, "utf8");
        const totalBytes = Buffer.byteLength(raw, "utf8");
        const offset = Math.max(0, opts.offsetBytes ?? 0);
        const limit = Math.max(1, Math.min(opts.limitBytes ?? MAX_READ_BYTES, MAX_READ_BYTES));
        const sliced = raw.slice(offset, offset + limit);
        return { exists: true, content: sliced, truncated: offset + limit < raw.length || offset > 0, totalBytes };
      } catch {
        return { exists: false, content: "", truncated: false, totalBytes: 0 };
      }
    },

    async writeFile(relativePath, content) {
      const fullPath = resolveContained(resolvedRoot, relativePath);
      if (!fullPath) return { existedBefore: false, verified: false, contentChanged: false, reason: "Refusing to write outside the project root." };
      if (fullPath === resolvedRoot) return { existedBefore: true, verified: false, contentChanged: false, reason: "A file path is required. Refusing to write to the project root itself." };
      const existedBefore = existsSync(fullPath);
      if (existedBefore && (await stat(fullPath)).isDirectory()) {
        return { existedBefore: true, verified: false, contentChanged: false, reason: `${relativePath} is a directory, not a file. Choose a specific file path.` };
      }
      const before = existedBefore ? await readFile(fullPath, "utf8").catch(() => "") : "";
      try {
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, "utf8");
        const details = await stat(fullPath);
        const actual = await readFile(fullPath, "utf8");
        const contentChanged = existedBefore ? before !== actual : true;
        const verified = actual === content && contentChanged;
        const diffResult = simpleDiff(before, actual);
        return {
          existedBefore,
          verified,
          contentChanged,
          bytes: details.size,
          modifiedAt: details.mtime.toISOString(),
          reason: verified ? undefined : actual !== content ? "Read-back content did not match what was written." : "Write succeeded but file content did not change.",
          diff: diffResult.text,
          firstChangedLine: diffResult.firstChangedLine,
          lastChangedLine: diffResult.lastChangedLine,
          beforeContent: existedBefore && Buffer.byteLength(before, "utf8") <= MAX_SNAPSHOT_BYTES ? before : existedBefore ? undefined : "",
        };
      } catch (error) {
        return { existedBefore, verified: false, contentChanged: false, reason: error instanceof Error ? error.message : "Write failed." };
      }
    },

    async deleteFile(relativePath) {
      const fullPath = resolveContained(resolvedRoot, relativePath);
      if (!fullPath) return { existed: false, verified: false, reason: "Refusing to delete outside the project root." };
      if (fullPath === resolvedRoot) return { existed: true, verified: false, reason: "Refusing to delete the project root itself." };
      const existed = existsSync(fullPath);
      if (!existed) return { existed: false, verified: true };
      try {
        await rm(fullPath, { force: true });
        return { existed: true, verified: !existsSync(fullPath), reason: existsSync(fullPath) ? "File still exists after deletion." : undefined };
      } catch (error) {
        return { existed: true, verified: false, reason: error instanceof Error ? error.message : "Delete failed." };
      }
    },

    async runCommand(command, cwd, options) {
      const requestedCwd = cwd ? resolveContained(resolvedRoot, cwd) : resolvedRoot;
      if (!requestedCwd) {
        return { exitCode: null, stdout: "", stderr: "Refusing to run a command outside the project root.", durationMs: 0, timedOut: false, skipped: "outside-root" };
      }
      const dependencyPreflight = await dependencyInstallAlreadySatisfied(command, requestedCwd);
      if (dependencyPreflight) return dependencyPreflight;
      const permission = decideCommandPermission(command);
      const bypassed = isCommandBypassAllowed(command, permission, options);
      if (!permission.allowed && !bypassed) {
        return {
          exitCode: null,
          stdout: "",
          stderr: permission.reason ?? "Command requires approval.",
          durationMs: 0,
          timedOut: false,
          skipped: permission.status ?? "permission-required",
          reason: permission.reason,
          category: permission.category,
        };
      }
      if (commandsRun >= MAX_COMMANDS_PER_ROOT) {
        return { exitCode: null, stdout: "", stderr: "Command budget for this mission was reached.", durationMs: 0, timedOut: false, skipped: "budget" };
      }
      commandsRun += 1;
      const approvalScope = approvalScopeFor(command, permission, options);

      if (isLongRunningServerCommand(command)) {
        const result = await runCommandWithShellFallback(command, requestedCwd, shellSession, DEV_SERVER_GRACE_PERIOD_MS, true);
        if (result.timedOut) {
          return { ...result, exitCode: 0, timedOut: false, approvalScope, stderr: `${result.stderr}\n[This looks like a long-running dev/server process — it's still running in the background rather than having failed or exited.]`.trim() };
        }
        return { ...result, approvalScope };
      }

      return { ...(await runCommandWithShellFallback(command, requestedCwd, shellSession, COMMAND_TIMEOUT_MS)), approvalScope };
    },

    async searchFiles(query, opts = {}) {
      const maxResults = opts.maxResults ?? 20;
      const needle = query.toLowerCase();
      const hits: ProjectSearchHit[] = [];

      async function visit(current: string) {
        if (hits.length >= maxResults) return;
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          if (hits.length >= maxResults) return;
          const fullPath = path.join(current, entry.name);
          const relative = path.relative(resolvedRoot, fullPath).replace(/\\/g, "/");
          if (EXCLUDED_DIR_PATTERN.test(relative)) continue;
          if (entry.isDirectory()) {
            await visit(fullPath);
            continue;
          }
          if (entry.name.toLowerCase().includes(needle)) {
            hits.push({ path: relative });
            continue;
          }
          const details = await stat(fullPath).catch(() => null);
          if (!details || details.size > MAX_SEARCH_FILE_BYTES) continue;
          const content = await readFile(fullPath, "utf8").catch(() => "");
          const lines = content.split(/\r?\n/);
          const lineIndex = lines.findIndex((line) => line.toLowerCase().includes(needle));
          if (lineIndex >= 0) {
            hits.push({ path: relative, line: lineIndex + 1, preview: lines[lineIndex].trim().slice(0, 200) });
          }
        }
      }

      await visit(resolvedRoot);
      return hits;
    },
  };
}

export type LocalConnectorConfig = {
  url: string;
  token?: string;
  rootLabel?: string;
};

export async function connectLocalConnectorRoot(config: LocalConnectorConfig, folderPath: string): Promise<{ ok: boolean; root?: string; error?: string }> {
  const baseUrl = config.url.replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
  };
  const response = await fetch(`${baseUrl}/connect`, { method: "POST", headers, body: JSON.stringify({ path: folderPath }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: typeof payload.error === "string" ? payload.error : `Agent /connect failed with HTTP ${response.status}.` };
  return payload as { ok: boolean; root?: string; error?: string };
}

export function createLocalConnectorProjectAccess(config: LocalConnectorConfig): ProjectAccess {
  const baseUrl = config.url.replace(/\/+$/, "");
  const root = config.rootLabel || baseUrl;
  const headers = {
    "content-type": "application/json",
    ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
  };

  async function post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ root, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Connector ${endpoint} failed with HTTP ${response.status}.`);
    return payload as T;
  }

  return {
    mode: "local-folder",
    rootLabel: root,
    capabilities: { canRunCommands: true, canSearch: true },
    async listDir(relativePath) {
      const result = await post<{ entries?: ProjectDirEntry[] }>("/list", { path: relativePath });
      return result.entries ?? [];
    },
    async readFile(relativePath, opts = {}) {
      return post<ProjectReadResult>("/read", { path: relativePath, offsetBytes: opts.offsetBytes ?? 0, limitBytes: opts.limitBytes ?? MAX_READ_BYTES });
    },
    async writeFile(relativePath, content) {
      return post<ProjectWriteResult>("/write", { path: relativePath, content });
    },
    async runCommand(command, cwd = "", options) {
      return post<ProjectCommandResult>("/run", {
        command,
        cwd,
        approvedCommands: options?.approvedCommands ?? [],
        approvedCategories: options?.approvedCategories ?? [],
        standingApprovedCommands: options?.standingApprovedCommands ?? [],
      });
    },
    async searchFiles(query, opts = {}) {
      const result = await post<{ hits?: ProjectSearchHit[] }>("/search", { query, maxResults: opts.maxResults ?? 20 });
      return result.hits ?? [];
    },
  };
}
