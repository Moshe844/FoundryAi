const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function loadContract() {
  const compiled = ts.transpileModule(source("lib/factory/event-contract.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const contractModule = { exports: {} };
  vm.runInNewContext(compiled, { module: contractModule, exports: contractModule.exports, require });
  return contractModule.exports;
}

function event(id, status, extra = {}) {
  return {
    id,
    timestamp: new Date().toISOString(),
    kind: "command",
    status,
    title: status === "running" ? "Running npm.cmd run build" : "Command finished: npm.cmd run build",
    command: "npm.cmd run build",
    ...extra,
  };
}

function run() {
  const contract = loadContract();
  const timeline = [event("build-command", "running", { transient: true })];
  assert.equal(
    contract.matchingRunningEventId(timeline, { kind: "command", command: "npm.cmd run build" }),
    "build-command",
    "The terminal command must recover its running lifecycle identity.",
  );
  contract.upsertExecutionEvent(timeline, event("build-command", "completed", { exitCode: 0, stdout: "compiled", transient: false }));
  assert.equal(timeline.length, 1, "A command lifecycle must render and persist as one event.");
  assert.equal(timeline[0].status, "completed");
  assert.equal(timeline[0].stdout, "compiled");

  const merged = contract.mergeExecutionTimelines(
    [event("build-command", "running", { transient: true })],
    [event("build-command", "completed", { exitCode: 0, transient: false })],
  );
  assert.equal(merged.length, 1, "Client reconciliation must replace, not append, lifecycle updates.");
  assert.equal(merged[0].status, "completed");

  const live = [
    event("provider-wait", "running", { kind: "reasoning", title: "Continuing from 1 verified file change", transient: true }),
    event("source-write", "completed", { kind: "edit", title: "Edited src/app/page.tsx", command: undefined, transient: false }),
  ];
  contract.upsertExecutionEvent(live, event("provider-wait", "running", { kind: "reasoning", title: "Continuing from 2 verified file changes", command: undefined, transient: true }));
  assert.equal(live.length, 2, "A repeated provider-wait state must replace itself rather than duplicate.");
  assert.equal(live.at(-1).id, "provider-wait", "The refreshed provider state must remain at the live edge.");
  assert.equal(live.filter((item) => item.id === "provider-wait").length, 1);

  const problems = [
    ...Array.from({ length: 10 }, () => "Console: Failed to load resource: the server responded with a status of 404"),
    "Responsive layout: desktop /: navigation nav.primary links \"Shop\" and \"About\" are crowded together.",
    "Responsive layout: mobile /: navigation nav.primary links \"Shop\" and \"About\" are crowded together.",
    "Responsive layout: desktop /products: navigation nav.primary links \"Shop\" and \"About\" are crowded together.",
    "Responsive layout: mobile /products: navigation nav.primary links \"Shop\" and \"About\" are crowded together.",
    "Responsive layout: desktop /about: route returned HTTP 404.",
    "Responsive layout: mobile /about: route returned HTTP 404.",
  ];
  const compact = contract.compactValidationProblems(problems);
  assert.equal(compact.length, 3, JSON.stringify(compact));
  assert.match(compact[0], /Observed in 10 checks/);
  assert.match(compact[1], /Observed in 4 checks/);
  assert.match(compact[2], /Observed in 2 checks/);

  const historical = contract.compactEvidenceText(`Browser preview verification failed: ${problems.join(" ")} Screenshot: C:\\validation\\preview.png`);
  assert.ok(historical.length < 1_000, historical);
  assert.equal((historical.match(/Failed to load resource/g) ?? []).length, 1, historical);

  const runtime = source("lib/factory/runtime.ts");
  const executor = source("lib/ai/mission/executor.ts");
  assert.doesNotMatch(runtime, /emitExecution\(execution, "stdout"/);
  assert.doesNotMatch(runtime, /emitExecution\(execution, "stderr"/);
  assert.match(runtime, /!safeEvent\.transient/);
  assert.match(runtime, /compactValidationProblems\(problems\)/);
  assert.match(executor, /id: "implementation-provider-wait"/);

  const canvas = source("lib/canvas/model.ts");
  assert.match(canvas, /event\.kind === "stdout"/);
  assert.match(canvas, /event\.kind === "stderr"/);

  console.log("event contract evaluation passed");
}

run();
