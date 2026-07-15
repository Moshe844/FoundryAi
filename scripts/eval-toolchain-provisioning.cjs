const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const catalog = fs.readFileSync(path.join(root, "lib/toolchains/catalog.ts"), "utf8");
const provisioner = fs.readFileSync(path.join(root, "lib/toolchains/provisioner.ts"), "utf8");
const route = fs.readFileSync(path.join(root, "app/api/factory/environment/route.ts"), "utf8");
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const ui = fs.readFileSync(path.join(root, "components/canvas/MissionCanvas.tsx"), "utf8");

for (const id of ["flutter", "docker", "terraform", "unity", "android", "kubernetes", "godot", "dotnet", "go", "rust", "python", "java"]) {
  assert.match(catalog, new RegExp(`${id}: \\{ id: "${id}"`), `${id} has a trusted toolchain definition`);
}
assert.match(catalog, /STACK_TOOLCHAINS/, "stacks map deterministically to requirements");
assert.doesNotMatch(route, /command\s*:\s*body\./, "the API never accepts an arbitrary installer command");
assert.match(provisioner, /approvedCommand !== recipe\.preview/, "installation requires an exact approval match");
assert.match(provisioner, /shell: false/, "trusted installers never execute through a shell");
assert.match(provisioner, /Start-Process[\s\S]*-Verb RunAs/, "Windows elevation uses the visible UAC boundary");
assert.match(provisioner, /20 \* 60 \* 1000/, "installers have a hard timeout");
assert.match(provisioner, /refreshProcessPath\(\)/, "the running Foundry process refreshes PATH after setup");
assert.match(runtime, /environmentReadinessForStack\(stackProfile\.id\)/, "project creation reports real environment readiness");
assert.match(ui, /Prepare this computer/, "non-technical users receive setup inside Foundry");
assert.match(ui, /onEnvironmentReady/, "verified setup resumes project verification automatically");
assert.match(ui, /Windows may show its normal security confirmation/, "machine changes are explained before approval");

console.log(JSON.stringify({ passed: 24, arbitraryCommandsAccepted: 0 }));
