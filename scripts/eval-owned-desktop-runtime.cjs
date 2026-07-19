#!/usr/bin/env node
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const fixture = path.join(os.tmpdir(), `foundry-owned-desktop-${process.pid}-${Date.now()}`);
const compiledModule = path.join(fixture, "owned-desktop-processes.cjs");
const executable = path.join(fixture, "FoundryOwnedFixture.exe");

function processIsAlive(processId) {
  try { process.kill(processId, 0); return true; } catch { return false; }
}

async function run() {
  fs.mkdirSync(fixture, { recursive: true });
  const source = fs.readFileSync(path.join(root, "lib", "factory", "owned-desktop-processes.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  fs.writeFileSync(compiledModule, compiled, "utf8");
  fs.copyFileSync(process.execPath, executable);
  const lifecycle = require(compiledModule);
  const acceptanceSource = fs.readFileSync(path.join(root, "lib", "factory", "desktop-acceptance.ts"), "utf8");
  const acceptanceCompiled = ts.transpileModule(acceptanceSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const acceptanceModule = { exports: {} };
  new Function("module", "exports", "require", acceptanceCompiled)(acceptanceModule, acceptanceModule.exports, require);
  const desktopAcceptance = acceptanceModule.exports;
  const runtimeSource = fs.readFileSync(path.join(root, "lib", "factory", "runtime.ts"), "utf8");
  const validatorSource = fs.readFileSync(path.join(root, "scripts", "local-agent-validation.cjs"), "utf8");

  assert.deepEqual(
    desktopAcceptance.desktopInteractionActionsForTask("When clicking on Settings, the entire app closes down."),
    [{ action: "click", name: "Settings", automationId: "" }],
    "Plain-language desktop controls are not converted into semantic acceptance actions.",
  );
  assert.deepEqual(
    desktopAcceptance.desktopInteractionActionsForTask("Press the Export button, then click Settings."),
    [{ action: "click", name: "Export", automationId: "" }, { action: "click", name: "Settings", automationId: "" }],
    "Multiple desktop controls are not preserved in user-request order.",
  );
  assert.match(runtimeSource, /currentPreviewPlatform === "web" && \(Boolean\(preModelBrowserEvidence\)/, "Native artifacts can still enter the web-browser acceptance branch.");
  assert.match(runtimeSource, /Checklist item\\\(s\\\) not completed/, "A verified partial implementation cannot continue when the executor leaves checklist work unfinished.");
  assert.match(runtimeSource, /deterministicDesktopAcceptanceRequested/, "Behavioral desktop work has no deterministic native acceptance stage.");
  assert.match(validatorSource, /validate-windows-desktop-ui\.ps1/, "The Local Agent does not exercise named desktop controls through Windows accessibility automation.");
  assert.match(validatorSource, /interactionVerified/, "Desktop validation can still claim interaction success from process launch alone.");

  assert.equal(lifecycle.commandProducesBuildArtifacts("dotnet build App.sln --no-restore"), true);
  assert.equal(lifecycle.commandProducesBuildArtifacts("npm.cmd run build"), true);
  assert.equal(lifecycle.commandProducesBuildArtifacts("cargo build --release"), true);
  assert.equal(lifecycle.commandProducesBuildArtifacts("python -m py_compile app.py"), false);
  assert.match(
    lifecycle.actionableBuildLockMessage('warning MSB3026: file is locked by: "Fixture (1234)"'),
    /Close the running app, then choose Verify again/i,
  );

  const child = spawn(executable, ["-e", "setInterval(() => {}, 1000)"], { cwd: fixture, detached: true, stdio: "ignore", windowsHide: true });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  assert.ok(child.pid && processIsAlive(child.pid), "The managed runtime fixture did not launch.");
  child.unref();
  lifecycle.registerOwnedDesktopProcess({ projectId: "owned-runtime-eval", projectPath: fixture, executable, args: ["-e", "setInterval(() => {}, 1000)"], processId: child.pid });

  const suspended = await lifecycle.suspendOwnedDesktopProcesses(fixture);
  assert.equal(suspended.failed.length, 0, "Foundry could not pause its owned desktop process.");
  assert.equal(suspended.suspended.length, 1, "Foundry did not recognize its owned desktop process.");
  assert.equal(processIsAlive(child.pid), false, "The owned executable remained locked after suspension.");

  fs.copyFileSync(process.execPath, executable);
  const resumed = await lifecycle.resumeOwnedDesktopProcesses(suspended.suspended);
  assert.equal(resumed.failed.length, 0, "Foundry could not restore its owned desktop process after the build.");
  assert.equal(resumed.resumed.length, 1);
  assert.equal(processIsAlive(resumed.resumed[0].processId), true, "The restored desktop process is not running.");

  const cleanup = await lifecycle.suspendOwnedDesktopProcesses(fixture);
  assert.equal(cleanup.failed.length, 0);
  assert.equal(cleanup.suspended.length, 1);
  console.log("PASS managed desktop lifecycle: launch -> pause -> replace executable -> restore -> cleanup.");
  console.log("PASS build-command coverage and actionable external-lock guidance.");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
}).finally(() => {
  if (process.platform === "win32") spawnSync("taskkill.exe", ["/im", "FoundryOwnedFixture.exe", "/t", "/f"], { stdio: "ignore", windowsHide: true });
  fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
});
