const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const filePath = path.join(__dirname, "..", "lib", "factory", "recovery-policy.ts");
const source = fs.readFileSync(filePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filePath,
}).outputText;
const moduleRecord = { exports: {} };
new Function("exports", "module", "require", compiled)(moduleRecord.exports, moduleRecord, require);
const {
  autonomousRepairStageLimit,
  buildOnlyRecoveryCanComplete,
  GENERATED_RECOVERY_ROUTING_BUDGET,
  generatedRecoveryContinuationLimit,
  normalizeVerificationEvidence,
  shouldResumeExactFailedRetry,
  shouldResumeIncompleteGeneratedProject,
} = moduleRecord.exports;

const base = {
  isFoundryGeneratedProject: true,
  hasPreModelBrowserEvidence: false,
  isUndo: false,
  hasRunnableEntry: true,
  isControlContinuation: true,
  hasOpenPlanItems: false,
  commandOnly: false,
  deletesProject: false,
};

assert.equal(shouldResumeIncompleteGeneratedProject(base), false, "A green inherited checklist must not turn a feature retry into build-only recovery.");
assert.equal(shouldResumeIncompleteGeneratedProject({ ...base, isControlContinuation: false }), false, "A standalone mutation must remain a fresh implementation.");
assert.equal(shouldResumeIncompleteGeneratedProject({ ...base, hasOpenPlanItems: true }), true, "A real continuation with open work should resume.");
assert.equal(shouldResumeIncompleteGeneratedProject({ ...base, hasRunnableEntry: false, isControlContinuation: false }), true, "A generated project with no runnable entry still needs recovery.");

const buildBase = {
  buildPassed: true,
  hasRunnableEntry: true,
  hasPreModelBrowserEvidence: false,
  hasOpenPlanItems: false,
  mutatingOutcomeRequired: false,
};
assert.equal(buildOnlyRecoveryCanComplete(buildBase), true, "A genuinely non-mutating recovery may finish from deterministic build evidence.");
assert.equal(buildOnlyRecoveryCanComplete({ ...buildBase, mutatingOutcomeRequired: true }), false, "A build cannot prove an authorized feature change.");
assert.equal(buildOnlyRecoveryCanComplete({ ...buildBase, hasOpenPlanItems: true }), false, "A build cannot erase unresolved requirements.");
assert.equal(buildOnlyRecoveryCanComplete({ ...buildBase, hasPreModelBrowserEvidence: true }), false, "A build cannot erase a browser-verified defect.");

const exactRetryBase = {
  exactRetry: true,
  retryIdMatchesParent: true,
  parentState: "failed",
  hasApprovalResponse: false,
  attachmentCount: 0,
};
assert.equal(shouldResumeExactFailedRetry(exactRetryBase), true, "The dedicated retry control must authoritatively resume its failed run.");
assert.equal(shouldResumeExactFailedRetry({ ...exactRetryBase, parentState: "cancelled" }), true, "An interrupted exact run must be resumable.");
assert.equal(shouldResumeExactFailedRetry({ ...exactRetryBase, retryIdMatchesParent: false }), false, "A retry id may not bind to another mission.");
assert.equal(shouldResumeExactFailedRetry({ ...exactRetryBase, hasApprovalResponse: true }), false, "Approval responses retain their separate authority path.");
assert.equal(shouldResumeExactFailedRetry({ ...exactRetryBase, attachmentCount: 1 }), false, "New evidence attachments make this a new evidence-bearing request.");

const volatileEvidenceA = "Live acceptance 1784482263688 failed at http://127.0.0.1:3101 after 1250ms on 2026-07-19T12:34:56.000Z";
const volatileEvidenceB = "live acceptance 1784489999999 failed at localhost:4999 after 2 seconds on 2026-07-19T12:40:00Z";
assert.equal(normalizeVerificationEvidence(volatileEvidenceA), normalizeVerificationEvidence(volatileEvidenceB), "Run ids, ports, timestamps, and durations must not buy duplicate semantic repairs.");
assert.notEqual(normalizeVerificationEvidence("Assignment failed"), normalizeVerificationEvidence("Completion failed"), "Distinct failed capabilities must remain distinct.");
assert.equal(autonomousRepairStageLimit(undefined), 6, "Autonomous recovery should continue beyond the legacy three-pass ceiling by default.");
assert.equal(autonomousRepairStageLimit("12"), 12, "Deployments may raise the recovery ceiling.");
assert.equal(autonomousRepairStageLimit("100"), 20, "A hard safety ceiling must still prevent runaway spend.");
assert.deepEqual(GENERATED_RECOVERY_ROUTING_BUDGET, { maximumModelCalls: 8, estimatedCostUsd: 0.75 }, "One generated-project retry must never inherit a 40-call enterprise budget.");
assert.equal(generatedRecoveryContinuationLimit(undefined), 2);
assert.equal(generatedRecoveryContinuationLimit("1"), 1);
assert.equal(generatedRecoveryContinuationLimit("20"), 2, "Configuration cannot expand a generated-project retry beyond two paid continuation stages.");

console.log("Recovery policy regression checks passed.");
