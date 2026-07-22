const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const executor = fs.readFileSync(path.join(root, "lib/ai/mission/executor.ts"), "utf8");
const canvas = fs.readFileSync(path.join(root, "components/canvas/MissionCanvas.tsx"), "utf8");
const blocking = fs.readFileSync(path.join(root, "components/canvas/BlockingCard.tsx"), "utf8");
const sdkIntake = fs.readFileSync(path.join(root, "app/api/factory/agent/sdk-intake/route.ts"), "utf8");
const workingSet = fs.readFileSync(path.join(root, "lib/ai/routing/project-working-set.ts"), "utf8");
assert.match(executor, /IMPLEMENTATION_SCAN_EXCLUDED_DIRS[\s\S]{0,300}"\.foundry-artifacts"[\s\S]{0,100}"\.foundry-data"/, "Implementation discovery can still treat Foundry's quarantined artifacts as customer source.");
assert.match(workingSet, /GENERATED_PATH_PATTERN[\s\S]{0,300}\\\.foundry-artifacts[\s\S]{0,100}\\\.foundry-data/, "Working-set discovery can still route models toward Foundry's quarantined artifacts.");

for (const artifact of ["continuation", "sdk(?:evidence|readiness)", "evidence(?:gate|record|checklist)", "hardwarevalidationnotice"]) {
  assert.ok(executor.toLowerCase().includes(artifact.toLowerCase()), `Missing orchestration-artifact rejection: ${artifact}`);
}
assert.match(executor, /FOUNDRY_MAX_MODEL_CALLS_PER_EXECUTION_BATCH[\s\S]{0,180}\|\| 8/, "Execution batches do not have the default eight-call paid safety boundary.");
assert.match(executor, /paidModelCallsThisBatch >= maximumPaidModelCallsThisBatch[\s\S]{0,500}paidCallPrevented: true/, "The paid safety boundary does not stop before another provider call.");
assert.match(executor, /coordinatedNewProjectFoundation[\s\S]{0,1800}tool\.name === "write_files"[\s\S]{0,1800}name: "write_files"/, "Generated-project recovery can still spend one provider call per tiny file before establishing its foundation.");
assert.match(executor, /coordinatedGeneratedFoundationNeeded[\s\S]{0,500}initialGeneratedManifestPresent[\s\S]{0,500}hasRunnableProjectEntry/, "A token runnable entry can still disable coordinated greenfield generation before a real manifest exists.");
for (const rejectedArtifact of ["generatedPlainPlaceholderPath", "generatedPlaceholderContentPath", "undersizedCoordinatedFoundation", "scaffoldnote", "build in progress", "touch to satisfy tool-call requirement", "TODO|FIXME"]) {
  assert.ok(executor.toLowerCase().includes(rejectedArtifact.toLowerCase()), `Generated placeholder rejection is missing: ${rejectedArtifact}`);
}
for (const rejectedContinuationArtifact of ["placeholder\\d*", "batch\\d*anchor", "init(?:one|two|three|\\d+)", "keep\\d+", "(?:temp|placeholder)(?:\\/|$)", "initialization artifact", "stable state wiring"]) {
  assert.ok(executor.toLowerCase().includes(rejectedContinuationArtifact.toLowerCase()), `Generated continuation junk rejection is missing: ${rejectedContinuationArtifact}`);
}
const projectAccess = fs.readFileSync(path.join(root, "lib/ai/mission/project-access.ts"), "utf8");
assert.match(projectAccess, /MAX_COMMANDS_PER_ROOT = 96/, "Generated native batch verification can still exhaust the command budget before the bounded source mission finishes.");
for (const namespaceGuard of ["invalidAndroidNamespacePath", "const namespacePath", "outside the Android application's established namespace"]) {
  assert.ok(executor.includes(namespaceGuard), `Generated Android namespace guard is missing: ${namespaceGuard}`);
}
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
assert.match(runtime, /effectiveCommandOnlyRequest = explicitCommandOnlyRequest && !resumingIncompleteProject/, "A Retry/continue control can still misclassify unfinished generated-project recovery as operation-only and provoke no-op source anchors.");
assert.match(runtime, /Mandatory Android source contract:[\s\S]{0,500}androidNamespace\.replace\(\/\\\.\/g, "\/"\)/, "Android generation is not explicitly constrained to the established namespace before the first model call.");
assert.match(runtime, /commandOnly: effectiveCommandOnlyRequest/, "The generated-project command-only override is not passed to the executor.");
assert.match(runtime, /generatedRecoveryRequirements\(savedBriefForRecovery\.content\)/, "Generated-project recovery still collapses a detailed saved brief into one generic completion checkbox.");
assert.match(runtime, /item\.length > 80[\s\S]{0,140}\^build \(\?:a \|an \)\?complete/, "Generated recovery still prioritizes the duplicated umbrella description over concrete product capabilities.");
assert.match(runtime, /existingCommands: result\.changedFiles\.length \? \[\] : result\.commands/, "Post-mutation verification can still reuse a pre-mutation build as proof of changed source.");
assert.match(executor, /SOURCE_BATCH_READY_FOR_DETERMINISTIC_VERIFICATION[\s\S]{0,500}return finalize\("failed"/, "Generated source can still accumulate across paid calls without a deterministic verification boundary after each batch.");
assert.match(runtime, /SOURCE_BATCH_READY_FOR_DETERMINISTIC_VERIFICATION\|NO_PROGRESS_/, "A verified generated batch cannot resume after its deterministic verification boundary.");
assert.match(runtime, /modelBudgetBoundaryAfterVerifiedEdit && !resumingIncompleteProject/, "An unfinished generated product can still be marked complete merely because one source batch compiles at the model-call boundary.");
assert.match(runtime, /resumableBatchFailure[\s\S]{0,1200}Model-call limit reached[\s\S]{0,4500}newProject: resumingIncompleteProject/, "A productive generated-project batch can still terminate at the per-batch call boundary or lose greenfield safeguards on continuation.");
assert.match(runtime, /resumableBatchFailure[\s\S]{0,500}candidate\.changedFiles\.length > 0/, "A zero-mutation rejected batch can still trigger another automatic paid continuation.");
assert.match(executor, /8–12 complete coordinated files[\s\S]{0,500}100,000 characters[\s\S]{0,700}user-visible screen or workflow/, "Generated recovery still forces tiny utility batches that exhaust the model-call allowance before building the product.");
assert.match(executor, /coordinatedAndroidProductSlice[\s\S]{0,500}androidProductLayers\.has\("experience"\)[\s\S]{0,300}androidProductLayers\.has\("behavior"\)/, "Android product progress is still measured only by file count instead of cross-layer behavior.");
assert.match(executor, /insufficientAndroidSourceBatch[\s\S]{0,500}runnableEntryExistsNow \? 6 : 2[\s\S]{0,100}!coordinatedAndroidProductSlice/, "Android continuation does not allow a smaller, evidenced cross-layer product slice.");
assert.match(executor, /consecutiveRejectedGeneratedWrites >= 2[\s\S]{0,500}paidCallPrevented: true/, "Repeated rejected generation can still consume paid calls without a durable mutation.");
assert.match(runtime, /continuation\.changedFiles\.length > 0[\s\S]{0,900}runRequiredVerificationProfile[\s\S]{0,500}existingCommands: \[\]/, "Generated continuation batches can still trigger another paid model call before deterministic compile, lint, test, and build verification.");
assert.match(canvas, /localConnector \?\? \(sdkProjectRoot[\s\S]{0,180}127\.0\.0\.1:3917/, "Foundry-managed projects cannot use the installed Local Agent for SDK intake.");
assert.match(canvas, /fetch\("\/api\/factory\/agent\/sdk-intake"/, "The browser still bypasses Foundry's same-origin SDK intake endpoint.");
assert.doesNotMatch(canvas, /fetch\(`\$\{baseUrl\}\/(?:connect|pick-folder|sdk\/discover|sdk\/import)/, "The browser still calls the Local Agent directly.");
assert.match(sdkIntake, /\/connect[\s\S]{0,1200}\/pick-folder[\s\S]{0,1600}\/sdk\/discover[\s\S]{0,1600}\/sdk\/import/, "Server SDK intake does not grant, select, discover, and import in order.");
assert.match(canvas, /importedEvidence[\s\S]{0,700}answerTaskFor\(activeVM\.blocking[\s\S]{0,700}resume the same preserved build mission/, "A successful Local Agent SDK import can still become a separate read-only inspection request.");
assert.match(blocking, /\^Locate SDK files with Local Agent\$[\s\S]{0,180}onLocateSdk\(\)/, "The SDK option can still degrade into a prose answer.");

console.log("Paid-call safety and managed SDK-intake regression checks passed.");
