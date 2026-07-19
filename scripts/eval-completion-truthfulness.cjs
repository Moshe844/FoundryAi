const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadPolicy() {
  const source = fs.readFileSync(path.join(root, "lib/ai/mission/requirement-contract.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require }, { filename: "requirement-contract.js" });
  return loadedModule.exports;
}

function loadFollowUpPolicy() {
  const source = fs.readFileSync(path.join(root, "lib/mission/classifyFollowUp.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require }, { filename: "classifyFollowUp.js" });
  return loadedModule.exports;
}

function loadBrowserInfrastructurePolicy() {
  const source = fs.readFileSync(path.join(root, "lib/verification/browser-infrastructure.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require }, { filename: "browser-infrastructure.js" });
  return loadedModule.exports;
}

function loadDebugIntentPolicy() {
  const source = fs.readFileSync(path.join(root, "lib/ai/mission/debug-intent.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require }, { filename: "debug-intent.js" });
  return loadedModule.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const policy = loadPolicy();
const followUpPolicy = loadFollowUpPolicy();
const browserInfrastructure = loadBrowserInfrastructurePolicy();
const debugIntentPolicy = loadDebugIntentPolicy();
const repeatedImplementationRequest = "make option to upload more pictures\nI should also be able to update pricing on my own, also the whole styling is ugly, needs to be really really nice eye catching";
assert(followUpPolicy.standaloneMutationIntent(repeatedImplementationRequest) === "edit", "The reported standalone implementation request is not recognized as a mutation.");
assert(followUpPolicy.standaloneMutationIntent("When clicking on Settings the app closes.") === "debug", "A plain-language current desktop failure is not routed as repair work.");
assert(debugIntentPolicy.isConcreteDebugRequest("When clicking on Settings the app closes."), "The planner does not recognize the Settings exit as a concrete debug request.");
assert(followUpPolicy.standaloneMutationIntent("What changed in the last mission?") === null, "A genuine status question was incorrectly converted into an edit.");
const uiRequests = [
  "Make the checkout easier and more pleasant for customers to use.",
  "Could this workflow feel clearer and less confusing?",
  "Refresh the interface so it works well on phones.",
  "Give the dashboard a polished, professional experience.",
];
for (const request of uiRequests) {
  assert(policy.isUserFacingUiOutcome(request), `UI outcome was not recognized: ${request}`);
}
assert(!policy.isUserFacingUiOutcome("Rename a private backend helper without changing behavior."), "Backend-only work was misclassified as a UI outcome.");
assert(policy.reportsCurrentBehaviorFailure("When clicking on Settings the app closes."), "A fresh desktop crash report does not override historical completion evidence.");
assert(policy.reportsCurrentBehaviorFailure("Opening the profile page crashes the application."), "A current navigation crash is not recognized as stronger evidence than a prior fingerprint.");
assert(policy.requiresFreshBehavioralAcceptance("Fix the API endpoint returning the wrong response."), "API behavior can still be declared complete from source fingerprints and a build alone.");
assert(policy.requiresFreshBehavioralAcceptance("Add an option to upload more pictures."), "A newly requested product capability does not require fresh behavioral acceptance.");
assert(!policy.requiresFreshBehavioralAcceptance("Rename a private backend helper without changing behavior."), "A source-only rename was incorrectly forced through a runtime acceptance gate.");
assert(!policy.mayAttemptPriorCompletionReuse("When clicking on Settings the app closes.", "desktop"), "The exact reported Settings crash can still be short-circuited as already complete.");
assert(!policy.mayAttemptPriorCompletionReuse("Add a pricing editor to the desktop app.", "desktop"), "Desktop behavior can still reuse fingerprints without current interaction acceptance.");
assert(!policy.mayAttemptPriorCompletionReuse("Fix the API endpoint returning the wrong response.", "api"), "API behavior can still reuse fingerprints without current request/response acceptance.");
assert(policy.mayAttemptPriorCompletionReuse("Add an option to upload more pictures.", "web"), "Web behavior cannot enter provisional reuse before its mandatory browser acceptance gate.");
assert(policy.mayAttemptPriorCompletionReuse("Rename a private backend helper without changing behavior.", "desktop"), "A source-only exact request cannot use verified fingerprints.");
assert(policy.requiresPresentationLayerChange("Modify the UX to be much nicer."), "Broad UX work must require a presentation-layer change.");
const requestedStoreContract = policy.observableBrowserContractForTask("make option to upload more pictures\nI should also be able to update pricing on my own\nalso the whole styling is ugly, needs to be really really nice eye catching");
const requestedStoreCapabilities = new Set(requestedStoreContract.requirements.flatMap((item) => item.capabilities));
assert(requestedStoreCapabilities.has("multiple-file-upload"), "Multi-image upload was not converted into an observable browser capability.");
assert(requestedStoreCapabilities.has("editable-pricing"), "Self-serve pricing was not converted into an observable browser capability.");
assert(requestedStoreCapabilities.has("visual-polish"), "The visual redesign was not converted into an observable browser capability.");
assert(requestedStoreContract.unsupported.length === 0, "The reported store request still contains acceptance clauses Foundry cannot verify deterministically.");
const proposalWrappedStoreContract = policy.observableBrowserContractForTask(`Foundry's referenced proposal (authoritative executable scope):
Inspect the current project structure; Update product data handling to support multiple images per product; Render updated components in real browser preview and verify functionality and visual polish across desktop and mobile.

Current instruction:
make option to upload more pictures
I should also be able to update pricing on my own
also the whole styling is ugly, needs to be really really nice eye catching`);
const proposalWrappedCapabilities = new Set(proposalWrappedStoreContract.requirements.flatMap((item) => item.capabilities));
assert(proposalWrappedCapabilities.has("multiple-file-upload") && proposalWrappedCapabilities.has("editable-pricing") && proposalWrappedCapabilities.has("visual-polish"), "Internal continuity context displaced the user's observable store requirements.");
assert(!proposalWrappedStoreContract.unsupported.some((item) => /Foundry's referenced proposal|Inspect the current project structure/i.test(item)), "Internal proposal bookkeeping is still exposed as a missing browser capability.");
assert(browserInfrastructure.hasDisposableFrameworkAssetFailure([
  "HTTP response: 404 http://127.0.0.1:3103/_next/static/chunks/app/admin/page-old.js.",
  "Page error: Loading chunk 698 failed.",
  "The browser health check passed, but requested behavior acceptance did not: missing rendered capability: editable-pricing, multiple-file-upload.",
]), "A stale Next.js chunk mixed with downstream acceptance misses was not classified for zero-model infrastructure recovery.");
assert(!browserInfrastructure.hasDisposableFrameworkAssetFailure([
  "The browser health check passed, but requested behavior acceptance did not: missing rendered capability: editable-pricing.",
]), "A genuine product-only acceptance miss was incorrectly hidden as infrastructure recovery.");

const executor = fs.readFileSync(path.join(root, "lib/ai/mission/executor.ts"), "utf8");
assert(!executor.includes("fastLane && checklist.length === 1 && changedFiles.size > 0"), "Fast-lane completion bypass returned.");
assert(executor.includes("policy.presentationChangeRequired"), "Presentation-layer completion gate is missing.");
assert(executor.includes("policy.successfulBrowserValidationPasses < policy.requiredBrowserValidationPasses"), "Browser completion gate is missing.");
assert(executor.includes("buildCompletionHandoff"), "Structured completion handoff is missing.");
assert(!executor.includes('item.evidence ||= "Completed and verified before the mission finished."'), "Finalize still fabricates completion evidence.");
assert(executor.includes("function concreteEditEvidence") && executor.includes("changes: editEvidence.length ? editEvidence"), "Final handoffs can still prefer superseded model rationale over the last concrete on-disk diff.");

const workspaceShell = fs.readFileSync(path.join(root, "components/WorkspaceShell.tsx"), "utf8");
const buildDashboard = fs.readFileSync(path.join(root, "components/BuildDashboard.tsx"), "utf8");
const factoryRuntime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const followUpClassifier = fs.readFileSync(path.join(root, "lib/mission/classifyFollowUp.ts"), "utf8");
const intentRoute = fs.readFileSync(path.join(root, "app/api/factory/intent/route.ts"), "utf8");
const missionPlanner = fs.readFileSync(path.join(root, "lib/ai/mission/mission-planner.ts"), "utf8");
const intentClassifier = fs.readFileSync(path.join(root, "lib/ai/mission/intent-classifier.ts"), "utf8");
const projectAccess = fs.readFileSync(path.join(root, "lib/ai/mission/project-access.ts"), "utf8");
const phraseSpecificContinuation = /yes please\|go ahead|go ahead\|continue|BARE_CONTINUE_PATTERN|isBareContinuationMessage/;
assert(!phraseSpecificContinuation.test(`${workspaceShell}\n${factoryRuntime}\n${followUpClassifier}`), "Phrase-specific continuation routing returned.");
assert(workspaceShell.includes('resolvedIntent.currentIntent === "continue"'), "Workspace continuation is not using the resolved semantic intent.");
assert(factoryRuntime.includes('followUpResolution?.currentIntent === "continue"'), "Runtime continuation is not using the structured resolution record.");
assert(workspaceShell.includes("recentConversation: mission.messages.slice(-20)"), "Enough recent conversation turns are not included to preserve proposal continuity across intervening failures.");
assert(workspaceShell.includes("recentMissionMemory: mission.executionMissions.slice(-20)"), "Mission memory is too shallow to resolve earlier referenced work after intervening turns.");
assert(intentRoute.includes('interpretation_source') && intentRoute.includes('mutation_authorized'), "Conversation-grounded authorization is missing from the semantic intent contract.");
assert(intentRoute.includes('mutation_kind') && intentRoute.includes('undo_recorded_change'), "Open-ended rollback language is not represented semantically in the intent contract.");
assert(buildDashboard.includes('undoExecutionId') && workspaceShell.includes('control?.undoExecutionId'), "The dedicated Undo control does not carry an exact execution identity.");
assert(buildDashboard.includes("listAgentTreeWithRetry") && buildDashboard.includes('connectedFolderTreeState === "ready"'), "A Local Agent project can still open before its file tree is indexed.");
assert(buildDashboard.includes("onUpdateRef.current({ uploadNames: paths, uploadedFiles: [] })"), "Indexed Local Agent paths are not persisted into the new workspace immediately.");
assert(buildDashboard.includes("Loading and indexing project files") && !buildDashboard.includes("Close Files and try again in a moment"), "The Files modal can still strand users on a stale tree-loading error.");
assert(factoryRuntime.includes('followUpResolution?.currentIntent === "undo"') && factoryRuntime.includes('classification.intent = "undo"'), "A resolved undo can still be reclassified as generic edit work.");
assert(intentRoute.includes('memoryForLatestFoundryTurn'), "Stored Foundry proposals are not bound back to mission evidence.");
assert(factoryRuntime.includes("Foundry's referenced proposal (executable scope)"), "The planner does not inherit Foundry's referenced proposal as executable scope.");
assert(executor.includes("referencedProposal") && executor.includes("input.priorContext.summary"), "The executor does not receive the referenced proposal.");
assert(factoryRuntime.includes("followUpResolution?.referencedPriorAction?.description?.trim()"), "Planner scope is lost when an intervening mission is newer than the referenced proposal.");
assert(executor.includes("input.followUpResolution?.referencedPriorAction?.description?.trim()"), "Executor scope is lost when an intervening mission is newer than the referenced proposal.");
assert(factoryRuntime.includes('if (!mutatingOutcomeRequired)') && factoryRuntime.includes("preModelBrowserBaselineEvidence"), "A passing pre-change browser baseline can still short-circuit an authorized implementation.");
assert(factoryRuntime.includes("carriesParentRequirements") && executor.includes("carriesPriorRequirements"), "An older referenced proposal can still inherit unrelated requirements from an intervening mission.");
assert(factoryRuntime.includes('result.status === "passed" && mutatingOutcomeRequired && result.changedFiles.length === 0'), "Runtime completion does not reject write-free implementation missions.");
assert(factoryRuntime.includes("browserMayCompleteMission") && factoryRuntime.includes('result.status !== "failed"'), "A passing unchanged browser baseline can still overwrite a failed implementation as Done.");
assert(factoryRuntime.includes("intent: classification.intent") && missionPlanner.includes('input.intent === "debug"'), "The planner can still replace semantic edit intent with a keyword-derived debug template.");
assert(factoryRuntime.includes("Passing commands or browser checks only verify the pre-change baseline"), "The mutation completion blocker does not explain why verification alone is insufficient.");
assert(!factoryRuntime.includes("const stalledBeforeFirstMutation = !preModelBrowserEvidence"), "Browser failure evidence still disables the promised action-enforced mutation recovery.");
assert(executor.includes("input.hasBuildTooling !== false"), "Existing static projects can still expose redundant command tools to the implementation model.");
assert(projectAccess.includes("(?:serve|http-server)"), "Common static preview commands are not recognized as long-running servers.");
assert(factoryRuntime.includes("semanticStaticMutation") && factoryRuntime.includes("strategyComplexity = boundedStaticFollowUp"), "Conversation-grounded static follow-ups can still expand into architecture-scale ceremony.");
assert(factoryRuntime.includes("browserEvidence.acceptanceVerified") && factoryRuntime.includes("Requirement-directed browser acceptance"), "A failed implementation can still be reconciled by generic browser health instead of request-specific acceptance.");
assert(factoryRuntime.includes("Boolean(preModelBrowserEvidence) || boundedStaticFollowUp || explicitCommandOnlyRequest"), "A bounded static edit can still expand into a multi-phase planning mission.");
assert(factoryRuntime.includes("Implemented the requested project change and verified the changed interface"), "A successful browser-reconciled edit can still expose an internal model-budget blocker as its outcome.");
assert(factoryRuntime.includes("findUnreachableVerifiedUiFiles"), "Fingerprint reuse does not check whether changed UI components are reachable from the application.");
assert(factoryRuntime.includes("their UI is not connected to the application"), "Disconnected UI can still be reported as an already-completed implementation.");
assert(workspaceShell.includes("currentStandaloneMutation && !isMutatingProjectIntent(resolvedIntent.currentIntent)"), "A standalone implementation request can still be rendered as a status evidence packet after semantic misclassification.");
assert(workspaceShell.includes("if (reportsCurrentBehaviorFailure(task)) return undefined"), "The client can still attach stale completion evidence to a fresh defect report.");
assert(intentRoute.includes('intent === "status" || intent === "retrospective"'), "The server policy does not correct imperative mutations misclassified as status or retrospective requests.");
assert(intentClassifier.includes("shuts?\\s+down") && intentClassifier.includes("clos(?:e|es|ed|ing)"), "Plain-language unexpected app exits are missing from deterministic debug routing.");
assert(factoryRuntime.includes("observableBrowserContractForTask") && factoryRuntime.includes("validateObservableBrowserContract"), "The browser gate does not derive and exercise observable capabilities from the user's atomic requirements.");
assert(factoryRuntime.includes("acceptanceScreenshotUrl") && factoryRuntime.includes("strongest matching surface"), "Browser evidence can still screenshot an arbitrary last route instead of the strongest requested surface.");
assert(factoryRuntime.includes("hasDisposableFrameworkAssetFailure(problems)"), "A stale generated chunk mixed with downstream DOM failures can still be routed into paid product repair.");
assert(factoryRuntime.includes("browserAcceptanceTask") && factoryRuntime.includes("previewTarget && verificationProfile.commands.some"), "Required builds can still invalidate a live preview or validate internal planning prose instead of the user request.");
assert(factoryRuntime.includes('page.waitForLoadState("networkidle"'), "Client-rendered controls can still be judged missing before route data and hydration settle.");
assert(factoryRuntime.includes("Matching files alone were insufficient; executing the unverified requirements"), "Idempotency reuse can still accept matching fingerprints without rendered requirement acceptance.");
assert(factoryRuntime.includes("currentDefectReport") && factoryRuntime.includes("priorCompletionCanBeReused"), "A fresh defect report can still reuse an older completed mission.");
assert(factoryRuntime.includes("File fingerprints and a build cannot prove the requested") && factoryRuntime.includes("executing normally"), "Non-web behavior can still be marked complete from hashes and compilation alone.");
assert(factoryRuntime.includes("Current defect evidence supersedes the matching historical completion record"), "The server-side reuse function lacks a final defense against stale defect completion.");
assert(factoryRuntime.includes("initializeObjectiveChecklist(execution, requestedTask, sourceMode)"), "A rejected reuse attempt can leave stale completed checklist items visible while repair continues.");

console.log("Completion truthfulness regression checks passed.");
