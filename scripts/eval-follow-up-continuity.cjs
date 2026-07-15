const assert = require("node:assert/strict");
const { mkdirSync, rmSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "tmp", "follow-up-continuity-test");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const source = path.join(root, "lib", "mission", "classifyFollowUp.ts");
const compile = spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), source, "--outDir", outDir, "--module", "commonjs", "--target", "es2022", "--skipLibCheck"], { cwd: root, encoding: "utf8" });
if (compile.status !== 0) {
  console.error(compile.stdout);
  console.error(compile.stderr);
  process.exit(compile.status || 1);
}

const {
  LatestFollowUpQueue,
  classifyFollowUpControl,
  fallbackFollowUpResolution,
  normalizeFollowUpResolution,
} = require(path.join(outDir, "classifyFollowUp.js"));

const now = new Date();
const earlier = new Date(now.getTime() - 5_000);
function context(overrides = {}) {
  return {
    missionTitle: "Inventory",
    objective: "Improve the inventory screen",
    source: "local-agent:C:/project",
    execution: {
      id: "run-active",
      status: "complete",
      objective: "Add inventory filters",
      changedFiles: ["edited src/Inventory.tsx (verified)"],
      createdAt: earlier.toISOString(),
      updatedAt: now.toISOString(),
    },
    recentMissionMemory: [{
      id: "run-previous",
      task: "Add inventory filters",
      status: "complete",
      summary: "Added inventory filters and verified the screen.",
      filesChanged: [{ path: "src/Inventory.tsx", status: "edited" }],
      createdAt: earlier.toISOString(),
      updatedAt: now.toISOString(),
    }],
    ...overrides,
  };
}

// 1. Simple follow-up after a large mission: a concrete new target replans from current evidence.
const simple = fallbackFollowUpResolution("Add a tooltip in src/Inventory.tsx", context());
assert.equal(simple.currentIntent, "edit");
assert.equal(simple.continuity, "fresh_plan");
assert.deepEqual(simple.relevantFiles, ["src/Inventory.tsx"]);

// 2. "Undo that" after one edit binds to the actual immediately preceding execution.
const undoOne = fallbackFollowUpResolution("Undo that", context());
assert.equal(undoOne.currentIntent, "undo");
assert.equal(undoOne.referencedPriorAction.executionId, "run-previous");
assert.deepEqual(undoOne.relevantFiles, ["src/Inventory.tsx"]);

// 3. "Undo that" after several edits keeps the referenced execution's exact file set.
const undoSeveral = fallbackFollowUpResolution("Undo that", context({ recentMissionMemory: [{
  id: "run-multi", task: "Split the inventory view", status: "complete", summary: "Split the view.",
  filesChanged: [{ path: "src/Inventory.tsx" }, { path: "src/Inventory.css" }, { path: "src/filters.ts" }],
  createdAt: earlier.toISOString(), updatedAt: now.toISOString(),
}] }));
assert.deepEqual(undoSeveral.relevantFiles, ["src/Inventory.tsx", "src/Inventory.css", "src/filters.ts"]);

// 4. Continue after interruption resumes the real active execution and no completed step is invented.
const continued = fallbackFollowUpResolution("Continue", context({ execution: { id: "run-paused", status: "cancelled", objective: "Finish filters", changedFiles: ["edited src/filters.ts (verified)"], createdAt: earlier.toISOString(), updatedAt: now.toISOString() } }));
assert.equal(continued.currentIntent, "continue");
assert.equal(continued.referencedPriorAction.executionId, "run-paused");
assert.match(continued.expectedScope, /active mission/i);

// 5. Why did you do that? is journal-backed and read-only.
const why = fallbackFollowUpResolution("Why did you do that?", context());
assert.equal(why.currentIntent, "retrospective");
assert.equal(why.destructive, false);
assert.equal(why.referencedPriorAction.executionId, "run-previous");

// 6. Ambiguous remove never guesses across multiple targets.
const ambiguousRemove = fallbackFollowUpResolution("Remove that", context({ recentMissionMemory: [{ id: "run-two", filesChanged: [{ path: "src/a.ts" }, { path: "src/b.ts" }] }] }));
assert.equal(ambiguousRemove.currentIntent, "clarify");
assert.deepEqual(ambiguousRemove.relevantFiles, []);
const overconfidentRemove = normalizeFollowUpResolution({
  currentIntent: "undo", referencedPriorAction: { executionId: "run-two", description: "two-file edit" },
  relevantFiles: ["src/a.ts", "src/b.ts"], expectedScope: "remove both", destructive: true,
  referenceConfidence: 0.99, plannedAction: "Remove that", continuity: "carry_forward_plan", rationale: "model guess",
}, "Remove that", context({ recentMissionMemory: [{ id: "run-two", filesChanged: [{ path: "src/a.ts" }, { path: "src/b.ts" }] }] }));
assert.equal(overconfidentRemove.currentIntent, "clarify", "model confidence cannot override an ambiguous destructive target");

// 7. A one-element visual follow-up excludes unrelated backend work.
const darker = fallbackFollowUpResolution("Make it darker", context({ recentMissionMemory: [{ id: "run-ui", task: "Polish header", filesChanged: [{ path: "src/header.css" }, { path: "api/server.py" }] }] }));
assert.equal(darker.currentIntent, "edit");
assert.deepEqual(darker.relevantFiles, ["src/header.css"]);

// 8/9. Switching topics creates a fresh plan and cannot reuse the previous plan.
const switched = fallbackFollowUpResolution("Create docs/release-notes.md", context());
assert.equal(switched.continuity, "fresh_plan");
assert.equal(switched.referencedPriorAction, null);

// 10. A destructive low-confidence model answer is downgraded to one clarification.
const unsafe = normalizeFollowUpResolution({
  currentIntent: "edit", referencedPriorAction: null, relevantFiles: ["src/a.ts"], expectedScope: "remove it", destructive: true,
  referenceConfidence: 0.4, plannedAction: "Remove that", continuity: "carry_forward_plan", rationale: "guess", clarifyingQuestion: "Which item?", clarifyingOptions: [],
}, "Remove that", context());
assert.equal(unsafe.currentIntent, "clarify");
assert.match(unsafe.expectedScope, /No files may change/i);

// 11/12. The queue contains only the latest real user payload; no fabricated steps exist.
const queue = new LatestFollowUpQueue();
queue.replace("m1", { task: "old suggestion" });
queue.replace("m1", { task: "newest user instruction" });
assert.deepEqual(queue.take("m1"), { task: "newest user instruction" });
assert.equal(queue.take("m1"), undefined);

// 13. A model cannot smuggle an unrelated file into a referenced follow-up scope.
const stripped = normalizeFollowUpResolution({
  currentIntent: "edit",
  referencedPriorAction: { executionId: "run-previous", description: "filters" },
  relevantFiles: ["src/Inventory.tsx", "server/unrelated.ts"],
  expectedScope: "change the filter only", destructive: false, referenceConfidence: 0.9,
  plannedAction: "Change that filter", continuity: "carry_forward_plan", rationale: "resolved", clarifyingQuestion: "", clarifyingOptions: [],
}, "Change that filter", context());
assert.deepEqual(stripped.relevantFiles, ["src/Inventory.tsx"]);

// 14. Visible control state matches the controller action: busy queues, Stop aborts, approval blocks.
assert.equal(classifyFollowUpControl({ message: "Make it darker", isBusy: true, pendingApproval: false }), "queue");
assert.equal(classifyFollowUpControl({ message: "Stop", isBusy: true, pendingApproval: false }), "hard_stop");
assert.equal(classifyFollowUpControl({ message: "Do something else", isBusy: false, pendingApproval: true }), "resolve_approval");
assert.equal(classifyFollowUpControl({ message: "Approved: run npm test", isBusy: false, pendingApproval: true }), "run");

rmSync(outDir, { recursive: true, force: true });
console.log("follow-up continuity regressions passed (14/14)");
