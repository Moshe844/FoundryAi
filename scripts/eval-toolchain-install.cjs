#!/usr/bin/env node
/**
 * Guards install-before-build: a generated project's declared toolchain must be installed BEFORE the
 * first build/dev/test command runs. Recorded live (.foundry-data/journals/marketing-site-2): the model
 * ran `npm run build` on a node_modules with "0 entries", got "'astro'/'next' is not recognized", and
 * burned dozens of paid turns before installing. The command runner now provisions deterministically.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { const t = r.startsWith("@/") ? path.join(root, r.slice(2)) : r; try { return orig.call(this, t, ...a); } catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${t}${x}`)) return `${t}${x}`; throw e; } };

const { commandNeedsInstalledToolchain, toolchainInstallMissing } = require(path.join(root, "lib/ai/mission/project-access.ts"));

let failures = 0;
const ok = (label, cond) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

console.log("=== commands that MUST provision the toolchain first ===");
for (const c of ["npm run build", "npm.cmd run build", "npm run dev", "pnpm build", "yarn test", "npx astro build", "astro build", "next dev", "vite build", "tsc --noEmit", "vitest run"]) {
  ok(`"${c}" needs installed toolchain`, commandNeedsInstalledToolchain(c) === true);
}

console.log("\n=== commands that must NOT trigger an install (would deadlock or be pointless) ===");
for (const c of ["npm install", "npm install --prefer-offline", "npm i", "npm ci", "yarn add dayjs", "git status", "ls -la", "echo hi", "mkdir -p src", "cat package.json"]) {
  ok(`"${c}" does not trigger install`, commandNeedsInstalledToolchain(c) === false);
}

console.log("\n=== node_modules presence detection ===");
const mk = (setup) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-")); setup(dir); return dir; };
const withPkgNoModules = mk((d) => fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ dependencies: { astro: "^5" } })));
const withEmptyModules = mk((d) => { fs.writeFileSync(path.join(d, "package.json"), "{}"); fs.mkdirSync(path.join(d, "node_modules")); fs.writeFileSync(path.join(d, "node_modules", ".package-lock.json"), "{}"); });
const withRealModules = mk((d) => { fs.writeFileSync(path.join(d, "package.json"), "{}"); fs.mkdirSync(path.join(d, "node_modules", "astro"), { recursive: true }); });
const noPkg = mk(() => {});

ok("package.json + no node_modules => install missing", toolchainInstallMissing(withPkgNoModules) === true);
ok("package.json + only dotfiles in node_modules => install missing", toolchainInstallMissing(withEmptyModules) === true);
ok("package.json + a real installed package => NOT missing", toolchainInstallMissing(withRealModules) === false);
ok("no package.json => never treated as missing (not a Node project)", toolchainInstallMissing(noPkg) === false);

for (const d of [withPkgNoModules, withEmptyModules, withRealModules, noPkg]) fs.rmSync(d, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
