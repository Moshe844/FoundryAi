#!/usr/bin/env node
const http = require("node:http");
const { spawn, spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { validationCapabilities, runBrowserValidation, compareScreenshots, runAndroidValidation, runIosValidation, runDesktopValidation, commandProducesBuildArtifacts, suspendOwnedDesktopProcesses, resumeOwnedDesktopProcesses } = require("./local-agent-validation.cjs");

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
  /\b(?:next|vite|nodemon|ts-node-dev)\s+dev\b|\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:dev|start)\b|\b(?:python|python3|py)(?:\.exe)?\s+-m\s+http\.server\b|\bflask\s+run\b|\brails\s+server\b|\bmanage\.py\s+runserver\b|\buvicorn\b|\bgunicorn\b/i;

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
const previewRegistryDirectory = path.join(os.tmpdir(), "foundry-local-preview-records-v1");

function previewRecordPath(previewPath) {
  const identity = process.platform === "win32" ? path.resolve(previewPath).toLowerCase() : path.resolve(previewPath);
  return path.join(previewRegistryDirectory, `${crypto.createHash("sha256").update(identity).digest("hex")}.json`);
}

function persistPreviewRecord(previewPath, preview) {
  try {
    fs.mkdirSync(previewRegistryDirectory, { recursive: true });
    fs.writeFileSync(previewRecordPath(previewPath), JSON.stringify({ previewPath: path.resolve(previewPath), ...preview, recordedAt: Date.now() }), "utf8");
  } catch {
    // Runtime deletion still has in-memory ownership; persistence only adds restart recovery.
  }
}

function forgetPreviewRecord(previewPath) {
  try {
    fs.rmSync(previewRecordPath(previewPath), { force: true });
  } catch {
    // A missing/stale record is already forgotten.
  }
}

function restorePreviewRecords() {
  let records = [];
  try {
    records = fs.readdirSync(previewRegistryDirectory).filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }
  for (const recordName of records) {
    const recordPath = path.join(previewRegistryDirectory, recordName);
    try {
      const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
      if (!record.previewPath || !record.pid || !record.port || Date.now() - Number(record.recordedAt || 0) > 86_400_000 || !processIsRunning(record.pid)) {
        fs.rmSync(recordPath, { force: true });
        continue;
      }
      previewProcesses.set(path.resolve(record.previewPath), {
        port: Number(record.port),
        pid: Number(record.pid),
        ownershipToken: record.ownershipToken,
        kind: record.kind === "app" ? "app" : "static",
        previewUrl: String(record.previewUrl || `http://127.0.0.1:${record.port}`),
      });
    } catch {
      try { fs.rmSync(recordPath, { force: true }); } catch { /* Ignore an unreadable stale record. */ }
    }
  }
}

restorePreviewRecords();
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
const safeAdapterVerificationPatterns = [
  /^R(?:\.exe)?\s+CMD\s+(?:check|build)\b/i,
  /^composer(?:\.bat)?\s+validate\b/i,
  /^bundle(?:\.bat)?\s+exec\s+(?:rubocop|rspec|rails\s+test)\b/i,
  /^swift\s+(?:build|test)\b/i,
  /^cmake\s+(?:-S\b|--build\b)/i,
  /^ctest\s+--test-dir\b/i,
  /^meson\s+(?:setup|compile|test)\b/i,
  /^mix\s+(?:format\s+--check-formatted|compile\s+--warnings-as-errors|test)\b/i,
  /^sbt\s+(?:compile|test)\b/i,
  /^dart\s+(?:format\s+--output=none|analyze|test)\b/i,
  /^(?:luacheck|busted)\b/i,
  /^pwsh(?:\.exe)?\s+-NoProfile\s+-Command\s+Invoke-ScriptAnalyzer\b/i,
  /^shellcheck\b/i,
  /^godot(?:\.exe)?\s+--headless\s+--editor\b/i,
];

function isSafeAdapterVerificationCommand(command) {
  if (/[&|;<>`$\r\n]/.test(command)) return false;
  return safeAdapterVerificationPatterns.some((pattern) => pattern.test(command));
}

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-private-network": "true",
    "access-control-max-age": "600",
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
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
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
  if (safeCommandPatterns.some((pattern) => pattern.test(trimmed)) || isReadOnlyExistenceProbe(trimmed) || isSafeAdapterVerificationCommand(trimmed)) return { allowed: true };
  return { allowed: false, status: "permission-required", reason: "Foundry needs approval before running an unrecognized local command.", category: "unrecognized" };
}

// Mirror of lib/ai/mission/command-permissions.ts::isReadOnlyExistenceProbe — kept in sync by hand because
// the connector is a standalone process that cannot import the app's TypeScript. A read-only existence
// probe (`dir node_modules\pkg 2>nul || echo NOT_FOUND`, `powershell -Command "Test-Path ..."`,
// `ls x | findstr y`, `node -e "require.resolve('pkg')"`) reads the filesystem/module graph and mutates
// nothing, so it must not trigger an approval prompt. Destructive/permission patterns are checked before
// this, and the base whitelist only allows inspection verbs, so no mutation slips through.
function isReadOnlyExistenceProbe(command) {
  const wrapper = String(command || "").trim().match(/^(?:powershell|pwsh|cmd|bash|sh)(?:\.exe)?\s+(?:-command|-c|\/c|\/k)\s+(.+)$/i);
  const inner = wrapper ? wrapper[1].trim().replace(/^["']|["']$/g, "") : String(command || "");
  const stderrStripped = inner.replace(/\s+2>\s*(?:nul|\/dev\/null)\b/gi, "");
  const chainStripped = stderrStripped.replace(/\s*(?:\|\||&&)\s*echo\s+[\w.\-/\\]+\s*$/i, "").trim();
  const pipeStripped = chainStripped
    .replace(/\s*\|\s*(?:findstr|find|grep|egrep|fgrep|select-string|sls|wc|head|tail|more|sort|uniq|select-object|measure-object|out-string)\b[^|&;<>`$]*$/i, "")
    .trim();
  if (/[&|;<>`$]/.test(pipeStripped)) return false;
  return (
    /^(?:dir|ls|type|cat|stat|Test-Path|Get-Item|Get-ChildItem|where|which)\b/i.test(pipeStripped) ||
    /^test\s+-[ef]\b/i.test(pipeStripped) ||
    /^node\s+(?:-e|--eval)\b.*require\.resolve/i.test(pipeStripped)
  );
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
  return {
    exists: true,
    content: raw.slice(offset, offset + limit),
    truncated: offset + limit < raw.length || offset > 0,
    totalBytes,
    contentHash: crypto.createHash("sha256").update(raw).digest("hex"),
  };
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
  const verified = actual === String(content);
  const diffResult = simpleDiff(before, actual);
  return {
    existedBefore,
    verified,
    contentChanged,
    bytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    reason: verified ? undefined : "Read-back content did not match.",
    diff: diffResult.text,
    firstChangedLine: diffResult.firstChangedLine,
    lastChangedLine: diffResult.lastChangedLine,
    beforeContent: existedBefore && Buffer.byteLength(before, "utf8") <= maxSnapshotBytes ? before : existedBefore ? undefined : "",
  };
}

async function writeBinary(root, relativePath, base64) {
  const fullPath = resolveContained(root, relativePath);
  if (!fullPath) return { existedBefore: false, verified: false, contentChanged: false, reason: "Refusing to write outside the connected folder." };
  const existedBefore = fs.existsSync(fullPath);
  const before = existedBefore ? await fsp.readFile(fullPath).catch(() => Buffer.alloc(0)) : Buffer.alloc(0);
  const expected = Buffer.from(String(base64 || ""), "base64");
  if (!expected.length) return { existedBefore, verified: false, contentChanged: false, reason: "The attached asset contained no decodable bytes." };
  await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  await fsp.writeFile(fullPath, expected);
  const actual = await fsp.readFile(fullPath);
  const stats = await fsp.stat(fullPath);
  const verified = actual.equals(expected);
  return {
    existedBefore,
    verified,
    contentChanged: !existedBefore || !before.equals(actual),
    bytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    reason: verified ? undefined : "Read-back bytes did not match the attached asset.",
  };
}

async function deleteProjectRoot(rawRoot) {
  const root = normalizeRoot(rawRoot);
  const home = normalizeRoot(os.homedir());
  if (!root || !approvedRoots.has(root)) return { existed: false, verified: false, reason: "That folder is not connected." };
  if (root === path.parse(root).root || root === home) {
    return { existed: fs.existsSync(root), verified: false, reason: "Refusing to delete a filesystem root or the user home folder." };
  }
  const existed = fs.existsSync(root);
  if (!existed) {
    approvedRoots.delete(root);
    return { existed: false, verified: true };
  }
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await stopPreviewsForRoot(root);
    try {
      await fsp.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      if (!fs.existsSync(root)) {
        approvedRoots.delete(root);
        return { existed: true, verified: true };
      }
      lastError = new Error("Project folder still exists after deletion.");
    } catch (error) {
      lastError = error;
    }
    if (attempt < 1) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const lockOwners = findWindowsDirectoryLockOwners(root);
  const lockMessage = lockOwners.length
    ? ` The folder is held open by ${lockOwners.map((owner) => `${owner.name} (PID ${owner.pid})`).join(", ")}. Save any work, close ${lockOwners.map((owner) => owner.name).join(" and ")}, then retry deletion. Foundry did not force-close an external app because that could discard unsaved work.`
    : " Close any terminal, editor, or file manager using this folder, then retry deletion.";
  const failure = lastError instanceof Error ? lastError.message : "Project deletion failed after releasing Foundry-owned project processes and retrying.";
  return { existed: true, verified: false, reason: `${failure}${lockMessage}`, lockOwners };
}

function findWindowsDirectoryLockOwners(root) {
  if (process.platform !== "win32") return [];
  const script = path.join(__dirname, "find-windows-process-cwds.ps1");
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Path", root], {
      encoding: "utf8",
      timeout: 8_000,
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout.trim()) return [];
    const parsed = JSON.parse(result.stdout.trim());
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((owner) => Number(owner?.pid) > 0 && owner?.name && Number(owner.pid) !== process.pid);
  } catch {
    return [];
  }
}

async function stopWindowsDirectoryLockOwners(root, processIds) {
  const requested = new Set((Array.isArray(processIds) ? processIds : []).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0));
  const currentOwners = findWindowsDirectoryLockOwners(root);
  const targets = currentOwners.filter((owner) => requested.has(Number(owner.pid)) && Number(owner.pid) !== process.pid);
  if (!targets.length) return { verified: false, stopped: [], reason: "The approved lock-owning processes are no longer attached to this project." };
  const protectedNames = new Set(["system", "registry", "csrss", "wininit", "services", "lsass", "explorer"]);
  if (targets.some((owner) => protectedNames.has(String(owner.name).toLowerCase()))) {
    return { verified: false, stopped: [], reason: "Foundry refuses to force-close a protected Windows process." };
  }
  const stopped = [];
  for (const owner of targets) {
    try {
      killProcessTree(Number(owner.pid));
      stopped.push(owner);
    } catch {
      // Verify remaining owners below.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  const remaining = findWindowsDirectoryLockOwners(root).filter((owner) => requested.has(Number(owner.pid)));
  return remaining.length
    ? { verified: false, stopped, reason: `Could not stop ${remaining.map((owner) => `${owner.name} (PID ${owner.pid})`).join(", ")}.` }
    : { verified: true, stopped };
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

function canBindPreviewHost(port, host) {
  return new Promise((resolve) => {
    const net = require("node:net");
    const probe = net.createServer();
    probe.once("error", (error) => resolve(error && (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL")));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

async function isPortAvailable(port) {
  // `localhost` may resolve to ::1 in Chromium while a preview server binds only 127.0.0.1. A port
  // is owned only when it is free on both loopback families; otherwise two unrelated projects can
  // appear to share one URL and the browser may render whichever family it resolves first.
  const activeListener = async (host) => new Promise((resolve) => {
    const net = require("node:net");
    const socket = net.createConnection({ port, host });
    const finish = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
  if ((await activeListener("127.0.0.1")) || (await activeListener("::1"))) return false;
  return (await canBindPreviewHost(port, "127.0.0.1")) && (await canBindPreviewHost(port, "::1"));
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

async function detectedPreviewCommand(fullPath) {
  const pkgPath = path.join(fullPath, "package.json");
  if (!fs.existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(await fsp.readFile(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};
    if (scripts.dev) return { kind: "npm", script: "dev", display: "npm run dev" };
    if (scripts.start) return { kind: "npm", script: "start", display: "npm start" };
    if (scripts.preview) return { kind: "npm", script: "preview", display: "npm run preview" };
    const declaresNext = Boolean(pkg.dependencies?.next || pkg.devDependencies?.next);
    const nextCli = path.join(fullPath, "node_modules", "next", "dist", "bin", "next");
    if (declaresNext && fs.existsSync(nextCli)) {
      const built = fs.existsSync(path.join(fullPath, ".next", "BUILD_ID"));
      return { kind: "next-cli", cliPath: nextCli, mode: built ? "start" : "dev", display: `node node_modules/next/dist/bin/next ${built ? "start" : "dev"}` };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function processIsRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findEntryHtmlFile(fullPath, preferredEntries = []) {
  const ignored = /^(?:node_modules|\.git|\.next|\.foundry-artifacts|\.foundry-data|coverage|dist|build|out|vendor|bin|obj)$/i;
  const queue = [{ absolute: fullPath, relative: "", depth: 0 }];
  const candidates = [];
  let visited = 0;
  while (queue.length && visited < 2_000) {
    const current = queue.shift();
    visited += 1;
    let entries = [];
    try { entries = fs.readdirSync(current.absolute, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && current.depth < 20 && !ignored.test(entry.name)) {
        queue.push({ absolute: path.join(current.absolute, entry.name), relative, depth: current.depth + 1 });
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        candidates.push({ path: relative.replace(/\\/g, "/"), score: current.depth * 10 + (/^index\.html?$/i.test(entry.name) ? 0 : 1) });
      }
    }
  }
  const byNormalizedPath = new Map(candidates.map((candidate) => [candidate.path.toLowerCase(), candidate.path]));
  for (const preferred of preferredEntries) {
    const normalized = String(preferred).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
    const exact = byNormalizedPath.get(normalized);
    if (exact) return exact;
  }
  return candidates.sort((left, right) => left.score - right.score || left.path.localeCompare(right.path))[0]?.path;
}

function safeInjectedEnvironment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || typeof item !== "string" || item.length > 32768) continue;
    result[key] = item;
  }
  return result;
}

async function testIntegrationProbe(probe) {
  try {
    const url = new URL(String(probe?.url || ""));
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))) {
      return { ok: false, status: "failed", message: "The Local Agent refused a non-TLS remote integration probe." };
    }
    const method = String(probe?.method || "GET").toUpperCase();
    if (!["GET", "POST", "PUT", "DELETE", "HEAD"].includes(method)) return { ok: false, status: "failed", message: "The integration probe method is not allowed." };
    const headers = {};
    for (const [key, value] of Object.entries(probe?.headers || {})) if (/^[a-z0-9-]{1,80}$/i.test(key) && typeof value === "string" && value.length <= 32768) headers[key] = value;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { method, headers, body: ["GET", "HEAD"].includes(method) ? undefined : String(probe?.body || ""), signal: controller.signal });
      return response.ok
        ? { ok: true, status: "configured", message: "Authentication succeeded from the Local Agent network." }
        : { ok: false, status: response.status === 401 ? "revoked" : "failed", message: `The provider rejected the Local Agent probe (HTTP ${response.status}).` };
    } finally { clearTimeout(timer); }
  } catch { return { ok: false, status: "failed", message: "The Local Agent could not reach the provider. Check network, TLS, and proxy settings." }; }
}

function discoverPaymentDevices() {
  try {
    if (process.platform === "win32") {
      const script = "Get-PnpDevice -PresentOnly | Where-Object { $_.Class -in @('USB','Ports','Bluetooth','SmartCardReader') } | Select-Object FriendlyName,InstanceId,Status | ConvertTo-Json -Compress";
      const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 10000 });
      const parsed = JSON.parse(result.stdout || "[]");
      return (Array.isArray(parsed) ? parsed : [parsed]).map(item => ({ name: String(item.FriendlyName || "Unknown device"), id: String(item.InstanceId || ""), status: String(item.Status || "Unknown") })).slice(0, 200);
    }
    if (process.platform === "darwin") {
      const result = spawnSync("system_profiler", ["SPUSBDataType", "-json"], { encoding: "utf8", timeout: 10000 });
      const data = JSON.parse(result.stdout || "{}");
      const output = [];
      const walk = value => { if (!value || typeof value !== "object") return; if (value._name) output.push({ name: String(value._name), id: String(value.vendor_id || value.serial_num || ""), status: "Present" }); for (const child of Object.values(value)) if (typeof child === "object") walk(child); };
      walk(data); return output.slice(0, 200);
    }
    const root = "/sys/bus/usb/devices";
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).flatMap(entry => { try { const base = path.join(root, entry); const name = fs.readFileSync(path.join(base, "product"), "utf8").trim(); const vendor = fs.readFileSync(path.join(base, "idVendor"), "utf8").trim(); const product = fs.readFileSync(path.join(base, "idProduct"), "utf8").trim(); return [{ name, id: `VID_${vendor}&PID_${product}`, status: "Present" }]; } catch { return []; } }).slice(0, 200);
  } catch { return []; }
}

async function startPreview(root, relativePath, command, preferredEntries = [], environment = {}) {
  const fullPath = resolveContained(root, relativePath || "");
  if (!fullPath || !fs.existsSync(fullPath)) return { state: "error", reason: "Preview path does not exist on this machine." };
  const key = fullPath;
  const existing = previewProcesses.get(key);
  if (existing) {
    if (!processIsRunning(existing.pid)) {
      previewProcesses.delete(key);
      forgetPreviewRecord(key);
    } else {
    const ready = await probeHttpReady(existing.port, 2, 300);
    const previewUrl = existing.previewUrl || `http://127.0.0.1:${existing.port}`;
    return ready
      ? { state: "ready", previewUrl }
      : { state: "starting", previewUrl, reason: "The dev server is still starting up." };
    }
  }

  const detectedCommand = command ? { kind: "shell", command, display: command } : await detectedPreviewCommand(fullPath);
  if (!detectedCommand) {
    const entryFile = findEntryHtmlFile(fullPath, preferredEntries);
    if (!entryFile) return { state: "error", reason: "No dev script and no HTML entry file were found, so there is nothing to preview yet." };
    const port = await findPreviewPort();
    const ownershipToken = crypto.randomBytes(16).toString("hex");
    const staticServer = path.join(__dirname, "foundry-static-preview.cjs");
    const child = spawn(process.execPath, [staticServer, fullPath, String(port), ownershipToken], {
      cwd: fullPath,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    if (!child.pid) return { state: "error", reason: "Could not start the owned static preview server." };
    const encodedEntryPath = entryFile.split("/").map(encodeURIComponent).join("/");
    const previewUrl = `http://127.0.0.1:${port}/${encodedEntryPath}`;
    previewProcesses.set(key, { port, pid: child.pid, ownershipToken, kind: "static", previewUrl });
    persistPreviewRecord(key, { port, pid: child.pid, ownershipToken, kind: "static", previewUrl });
    const ready = await probeHttpReady(port, 6, 250);
    if (!ready) {
      return { state: "starting", previewUrl, port, reason: `The static preview for ${entryFile} is still starting.` };
    }
    return { state: "ready", previewUrl, port, ownershipToken };
  }

  const port = await findPreviewPort();
  let spawnFailed = false;
  let previewExecutable;
  let previewArguments;
  if (detectedCommand.kind === "next-cli") {
    previewExecutable = process.execPath;
    previewArguments = [detectedCommand.cliPath, detectedCommand.mode, "-p", String(port)];
  } else if (detectedCommand.kind === "npm" && process.platform !== "win32") {
    previewExecutable = "npm";
    previewArguments = ["run", detectedCommand.script, "--", "-p", String(port)];
  } else if (process.platform === "win32") {
    const devCommand = detectedCommand.kind === "npm" ? detectedCommand.display : detectedCommand.command;
    previewExecutable = process.env.ComSpec || "cmd.exe";
    previewArguments = ["/d", "/s", "/c", `${devCommand} -- -p ${port}`];
  } else {
    previewExecutable = "/bin/sh";
    previewArguments = ["-lc", `${detectedCommand.command} -- -p ${port}`];
  }
  const child = spawn(previewExecutable, previewArguments, {
    cwd: fullPath,
    shell: false,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, ...safeInjectedEnvironment(environment), PORT: String(port) },
  });
  child.once("error", () => {
    spawnFailed = true;
  });
  child.unref();
  if (spawnFailed) return { state: "error", reason: "Could not start the dev server process." };
  const previewUrl = `http://127.0.0.1:${port}`;
  previewProcesses.set(key, { port, pid: child.pid, kind: "app", previewUrl });
  persistPreviewRecord(key, { port, pid: child.pid, kind: "app", previewUrl });
  const ready = await probeHttpReady(port, 6, 400);
  if (!ready) {
    return { state: "starting", previewUrl, port, reason: "The dev server was started but has not responded yet — it may still be compiling." };
  }
  return { state: "ready", previewUrl, port };
}

function stopPreview(root, relativePath) {
  const fullPath = resolveContained(root, relativePath || "");
  const key = fullPath || relativePath;
  const existing = previewProcesses.get(key);
  if (!existing) return { state: "unavailable" };
  if (!processIsRunning(existing.pid)) {
    previewProcesses.delete(key);
    forgetPreviewRecord(key);
    return { state: "error", reason: "The project preview process exited before its HTTP server became ready." };
  }
  try {
    if (existing.pid) killProcessTree(existing.pid);
  } catch {
    // Process may have already exited.
  }
  previewProcesses.delete(key);
  forgetPreviewRecord(key);
  return { state: "unavailable" };
}

const artifactExtensionsByPlatform = {
  desktop: new Set([".exe", ".msi", ".msix", ".dmg", ".pkg", ".appimage", ".deb", ".rpm"]),
  android: new Set([".apk", ".aab"]),
  mobile: new Set([".ipa", ".apk", ".aab"]),
  report: new Set([".pdf"]),
};

function artifactCandidateRank(relativePath, extension) {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  if ([".msix", ".msi", ".dmg", ".pkg", ".appimage", ".deb", ".rpm", ".aab", ".ipa"].includes(extension)) return 0;
  if (/(^|\/)(publish|release|artifacts?|outputs?)(\/|$)/.test(normalized)) return 1;
  if (/(^|\/)bin\/debug(\/|$)/.test(normalized)) return 3;
  return 2;
}

function artifactPlatformLabel(extension) {
  if ([".apk", ".aab"].includes(extension)) return "Android";
  if (extension === ".ipa") return "iOS";
  if ([".dmg", ".pkg"].includes(extension)) return "macOS";
  if ([".appimage", ".deb", ".rpm"].includes(extension)) return "Linux";
  if (extension === ".pdf") return "Document";
  return "Windows";
}

function artifactFileType(extension) {
  const labels = {
    ".exe": "Windows executable (.exe)", ".msi": "Windows installer (.msi)", ".msix": "Windows app package (.msix)",
    ".apk": "Android package (.apk)", ".aab": "Android App Bundle (.aab)", ".ipa": "iOS application archive (.ipa)",
    ".dmg": "macOS disk image (.dmg)", ".pkg": "macOS installer (.pkg)", ".appimage": "Linux AppImage",
    ".deb": "Debian package (.deb)", ".rpm": "RPM package (.rpm)", ".pdf": "PDF document (.pdf)",
  };
  return labels[extension] || `Build artifact (${extension})`;
}

async function findProjectArtifact(root, platform) {
  const normalizedRoot = normalizeRoot(root);
  const extensions = artifactExtensionsByPlatform[platform];
  if (!normalizedRoot || !extensions) return { found: false };
  const queue = [normalizedRoot];
  const candidates = [];
  let visited = 0;
  while (queue.length && visited < 600) {
    const directory = queue.shift();
    visited += 1;
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if ([".git", ".next", ".turbo", "node_modules", "obj", ".gradle", ".dart_tool", "coverage"].includes(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (queue.length < 600) queue.push(fullPath);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!extensions.has(extension)) continue;
      const relativePath = path.relative(normalizedRoot, fullPath).replace(/\\/g, "/");
      const details = await fsp.stat(fullPath).catch(() => undefined);
      if (details?.isFile()) candidates.push({ fullPath, relativePath, extension, details });
    }
  }
  const selected = candidates.sort((left, right) => artifactCandidateRank(left.relativePath, left.extension) - artifactCandidateRank(right.relativePath, right.extension) || right.details.mtimeMs - left.details.mtimeMs)[0];
  if (!selected) return { found: false };
  return {
    found: true,
    path: selected.relativePath,
    name: path.basename(selected.fullPath),
    sizeBytes: selected.details.size,
    createdAt: selected.details.mtime.toISOString(),
    platform: artifactPlatformLabel(selected.extension),
    fileType: artifactFileType(selected.extension),
    version: "1.0.0",
  };
}

async function sendProjectArtifact(res, root, relativePath) {
  const fullPath = resolveContained(root, relativePath);
  if (!fullPath || !fs.existsSync(fullPath)) return send(res, 404, { error: "Build artifact was not found." });
  const details = await fsp.stat(fullPath).catch(() => undefined);
  if (!details?.isFile()) return send(res, 404, { error: "Build artifact is not a file." });
  const filename = path.basename(fullPath).replace(/["\r\n]/g, "_");
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": String(details.size),
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  fs.createReadStream(fullPath).pipe(res);
}

async function stopPreviewsForRoot(root) {
  const canonicalRoot = normalizeRoot(root);
  const stoppedPids = [];
  for (const [previewPath, preview] of previewProcesses.entries()) {
    const relative = path.relative(canonicalRoot, path.resolve(previewPath));
    const belongsToRoot = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    if (!belongsToRoot) continue;
    if (preview.pid && processIsRunning(preview.pid)) {
      killProcessTree(preview.pid);
      stoppedPids.push(preview.pid);
    }
    previewProcesses.delete(previewPath);
    forgetPreviewRecord(previewPath);
  }

  // taskkill is synchronous, but Windows can retain a process working-directory handle for a
  // brief moment after the process exits. Wait for Foundry-owned processes to be gone before rm.
  for (let attempt = 0; attempt < 20 && stoppedPids.some(processIsRunning); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return stoppedPids.length;
}

async function previewStatus(root, relativePath) {
  const fullPath = resolveContained(root, relativePath || "");
  const key = fullPath || relativePath;
  const existing = previewProcesses.get(key);
  if (!existing) return { state: "unavailable" };
  const ready = await probeHttpReady(existing.port, 1, 0);
  const previewUrl = existing.previewUrl || `http://127.0.0.1:${existing.port}`;
  return ready
    ? { state: "ready", previewUrl }
    : { state: "starting", previewUrl, reason: "The dev server has not responded to a health check yet." };
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

async function discoverSdkArtifacts(root, terms, maxResults = 80) {
  const resolvedRoot = normalizeRoot(root);
  const needles = (Array.isArray(terms) ? terms : []).map((term) => String(term).trim().toLowerCase()).filter((term) => term.length >= 2).slice(0, 20);
  const sdkExtension = /\.(?:zip|aar|jar|dll|so|dylib|framework|xcframework|pdf|docx?|txt|md|html?|xml|json|ya?ml)$/i;
  const ignored = /(?:^|[\\/])(?:node_modules|\.git|\.gradle|build|dist|coverage|\.next)(?:[\\/]|$)/i;
  const hits = [];
  async function visit(directory, depth) {
    if (depth > 8 || hits.length >= maxResults) return;
    const entries = await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (hits.length >= maxResults) break;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(resolvedRoot, absolute).replace(/\\/g, "/");
      if (ignored.test(relative)) continue;
      if (entry.isDirectory()) { await visit(absolute, depth + 1); continue; }
      const lower = relative.toLowerCase();
      if (!sdkExtension.test(entry.name) || (needles.length && !needles.some((needle) => lower.includes(needle)))) continue;
      const details = await fs.promises.stat(absolute).catch(() => undefined);
      hits.push({ path: relative, name: entry.name, size: details?.size ?? 0, extension: path.extname(entry.name).toLowerCase() });
    }
  }
  await visit(resolvedRoot, 0);
  return { root: path.basename(resolvedRoot), artifacts: hits, searchedTerms: needles, truncated: hits.length >= maxResults };
}

async function importSdkArtifacts(sourceRoot, destinationRoot, artifactPaths) {
  const source = normalizeRoot(sourceRoot);
  const destination = normalizeRoot(destinationRoot);
  if (!source || !destination || !approvedRoots.has(source) || !approvedRoots.has(destination)) {
    return { ok: false, error: "Both the SDK folder and project folder must be explicitly approved." };
  }
  const requested = Array.isArray(artifactPaths) ? artifactPaths.map(String).slice(0, 80) : [];
  const allowed = /\.(?:zip|aar|jar|dll|so|dylib|framework|xcframework|pdf|docx?|txt|md|html?|xml|json|ya?ml)$/i;
  const imported = [];
  let totalBytes = 0;
  for (const relative of requested) {
    const sourceFile = resolveContained(source, relative);
    if (!sourceFile || !allowed.test(relative)) continue;
    const stats = await fsp.stat(sourceFile).catch(() => null);
    if (!stats?.isFile()) continue;
    totalBytes += stats.size;
    if (totalBytes > 512 * 1024 * 1024) return { ok: false, error: "Selected SDK evidence exceeds the 512 MB safe import limit." };
    const safeRelative = relative.replace(/\\/g, "/").split("/").filter((part) => part && part !== "." && part !== "..").join("/");
    const projectRelative = `.foundry-input/sdk/${safeRelative}`;
    const destinationFile = resolveContained(destination, projectRelative);
    if (!destinationFile) continue;
    await fsp.mkdir(path.dirname(destinationFile), { recursive: true });
    await fsp.copyFile(sourceFile, destinationFile);
    imported.push({ source: relative, path: projectRelative, name: path.basename(relative), size: stats.size });
  }
  return { ok: true, imported, totalBytes };
}

function normalizeCommandText(command) {
  return String(command || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeCommandForExecution(command, platform = process.platform) {
  let normalized = String(command || "").trim();
  if (platform !== "win32") return normalized;
  const outputPreviewSuffix = /\s+(?:2>&1\s*)?\|\s*(?:tail|head)\s+(?:(?:-n|--lines)\s+)?-?\d+\s*$/i;
  while (outputPreviewSuffix.test(normalized)) normalized = normalized.replace(outputPreviewSuffix, "").trim();
  return normalized;
}

function leadingPosixMkdir(command) {
  const chainIndex = command.indexOf("&&");
  const mkdirCommand = (chainIndex >= 0 ? command.slice(0, chainIndex) : command).trim();
  const remainder = chainIndex >= 0 ? command.slice(chainIndex + 2).trim() : "";
  const tokens = tokenizeCommand(mkdirCommand);
  if (tokens.length < 3 || tokens[0].toLowerCase() !== "mkdir" || tokens[1] !== "-p") return undefined;
  const directories = tokens.slice(2);
  if (directories.some((entry) => !entry || !/^[A-Za-z0-9_ .\/\\:-]+$/.test(entry) || /[&|<>;%!^]/.test(entry))) return undefined;
  return { directories, remainder };
}

// Mirror of lib/ai/mission/project-access.ts::commandPermissionIdentity — kept in sync by hand (standalone
// process, no TS import). Canonicalizes risk-neutral install variations so an approval for
// `npm install dayjs --save` also covers `npm install dayjs` / `npm i dayjs`, and a denial never loops.
// Different packages, `--global`, `--force`, and other command families stay distinct.
function commandPermissionIdentity(command) {
  let text = normalizeCommandText(normalizeCommandForExecution(command));
  if (/\b(npm|pnpm|yarn|bun)(\.cmd)?\s+(?:install|i|add)\b/.test(text)) {
    text = text.replace(/\b(npm|pnpm|bun)(\.cmd)?\s+i\b/g, "$1 install");
    text = text.replace(/\s+(?:--save(?:-dev|-prod|-exact|-optional|-peer)?|--no-save|--legacy-peer-deps|-[sdebop])\b/g, "");
  }
  return text.replace(/\s+/g, " ").trim();
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
  // PowerShell's execution policy blocks the npm/npx/pnpm/yarn *.ps1 shims on many Windows machines
  // ("running scripts is disabled on this system"). That's not a real command failure — the SAME command
  // succeeds via cmd (which uses the .cmd shim), so treat it as a shell mismatch and fall back automatically
  // instead of surfacing a spurious failure (and re-prompting when the model retries with a cmd wrapper).
  /running scripts is disabled on this system/i,
  /cannot be loaded because running scripts/i,
  /about_execution_policies/i,
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

function spawnCommand(invocation, cwd, timeoutMs, keepAliveOnTimeout = false, signal) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let abortHandler;
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
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
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

    // Stop (client disconnect) must actually terminate a running child — a build/install/test/lint should
    // not keep running after the mission was cancelled (RC-E1). Dev/server processes (keepAliveOnTimeout)
    // are intentionally exempt: they're detached to outlive the request as the live preview.
    if (signal && !keepAliveOnTimeout) {
      abortHandler = () => {
        if (settled) return;
        if (typeof child.pid === "number") killProcessTree(child.pid);
        else child.kill();
        setTimeout(() => finish(null), 300);
      };
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    }

    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      stderr = stderr || error.message;
      finish(null);
    });
    child.on("close", (exitCode) => finish(exitCode));
  });
}

async function runCommandWithShellFallback(command, cwd, timeoutMs, keepAliveOnTimeout = false, signal) {
  if (/^\s*node(?:\.exe)?\s+-e\s+/i.test(command)) {
    const tokens = tokenizeCommand(command);
    const result = await spawnCommand({ cmd: process.execPath, args: tokens.slice(1) }, cwd, timeoutMs, false, signal);
    return { ...result, shellUsed: "direct-node" };
  }
  const order = process.platform === "win32" ? windowsShellOrder(stickyShellId) : posixShellOrder(stickyShellId);
  const firstAttemptedShellId = order.find((id) => shellInvocation(id, command));
  let lastResult = null;
  let lastShellId;

  for (const shellId of order) {
    if (signal?.aborted) break;
    const invocation = shellInvocation(shellId, command);
    if (!invocation) continue;
    const result = await spawnCommand(invocation, cwd, timeoutMs, keepAliveOnTimeout, signal);
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

async function runCommand(root, command, cwd = "", approvedCommands = [], approvedCategories = [], signal) {
  command = normalizeCommandForExecution(command);
  const portableMkdir = process.platform === "win32" ? leadingPosixMkdir(command) : undefined;
  const requestedCwd = resolveContained(root, cwd);
  if (!requestedCwd) return { exitCode: null, stdout: "", stderr: "Refusing to run outside the connected folder.", durationMs: 0, timedOut: false, skipped: "outside-root" };
  const dependencyPreflight = dependencyInstallAlreadySatisfied(command, requestedCwd);
  if (dependencyPreflight) return dependencyPreflight;
  const permission = decideCommandPermission(command);
  const exactApproved = approvedCommands.some((entry) => commandPermissionIdentity(entry) === commandPermissionIdentity(command));
  const categoryApproved = Boolean(permission.category && approvedCategories.includes(permission.category));
  const bypassed = permission.status === "permission-required" && (exactApproved || categoryApproved);
  if (!permission.allowed && !bypassed) {
    return {
      exitCode: null,
      stdout: "",
      stderr: permission.reason || "Command requires approval.",
      durationMs: 0,
      timedOut: false,
      skipped: permission.status || "permission-required",
      reason: permission.reason,
      category: permission.category,
    };
  }
  if (portableMkdir) {
    try {
      for (const directory of portableMkdir.directories) {
        const target = path.resolve(requestedCwd, directory);
        const relative = path.relative(path.resolve(root), target);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          return Promise.resolve({ exitCode: null, stdout: "", stderr: "Refusing to create a directory outside the connected folder.", durationMs: 0, timedOut: false, skipped: "outside-root" });
        }
        fs.mkdirSync(target, { recursive: true });
      }
      command = portableMkdir.remainder;
      if (!command) return Promise.resolve({ exitCode: 0, stdout: `Created ${portableMkdir.directories.join(", ")}.`, stderr: "", durationMs: 0, timedOut: false });
    } catch (error) {
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error), durationMs: 0, timedOut: false });
    }
  }
  if (isLongRunningServerCommand(command)) {
    return runCommandWithShellFallback(command, requestedCwd, devServerGracePeriodMs, true, signal).then((result) => {
      if (!result.timedOut) return result;
      return {
        ...result,
        exitCode: 0,
        timedOut: false,
        stderr: `${result.stderr}\n[This looks like a long-running dev/server process — it's still running in the background rather than having failed or exited.]`.trim(),
      };
    });
  }

  if (commandProducesBuildArtifacts(command)) await stopPreviewsForRoot(root);
  const desktopSuspension = commandProducesBuildArtifacts(command)
    ? await suspendOwnedDesktopProcesses(root)
    : { suspended: [], failed: [] };
  if (desktopSuspension.failed.length) {
    const owners = desktopSuspension.failed.map((record) => `${path.basename(record.executable)} (PID ${record.processId})`).join(", ");
    return {
      exitCode: null,
      stdout: "",
      stderr: `Foundry could not pause its running desktop app before rebuilding: ${owners}. Close the app, then choose Verify again.`,
      durationMs: 0,
      timedOut: false,
      skipped: "owned-runtime-lock",
    };
  }
  const result = await runCommandWithShellFallback(command, requestedCwd, commandTimeoutMs, false, signal);
  const resumed = await resumeOwnedDesktopProcesses(desktopSuspension.suspended);
  const lifecycleNote = desktopSuspension.suspended.length
    ? resumed.failed.length
      ? `Foundry paused ${desktopSuspension.suspended.length} running desktop app before the build, but could not relaunch ${resumed.failed.map((item) => path.basename(item.record.executable)).join(", ")}: ${resumed.failed.map((item) => item.reason).join("; ")}`
      : `Foundry paused and restored ${resumed.resumed.length} running desktop app${resumed.resumed.length === 1 ? "" : "s"} around the build.`
    : "";
  return { ...result, stderr: [result.stderr, lifecycleNote].filter(Boolean).join("\n") };
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
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, approvedRoots: Array.from(approvedRoots), commands: true, validation: validationCapabilities() });
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
    if (url.pathname === "/write-binary") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await writeBinary(body.root, body.path || "", body.base64 || ""));
    }
    if (url.pathname === "/delete-root") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await deleteProjectRoot(body.root));
    }
    if (url.pathname === "/stop-root-locks") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await stopWindowsDirectoryLockOwners(normalizeRoot(body.root), body.processIds));
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
      // Stop = the client aborts its request. Fire an AbortSignal on a premature disconnect (connection
      // closed before we finished responding) so a running build/install/test child is actually killed
      // (RC-E1). A normal completion closes the socket only after writableFinished, so it won't abort.
      const runController = new AbortController();
      res.on("close", () => { if (!res.writableFinished) runController.abort(); });
      return send(res, 200, await runCommand(body.root, String(body.command || ""), String(body.cwd || ""), Array.isArray(body.approvedCommands) ? body.approvedCommands : [], Array.isArray(body.approvedCategories) ? body.approvedCategories : [], runController.signal));
    }
    if (url.pathname === "/preview/start") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await startPreview(
        body.root,
        String(body.path || ""),
        body.command ? String(body.command) : undefined,
        Array.isArray(body.entryFiles) ? body.entryFiles.map(String) : [],
        body.environment,
      ));
    }
    if (url.pathname === "/integrations/probe") {
      return send(res, 200, await testIntegrationProbe(body.probe));
    }
    if (url.pathname === "/hardware/discover") {
      return send(res, 200, { devices: discoverPaymentDevices(), permissions: { deviceEnumeration: "completed", usbAccess: "not-tested", bluetoothAccess: "not-tested", serialAccess: "not-tested" }, hardwareValidated: false });
    }
    if (url.pathname === "/sdk/discover") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await discoverSdkArtifacts(body.root, body.terms, body.maxResults || 80));
    }
    if (url.pathname === "/sdk/import") {
      if (!requireApprovedRoot(res, body.sourceRoot) || !requireApprovedRoot(res, body.destinationRoot)) return;
      return send(res, 200, await importSdkArtifacts(body.sourceRoot, body.destinationRoot, body.paths));
    }
    if (url.pathname === "/preview/stop") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, stopPreview(body.root, String(body.path || "")));
    }
    if (url.pathname === "/preview/status") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await previewStatus(body.root, String(body.path || "")));
    }
    if (url.pathname === "/artifact/find") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await findProjectArtifact(body.root, String(body.platform || "")));
    }
    if (url.pathname === "/artifact/download") {
      if (!requireApprovedRoot(res, body.root)) return;
      return sendProjectArtifact(res, body.root, String(body.path || ""));
    }
    if (url.pathname === "/validation/capabilities") return send(res, 200, validationCapabilities());
    if (url.pathname === "/validation/browser/run") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await runBrowserValidation(body));
    }
    if (url.pathname === "/validation/browser/compare") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await compareScreenshots(body.root, body.baselineScreenshot, body.actualScreenshot, body.diffName));
    }
    if (url.pathname === "/validation/android/run") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await runAndroidValidation(body));
    }
    if (url.pathname === "/validation/ios/run") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await runIosValidation(body));
    }
    if (url.pathname === "/validation/desktop/run") {
      if (!requireApprovedRoot(res, body.root)) return;
      return send(res, 200, await runDesktopValidation(body));
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
