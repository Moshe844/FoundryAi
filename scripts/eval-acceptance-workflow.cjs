const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const { parseAcceptanceWorkflowManifest } = require(path.join(root, "lib/verification/acceptance-workflow.ts"));
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");

const valid = parseAcceptanceWorkflowManifest(JSON.stringify({
  version: 1,
  workflows: [{
    id: "create-and-find",
    requirement: "Create a customer and find it after saving",
    startPath: "/customers",
    steps: [
      { action: "fill", selector: "[data-testid='customer-name']", value: "${uniqueText}" },
      { action: "click", selector: "[data-testid='save-customer']" },
    ],
    assertions: [{ kind: "text-visible", value: "${uniqueText}" }],
  }],
}));
assert.equal(valid?.workflows.length, 1, "A safe declarative workflow must parse.");
assert.equal(parseAcceptanceWorkflowManifest('{"version":1,"workflows":[]}'), undefined, "An empty contract cannot prove behavior.");
assert.equal(parseAcceptanceWorkflowManifest(JSON.stringify({ version: 1, workflows: [{ id: "bad", requirement: "bad", startPath: "https://evil.example", steps: [], assertions: [{ kind: "text-visible", value: "x" }] }] })), undefined, "Workflow navigation must stay same-origin.");
assert.match(runtime, /executeAcceptanceWorkflowManifest/, "The browser gate must execute project acceptance workflows.");
assert.match(runtime, /Foundry will not call an unproven behavior complete/, "Unproven behavior must not cross the completion boundary.");
assert.doesNotMatch(runtime, /result\.status = "passed";\s*result\.blocker = undefined;\s*\/\/ "skipped" alongside the passing build\/typecheck/, "A clean render with unproven behavior must not become a partial success.");

console.log("Executable acceptance workflow regression checks passed.");
