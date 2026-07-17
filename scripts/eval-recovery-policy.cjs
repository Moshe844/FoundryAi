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
const { shouldResumeIncompleteGeneratedProject, buildOnlyRecoveryCanComplete } = moduleRecord.exports;

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

console.log("Recovery policy regression checks passed.");
