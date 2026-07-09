#!/usr/bin/env node
const http = require("node:http");
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const initialRoot = process.env.FOUNDRY_CONNECTOR_ROOT || process.argv[2] || "";
const port = Number(process.env.FOUNDRY_CONNECTOR_PORT || process.argv[3] || 3917);
const token = process.env.FOUNDRY_CONNECTOR_TOKEN || process.argv[4] || "";
const approvedRoots = new Set();
const maxReadBytes = 300_000;
const maxSearchFileBytes = 300_000;
const commandTimeoutMs = 120_000;
const devServerGracePeriodMs = 6_000;
const maxSnapshotBytes = 200_000;
const longRunningCommandPattern =
  /\b(?:next|vite|nodemon|ts-node-dev)\s+dev\b|\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:dev|start)\b|\bflask\s+run\b|\brails\s+server\b|\bmanage\.py\s+runserver\b|\buvicorn\b|\bgunicorn\b/i;

function isLongRunningServerCommand(command) {
  return longRunningCommandPattern.test(command);
}

function killProcessTree(pid) {
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
const previewProcesses = new Map();
const excludedDirPattern = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|target|bin|obj)(\/|$)/i;
const destructiveCommandPatterns = [
  /\brm\s+-rf\s+(\/|~|\.\s*$)/i,
  /\brd\s+\/s\s+\/q\s+[a-z]:\\?\s*$/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bgit\s+push\s+.*--force/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-fdx/i,
  /\bsudo\b/i,
  /\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sh|bash|iex|invoke-expression)\b/i,
];
const permissionRequiredCommandPatterns = [
  { pattern: /\b(npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:ci|i|install|add|remove|uninstall|upgrade|update)\b/i, reason: "Dependency changes need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(pip|pip3|python\s+-m\s+pip|py\s+-m\s+pip|uv|poetry|pipenv)(?:\.exe)?\s+(?:install|add|remove|uninstall|update|upgrade)\b/i, reason: "Dependency changes need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(dotnet)\s+(?:add|remove)\s+package\b/i, reason: "Dependency changes need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(cargo)\s+(?:add|remove|rm|install|update)\b/i, reason: "Dependency changes need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(flutter)\s+pub\s+(?:add|remove|upgrade|downgrade)\b/i, reason: "Dependency changes need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(gradle|gradlew|mvn|mvnw)(?:\.cmd)?\b.*\b(?:dependency|dependencies|wrapper|publish|deploy)\b/i, reason: "Build-tool dependency or publication commands need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(npx|pnpm\s+dlx|yarn\s+dlx|bunx)(?:\.cmd)?\b/i, reason: "Downloading or running a package executable needs approval.", category: "package-runner" },
  { pattern: /\b(git\s+(?:push|pull|fetch|merge|rebase|commit|tag|checkout|switch|branch|restore|reset|clean|stash))\b/i, reason: "Git history or remote operations need approval.", category: "git" },
  { pattern: /\b(docker|docker-compose|podman|kubectl|helm|terraform|pulumi)\b/i, reason: "Infrastructure and container commands need approval.", category: "infra" },
  { pattern: /\b(vercel|netlify|firebase|wrangler|flyctl|railway|render)\b/i, reason: "Deploy commands need approval.", category: "deploy" },
  { pattern: /\b(prisma|drizzle|sequelize|typeorm|knex|alembic|rails)\b.*\b(migrate|db:|database|schema)\b/i, reason: "Database schema or data commands need approval.", category: "database" },
  { pattern: /\b(powershell|pwsh|bash|sh|cmd)\b.*\b(remove-item|del|erase|rmdir|rm|mv|move|copy-item|set-content|add-content)\b/i, reason: "Shell file mutation commands need approval.", category: "shell-mutation" },
];
const safeCommandPatterns = [
  /\b(npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:build|test|lint|typecheck|check|dev|start|preview)\b/i,
  /\b(node|python|python3|py|ruby|php|java|go|cargo|dotnet|mvn|gradle|pytest|vitest|jest|tsc|eslint|next|vite|astro|svelte-kit)\b/i,
  /\bgit\s+(?:status|log|diff|show|rev-parse|blame|shortlog|describe|ls-files|remote(?:\s+-v)?)\b/i,
];

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

function normalizeRoot(rawRoot) {
  const trimmed = String(rawRoot || "").trim();
  return trimmed ? path.resolve(trimmed) : "";
}

function isApprovedRoot(rawRoot) {
  const normalized = normalizeRoot(rawRoot);
  return Boolean(normalized) && approvedRoots.has(normalized);
}

function connectRoot(rawPath) {
  const normalized = normalizeRoot(rawPath);
  if (!normalized) return { ok: false, error: "A folder path is required." };
  if (!fs.existsSync(normalized)) return { ok: false, error: "That folder does not exist on this machine." };
  if (!fs.statSync(normalized).isDirectory()) return { ok: false, error: "That path is not a folder." };
  approvedRoots.add(normalized);
  return { ok: true, root: normalized };
}

function resolveContained(rawRoot, relativePath = "") {
  const root = normalizeRoot(rawRoot);
  if (!root || !approvedRoots.has(root)) return null;
  const cleaned = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
  const fullPath = path.resolve(root, cleaned || ".");
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) return null;
  return fullPath;
}

function quickAccessRoots() {
  const home = os.homedir();
  const candidates = [];
  if (process.platform === "win32") {
    for (const code of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const drive = `${code}:\\`;
      if (fs.existsSync(drive)) candidates.push({ name: `${code}:\\`, path: drive });
    }
  } else {
    candidates.push({ name: "Home", path: home });
  }
  for (const shortcut of ["Desktop", "Documents", "Downloads", "Projects"]) {
    const full = path.join(home, shortcut);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) candidates.push({ name: shortcut, path: full });
  }
  return candidates;
}

async function browseDirectory(rawPath) {
  if (!rawPath) return { ok: true, path: "", parent: null, entries: quickAccessRoots() };
  const normalized = normalizeRoot(rawPath);
  if (!normalized || !fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    return { ok: false, path: rawPath, parent: null, entries: [], error: "That folder does not exist on this machine." };
  }
  let entries;
  try {
    entries = await fsp.readdir(normalized, { withFileTypes: true });
  } catch {
    return { ok: false, path: normalized, parent: null, entries: [], error: "That folder could not be read (permission denied)." };
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !excludedDirPattern.test(entry.name.toLowerCase()) && !entry.name.startsWith("."))
    .map((entry) => ({ name: entry.name, path: path.join(normalized, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parentDir = path.dirname(normalized);
  return { ok: true, path: normalized, parent: parentDir !== normalized ? parentDir : null, entries: dirs };
}

function createFolder(parentPath, name) {
  const parent = normalizeRoot(parentPath);
  const cleanName = String(name || "").trim();
  if (!parent || !fs.existsSync(parent)) return { ok: false, error: "Parent folder does not exist." };
  if (!cleanName || /[\\/:*?"<>|]/.test(cleanName)) return { ok: false, error: "Enter a valid folder name." };
  const target = path.join(parent, cleanName);
  if (fs.existsSync(target)) return { ok: false, error: "A folder with that name already exists there." };
  fs.mkdirSync(target, { recursive: true });
  return connectRoot(target);
}

function windowsExplorerFolderPickerCommand() {
  const csharp = String.raw`
using System;
using System.Runtime.InteropServices;

[Flags]
public enum FOS : uint {
  FOS_NOCHANGEDIR = 0x00000008,
  FOS_PICKFOLDERS = 0x00000020,
  FOS_FORCEFILESYSTEM = 0x00000040,
  FOS_PATHMUSTEXIST = 0x00000800
}

public enum SIGDN : uint {
  SIGDN_FILESYSPATH = 0x80058000
}

[ComImport]
[Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
public class FileOpenDialogCom {}

[ComImport]
[Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IFileDialog {
  [PreserveSig] int Show(IntPtr parent);
  void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
  void SetFileTypeIndex(uint iFileType);
  void GetFileTypeIndex(out uint piFileType);
  void Advise(IntPtr pfde, out uint pdwCookie);
  void Unadvise(uint dwCookie);
  void SetOptions(FOS fos);
  void GetOptions(out FOS pfos);
  void SetDefaultFolder(IShellItem psi);
  void SetFolder(IShellItem psi);
  void GetFolder(out IShellItem ppsi);
  void GetCurrentSelection(out IShellItem ppsi);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
  void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
  void GetResult(out IShellItem ppsi);
  void AddPlace(IShellItem psi, int fdap);
  void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
  void Close(int hr);
  void SetClientGuid(ref Guid guid);
  void ClearClientData();
  void SetFilter(IntPtr pFilter);
}

[ComImport]
[Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItem {
  void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
  void GetParent(out IShellItem ppsi);
  void GetDisplayName(SIGDN sigdnName, out IntPtr ppszName);
  void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
  void Compare(IShellItem psi, uint hint, out int piOrder);
}

public static class FoundryFolderPicker {
  public static string Pick() {
    IFileDialog dialog = (IFileDialog)new FileOpenDialogCom();
    dialog.SetOptions(FOS.FOS_PICKFOLDERS | FOS.FOS_FORCEFILESYSTEM | FOS.FOS_PATHMUSTEXIST | FOS.FOS_NOCHANGEDIR);
    dialog.SetTitle("Choose the project folder for Foundry");
    dialog.SetOkButtonLabel("Select Folder");
    int hr = dialog.Show(IntPtr.Zero);
    if (hr != 0) return "";
    IShellItem item;
    dialog.GetResult(out item);
    IntPtr pathPtr;
    item.GetDisplayName(SIGDN.SIGDN_FILESYSPATH, out pathPtr);
    try {
      return Marshal.PtrToStringUni(pathPtr);
    } finally {
      Marshal.FreeCoTaskMem(pathPtr);
    }
  }
}
`.trim();

  return [
    "$ErrorActionPreference = 'Stop'",
    `$code = @'\n${csharp}\n'@`,
    "Add-Type -TypeDefinition $code",
    "[FoundryFolderPicker]::Pick()",
  ].join("; ");
}

function pickFolderCommand() {
  if (process.platform === "win32") {
    return {
      cmd: "powershell.exe",
      args: [
        "-NoProfile",
        "-STA",
        "-Command",
        windowsExplorerFolderPickerCommand(),
      ],
    };
  }
  if (process.platform === "darwin") {
    return { cmd: "osascript", args: ["-e", 'POSIX path of (choose folder with prompt "Choose the project folder for Foundry")'] };
  }
  if (process.platform === "linux") {
    return { cmd: "zenity", args: ["--file-selection", "--directory", "--title=Choose the project folder for Foundry"] };
  }
  return null;
}

function pickFolderNative() {
  return new Promise((resolve) => {
    const invocation = pickFolderCommand();
    if (!invocation) return resolve({ ok: false, unsupported: true });
    let child;
    try {
      child = spawn(invocation.cmd, invocation.args, { windowsHide: false });
    } catch {
      return resolve({ ok: false, unsupported: true });
    }
    let stdout = "";
    child.stdout && child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("error", () => {
      resolve(process.platform === "linux" ? { ok: false, unsupported: true } : { ok: false, error: "Could not open the native folder picker." });
    });
    child.on("close", () => {
      const picked = stdout.trim();
      if (!picked) return resolve({ ok: false, cancelled: true });
      resolve(connectRoot(picked));
    });
  });
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk.toString();
  return body ? JSON.parse(body) : {};
}

function simpleDiff(before, after) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const rows = [];
  let firstChangedLine;
  let lastChangedLine;
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    const previous = beforeLines[index] || "";
    const next = afterLines[index] || "";
    if (previous === next) continue;
    if (firstChangedLine === undefined) firstChangedLine = index + 1;
    lastChangedLine = index + 1;
    if (previous && rows.length < 80) rows.push(`- ${previous}`);
    if (next && rows.length < 80) rows.push(`+ ${next}`);
  }
  return { text: rows.join("\n"), firstChangedLine, lastChangedLine };
}

function decideCommandPermission(command) {
  const trimmed = String(command || "").trim();
  if (!trimmed) return { allowed: false, status: "permission-required", reason: "Empty commands are not runnable.", category: "unrecognized" };
  if (destructiveCommandPatterns.some((pattern) => pattern.test(trimmed))) {
    return { allowed: false, status: "destructive", reason: "Command was blocked because it is destructive." };
  }
  const approvalMatch = permissionRequiredCommandPatterns.find((entry) => entry.pattern.test(trimmed));
  if (approvalMatch) return { allowed: false, status: "permission-required", reason: approvalMatch.reason, category: approvalMatch.category };
  if (safeCommandPatterns.some((pattern) => pattern.test(trimmed))) return { allowed: true };
  return { allowed: false, status: "permission-required", reason: "Foundry needs approval before running an unrecognized local command.", category: "unrecognized" };
}

function normalizeRelativePathForFilter(relativePath) {
  return String(relativePath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

function shouldExcludeListedEntry(requestedRelativePath, entryRelativePath) {
  const requested = normalizeRelativePathForFilter(requestedRelativePath);
  if (requested === "node_modules" || requested.startsWith("node_modules/")) return false;
  return excludedDirPattern.test(entryRelativePath);
}

async function listDir(root, relativePath) {
  const fullPath = resolveContained(root, relativePath);
  if (!fullPath || !fs.existsSync(fullPath)) return [];
  const entries = await fsp.readdir(fullPath, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const fullEntryPath = path.join(fullPath, entry.name);
    const relative = path.relative(normalizeRoot(root), fullEntryPath).replace(/\\/g, "/");
    if (shouldExcludeListedEntry(relativePath, relative)) continue;
    if (entry.isDirectory()) result.push({ name: entry.name, kind: "directory" });
    else {
      const stats = await fsp.stat(fullEntryPath);
      result.push({ name: entry.name, kind: "file", size: stats.size });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function readFile(root, relativePath, offsetBytes = 0, limitBytes = 20_000) {
  const fullPath = resolveContained(root, relativePath);
  if (!fullPath || !fs.existsSync(fullPath)) return { exists: false, content: "", truncated: false, totalBytes: 0 };
  const stats = await fsp.stat(fullPath);
  if (!stats.isFile()) return { exists: false, content: "", truncated: false, totalBytes: 0 };
  const raw = await fsp.readFile(fullPath, "utf8");
  const totalBytes = Buffer.byteLength(raw, "utf8");
  const offset = Math.max(0, Number(offsetBytes) || 0);
  const limit = Math.max(1, Math.min(Number(limitBytes) || 20_000, maxReadBytes));
  return { exists: true, content: raw.slice(offset, offset + limit), truncated: offset + limit < raw.length || offset > 0, totalBytes };
}

async function writeFile(root, relativePath, content) {
  const fullPath = resolveContained(root, relativePath);
  if (!fullPath) return { existedBefore: false, verified: false, contentChanged: false, reason: "Refusing to write outside the connected folder." };
  const existedBefore = fs.existsSync(fullPath);
  const before = existedBefore ? await fsp.readFile(fullPath, "utf8").catch(() => "") : "";
  await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  await fsp.writeFile(fullPath, String(content), "utf8");
  const actual = await fsp.readFile(fullPath, "utf8");
  const stats = await fsp.stat(fullPath);
  const contentChanged = existedBefore ? before !== actual : true;
  const verified = actual === String(content) && contentChanged;
  const diffResult = simpleDiff(before, actual);
  return {
    existedBefore,
    verified,
    contentChanged,
    bytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    reason: verified ? undefined : actual !== String(content) ? "Read-back content did not match." : "Write succeeded but file content did not change.",
    diff: diffResult.text,
    firstChangedLine: diffResult.firstChangedLine,
    lastChangedLine: diffResult.lastChangedLine,
    beforeContent: existedBefore && Buffer.byteLength(before, "utf8") <= maxSnapshotBytes ? before : existedBefore ? undefined : "",
  };
}

async function listProjectTree(root, maxEntries = 2000) {
  const resolvedRoot = normalizeRoot(root);
  const entries = [];
  if (!resolvedRoot || !approvedRoots.has(resolvedRoot)) return { entries, truncated: false };
  let truncated = false;
  async function visit(current) {
    if (entries.length >= maxEntries) {
      truncated = true;
      return;
    }
    let dirEntries;
    try {
      dirEntries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of dirEntries) {
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      const fullPath = path.join(current, entry.name);
      const relative = path.relative(resolvedRoot, fullPath).replace(/\\/g, "/");
      if (excludedDirPattern.test(relative) || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      const stats = await fsp.stat(fullPath).catch(() => null);
      entries.push({ path: relative, size: stats ? stats.size : 0 });
    }
  }
  await visit(resolvedRoot);
  return { entries, truncated };
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const net = require("node:net");
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function findPreviewPort() {
  const usedPorts = new Set(Array.from(previewProcesses.values()).map((entry) => entry.port));
  for (let port = 4100; port < 4200; port += 1) {
    if (!usedPorts.has(port) && (await isPortAvailable(port))) return port;
  }
  return 4199;
}

function probeHttpReady(port, attempts = 6, delayMs = 400) {
  return new Promise((resolve) => {
    let remaining = attempts;
    const tryOnce = () => {
      const req = http.get({ host: "127.0.0.1", port, timeout: 1200 }, (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on("error", () => {
        remaining -= 1;
        if (remaining <= 0) return resolve(false);
        setTimeout(tryOnce, delayMs);
      });
      req.on("timeout", () => {
        req.destroy();
        remaining -= 1;
        if (remaining <= 0) return resolve(false);
        setTimeout(tryOnce, delayMs);
      });
    };
    tryOnce();
  });
}

async function hasRunnableDevScript(fullPath) {
  const pkgPath = path.join(fullPath, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(await fsp.readFile(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};
    return Boolean(scripts.dev || scripts.start || scripts.preview);
  } catch {
    return false;
  }
}

function findEntryHtmlFile(fullPath) {
  try {
    const entries = fs.readdirSync(fullPath);
    return entries.find((name) => name.toLowerCase() === "index.html") || entries.find((name) => name.toLowerCase().endsWith(".html"));
  } catch {
    return undefined;
  }
}

async function startPreview(root, relativePath, command) {
  const fullPath = resolveContained(root, relativePath || "");
  if (!fullPath || !fs.existsSync(fullPath)) return { state: "error", reason: "Preview path does not exist on this machine." };
  const key = fullPath;
  const existing = previewProcesses.get(key);
  if (existing) {
    const ready = await probeHttpReady(existing.port, 2, 300);
    return ready
      ? { state: "ready", previewUrl: `http://localhost:${existing.port}` }
      : { state: "starting", previewUrl: `http://localhost:${existing.port}`, reason: "The dev server is still starting up." };
  }

  const canRunDev = Boolean(command) || (await hasRunnableDevScript(fullPath));
  if (!canRunDev) {
    const entryFile = findEntryHtmlFile(fullPath);
    if (!entryFile) return { state: "error", reason: "No dev script and no HTML entry file were found, so there is nothing to preview yet." };
    return { state: "ready", reason: `No dev server needed — confirmed ${entryFile} exists on disk. Open it directly.` };
  }

  const port = await findPreviewPort();
  const devCommand = command || "npm run dev";
  let spawnFailed = false;
  const child = spawn(devCommand, ["--", "-p", String(port)], { cwd: fullPath, shell: true, detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", () => {
    spawnFailed = true;
  });
  child.unref();
  if (spawnFailed) return { state: "error", reason: "Could not start the dev server process." };
  previewProcesses.set(key, { port, pid: child.pid });
  const ready = await probeHttpReady(port, 6, 400);
  if (!ready) {
    return { state: "starting", previewUrl: `http://localhost:${port}`, port, reason: "The dev server was started but has not responded yet — it may still be compiling." };
  }
  return { state: "ready", previewUrl: `http://localhost:${port}`, port };
}

function stopPreview(root, relativePath) {
  const fullPath = resolveContained(root, relativePath || "");
  const key = fullPath || relativePath;
  const existing = previewProcesses.get(key);
  if (!existing) return { state: "unavailable" };
  try {
    if (existing.pid) process.kill(existing.pid);
  } catch {
    // Process may have already exited.
  }
  previewProcesses.delete(key);
  return { state: "unavailable" };
}

async function previewStatus(root, relativePath) {
  const fullPath = resolveContained(root, relativePath || "");
  const key = fullPath || relativePath;
  const existing = previewProcesses.get(key);
  if (!existing) return { state: "unavailable" };
  const ready = await probeHttpReady(existing.port, 1, 0);
  return ready
    ? { state: "ready", previewUrl: `http://localhost:${existing.port}` }
    : { state: "starting", previewUrl: `http://localhost:${existing.port}`, reason: "The dev server has not responded to a health check yet." };
}

async function searchFiles(root, query, maxResults = 20) {
  const needle = String(query || "").toLowerCase();
  const hits = [];
  const resolvedRoot = normalizeRoot(root);
  if (!resolvedRoot || !approvedRoots.has(resolvedRoot)) return hits;
  async function visit(current) {
    if (hits.length >= maxResults) return;
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (hits.length >= maxResults) return;
      const fullPath = path.join(current, entry.name);
      const relative = path.relative(resolvedRoot, fullPath).replace(/\\/g, "/");
      if (excludedDirPattern.test(relative)) continue;
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (entry.name.toLowerCase().includes(needle)) {
        hits.push({ path: relative });
        continue;
      }
      const stats = await fsp.stat(fullPath).catch(() => null);
      if (!stats || stats.size > maxSearchFileBytes) continue;
      const content = await fsp.readFile(fullPath, "utf8").catch(() => "");
      const lines = content.split(/\r?\n/);
      const index = lines.findIndex((line) => line.toLowerCase().includes(needle));
      if (index >= 0) hits.push({ path: relative, line: index + 1, preview: lines[index].trim().slice(0, 200) });
    }
  }
  await visit(resolvedRoot);
  return hits;
}

function normalizeCommandText(command) {
  return String(command || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function tokenizeCommand(command) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(command || "")))) {
    tokens.push(match[1] || match[2] || match[3] || "");
  }
  return tokens.filter(Boolean);
}

function packageNameFromSpec(spec) {
  const cleaned = String(spec || "").trim();
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

function javascriptPackageInstallInfo(command) {
  const tokens = tokenizeCommand(command);
  if (!tokens.length) return null;
  const manager = tokens[0].toLowerCase().replace(/\.cmd$/i, "");
  if (!["npm", "pnpm", "yarn", "bun"].includes(manager)) return null;

  const rawAction = (tokens[1] || "").toLowerCase();
  const action = manager === "yarn" && !rawAction ? "install" : rawAction;
  const packageActions = new Set(["add", "i", "install"]);
  const bareInstallActions = new Set(["ci", "i", "install"]);
  if (!action || (!packageActions.has(action) && !bareInstallActions.has(action))) return null;

  const packages = tokens.slice(rawAction ? 2 : 1).filter((token) => !token.startsWith("-") && token !== "--").map(packageNameFromSpec).filter(Boolean);
  return {
    manager,
    action,
    packages: Array.from(new Set(packages)),
    isBareInstall: bareInstallActions.has(action) && packages.length === 0,
  };
}

function dependencyInstallPackages(command) {
  const info = javascriptPackageInstallInfo(command);
  return info && info.packages.length ? info.packages : null;
}

function isBareDependencyInstallCommand(command) {
  const info = javascriptPackageInstallInfo(command);
  return Boolean(info && info.isBareInstall);
}

function projectDependencyInstallAlreadySatisfied(command, cwd) {
  if (!isBareDependencyInstallCommand(command)) return null;
  const packageJsonPath = path.join(cwd, "package.json");
  const nodeModulesPath = path.join(cwd, "node_modules");
  if (!fs.existsSync(packageJsonPath) || !fs.existsSync(nodeModulesPath)) return null;

  const evidence = ["package.json", "node_modules"];
  for (const lockfile of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"]) {
    if (fs.existsSync(path.join(cwd, lockfile))) evidence.push(lockfile);
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

function dependencyEvidence(cwd, packageName) {
  const evidence = [];
  const packageJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const dependencyBlocks = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
      const listedIn = dependencyBlocks.filter((key) => pkg[key] && pkg[key][packageName]);
      if (listedIn.length) evidence.push(`package.json:${listedIn.join(",")}`);
    } catch {
      // Invalid package metadata should not suppress an approval prompt.
    }
  }

  const lockPath = path.join(cwd, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if ((lock.dependencies && lock.dependencies[packageName]) || (lock.packages && lock.packages[`node_modules/${packageName}`])) {
        evidence.push("package-lock.json");
      }
    } catch {
      // Invalid lockfile should not suppress an approval prompt.
    }
  }

  const pnpmLockPath = path.join(cwd, "pnpm-lock.yaml");
  if (fs.existsSync(pnpmLockPath)) {
    try {
      const lockText = fs.readFileSync(pnpmLockPath, "utf8");
      if (lockText.includes(`${packageName}:`) || lockText.includes(`/${packageName}@`)) evidence.push("pnpm-lock.yaml");
    } catch {
      // Invalid lockfile should not suppress an approval prompt.
    }
  }

  const yarnLockPath = path.join(cwd, "yarn.lock");
  if (fs.existsSync(yarnLockPath)) {
    try {
      const lockText = fs.readFileSync(yarnLockPath, "utf8");
      if (lockText.includes(`${packageName}@`) || lockText.includes(`"node_modules/${packageName}"`)) evidence.push("yarn.lock");
    } catch {
      // Invalid lockfile should not suppress an approval prompt.
    }
  }

  if (fs.existsSync(path.join(cwd, "node_modules", ...packageName.split("/"), "package.json"))) evidence.push("node_modules");

  try {
    require.resolve(packageName, { paths: [cwd] });
    evidence.push("require.resolve");
  } catch {
    // Missing resolution is useful evidence by absence, but not an error here.
  }

  return evidence;
}

function dependencyInstallAlreadySatisfied(command, cwd) {
  const projectSatisfied = projectDependencyInstallAlreadySatisfied(command, cwd);
  if (projectSatisfied) return projectSatisfied;

  const packages = dependencyInstallPackages(command);
  if (!packages) return null;
  const checks = packages.map((packageName) => ({ packageName, evidence: dependencyEvidence(cwd, packageName) }));
  if (checks.some((check) => !check.evidence.includes("node_modules") && !check.evidence.includes("require.resolve"))) return null;
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

const shellMismatchPatterns = [
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

function isShellMismatchFailure(stdout, stderr) {
  const combined = `${stderr}\n${stdout}`;
  return shellMismatchPatterns.some((pattern) => pattern.test(combined));
}

let cachedGitBashPath;
function findGitBashPath() {
  if (cachedGitBashPath !== undefined) return cachedGitBashPath;
  const candidates = [
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : "",
    "C:\\Program Files\\Git\\bin\\bash.exe",
  ].filter(Boolean);
  cachedGitBashPath = candidates.find((candidate) => fs.existsSync(candidate)) || null;
  return cachedGitBashPath;
}

let cachedPwshPath;
function findPwshPath() {
  if (cachedPwshPath !== undefined) return cachedPwshPath;
  try {
    const lookup = process.platform === "win32" ? "where pwsh" : "command -v pwsh";
    const output = execSync(lookup, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split(/\r?\n/)[0];
    cachedPwshPath = output || null;
  } catch {
    cachedPwshPath = null;
  }
  return cachedPwshPath;
}

function windowsShellOrder(stickyShellId) {
  const base = ["cmd", "powershell", "git-bash"];
  if (!stickyShellId) return base;
  return [stickyShellId, ...base.filter((id) => id !== stickyShellId)];
}

function posixShellOrder(stickyShellId) {
  const base = ["default", "pwsh"];
  if (!stickyShellId) return base;
  return [stickyShellId, ...base.filter((id) => id !== stickyShellId)];
}

function shellInvocation(shellId, command) {
  if (shellId === "cmd") return { cmd: "cmd.exe", args: ["/d", "/s", "/c", command] };
  if (shellId === "powershell") return { cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", command] };
  if (shellId === "git-bash") {
    const bashPath = findGitBashPath();
    return bashPath ? { cmd: bashPath, args: ["-lc", command] } : null;
  }
  if (shellId === "default") return { cmd: command, args: [], useShellOption: true };
  if (shellId === "pwsh") {
    const pwshPath = findPwshPath();
    return pwshPath ? { cmd: pwshPath, args: ["-NoProfile", "-NonInteractive", "-Command", command] } : null;
  }
  return null;
}

let stickyShellId;

function spawnCommand(invocation, cwd, timeoutMs, keepAliveOnTimeout = false) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    // A dev/server command (keepAliveOnTimeout) must survive past its own grace-period timeout — detached so
    // it isn't tied to this request's process group, and never killed when the grace period elapses below.
    const spawnOptions = invocation.useShellOption
      ? { cwd, shell: true, windowsHide: true, detached: keepAliveOnTimeout }
      : { cwd, windowsHide: true, detached: keepAliveOnTimeout };
    const child = spawn(invocation.cmd, invocation.args, spawnOptions);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (exitCode) => {
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
        if (child.stdout) child.stdout.destroy();
        if (child.stderr) child.stderr.destroy();
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

    child.stdout && child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr && child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      stderr = stderr || error.message;
      finish(null);
    });
    child.on("close", (exitCode) => finish(exitCode));
  });
}

async function runCommandWithShellFallback(command, cwd, timeoutMs, keepAliveOnTimeout = false) {
  const order = process.platform === "win32" ? windowsShellOrder(stickyShellId) : posixShellOrder(stickyShellId);
  const firstAttemptedShellId = order.find((id) => shellInvocation(id, command));
  let lastResult = null;
  let lastShellId;

  for (const shellId of order) {
    const invocation = shellInvocation(shellId, command);
    if (!invocation) continue;
    const result = await spawnCommand(invocation, cwd, timeoutMs, keepAliveOnTimeout);
    lastResult = result;
    lastShellId = shellId;
    const mismatch = result.exitCode !== 0 && isShellMismatchFailure(result.stdout, result.stderr);
    if (!mismatch) {
      if (shellId !== stickyShellId) stickyShellId = shellId;
      return { ...result, shellUsed: shellId, shellFallbackFrom: shellId !== firstAttemptedShellId ? firstAttemptedShellId : undefined };
    }
  }

  return { ...lastResult, shellUsed: lastShellId };
}

function runCommand(root, command, cwd = "", approvedCommands = [], approvedCategories = []) {
  const requestedCwd = resolveContained(root, cwd);
  if (!requestedCwd) return Promise.resolve({ exitCode: null, stdout: "", stderr: "Refusing to run outside the connected folder.", durationMs: 0, timedOut: false, skipped: "outside-root" });
  const dependencyPreflight = dependencyInstallAlreadySatisfied(command, requestedCwd);
  if (dependencyPreflight) return Promise.resolve(dependencyPreflight);
  const permission = decideCommandPermission(command);
  const exactApproved = approvedCommands.some((entry) => normalizeCommandText(entry) === normalizeCommandText(command));
  const categoryApproved = Boolean(permission.category && approvedCategories.includes(permission.category));
  const bypassed = permission.status === "permission-required" && (exactApproved || categoryApproved);
  if (!permission.allowed && !bypassed) {
    return Promise.resolve({
      exitCode: null,
      stdout: "",
      stderr: permission.reason || "Command requires approval.",
      durationMs: 0,
      timedOut: false,
      skipped: permission.status || "permission-required",
      reason: permission.reason,
      category: permission.category,
    });
  }
  if (isLongRunningServerCommand(command)) {
    return runCommandWithShellFallback(command, requestedCwd, devServerGracePeriodMs, true).then((result) => {
      if (!result.timedOut) return result;
      return {
        ...result,
        exitCode: 0,
        timedOut: false,
        stderr: `${result.stderr}\n[This looks like a long-running dev/server process — it's still running in the background rather than having failed or exited.]`.trim(),
      };
    });
  }

  return runCommandWithShellFallback(command, requestedCwd, commandTimeoutMs);
}

function requireApprovedRoot(res, root) {
  if (isApprovedRoot(root)) return true;
  send(res, 403, { error: "That folder is not connected yet. Call /connect with this path first." });
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 200, { ok: true });
    if (!authorized(req)) return send(res, 401, { error: "Unauthorized connector token." });
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, approvedRoots: Array.from(approvedRoots), commands: true });
    if (req.method !== "POST") return send(res, 404, { error: "Unknown connector endpoint." });
    const body = await readJson(req);
    if (url.pathname === "/connect") return send(res, 200, connectRoot(body.path || ""));
    if (url.pathname === "/browse") return send(res, 200, await browseDirectory(String(body.path || "")));
    if (url.pathname === "/create-folder") return send(res, 200, createFolder(String(body.path || ""), String(body.name || "")));
    if (url.pathname === "/pick-folder") return send(res, 200, await pickFolderNative());
    if (url.pathname === "/list") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, { entries: await listDir(body.root, body.path || "") });
    }
    if (url.pathname === "/read") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await readFile(body.root, body.path || "", body.offsetBytes, body.limitBytes));
    }
    if (url.pathname === "/write") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await writeFile(body.root, body.path || "", body.content || ""));
    }
    if (url.pathname === "/search") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, { hits: await searchFiles(body.root, body.query || "", body.maxResults || 20) });
    }
    if (url.pathname === "/tree") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await listProjectTree(body.root, body.maxEntries || 2000));
    }
    if (url.pathname === "/run") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await runCommand(body.root, String(body.command || ""), String(body.cwd || ""), Array.isArray(body.approvedCommands) ? body.approvedCommands : [], Array.isArray(body.approvedCategories) ? body.approvedCategories : []));
    }
    if (url.pathname === "/preview/start") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await startPreview(body.root, String(body.path || ""), body.command ? String(body.command) : undefined));
    }
    if (url.pathname === "/preview/stop") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, stopPreview(body.root, String(body.path || "")));
    }
    if (url.pathname === "/preview/status") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await previewStatus(body.root, String(body.path || "")));
    }
    return send(res, 404, { error: "Unknown connector endpoint." });
  } catch (error) {
    return send(res, 500, { error: error && error.message ? error.message : "Connector request failed." });
  }
});

if (initialRoot) {
  const preApproved = connectRoot(initialRoot);
  if (!preApproved.ok) console.error(`Could not pre-approve startup root: ${preApproved.error}`);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Foundry local agent listening on http://127.0.0.1:${port}`);
  if (approvedRoots.size) console.log(`Pre-approved folder: ${Array.from(approvedRoots).join(", ")}`);
  else console.log("No folder connected yet — Foundry will ask you to connect one.");
  if (token) console.log("Token required via Authorization: Bearer <token>");
});
