const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const baseUrl = process.env.FOUNDRY_URL || "http://127.0.0.1:3001";
const originalTask = "can you delete this project?";

function createFixture(name) {
  const fixture = path.join(root, "tmp", name);
  fs.rmSync(fixture, { recursive: true, force: true });
  fs.mkdirSync(path.join(fixture, "src", "nested"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "package.json"), '{"name":"deletion-fixture","private":true}\n');
  fs.writeFileSync(path.join(fixture, "README.md"), "# Disposable deletion fixture\n");
  fs.writeFileSync(path.join(fixture, "src", "app.js"), 'console.log("delete only after approval");\n');
  fs.writeFileSync(path.join(fixture, "src", "nested", "data.json"), '{"preserved":true}\n');
  return fixture;
}

async function readStream(response) {
  if (!response.ok || !response.body) throw new Error(`Request failed: HTTP ${response.status} ${await response.text()}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const payload = JSON.parse(line);
      if (payload.type === "error") throw new Error(payload.error);
      if (payload.type === "result") result = payload.result;
    }
    if (done) break;
  }
  if (!result) throw new Error("Stream ended without a result.");
  return result;
}

function requestBody(projectPath, connection = {}) {
  return {
    brief: `Mode: Work on existing project\nLocal project path: ${projectPath}\nProject type: Node.js application\nSelected stack: Node.js`,
    task: originalTask,
    files: [],
    ...connection,
    quality: "quick",
    modelMode: "auto",
  };
}

async function execute(body) {
  const response = await fetch(`${baseUrl}/api/factory/existing?stream=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  return readStream(response);
}

function assertExactApproval(result, projectPath) {
  assert.equal(result.status, "awaiting-approval");
  assert.equal(result.checklist.length, 1, "whole-project deletion is one project-level operation");
  assert.equal(result.checklist[0].status, "blocked");
  const blocked = result.timeline.filter((event) => event.kind === "blocked" && event.command);
  assert.equal(blocked.length, 1, "the initial request emits one approval, not one approval per file");
  const event = blocked[0];
  assert.equal(event.title, "Permission needed to delete this project");
  assert.equal(event.details.actionKind, "delete-project");
  assert.equal(event.details.projectPath, projectPath);
  assert.equal(event.filePath, projectPath);
  assert.match(event.command, /^foundry:delete-project-root:/);
  assert.ok(fs.existsSync(projectPath), "nothing is deleted before approval");
  return event;
}

function approvalContinuation(first, event, projectPath, connection = {}, decision = "approve-once") {
  return {
    ...requestBody(projectPath, connection),
    task: decision === "deny" ? `Denied approval to run "${event.command}"` : `Approved: run ${event.command}`,
    continuity: "carry_forward_plan",
    parentMission: {
      id: `delete-parent-${Date.now()}`,
      source_requirements: [originalTask],
      state: "waiting_for_approval",
      plan: first.checklist,
      files_touched: [],
      commands_run: [],
      decisions: [],
      findings: [],
      blocked_reason: first.blocker,
      summary: "",
    },
    approvalResponse: { requestedCommand: event.command, decision },
  };
}

async function verifyRefusalJourneys() {
  const deniedFixture = createFixture("project-deletion-denied-e2e");
  const deniedFirst = await execute(requestBody(deniedFixture, { localPath: deniedFixture }));
  const deniedEvent = assertExactApproval(deniedFirst, deniedFixture);
  const denied = await execute(approvalContinuation(deniedFirst, deniedEvent, deniedFixture, { localPath: deniedFixture }, "deny"));
  assert.equal(denied.status, "passed");
  assert.equal(fs.existsSync(deniedFixture), true, "Keep project preserves the complete root");

  const standingGrantFixture = createFixture("project-deletion-standing-grant-e2e");
  const standingFirst = await execute(requestBody(standingGrantFixture, { localPath: standingGrantFixture }));
  const standingEvent = assertExactApproval(standingFirst, standingGrantFixture);
  const standing = await execute(approvalContinuation(standingFirst, standingEvent, standingGrantFixture, { localPath: standingGrantFixture }, "approve-category"));
  assert.equal(standing.status, "failed");
  assert.equal(fs.existsSync(standingGrantFixture), true, "a standing deletion grant cannot authorize project-root removal");

  fs.rmSync(deniedFixture, { recursive: true, force: true });
  fs.rmSync(standingGrantFixture, { recursive: true, force: true });
}

async function verifyDeletionJourney(projectPath, connection = {}) {
  const first = await execute(requestBody(projectPath, connection));
  const event = assertExactApproval(first, projectPath);
  const result = await execute(approvalContinuation(first, event, projectPath, connection));
  assert.equal(result.status, "passed", result.blocker || "deletion mission should pass");
  assert.equal(result.projectDeleted, true);
  assert.equal(fs.existsSync(projectPath), false, "the approved project root is removed, not merely emptied");
  assert.equal(result.checklist.length, 1);
  assert.equal(result.checklist[0].status, "completed");
  assert.ok(result.verification.some((item) => item.result === "pass" && item.evidence.includes(projectPath)));
  const visibleEdits = result.timeline.filter((item) => !item.internal && item.kind === "edit");
  assert.deepEqual(visibleEdits.map((item) => item.title), ["Deleting the approved project folder", "Project folder deleted"], "execution shows one project-level action, never file-by-file deletion noise");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForConnector(url, token) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`, { headers: { authorization: `Bearer ${token}` } });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Disposable local connector did not become ready.");
}

async function main() {
  await verifyRefusalJourneys();
  const directFixture = createFixture("project-deletion-direct-e2e");
  await verifyDeletionJourney(directFixture, { localPath: directFixture });

  const connectorFixture = createFixture("project-deletion-connector-e2e");
  const port = await freePort();
  const token = `delete-e2e-${Date.now()}`;
  const connectorUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(root, "scripts", "foundry-local-connector.cjs"), connectorFixture, String(port), token], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await waitForConnector(connectorUrl, token);
    await verifyDeletionJourney(connectorFixture, { localConnector: { url: connectorUrl, token, rootLabel: connectorFixture } });
  } finally {
    child.kill();
    fs.rmSync(directFixture, { recursive: true, force: true });
    fs.rmSync(connectorFixture, { recursive: true, force: true });
  }

  console.log("project deletion intent, deny, standing-grant refusal, direct-root, and connector-root tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
