// Regression guard for the command-permission classifier and its permission-matching identity.
// Covers the Phase C QA fixes: RC-D1 (read-only existence probes must not prompt, incl. shell-wrapped
// forms) and RC-D2 (deny/exact-command matching must ignore risk-neutral install-flag variations so
// denial never loops), plus the baseline safe/permission/destructive classification it must preserve.
const { spawnSync } = require("node:child_process");
const { mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "tmp", "command-permissions-test");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const sources = [
  path.join(root, "lib", "ai", "mission", "command-permissions.ts"),
  path.join(root, "lib", "ai", "mission", "project-access.ts"),
  path.join(root, "lib", "ai", "mission", "write-verification.ts"),
];
const compile = spawnSync(
  process.execPath,
  [path.join(root, "node_modules", "typescript", "bin", "tsc"), ...sources, "--outDir", outDir, "--module", "commonjs", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
  { cwd: root, encoding: "utf8" },
);
if (compile.status !== 0) {
  console.error(compile.stdout);
  console.error(compile.stderr);
  process.exit(compile.status || 1);
}

const { decideCommandPermission } = require(path.join(outDir, "command-permissions.js"));
const { commandPermissionIdentity } = require(path.join(outDir, "project-access.js"));

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label} => ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

// --- baseline classification (must be preserved) ---
check("build script is safe", decideCommandPermission("npm run build").allowed, true);
check("typecheck is safe", decideCommandPermission("npm run typecheck").allowed, true);
check("npm install requires approval", decideCommandPermission("npm install dayjs --save").status, "permission-required");
check("npm install category is dependencies", decideCommandPermission("npm install dayjs").category, "dependencies");
check("git push requires approval", decideCommandPermission("git push origin main").status, "permission-required");
check("rm -rf is destructive", decideCommandPermission("rm -rf /").status, "destructive");
check("TLS verification bypass is destructive", decideCommandPermission("set NODE_TLS_REJECT_UNAUTHORIZED=0&& npm.cmd install").status, "destructive");
check("git status is safe", decideCommandPermission("git status").allowed, true);

// --- RC-D1: read-only existence probes must not prompt ---
check("bare dir probe allowed", decideCommandPermission("dir node_modules\\dayjs 2>nul || echo NOT_FOUND").allowed, true);
check("Test-Path probe allowed", decideCommandPermission("Test-Path node_modules/dayjs").allowed, true);
check("powershell-wrapped Test-Path allowed", decideCommandPermission('powershell -Command "Test-Path node_modules/dayjs"').allowed, true);
check("cmd-wrapped dir allowed", decideCommandPermission('cmd /c "dir node_modules\\dayjs"').allowed, true);
check("node require.resolve probe allowed", decideCommandPermission("node -e \"require.resolve('dayjs')\"").allowed, true);
check("dir | findstr probe allowed", decideCommandPermission("dir node_modules | findstr /i dayjs").allowed, true);
check("ls | grep probe allowed", decideCommandPermission("ls node_modules | grep dayjs").allowed, true);
// adversarial: real chains/mutations behind a probe-shaped prefix must NOT be allowed
check("dir & del refused", decideCommandPermission("dir node_modules && del important.txt").allowed, false);
check("dir | del refused", decideCommandPermission("dir node_modules | del important.txt").allowed, false);
check("wrapped Remove-Item refused", decideCommandPermission('powershell -Command "Remove-Item -Recurse node_modules"').allowed, false);
check("probe then mutation refused", decideCommandPermission('powershell -Command "Test-Path x; Remove-Item y"').allowed, false);

// --- RC-D2: permission identity ignores risk-neutral install-flag variations ---
const idEq = (a, b) => commandPermissionIdentity(a) === commandPermissionIdentity(b);
check("--save variant matches", idEq("npm install dayjs --save", "npm install dayjs"), true);
check("i alias matches install", idEq("npm i dayjs", "npm install dayjs"), true);
check("--save-dev variant matches", idEq("npm install dayjs --save-dev", "npm install dayjs"), true);
check("pnpm add flag variant matches", idEq("pnpm add dayjs --save-dev", "pnpm add dayjs"), true);
check("different package stays distinct", idEq("npm install dayjs", "npm install leftpad"), false);
check("--global stays distinct", idEq("npm install dayjs", "npm install dayjs --global"), false);
check("git push --force untouched", idEq("git push", "git push --force"), false);

// --- Suite D bypass matrix: replicates the exact allow decision used by BOTH the connector
// (foundry-local-connector.cjs) and server-access (project-access.ts::isCommandBypassAllowed):
// a permission-required command runs only if the exact command was approved (identity match) OR its
// category was approved; destructive/safe never depend on approvals. Guards allow-once/allow-category/
// always-allow-exact and their narrowness (no accidental broadening).
function bypassed(command, approvedCommands = [], approvedCategories = []) {
  const p = decideCommandPermission(command);
  if (p.status !== "permission-required") return p.allowed;
  const exact = approvedCommands.some((e) => commandPermissionIdentity(e) === commandPermissionIdentity(command));
  const cat = Boolean(p.category && approvedCategories.includes(p.category));
  return exact || cat;
}
check("category grant allows an install", bypassed("npm install clsx", [], ["dependencies"]), true);
check("category grant is narrow (git NOT covered by dependencies)", bypassed("git push origin main", [], ["dependencies"]), false);
check("exact grant allows that command", bypassed("npm install uuid", ["npm install uuid"], []), true);
check("exact grant covers a --save variant", bypassed("npm install uuid --save", ["npm install uuid"], []), true);
check("exact grant does NOT broaden to a different package", bypassed("npm install leftpad", ["npm install uuid"], []), false);
check("destructive is never bypassable by a category", bypassed("rm -rf /", [], ["dependencies", "shell-mutation"]), false);
check("unrelated category grant doesn't allow an install", bypassed("npm install clsx", [], ["git"]), false);

console.log(failures ? `\n${failures} FAILED` : "\nAll command-permission regressions passed.");
process.exit(failures ? 1 : 0);
