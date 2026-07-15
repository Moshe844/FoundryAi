const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const adapters = readFileSync(path.join(root, "lib", "factory", "language-adapters.ts"), "utf8");
const runtime = readFileSync(path.join(root, "lib", "factory", "runtime.ts"), "utf8");
const verification = readFileSync(path.join(root, "lib", "verification", "adapters.ts"), "utf8");

const classifiedLevels = [...adapters.matchAll(/return \{ id: "[^"]+", label:[^\n]+?level: (\d) \}/g)].map((match) => Number(match[1]));
assert.ok(classifiedLevels.length >= 30, "expected broad stack classification coverage");
assert.ok(classifiedLevels.every((level) => level === 4), "every recognized or custom stack must enter the full mission workflow");
assert.match(runtime, /return capabilityLevelForStackChoice\(stack\)\.level === 4/);
assert.match(runtime, /executableAvailable\(command\)/, "runtime verification must reflect installed toolchains");
for (const adapter of ["android-gradle", "dotnet", "flutter", "go", "rust", "docker", "terraform", "kubernetes", "godot", "unity", "sql"]) {
  assert.match(verification, new RegExp(`id: "${adapter}"`), `missing verification adapter: ${adapter}`);
}
assert.match(verification, /Instrumentation tests require an available emulator or connected device/);
assert.match(verification, /Foundry never applies infrastructure automatically/);
assert.match(verification, /require a locally installed, licensed Unity Editor/);

console.log(JSON.stringify({ passed: classifiedLevels.length + 15, stacks: classifiedLevels.length }));
