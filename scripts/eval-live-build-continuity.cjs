const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, token) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`, { headers: { authorization: `Bearer ${token}` } });
      if (response.ok) return;
    } catch {
      // Connector is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Local connector did not become ready.");
}

async function run() {
  const dashboard = source("components/BuildDashboard.tsx");
  const workspaceShell = source("components/WorkspaceShell.tsx");
  const adapter = source("lib/canvas/adapter.ts");
  const liveActivity = source("components/canvas/LiveActivityRow.tsx");
  const executor = source("lib/ai/mission/executor.ts");
  const runtime = source("lib/factory/runtime.ts");
  const canvasModel = source("lib/canvas/model.ts");
  const projectAccess = source("lib/ai/mission/project-access.ts");
  const connectorSource = source("scripts/foundry-local-connector.cjs");

  assert.ok(dashboard.includes('import { generatedWorkspaceForMission } from "@/lib/factory/live-project"'));
  const liveProjectSource = source("lib/factory/live-project.ts");
  const compiledLiveProject = ts.transpileModule(liveProjectSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const liveProjectModule = { exports: {} };
  vm.runInNewContext(compiledLiveProject, { module: liveProjectModule, exports: liveProjectModule.exports, require });
  const liveWorkspace = liveProjectModule.exports.generatedWorkspaceForMission({
    executionMissions: [{ timeline: [{ kind: "folder", filePath: "C:\\work\\projects\\cherubi-shop", details: { projectId: "cherubi-shop" } }] }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(liveWorkspace)), { projectId: "cherubi-shop", projectPath: "C:\\work\\projects\\cherubi-shop" });
  const connectedPathImplementation = dashboard.slice(dashboard.indexOf("function connectedPathForMission"), dashboard.indexOf("function connectorInfoFromMission"));
  assert.ok(
    connectedPathImplementation.indexOf("const generatedWorkspace = generatedWorkspaceForMission(mission)") < connectedPathImplementation.indexOf("const brief = projectBriefFromMission(mission)"),
    "The live generated workspace must win before uploaded/brief fallback labels.",
  );
  assert.match(runtime, /details: \{ path: projectPath, projectId, projectPath \}/);

  assert.match(adapter, /requestBrief \? conciseProjectRequest/);
  assert.doesNotMatch(adapter, /if \(description && \/\^\(Mode\|Create Project\)/);
  assert.match(liveActivity, /ATTENTION_AFTER_MS = 30_000/);
  assert.match(liveActivity, /Still working on:/);
  assert.match(liveActivity, /STALL_AFTER_MS = 180_000/);

  assert.match(executor, /NO_PROGRESS_AFTER_MUTATION/);
  assert.match(runtime, /NO_PROGRESS_\(\?:BEFORE\|AFTER\)_MUTATION\|command or file write failed/);
  assert.match(executor, /waitingOnProvider: true/);
  assert.match(executor, /id: "implementation-provider-wait"/);
  assert.match(runtime, /noProgressBoundaryAfterVerifiedEdit/);
  assert.match(runtime, /advancedFromNoProgressBoundaryVerification/);
  assert.match(runtime, /uiChangeNeedsBrowserVerification/);
  assert.match(runtime, /async function detectNextPreviewCommand/);
  assert.match(runtime, /verifiedBuildExists[\s\S]+scripts\.start/);
  assert.match(runtime, /declaresNext && existsSync\(cliPath\)/);
  assert.match(runtime, /previewCommand\.kind === "direct"/);
  assert.match(runtime, /path\.join\(projectPath, "out", "index\.html"\)/);
  assert.match(runtime, /startScript === "start" \? 50 : 90/);
  assert.match(runtime, /Preview failed to start: \$\{trimOutput\(runtimeLog\)\}/);
  assert.match(workspaceShell, /readFactoryExecutionStream\(response, missionId, controlId, controller\.signal\)/, "Live streams are not recoverable by execution control id.");
  assert.match(workspaceShell, /Reconnecting to the active execution[\s\S]+api\/factory\/execution\?controlId=/, "A dropped live stream still becomes a terminal project failure instead of polling its server snapshot.");
  assert.match(workspaceShell, /snapshot\.state === "completed" && snapshot\.result[\s\S]+return snapshot\.result/, "Recovered streams do not return the real completed result.");
  assert.match(workspaceShell, /Execution connection could not be recovered:[\s\S]+state: "cancelled"/, "A vanished server execution is still mislabeled as a blocked project.");
  assert.doesNotMatch(runtime, /const existingEnvironment = await environmentReadinessForStack\(capabilityLevelForStackChoice\(detected\.stack\)\.id\)/, "Local project inspection still blocks on an unused synchronous toolchain probe.");
  assert.match(canvasModel, /newest\?\.status === "running" && isInternalExecutionEvent\(newest\) && newest\.title\.trim\(\)/, "Current focus still ignores the newest provider-wait stage.");
  assert.match(runtime, /boundedSmallEdit \|\| boundedStaticFollowUp \? 1 : autonomousRepairStageLimit\(process\.env\.FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES, 2\)/, "Bounded static follow-ups get one repair while larger missions retain staged recovery.");
  assert.doesNotMatch(runtime, /spawnSync\("taskkill\.exe", \["\/pid", String\(processId\), "\/t", "\/f"\]/, "Preview cleanup can still block the server event loop and prevent Stop.");
  assert.match(runtime, /const listed = spawn\(powershell,[\s\S]+listed\.unref\(\)/, "Orphan preview discovery still blocks execution and cancellation.");

  assert.match(projectAccess, /function normalizeCommandForExecution/);
  assert.match(connectorSource, /function normalizeCommandForExecution/);

  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), "foundry-command-normalization-"));
  const port = await availablePort();
  const token = `live-build-${Date.now()}`;
  const baseUrl = `http://127.0.0.1:${port}`;
  const connector = spawn(process.execPath, [path.join(__dirname, "foundry-local-connector.cjs"), fixture, String(port), token], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await waitForHealth(baseUrl, token);
    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ root: fixture, command: `node -e "console.log('normalized-ok')" 2>&1 | tail -5` }),
    });
    const result = await response.json();
    assert.equal(response.ok, true, JSON.stringify(result));
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.match(result.stdout, /normalized-ok/);

    const mkdirResponse = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ root: fixture, command: `mkdir -p generated/resources && node -e "require('fs').writeFileSync('continued.txt','ok')"` }),
    });
    const mkdirResult = await mkdirResponse.json();
    assert.equal(mkdirResponse.ok, true, JSON.stringify(mkdirResult));
    assert.equal(mkdirResult.exitCode, 0, JSON.stringify(mkdirResult));
    assert.equal(fs.existsSync(path.join(fixture, "generated", "resources")), true, "POSIX mkdir -p should execute idempotently on Windows.");
    assert.equal(fs.existsSync(path.join(fixture, "continued.txt")), true, `The command after portable mkdir must still execute: ${JSON.stringify(mkdirResult)}`);
  } finally {
    connector.kill();
    await fsp.rm(fixture, { recursive: true, force: true });
  }

  console.log("Live build continuity regression checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
