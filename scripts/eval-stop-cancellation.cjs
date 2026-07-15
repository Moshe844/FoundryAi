const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixture = path.join(root, "tmp", `stop-cancellation-e2e-${process.pid}-${Date.now()}`);
const lateMarker = path.join(fixture, "late.txt");
const startedMarker = path.join(fixture, "started.txt");
const controlId = path.basename(fixture);

async function main() {
  fs.rmSync(fixture, { recursive: true, force: true });
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
    name: "stop-cancellation-e2e",
    private: true,
    scripts: { test: "node long-test.cjs" },
  }, null, 2));
  fs.writeFileSync(path.join(fixture, "long-test.cjs"), [
    'const fs = require("node:fs");',
    'fs.writeFileSync("started.txt", "running");',
    'setTimeout(() => { fs.writeFileSync("late.txt", "the cancelled subprocess survived"); }, 5000);',
  ].join("\n"));

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
  let commandStarted = false;
  let abortAt = 0;
  try {
    const response = await fetch("http://127.0.0.1:3001/api/factory/existing?stream=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brief: `Mode: Work on existing project\nLocal project path: ${fixture}`,
        task: "Approved: run npm test",
        files: [],
        localPath: fixture,
        controlId,
        continuity: "carry_forward_plan",
        parentMission: {
          id: "stop-parent",
          source_requirements: ["Run npm test as the only project action and report its real exit code. Do not edit files."],
          state: "waiting_for_approval",
          plan: [{ id: "run-test", label: "Run npm test", status: "blocked" }],
          files_touched: [],
          commands_run: [],
          decisions: [],
          findings: [],
          blocked_reason: "Waiting for approval to run: npm test",
          summary: "",
        },
        approvalResponse: { requestedCommand: "npm test", decision: "approve-once" },
        quality: "quick",
        modelMode: "auto",
      }),
      signal: controller.signal,
    });
    assert.ok(response.ok && response.body, `execution request failed: HTTP ${response.status}`);
    const reader = response.body.getReader();
    const consume = (async () => {
      while (true) {
        const { done } = await reader.read();
        if (done) return;
      }
    })().catch((error) => {
      if (!(error instanceof Error) || error.name !== "AbortError") throw error;
    });
    const deadline = Date.now() + 55_000;
    while (Date.now() < deadline && !fs.existsSync(startedMarker)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    commandStarted = fs.existsSync(startedMarker);
    assert.equal(commandStarted, true, "the fixture reached a real running command before Stop");
    abortAt = Date.now();
    const stopResponse = await fetch("http://127.0.0.1:3001/api/factory/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ controlId }),
    });
    const stopResult = await stopResponse.json();
    assert.equal(stopResult.stopped, true, "the server found and aborted the in-flight execution");
    controller.abort();
    await consume;
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") throw error;
  } finally {
    clearTimeout(timeout);
  }

  assert.equal(commandStarted, true, "the fixture reached a real running command before Stop");
  assert.equal(timedOut, false, "the fixture reached the command within the bounded test window");
  await new Promise((resolve) => setTimeout(resolve, 6500));
  assert.equal(fs.existsSync(lateMarker), false, "no post-cancellation subprocess event reached the filesystem");
  console.log(JSON.stringify({ passed: true, commandStarted, abortLatencyWindowMs: Date.now() - abortAt, lateMarker: false }));
  fs.rmSync(fixture, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
