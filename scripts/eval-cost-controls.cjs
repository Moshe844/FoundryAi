const assert = require("node:assert/strict");
const { mkdirSync, rmSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "tmp", "cost-controls-test");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const source = path.join(root, "lib", "ai", "routing", "spend-ledger.ts");
const compile = spawnSync(process.execPath, [
  path.join(root, "node_modules", "typescript", "bin", "tsc"),
  source,
  "--outDir", outDir,
  "--module", "commonjs",
  "--target", "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { cwd: root, encoding: "utf8" });
if (compile.status !== 0) {
  console.error(compile.stdout);
  console.error(compile.stderr);
  process.exit(compile.status || 1);
}

const ledger = require(path.join(outDir, "spend-ledger.js"));
const snapshot = ledger.globalSpendSnapshot();
assert.equal(snapshot.limitUsd, Number(process.env.FOUNDRY_DAILY_MODEL_BUDGET_USD) || 5);
assert.equal(snapshot.remainingUsd, Math.max(0, Number((snapshot.limitUsd - snapshot.actualCostUsd - snapshot.reservedCostUsd).toFixed(6))));
assert.throws(
  () => ledger.reserveGlobalModelSpend(snapshot.limitUsd + 1),
  (error) => error instanceof ledger.DailySpendLimitError && /No provider call was sent/.test(error.message),
  "an over-budget reservation must stop before any provider request",
);

console.log(JSON.stringify({ passed: 3, snapshot }));
