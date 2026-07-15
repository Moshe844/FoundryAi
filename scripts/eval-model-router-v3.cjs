const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync, rmSync, readFileSync } = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "tmp", "model-router-v3-test");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const sources = ["types.ts", "task-profiler.ts", "capability-registry.ts", "selector.ts"].map((file) => path.join(root, "lib", "ai", "routing", file));
const compile = spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), ...sources, "--outDir", outDir, "--module", "commonjs", "--target", "es2022", "--skipLibCheck"], { cwd: root, encoding: "utf8" });
if (compile.status !== 0) { console.error(compile.stdout); console.error(compile.stderr); process.exit(compile.status || 1); }
const { profileTask } = require(path.join(outDir, "task-profiler.js"));
const { CapabilityRegistry } = require(path.join(outDir, "capability-registry.js"));
const { selectModel } = require(path.join(outDir, "selector.js"));
const tier = (message, context = {}) => profileTask({ message, ...context }).recommendedIntelligenceTier;

const cases = [
  ["Change this button from blue to green.", "fast"],
  ["Fix this spelling mistake.", "fast"],
  ["Where is the login route defined?", "fast"],
  ["Add validation to this existing form.", "fast"],
  ["Build a standard settings page following existing patterns.", "fast"],
  ["Fix a bug affecting three related files.", "fast"],
  ["The app intermittently loses transactions under concurrent writes.", "architect"],
  ["Refactor authentication across frontend, API, and database.", "architect"],
  ["Migrate this large WinForms system to WPF while preserving behavior across the whole app.", "enterprise-architect"],
  ["Investigate a critical payment incident after two failed fixes.", "super-reasoning", { failureHistory: 2 }],
  ["actually migrate the whole design system", "enterprise-architect"],
  ["Fix this straightforward compiler error.", "fast"],
  ["Update one config value.", "fast"],
  ["Rename this local symbol.", "fast"],
  ["Build a normal CRUD endpoint.", "fast"],
  ["Investigate this authentication failure.", "architect"],
  ["Redesign shared infrastructure across all services.", "enterprise-architect"],
  ["Change the spacing in this one component.", "fast"],
  ["Find where this symbol is defined.", "fast"],
  ["Create a clean responsive personal portfolio using HTML, CSS, and vanilla JavaScript. No backend, database, authentication, or framework.", "fast"],
  ["Create a polished professional complete responsive portfolio website using HTML, CSS, and vanilla JavaScript for every screen.", "fast"],
  ["Create a small Express API with three CRUD endpoints and SQLite. No authentication or external integrations.", "fast"],
  ["Create a simple FastAPI backend with one health endpoint. No database or authentication.", "fast"],
  ["Create a small Node.js service that accepts JSON and stores records in SQLite.", "fast"],
  ["Create a payment API with authentication and transaction processing.", "architect"],
  ["Create a portfolio with a complex animation system and advanced performance issues to solve.", "architect"],
];
for (const [message, expected, context] of cases) assert.equal(tier(message, context), expected, message);
assert.equal(tier("Change this CSS color.", { projectFileCount: 100000 }), "fast", "repository size alone must not escalate");
assert.equal(tier("Implement pagination and caching.", { likelyFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"] }), "builder", "a larger evidenced working set must not be mislabeled simple");
assert.equal(tier("A concurrent write race loses data.", { projectFileCount: 20 }), "architect", "small repository does not make hard work simple");
assert.equal(tier("make it darker", { activeMission: "Change the button style" }), "fast", "follow-up uses mission context");
assert.equal(profileTask({ message: "Fix this spelling mistake.", requestedDepth: "production" }).recommendedIntelligenceTier, "fast", "depth is independent");
assert.equal(profileTask({ message: "Refactor authentication across frontend, API, and database.", requestedDepth: "quick" }).recommendedExecutionDepth, "quick", "intelligence is independent");
const portfolioProfile = profileTask({ message: "Create a clean responsive personal portfolio using HTML, CSS, and vanilla JavaScript. No backend, database, authentication, or framework.", requestedDepth: "standard" });
assert.equal(portfolioProfile.taskType, "project_creation");
assert.equal(portfolioProfile.missionComplexity, 2);
assert.equal(portfolioProfile.repositoryComplexity, 1);
assert.ok(portfolioProfile.expectedFiles >= 3 && portfolioProfile.expectedFiles <= 8);
assert.equal(portfolioProfile.effectiveIntelligence, "fast");
assert.equal(portfolioProfile.recommendedExecutionDepth, "standard");
const backendProfile = profileTask({ message: "Create a small Express API with three CRUD endpoints and SQLite. No authentication or external integrations.", requestedDepth: "standard" });
assert.equal(backendProfile.taskType, "project_creation");
assert.equal(backendProfile.missionComplexity, 2);
assert.equal(backendProfile.risk, 0.08);
assert.ok(backendProfile.expectedFiles >= 3 && backendProfile.expectedFiles <= 8);
assert.equal(backendProfile.effectiveIntelligence, "fast");

const dynamicAssessment = (overrides = {}) => ({
  taskType: "edit", affectedScope: "single-file", estimatedFiles: 1, estimatedSubsystems: 1,
  difficulty: 0.2, uncertainty: 0.15, risk: 0.1, contextRequired: 0.2,
  securityOrPayment: false, migration: false, repetitive: false, projectCreation: false,
  independentReviewNeeded: false, confidence: 0.9, reasons: ["normalized current-task evidence"],
  source: "dynamic-fast-classifier", ...overrides,
});
assert.equal(tier("Perform the requested chromatic adjustment in the indicated control.", { projectFileCount: 500000, dynamicAssessment: dynamicAssessment() }), "fast", "unseen wording follows normalized task facts, not keywords or repository size");
assert.equal(tier("Alter the trust boundary for identity proofs.", { projectFileCount: 4, dynamicAssessment: dynamicAssessment({ taskType: "refactor", affectedScope: "multi-subsystem", estimatedFiles: 7, estimatedSubsystems: 3, difficulty: 0.78, uncertainty: 0.55, risk: 0.72, securityOrPayment: true }) }), "architect", "semantic security assessment escalates without auth keywords");
assert.equal(tier("Move the estate to the successor representation.", { dynamicAssessment: dynamicAssessment({ taskType: "migrate", affectedScope: "project-wide", estimatedFiles: 40, estimatedSubsystems: 5, difficulty: 0.8, uncertainty: 0.6, risk: 0.7, migration: true }) }), "enterprise-architect", "semantic migration assessment escalates without migration keywords");
assert.equal(tier("Independently resolve the critical unknown.", { dynamicAssessment: dynamicAssessment({ taskType: "debug", affectedScope: "multi-subsystem", estimatedFiles: 30, estimatedSubsystems: 5, difficulty: 0.95, uncertainty: 0.85, risk: 0.9, independentReviewNeeded: true }) }), "super-reasoning", "critical independent-review assessment reaches Super Reasoning");
assert.equal(tier("Apply the established mechanical transformation.", { activeMission: "Critical payment migration", dynamicAssessment: dynamicAssessment({ repetitive: true, affectedScope: "few-files", estimatedFiles: 10, estimatedSubsystems: 1, difficulty: 0.25 }) }), "fast", "dynamic repetitive work downgrades after premium planning");

const capabilities = (value) => ({ coding: value, debugging: value, architecture: value, toolReliability: value, longContext: value, vision: value, structuredOutput: value, instructionFollowing: value, reasoning: value });
const candidate = (modelId, costClass, tierFit, freshness) => ({ provider: "openai", modelId, displayName: modelId, status: "discovered", available: true, supportsTools: true, supportsStructuredOutput: true, supportsVision: true, supportsReasoning: true, supportedEfforts: ["low", "medium", "high"], costClass, latencyClass: costClass === "ultra-low" ? "fast" : "normal", capabilities: capabilities(costClass === "ultra-low" ? 0.7 : 0.96), providerHealth: 1, tierFit, freshness, deprecated: false });
const fits = (fast, builder, architect, enterprise, superReasoning) => ({ fast, builder, architect, "enterprise-architect": enterprise, "super-reasoning": superReasoning });
const registry = new CapabilityRegistry([
  candidate("small-current", "ultra-low", fits(1, 0.7, 0.3, 0.2, 0.1), 1),
  candidate("premium-old", "premium", fits(0.2, 0.8, 0.95, 0.96, 1), 0.3),
  candidate("premium-current", "premium", fits(0.2, 0.85, 0.96, 1, 1), 1),
]);
const routedFast = selectModel(profileTask({ message: "Change this CSS color." }), registry);
const routedEnterprise = selectModel(profileTask({ message: "Migrate the whole design system across all services." }), registry);
assert.equal(routedFast.model, "small-current", "Fast selects the efficient tier-fit model");
assert.equal(routedEnterprise.model, "premium-current", "Enterprise selects the strongest current tier-fit model");

const requiredCases = [
  { name: "500,000-line project + CSS color", message: "Change this button CSS color to green.", context: { projectFileCount: 500000 }, allowed: ["fast"] },
  { name: "large project + spelling", message: "Fix this spelling mistake.", context: { projectFileCount: 500000 }, allowed: ["fast"] },
  { name: "large project + simple question", message: "What does this setting do?", context: { projectFileCount: 500000 }, allowed: ["fast"] },
  { name: "large project + one-file bug", message: "Fix this isolated one-file bug.", context: { projectFileCount: 500000, likelyFiles: ["button.ts"] }, allowed: ["fast", "builder"] },
  { name: "small project + complex auth architecture", message: "Design a complex authentication architecture.", context: { projectFileCount: 5 }, allowed: ["architect"] },
  { name: "payment processing", message: "Change the payment-processing transaction flow.", context: { projectFileCount: 20 }, allowed: ["architect"] },
  { name: "large migration", message: "Migrate the whole application across all services.", context: { projectFileCount: 500000 }, allowed: ["enterprise-architect"] },
  { name: "complex then simple follow-up", message: "What does this label mean?", context: { activeMission: "Critical payment architecture migration across all services", projectFileCount: 500000 }, allowed: ["fast"] },
  { name: "repetitive edits after Architect plan", message: "Apply this same spelling correction to these three files.", context: { activeMission: "Architect plan for a complex authentication system", likelyFiles: ["a.ts", "b.ts", "c.ts"] }, allowed: ["fast", "builder"] },
  { name: "failed Builder diagnosis", message: "Fix this isolated bug.", context: { projectFileCount: 10, likelyFiles: ["handler.ts"], failureHistory: 1 }, allowed: ["architect"] },
];
const providerProof = requiredCases.map((test) => {
  const profile = profileTask({ message: test.message, ...test.context });
  assert.ok(test.allowed.includes(profile.recommendedIntelligenceTier), `${test.name}: expected ${test.allowed.join("/")}, got ${profile.recommendedIntelligenceTier}`);
  const decision = selectModel(profile, registry);
  assert.ok(decision, `${test.name}: expected a provider/model decision`);
  return { case: test.name, tier: decision.tier, provider: decision.provider, model: decision.model, costClass: decision.costClass };
});

const router = readFileSync(path.join(root, "lib", "ai", "model-router.ts"), "utf8");
const executable = router.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
assert.doesNotMatch(executable, /gemini-(?:flash-lite|pro)-latest|claude-sonnet-5|claude-opus-4-8/, "unverified aliases/guessed IDs must not remain executable");
assert.doesNotMatch(executable, /TIER_MODEL_TABLE|claude-(?:haiku|sonnet|opus)-\d|gemini-3|gpt-5\.4-/, "production router must not contain named model tables or bootstrap IDs");
assert.match(router, /modelForReasoningRequest[\s\S]*tierForReasoningRequest\(request\)/, "ordinary answers must use the same fresh current-message classifier");
assert.doesNotMatch(router, /return requestedTier \? strongestTier/, "a requested or prior tier must never ratchet an Auto request upward");
const dispatch = readFileSync(path.join(root, "lib", "ai", "providers", "dispatch.ts"), "utf8");
assert.doesNotMatch(dispatch, /AUTO_PROVIDER_ORDER/, "providers must be ranked per request, not by fixed order");
assert.match(dispatch, /obeyedToolChoice[\s\S]*reportModelHealth\(provider, candidate\.modelId, successful, Boolean\(requiredTool && !obeyedToolChoice\)\)/, "required-tool noncompliance must lower health and suppress the unusable model for recovery");
assert.match(dispatch, /callProvider\(candidateRequest, candidateOptions\)/, "the audited candidate provider/model must be the request sent to the real provider adapter");
assert.match(dispatch, /recordProviderCall\([\s\S]*estimatedCostUsd: reservation\.estimatedCostUsd/, "actual provider/model and estimated/actual cost must be logged at dispatch");
assert.doesNotMatch(dispatch, /lastResult \?\? callProvider\(request, options\)/, "no unguarded provider call may bypass routing after fallback exhaustion");
const guard = readFileSync(path.join(root, "lib", "ai", "routing", "cost-guard.ts"), "utf8");
assert.match(guard, /FOUNDRY_MAX_MODEL_CALLS_PER_REQUEST/, "hard per-request call limit is configurable");
assert.match(guard, /FOUNDRY_MAX_ESTIMATED_COST_USD_PER_REQUEST/, "hard per-request estimated-cost limit is configurable");
assert.match(guard, /FOUNDRY_MAX_PREMIUM_CALLS_PER_MISSION/, "hard per-mission premium-call limit is configurable");
assert.match(guard, /fast: \{ maximumModelCalls: 4, estimatedCostUsd: 0\.08, premiumCallLimit: 1/, "Fast keeps a low-cost bounded ceiling");
assert.match(guard, /builder: \{ maximumModelCalls: 8, estimatedCostUsd: 0\.35, premiumCallLimit: 1/, "Builder cannot multiply one implementation into twenty paid turns");
assert.match(guard, /architect: \{ maximumModelCalls: 10, estimatedCostUsd: 0\.75, premiumCallLimit: 1/, "Architect has bounded capacity for difficult debugging");
assert.match(guard, /const budget = \{ \.\.\.routingBudgetForTier\(context\.tier\), \.\.\.context\.budget \}/, "the actual provider reservation uses the evidence-selected tier budget");
assert.match(guard, /const premium = context\.costClass === "premium"/, "normal high-capability debugging turns do not consume the exceptional premium-model allowance");
const foundryRuntime = readFileSync(path.join(root, "lib", "ai", "foundry-runtime.ts"), "utf8");
assert.match(foundryRuntime, /reserveDirectAttempt\(requestId, estimatedAttemptCost\)/, "direct OpenAI answer calls cannot bypass the actual-call and dollar budget");
assert.match(foundryRuntime, /reserveGlobalModelSpend\(estimatedAttemptCost\)/, "direct OpenAI answers share the persisted global daily spend ceiling");
const sourceRuntime = readFileSync(path.join(root, "lib", "sources", "openai-web-search.ts"), "utf8");
assert.doesNotMatch(sourceRuntime, /fetch\("https:\/\/api\.openai\.com\/v1\/responses"/, "source calls must use managed cost and usage accounting");
assert.match(sourceRuntime, /modelForProfile\(implementationRequest \? "standard" : "fast"\)/, "searching and source summaries use Fast; only requested artifact implementation may use Builder");
const classifier = readFileSync(path.join(root, "lib", "ai", "mission", "intent-classifier.ts"), "utf8");
assert.match(classifier, /affected_scope[\s\S]*estimated_files[\s\S]*difficulty[\s\S]*uncertainty[\s\S]*security_or_payment/, "the existing Fast intent call returns a normalized dynamic routing assessment");
assert.match(classifier, /Do not recommend a model or tier/, "the classifier reports engineering facts instead of choosing an expensive model itself");
const factoryRuntime = readFileSync(path.join(root, "lib", "factory", "runtime.ts"), "utf8");
assert.match(factoryRuntime, /modelForMissionStage\(task, modelMode, "fast"/, "no premium model is selected before dynamic assessment");
assert.match(factoryRuntime, /profileTask\(\{ message: task, dynamicAssessment: routingAssessment/, "execution routing consumes the dynamic assessment");
const runtime = readFileSync(path.join(root, "lib", "ai", "foundry-runtime.ts"), "utf8");
assert.match(runtime, /const model = requestedModel;/, "runtime must preserve the capability router's selected model");
const factory = readFileSync(path.join(root, "lib", "factory", "runtime.ts"), "utf8");
assert.match(factory, /discoverProjectWorkingSet\(access, task\)/, "existing-project routing must inspect the actual working set first");
assert.match(factory, /modelForMissionStage\(routingSummary, modelMode, "fast"\)/, "new projects bootstrap with Fast before dynamic assessment");
assert.match(factory, /simpleCreation = stackProfile\.id === "static-html" \|\| \([\s\S]*creationAssessment\.projectCreation[\s\S]*creationProfile\.recommendedIntelligenceTier === "fast"/, "new-project execution complexity must follow dynamic task evidence, with static HTML kept on its bounded low-cost path");
assert.match(factory, /boundedDebug = classification\.intent === "debug"[\s\S]*routingAssessment\.estimatedFiles <= 3[\s\S]*directExecutionLane = explicitCommandOnlyRequest \|\| fastLane \|\| boundedDebug/, "localized low-risk debugging and explicit operation-only requests execute directly instead of buying a separate planning mission");
const fastShare = cases.filter(([, expected]) => expected === "fast").length / cases.length;
rmSync(outDir, { recursive: true, force: true });
console.log(JSON.stringify({ passed: cases.length + 34, fastShare: Number(fastShare.toFixed(3)), providerProof }, null, 2));
