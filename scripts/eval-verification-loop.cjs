const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "tmp", "verification-policy-test");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const compile = spawnSync(process.execPath, [
  path.join(root, "node_modules", "typescript", "bin", "tsc"),
  path.join(root, "lib", "ai", "mission", "verification-policy.ts"),
  "--outDir", outDir,
  "--module", "commonjs",
  "--target", "es2020",
  "--skipLibCheck",
], { cwd: root, encoding: "utf8" });

if (compile.status !== 0) {
  console.error(compile.stdout);
  console.error(compile.stderr);
  process.exit(compile.status || 1);
}

const policy = require(path.join(outDir, "verification-policy.js"));
assert.equal(policy.verificationAction(80), "accept");
assert.equal(policy.verificationAction(79), "repair");
assert.equal(policy.verificationRisk(59), "material");
assert.equal(policy.verificationRisk(60), "low");
assert.equal(policy.verificationImproved(50, 70), true);
assert.equal(policy.verificationImproved(70, 70), false);
assert.equal(policy.verificationAction(Number.NaN), "repair");

rmSync(outDir, { recursive: true, force: true });
console.log("verification loop policy tests passed");
