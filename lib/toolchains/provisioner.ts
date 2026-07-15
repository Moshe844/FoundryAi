import { spawn, spawnSync } from "node:child_process";
import { toolchainById, toolchainsForStack, type ToolchainDefinition, type ToolchainId } from "./catalog";

export type ToolchainRequirement = {
  id: ToolchainId;
  label: string;
  purpose: string;
  executable: string;
  status: "ready" | "missing" | "unsupported";
  canInstall: boolean;
  approvalCommand?: string;
  postInstall?: string;
  detectedVersion?: string;
  reason?: string;
};

export type EnvironmentReadiness = {
  status: "ready" | "needs-setup" | "unsupported";
  platform: NodeJS.Platform;
  requirements: ToolchainRequirement[];
};

export async function environmentReadinessForStack(stackId: string): Promise<EnvironmentReadiness | undefined> {
  const definitions = toolchainsForStack(stackId);
  if (!definitions.length) return undefined;
  const requirements = definitions.map(inspectToolchain);
  return {
    status: requirements.every((item) => item.status === "ready") ? "ready" : requirements.some((item) => item.status === "missing" && item.canInstall) ? "needs-setup" : "unsupported",
    platform: process.platform,
    requirements,
  };
}

export function inspectToolchain(definition: ToolchainDefinition): ToolchainRequirement {
  const version = executableVersion(definition.executable);
  if (version) return { ...base(definition), status: "ready", canInstall: false, detectedVersion: version };
  const recipe = installRecipe(definition);
  if (!recipe) return { ...base(definition), status: "unsupported", canInstall: false, reason: `Foundry does not yet have a trusted installer recipe for ${definition.label} on ${process.platform}.` };
  return { ...base(definition), status: "missing", canInstall: true, approvalCommand: recipe.preview, postInstall: definition.postInstall };
}

export async function installToolchain(id: string, approvedCommand: string) {
  const definition = toolchainById(id);
  if (!definition) throw new Error("Unknown toolchain request.");
  const current = inspectToolchain(definition);
  if (current.status === "ready") return { ok: true, requirement: current, alreadyInstalled: true };
  const recipe = installRecipe(definition);
  if (!recipe || approvedCommand !== recipe.preview) throw new Error("Installation approval did not match Foundry's trusted recipe.");
  let result = await runInstaller(recipe.command, recipe.args, recipe.elevated);
  if (result.exitCode !== 0 && process.platform === "win32" && recipe.command === "winget" && definition.windows.chocolatey && windowsInstallerAvailable("choco")) {
    result = await runInstaller("choco", ["install", definition.windows.chocolatey, "-y", "--no-progress"], true);
  }
  refreshProcessPath();
  const requirement = inspectToolchain(definition);
  const installed = requirement.status === "ready" || result.exitCode === 0;
  return { ok: installed, requirement, exitCode: result.exitCode, output: trim(`${result.stdout}\n${result.stderr}`), postInstall: definition.postInstall, restartMayBeRequired: installed && requirement.status !== "ready" };
}

function base(definition: ToolchainDefinition) {
  return { id: definition.id, label: definition.label, purpose: definition.purpose, executable: definition.executable };
}

function executableVersion(executable: string) {
  const lookup = spawnSync(process.platform === "win32" ? "where.exe" : "which", [executable], { encoding: "utf8", windowsHide: true, timeout: 4000 });
  if (lookup.status !== 0) return "";
  const command = executable === "java" ? ["-version"] : ["--version"];
  const version = spawnSync(executable, command, { encoding: "utf8", windowsHide: true, timeout: 6000 });
  return trim(version.stdout || version.stderr).split(/\r?\n/)[0] || "installed";
}

function installRecipe(definition: ToolchainDefinition): { command: string; args: string[]; preview: string; elevated: boolean } | undefined {
  if (process.platform === "win32") {
    if (definition.windows.winget && windowsInstallerAvailable("winget")) {
      const args = ["install", "--id", definition.windows.winget, "--exact", "--accept-package-agreements", "--accept-source-agreements", "--silent"];
      return { command: "winget", args, preview: `Install ${definition.label} using Foundry's trusted Windows package manager`, elevated: false };
    }
    if (definition.windows.chocolatey && windowsInstallerAvailable("choco")) {
      return { command: "choco", args: ["install", definition.windows.chocolatey, "-y", "--no-progress"], preview: `Install ${definition.label} using Foundry's trusted Windows package manager`, elevated: true };
    }
    return undefined;
  }
  if (process.platform === "darwin" && definition.macos && commandExists("brew")) {
    return { command: "brew", args: ["install", ...(definition.macos.cask ? ["--cask"] : []), definition.macos.brew], preview: `Install ${definition.label} with Homebrew`, elevated: false };
  }
  return undefined;
}

const windowsInstallerCache = new Map<"winget" | "choco", boolean>();
function windowsInstallerAvailable(manager: "winget" | "choco") {
  const cached = windowsInstallerCache.get(manager);
  if (cached != null) return cached;
  const available = manager === "winget" ? commandWorks("winget", ["--version"]) : commandExists("choco");
  windowsInstallerCache.set(manager, available);
  return available;
}

function commandExists(command: string) {
  return spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { stdio: "ignore", windowsHide: true, timeout: 3000 }).status === 0;
}

function commandWorks(command: string, args: string[]) {
  return spawnSync(command, args, { stdio: "ignore", windowsHide: true, timeout: 5000 }).status === 0;
}

function runInstaller(command: string, args: string[], elevated: boolean): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  let executable = command;
  let actualArgs = args;
  if (process.platform === "win32" && elevated) {
    executable = "powershell.exe";
    const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(",");
    actualArgs = ["-NoProfile", "-Command", `$p=Start-Process -FilePath '${command}' -ArgumentList @(${escapedArgs}) -Verb RunAs -Wait -PassThru; exit $p.ExitCode`];
  }
  return new Promise((resolve) => {
    const child = spawn(executable, actualArgs, { windowsHide: false, shell: false, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => child.kill(), 20 * 60 * 1000);
    child.on("close", (exitCode) => { clearTimeout(timer); resolve({ exitCode, stdout, stderr }); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ exitCode: -1, stdout, stderr: `${stderr}\n${error.message}` }); });
  });
}

function refreshProcessPath() {
  if (process.platform !== "win32") return;
  const paths: string[] = [];
  for (const scope of ["HKCU\\Environment", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"]) {
    const result = spawnSync("reg.exe", ["query", scope, "/v", "Path"], { encoding: "utf8", windowsHide: true, timeout: 4000 });
    const value = result.stdout.match(/\sPath\s+REG_\w+\s+(.+)$/im)?.[1]?.trim();
    if (value) paths.push(value);
  }
  if (paths.length) process.env.PATH = `${paths.join(";")};${process.env.PATH ?? ""}`;
}

function trim(value: string) { return value.trim().slice(-6000); }
