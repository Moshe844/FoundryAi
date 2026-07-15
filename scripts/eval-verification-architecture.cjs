const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "tmp", "verification-architecture-test");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const sources = ["types.ts", "adapters.ts", "project-detector.ts", "report.ts"].map((file) => path.join(root, "lib", "verification", file));
const compile = spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), ...sources, "--outDir", outDir, "--module", "commonjs", "--target", "es2020", "--skipLibCheck"], { cwd: root, encoding: "utf8" });
if (compile.status !== 0) { console.error(compile.stdout); console.error(compile.stderr); process.exit(compile.status || 1); }

const { detectVerificationProfile } = require(path.join(outDir, "project-detector.js"));
const { buildVerificationReport, verificationStatusLabel } = require(path.join(outDir, "report.js"));
const platform = "win32";
const node = detectVerificationProfile({ rootEntries: ["package.json", "package-lock.json", "next.config.ts"], files: { "package.json": JSON.stringify({ scripts: { lint: "eslint .", typecheck: "tsc --noEmit", build: "next build", test: "vitest" }, dependencies: { next: "15" } }) }, platform });
assert.equal(node.adapterId, "nextjs");
assert.deepEqual(node.commands.map((item) => item.stage), ["lint", "typecheck", "build", "unit-test"]);
assert.equal(node.packageManager, "npm");
const partial = buildVerificationReport(node, [{ command: "npm.cmd run lint", exitCode: 0 }]);
assert.equal(verificationStatusLabel(partial.status), "Partially verified");
const verified = buildVerificationReport(node, node.commands.map((item) => ({ command: item.command, exitCode: 0 })));
assert.equal(verificationStatusLabel(verified.status), "Verified");

const android = detectVerificationProfile({ rootEntries: ["gradlew.bat", "settings.gradle.kts", "app"], files: {}, platform });
assert.equal(android.adapterId, "android-gradle");
assert.match(android.commands[0].command, /^gradlew\.bat/);
const unknown = detectVerificationProfile({ rootEntries: ["README.md"], files: {}, platform });
assert.equal(verificationStatusLabel(buildVerificationReport(unknown, []).status), "Not verified");
assert.equal(detectVerificationProfile({ rootEntries: ["mix.exs"], files: {}, platform }).adapterId, "elixir");
assert.equal(detectVerificationProfile({ rootEntries: ["Package.swift"], files: {}, platform }).adapterId, "swift");
assert.equal(detectVerificationProfile({ rootEntries: ["CMakeLists.txt"], files: {}, platform }).adapterId, "cmake");
assert.equal(detectVerificationProfile({ rootEntries: ["build.sbt"], files: {}, platform }).adapterId, "scala-sbt");

rmSync(outDir, { recursive: true, force: true });
console.log("verification architecture tests passed");
