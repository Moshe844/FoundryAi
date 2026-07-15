const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync, readFileSync, rmSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const discoveryRouteSource = readFileSync(path.join(root, "app", "api", "factory", "discover", "route.ts"), "utf8");
const discoveryUiSource = readFileSync(path.join(root, "components", "BuildDashboard.tsx"), "utf8");
assert.match(discoveryRouteSource, /const knownStarter = Boolean\(context\.starter\.id && context\.starter\.id !== "custom"\)/, "known starter discovery uses authoritative catalog context");
assert.match(discoveryRouteSource, /maxOutputTokens: knownStarter \? 1000 : 6000/, "known starter stack reasoning uses a fast bounded output budget");
assert.match(discoveryRouteSource, /maxAttempts: knownStarter \? 1 : 2/, "known starter discovery does not hide latency behind provider retries");
assert.match(discoveryRouteSource, /currently supported, security-maintained releases/, "starter stack reasoning rejects obsolete framework recommendations");
assert.match(discoveryRouteSource, /Preserve its exact subtype in project_type/, "starter discovery preserves exact niche subtype context");
assert.match(discoveryRouteSource, /your only job is the project-specific stack\/language decision/, "known starter AI work is narrowed to the real stack decision instead of regenerating the whole memo");
assert.match(discoveryUiSource, /function reconcileKnownStarterDiscovery[\s\S]+\["domain", "platform", "data-shape", "features"\][\s\S]+question: undefined/, "known starters do not re-ask architecture facts the user already established");
assert.match(discoveryUiSource, /function applyConfirmedStyle[\s\S]+source: "user-confirmed"[\s\S]+The user selected this visual direction/, "a selected style updates the decision memo instead of leaving contradictory neutral defaults");
assert.match(discoveryUiSource, /function fallbackStackOptionsFor[\s\S]+Astro \+ TypeScript[\s\S]+public site without a database/, "custom content sites use category-derived fallback choices instead of the universal generic stack list");
assert.match(discoveryUiSource, /function alignDiscoveryWithSelectionAndConstraints[\s\S]+explicitly excluded this scope[\s\S]+recommendedStack: selectedStack/, "the selected stack and explicit negative constraints remain authoritative in the memo");
const outDir = path.join(root, "tmp", "project-discovery-test");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const compile = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    path.join(root, "lib", "ai", "project-discovery.ts"),
    "--outDir",
    outDir,
    "--module",
    "commonjs",
    "--target",
    "es2020",
    "--skipLibCheck",
    "--esModuleInterop",
  ],
  { cwd: root, encoding: "utf8" },
);

if (compile.status !== 0) {
  console.error(compile.stdout);
  console.error(compile.stderr);
  process.exit(compile.status || 1);
}

const { actionForDecision, discoverProject } = require(path.join(outDir, "project-discovery.js"));

assert.equal(actionForDecision(90, "low"), "silent-infer");
assert.equal(actionForDecision(90, "high"), "disclose");
assert.equal(actionForDecision(45, "high"), "ask");
assert.equal(actionForDecision(45, "low"), "default-disclose");

const inventory = discoverProject("Build me an inventory system.");
assert.equal(inventory.projectType, "Inventory management system");
assert.equal(inventory.recommendedStack, "Next.js");
assert.match(inventory.styleDirection, /SaaS|operations/i);
assert.ok(inventory.dataModel.some((item) => /Product|SKU/i.test(item)));
assert.ok(inventory.mainFeatures.some((item) => /Stock|Product/i.test(item)));

const game = discoverProject("Build me a kids math game.");
assert.equal(game.projectType, "Game");
assert.equal(game.recommendedStack, "Phaser");
assert.match(game.styleDirection, /Playful|game/i);
assert.ok(game.mainFeatures.some((item) => /gameplay|Score|Level/i.test(item)));
assert.ok(!game.questions.some((question) => /inventory|stock|supplier/i.test(question)));

const vague = discoverProject("Build me a tool.");
assert.ok(vague.questions.length > 0 && vague.questions.length <= 3);
assert.ok(vague.decisions.some((decision) => decision.action === "ask"));

rmSync(outDir, { recursive: true, force: true });
console.log("project discovery engine tests passed");
