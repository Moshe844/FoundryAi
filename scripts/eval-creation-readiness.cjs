const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const loadTs = (file, customRequire = require) => {
  const compiled = ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require: customRequire });
  return loaded.exports;
};

const discovery = loadTs("lib/ai/project-discovery.ts");
assert.equal(discovery.explicitPlatformFromPrompt("Build a PAX Android point-of-sale application that allows merchants to scan items and checkout."), "Mobile app");
const dashboardSource = source("components/BuildDashboard.tsx");
assert.match(dashboardSource, /const subtype = template\.id === "custom" \? "" : firstSubtypeFor\(template\.id\)/, "Freeform projects must not be preclassified as Web apps.");
assert.match(dashboardSource, /subtype: "",\s*\/\/ Keep freeform discovery unclassified|Keep freeform discovery unclassified[\s\S]{0,180}subtype: ""/, "Editing a custom brief must clear any stale platform subtype.");
assert.match(dashboardSource, /explicitSurfaceFromBrief\(start\.projectDescription, start\.discovery\)/, "The discovery rail must derive its platform label from the current brief.");
assert.match(dashboardSource, /start\.template\.id === "custom" && !start\.projectNameTouched[\s\S]{0,180}start\.projectDescription/, "Freeform project creation must derive identity from the current authoritative brief.");
assert.match(dashboardSource, /deterministicDiscoveryIsSufficient\(seedText\)[\s\S]{0,1600}discoveryProvenance: "deterministic"/, "Explicit platform/stack briefs must bypass unnecessary remote discovery.");
assert.match(dashboardSource, /No discovery model call was needed\./, "The UI must distinguish zero-call deterministic discovery from a failed model refinement.");
assert.match(dashboardSource, /decision\.dimension === "platform" && platformHypothesis[\s\S]{0,500}hypothesis: platformHypothesis/, "Selecting a native stack must reconcile the memo's platform decision instead of retaining Web app.");
assert.match(dashboardSource, /fact === previousPlatform[\s\S]{0,220}platformHypothesis/, "Platform reconciliation must remove stale Web app key facts.");
assert.match(dashboardSource, /explicitPlatformFromPrompt\(brief\)[\s\S]{0,180}words >= 8/, "The zero-call discovery path must require an explicit platform and a concrete brief.");
const staticBrief = "Create a small static web app called Orbit Notes. Use plain HTML, CSS, and JavaScript with no external dependencies. Users can add notes, search notes, pin favorites, delete notes, and keep data in localStorage.";
const staticResult = discovery.discoverProject(staticBrief);
assert.equal(discovery.explicitStackFromPrompt(staticBrief), "Static HTML + CSS + JavaScript");
assert.equal(staticResult.recommendedStack, "Static HTML + CSS + JavaScript");
assert.equal(staticResult.decisions.find((item) => item.dimension === "platform").hypothesis, "Web app");
assert.ok(staticResult.mainFeatures.some((feature) => /search/i.test(feature)), "Detailed custom briefs must preserve named features in the local fallback.");
assert.ok(staticResult.projectType.length < 100, "The project name must not swallow the entire detailed brief.");

const reactBrief = "Create VenueFlow using React, TypeScript, and Vite. Include booking search, filters, create/edit/cancel, responsive layouts, localStorage, and unit tests.";
assert.equal(discovery.explicitStackFromPrompt(reactBrief), "Vite + React + TypeScript");
assert.equal(discovery.discoverProject(reactBrief).recommendedStack, "Vite + React + TypeScript");
const reactResult = discovery.discoverProject(reactBrief);
assert.ok(reactResult.mainFeatures.some((feature) => /booking search/i.test(feature)));
assert.ok(reactResult.mainFeatures.some((feature) => /create\/edit\/cancel/i.test(feature)));
assert.ok(reactResult.dataModel.some((entity) => /booking/i.test(entity)));
assert.ok(reactResult.dataModel.every((entity) => !/^(?:And|Medium-complexity)$/i.test(entity)));

const nextBrief = "Build ForgeOps as a production-ready Next.js and TypeScript application using Prisma with PostgreSQL, role permissions, audit history, tests, and deployment checks.";
assert.equal(discovery.explicitStackFromPrompt(nextBrief), "Next.js + TypeScript");
const nextResult = discovery.discoverProject(nextBrief);
assert.equal(nextResult.recommendedStack, "Next.js + TypeScript");
assert.equal(nextResult.projectType, "ForgeOps");
assert.equal(nextResult.questions.length, 0, "A detailed explicit-stack brief must not ask questions already answered by the user.");
const longExplicitName = "Build ForgeOps Acceptance as a production-ready multi-tenant maintenance operations platform using Next.js and TypeScript with Prisma and PostgreSQL.";
assert.equal(discovery.explicitProjectNameFromPrompt(longExplicitName), "ForgeOps Acceptance");
assert.equal(discovery.discoverProject(longExplicitName).projectType, "ForgeOps Acceptance");
const complexBrief = `${longExplicitName} Organizations contain sites, assets, technicians, and work orders. Include organization-scoped navigation, role permissions for admin manager and technician, preventive maintenance schedules, asset health and overdue KPI dashboards, filterable and searchable work-order tables, create/edit/assign/complete work-order flows, optimistic feedback, validation and empty/error/loading states, immutable audit history, seeded realistic data, responsive accessible UI, Prisma schema and migration-ready relational models, service and repository boundaries, unit tests for permissions and status transitions, integration tests for core services, typecheck, production build, and a real browser acceptance pass for create, search/filter, edit, assignment, completion, persistence, and permission-denied behavior.`;
const complexResult = discovery.discoverProject(complexBrief);
for (const entity of ["Organization", "Site", "Asset", "Technician", "Work Order"]) {
  assert.ok(complexResult.dataModel.includes(entity), `Explicit entity was lost: ${entity}`);
}
assert.ok(complexResult.dataModel.includes("Role"), "Role-based access must produce a Role domain boundary.");
for (const noisyEntity of ["Searchable Work-order", "Complete Work-order", "Immutable Audit", "Migration-ready Relational"]) {
  assert.ok(!complexResult.dataModel.includes(noisyEntity), `Descriptive prose leaked into the entity model: ${noisyEntity}`);
}
for (const capability of ["role permissions", "preventive maintenance", "browser acceptance", "permission-denied"]) {
  assert.ok(complexResult.mainFeatures.some((feature) => feature.toLowerCase().includes(capability)), `Explicit capability was lost: ${capability}`);
}
assert.equal(discovery.explicitPersistenceFromPrompt(complexBrief), "PostgreSQL");
assert.equal(complexResult.decisions.find((item) => item.dimension === "auth-database-api").hypothesis, "PostgreSQL persistence with replaceable repository and migration boundaries");
const deliberatelyLossyRefinement = discovery.reconcileDiscoveryWithExplicitBrief({ ...complexResult, mainFeatures: ["Generic CRUD"], dataModel: ["Resource"] }, complexBrief);
assert.ok(deliberatelyLossyRefinement.mainFeatures.some((feature) => /permission-denied/i.test(feature)), "Model refinement must not weaken explicit acceptance requirements.");
assert.ok(deliberatelyLossyRefinement.dataModel.includes("Organization"), "Model refinement must not discard explicit entities.");

const selectedMobileProduct = "Workout Trackers, Calorie Counters, Meditation Timers IOS app";
const genericMobileSeed = discovery.discoverProject("Mobile app");
const productSpecificFallback = discovery.reconcileDiscoveryWithUserProductSignal(genericMobileSeed, {
  productSignal: selectedMobileProduct,
  starterTitle: "Mobile App",
});
assert.equal(productSpecificFallback.projectType, selectedMobileProduct);
for (const concept of ["Workout Trackers", "Calorie Counters", "Meditation Timers"]) {
  assert.ok(productSpecificFallback.mainFeatures.includes(concept), `Selected product concept was lost: ${concept}`);
}
assert.ok(productSpecificFallback.architecture.includes(selectedMobileProduct), "Fallback architecture must name the selected product scope.");
assert.ok(productSpecificFallback.dataModel.every((entity) => !/^(?:Item\/record|Activity\/event)$/i.test(entity)), "Generic entity placeholders must not outrank selected product concepts.");
assert.equal(productSpecificFallback.decisions.find((item) => item.dimension === "domain").source, "user-confirmed");

const policy = loadTs("lib/discovery/platform-stack-policy.ts", (id) => {
  if (id === "@/lib/ai/project-discovery") return discovery;
  return require(id);
});
const reconciled = policy.reconcilePlatformStackOptions("custom", staticResult, [
  { name: "Electron + React + TypeScript", why: "wrong platform", recommended: true },
  { name: ".NET WPF", why: "wrong platform", recommended: false },
]);
assert.equal(reconciled.family, "web");
assert.equal(reconciled.recommendedStack, "Static HTML + CSS + JavaScript");
assert.equal(reconciled.stackOptions[0].recommended, true);

const requirements = loadTs("lib/ai/mission/requirement-contract.ts");
const contract = requirements.observableBrowserContractForTask(staticBrief);
const capabilities = new Set(contract.requirements.flatMap((item) => item.capabilities));
for (const capability of ["create-record", "search-filter", "toggle-state", "delete-record", "persistent-state"]) {
  assert.ok(capabilities.has(capability), `Missing named browser capability: ${capability}`);
}
const venueContract = requirements.observableBrowserContractForTask(reactBrief + " Reject overlapping room conflicts in the browser.");
const venueCapabilities = new Set(venueContract.requirements.flatMap((item) => item.capabilities));
for (const capability of ["create-record", "search-filter", "update-record", "cancel-record", "conflict-rejection", "persistent-state"]) {
  assert.ok(venueCapabilities.has(capability), `Missing VenueFlow browser capability: ${capability}`);
}
const complexContract = requirements.observableBrowserContractForTask(complexBrief);
const complexCapabilities = new Set(complexContract.requirements.flatMap((item) => item.capabilities));
for (const capability of ["create-record", "search-filter", "update-record", "assign-record", "complete-record", "persistent-state", "permission-denied"]) {
  assert.ok(complexCapabilities.has(capability), `Missing ForgeOps browser capability: ${capability}`);
}
const calculatorContract = requirements.observableBrowserContractForTask("Build a single-page calculator with transient calculation state, optional history per session, and no persistence or auth.");
const calculatorCapabilities = new Set(calculatorContract.requirements.flatMap((item) => item.capabilities));
assert.ok(!calculatorCapabilities.has("persistent-state"), "A negative persistence constraint was inverted into a required browser capability.");
const persistedCalculatorContract = requirements.observableBrowserContractForTask("Persist calculator history in localStorage so it survives a reload.");
const persistedCalculatorCapabilities = new Set(persistedCalculatorContract.requirements.flatMap((item) => item.capabilities));
assert.ok(persistedCalculatorCapabilities.has("persistent-state"), "An explicit positive persistence requirement was lost.");
const savedRecordsContract = requirements.observableBrowserContractForTask("Save created reports and show the saved records after reload.");
const savedRecordsCapabilities = new Set(savedRecordsContract.requirements.flatMap((item) => item.capabilities));
assert.ok(savedRecordsCapabilities.has("persistent-state"), "Natural save-and-retrieve requirements do not enter persistence acceptance.");
const expandedCalculatorContract = requirements.observableBrowserContractForTask("Improve my existing calculator without rebuilding it from scratch. Add standard operations, calculation history, a Clear History option, scientific mode, degrees and radians, keyboard input, error handling, light and dark mode, copy result, and make the complete static source set use separate files.");
const expandedCalculatorCapabilities = new Set(expandedCalculatorContract.requirements.flatMap((item) => item.capabilities));
for (const falseCrudCapability of ["toggle-state", "delete-record", "complete-record"]) {
  assert.ok(!expandedCalculatorCapabilities.has(falseCrudCapability), `Calculator controls were misclassified as ${falseCrudCapability}.`);
}

const dashboard = source("components/BuildDashboard.tsx");
assert.match(dashboard, /const hardTimeoutMs = 8_000/);
assert.match(dashboard, /fast-discovery-v5-explicit-contract", attempt/);
assert.match(dashboard, /exceeded the 8-second user-facing time budget/);
assert.match(dashboard, /portfolio\|product page\|landing page/, "Simple content websites do not bypass unnecessary remote discovery.");
assert.match(dashboard, /if \(!result\.ok \|\| !result\.discovery\) \{[\s\S]{0,120}skipRefinement\(\)/, "Timed-out discovery can still strand the user on an error screen instead of advancing locally.");
assert.match(dashboard, /result\.provenance === "brief"/);
assert.match(dashboard, /explicitProjectNameFromPrompt/);
assert.match(dashboard, /projectType: explicitProjectName \|\| discovery\.projectType/);
assert.match(dashboard, /const explicitName = explicitProjectNameFromPrompt\(value\)/);
assert.match(dashboard, /if \(explicitName\) return explicitName\.trim\(\)/);

const discoveryRoute = source("app/api/factory/discover/route.ts");
assert.match(discoveryRoute, /explicitBriefCanProceed/);
assert.match(discoveryRoute, /provenance: "brief"/);
assert.match(discoveryRoute, /used the explicit brief-derived decision instead of blocking/);
assert.match(discoveryRoute, /explicitProjectNameFromPrompt/);
assert.match(discoveryRoute, /parsedRefinement\.discovery\.projectType = explicitProjectName/);
assert.match(discoveryRoute, /reconcileDiscoveryWithExplicitBrief/);
assert.match(discoveryRoute, /reconcileDiscoveryWithUserProductSignal/);
assert.match(discoveryRoute, /const authoritativeBrief =/);
assert.match(discoveryRoute, /const fallbackDiscovery = \{ \.\.\.preserveUserProductSignal\(heuristic\), prompt: authoritativeBrief \}/);
assert.match(discoveryRoute, /deploymentNoteRespectingExplicitPersistence/);

const runtime = source("lib/factory/runtime.ts");
const taskProfiler = source("lib/ai/routing/task-profiler.ts");
const executor = source("lib/ai/mission/executor.ts");
const executionControl = source("lib/factory/execution-control.ts");
assert.match(runtime, /const requestedMockReview =/);
assert.match(runtime, /const offerMockGate = requestedMockReview &&/);
assert.match(runtime, /const credentialBrief = \[spec\.projectDescription, `Selected stack: \$\{spec\.stack\}`, spec\.instructions\]/);
assert.doesNotMatch(runtime, /const credentialBrief = \[brief, spec\.projectDescription/);
assert.match(runtime, /maxTurns: stackProfile\.id === "static-html" \? 8 : 6/);
assert.match(runtime, /const maxCreationContinuationBatches = 0/);
assert.match(runtime, /const generationBoundaryWithFiles = result\.status === "failed"/);
assert.doesNotMatch(runtime, /const budgetBoundaryAfterGeneration/);
assert.match(runtime, /Created verified Vite \+ React project scaffold/);
assert.match(runtime, /Created verified Node\.js service scaffold/);
assert.match(runtime, /Created verified Python service scaffold/);
assert.match(runtime, /Created verified ASP\.NET Core scaffold/);
assert.match(runtime, /src\/app\/page\.tsx/);
assert.match(runtime, /actionRecoveryEvidence/);
assert.match(runtime, /requireFirstMutation: Boolean\(actionRecoveryEvidence\)/);
assert.match(runtime, /exerciseNamedBrowserWorkflow/);
assert.match(runtime, /const numericInput =/);
assert.match(runtime, /numericInput \? "42"/);
assert.match(runtime, /"assign-record"/);
assert.match(runtime, /"complete-record"/);
assert.match(runtime, /"permission-denied"/);
assert.match(runtime, /\[role="dialog"\]:visible/);
assert.match(runtime, /article:visible, li:visible, tr:visible/);
assert.match(runtime, /A record list often opens a professional detail screen on row\/card click/);
assert.match(runtime, /await page\.waitForTimeout\(700\);/);
assert.match(runtime, /const selectedValuePersisted =/);
assert.match(runtime, /const conciseAssigneeLabel =/);
assert.match(runtime, /const confirmationSurface = visibleCreateForm\(\)/);
assert.match(runtime, /Server-backed mutations commonly refetch and reorder a list/);
assert.match(runtime, /attempt < 8/);
assert.match(runtime, /const durableBrowserBrief = await access\.readFile\("foundry-brief\.md"/);
assert.match(runtime, /durableBrowserBrief\?\.exists && !requestNamesConcreteChange \? durableBrowserRequirementsFromBrief\(durableBrowserBrief\.content\)/);
assert.match(runtime, /Project description:/);
assert.match(runtime, /requestedTask = durableBrowserRequirementsFromBrief\(requestedTask\)/, "Browser acceptance still treats deferred ideas and alternative stacks as current requirements.");
assert.doesNotMatch(runtime, /\.\.\.\(uncoveredProse\.length \? \[.*had no automatic browser check/, "Uncheckable descriptive prose still manufactures a browser failure and paid repair.");
assert.match(runtime, /const verified = missing\.length === 0 && workflow\.problems\.length === 0/, "Browser acceptance does not base its verdict exclusively on observed checks.");
assert.match(taskProfiler, /const text = activeTaskScope\(input\.message\)\.toLowerCase\(\)/, "Routing still profiles deferred brief content as active work.");
assert.match(taskProfiler, /Anticipated future capabilities/, "Deferred Foundry brief capabilities are not removed from routing scope.");
assert.match(executor, /input\.staticProject[\s\S]{0,180}\? 45_000/, "A stalled static-project provider can still freeze generation for two minutes.");
assert.equal((executionControl.match(/if \(current\.state === "stopped"\) return;/g) || []).length, 2, "Late completion or failure can overwrite an explicit Stop state.");
assert.equal((runtime.match(/const inheritedBrowserRequest =/g) || []).length, 1, "Every browser branch must share one durable acceptance input.");
assert.doesNotMatch(runtime, /previewOwnershipToken, requestedTask\)/);
assert.match(runtime, /Verification-only browser acceptance failed\. Foundry preserved every project file/);
assert.match(runtime, /workspaceProjectPath && !explicitlyReadOnlyOperation/);
assert.match(runtime, /the requirement-directed acceptance contract/);
assert.doesNotMatch(runtime, /mainFeatures\.slice\(0, 10\)/);
assert.doesNotMatch(runtime, /one representative control/);

console.log("Universal project-creation readiness regression checks passed.");
