/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
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
