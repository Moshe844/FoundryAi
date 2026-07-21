#!/usr/bin/env node
/**
 * Guards the cost scope of small edits.
 *
 * A one-line reposition ("move the total spend number above the filter bar") was classified as
 * full-scope work, routed to the architect tier, and cost $0.89 across 22 model calls. The scope
 * heuristic's small-tweak vocabulary listed "position", "align" and "spacing" but not the reposition
 * family, so moving an existing element read as architecture work.
 *
 * Real work must still be recognized as real: a reposition verb alone is not enough, it needs a
 * positional target, so "move the database to Postgres" stays full scope.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.join(__dirname, "..");

Module._extensions[".ts"] = (mod, file) => {
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
    }).outputText,
    file,
  );
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const target = request.startsWith("@/") ? path.join(root, request.slice(2)) : request;
  try {
    return originalResolve.call(this, target, ...rest);
  } catch (error) {
    for (const extension of [".ts", ".tsx"]) {
      if (fs.existsSync(`${target}${extension}`)) return `${target}${extension}`;
    }
    throw error;
  }
};

const { isLikelySmallSingleFileRequest } = require(path.join(root, "lib/factory/language-adapters.ts"));
const { recoveryRoutingBudget } = require(path.join(root, "lib/factory/recovery-policy.ts"));
const { unmatchedStylesheetSelectors } = require(path.join(root, "lib/verification/stylesheet-selectors.ts"));
const { generatedRecoveryBudgetForTier } = require(path.join(root, "lib/factory/recovery-policy.ts"));

let failures = 0;
const check = (label, actual, expected, detail) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}  ${detail ?? ""}`);
};

console.log("=== small repositions must stay cheap ===");
for (const task of [
  "can you move the total spend number so it shows above the filter bar?",
  "move the header above the nav",
  "put the submit button below the form",
  "reorder the cards so pricing comes first",
  "shift the logo to the left",
  "place the search box inside the header",
]) {
  check("small", isLikelySmallSingleFileRequest(task), true, JSON.stringify(task));
}

console.log("\n=== real scope must NOT be downgraded to a tweak ===");
for (const task of [
  "move the database to Postgres",
  "move the auth logic to a new backend service",
  "migrate the app to the app router",
  "refactor the components into separate files",
  "rewrite the entire project from scratch",
  "add a new payment integration with a package",
]) {
  check("full-scope", isLikelySmallSingleFileRequest(task), false, JSON.stringify(task));
}

console.log("\n=== recovery lanes cost a fraction of the mission, never the whole ceiling ===");
// architect ceiling is $4; a retry of already-failed work must not inherit it
check("architect recovery", recoveryRoutingBudget(4).estimatedCostUsd, 0.75, "25% of $4 -> hits the $0.75 cap");
check("fast recovery", recoveryRoutingBudget(0.5).estimatedCostUsd, 0.15, "floored at $0.15");
check("builder recovery", recoveryRoutingBudget(2).estimatedCostUsd, 0.5, "25% of $2");
check("recovery is capped", recoveryRoutingBudget(100).estimatedCostUsd, 0.75, "hard cap $0.75");

console.log("\n=== resuming an unfinished BUILD scales on BOTH axes (cost AND calls) ===");
// A SwiftUI app died twice: first at the flat $0.75 cost cap, then at a 12-call cap after the cost fix
// forgot to raise the call count too. The resume budget must match the tier on both axes.
const fast = { maximumModelCalls: 12, estimatedCostUsd: 0.5 };
const builder = { maximumModelCalls: 24, estimatedCostUsd: 2 };
const architect = { maximumModelCalls: 32, estimatedCostUsd: 4 };
const enterprise = { maximumModelCalls: 40, estimatedCostUsd: 7 };
check("Builder resume cost", generatedRecoveryBudgetForTier(builder).estimatedCostUsd, 2, "was flat $0.75");
check("Builder resume CALLS", generatedRecoveryBudgetForTier(builder).maximumModelCalls, 24, "was silently 12");
check("Architect resume cost", generatedRecoveryBudgetForTier(architect).estimatedCostUsd, 4, "big builds get room");
check("Architect resume CALLS", generatedRecoveryBudgetForTier(architect).maximumModelCalls, 32, "full call budget");
check("Fast resume cost stays cheap", generatedRecoveryBudgetForTier(fast).estimatedCostUsd, 0.75, "floored");
check("resume cost never past Architect", generatedRecoveryBudgetForTier(enterprise).estimatedCostUsd, 4, "cost capped at $4");
check("resume calls never past Architect", generatedRecoveryBudgetForTier(enterprise).maximumModelCalls, 32, "calls capped at 32");

console.log("\n=== dead stylesheet selectors are detected ===");
const markup = `<div className="filter-summary"><span className="summary-total">Total</span></div>`;
check(
  "the exact dead CSS that shipped",
  unmatchedStylesheetSelectors(
    `.page-shell { display: flex; }
     .total-spend, .total-spend-number, [data-total-spend] { order: 1; }
     .filter-bar, [data-filter-bar] { order: 2; }`,
    markup,
  ),
  [".filter-bar", ".page-shell", ".total-spend", ".total-spend-number", "[data-filter-bar]", "[data-total-spend]"],
);
check("real selectors are not flagged", unmatchedStylesheetSelectors(`.summary-total { color: red; }`, markup), []);
check("media queries contribute nothing", unmatchedStylesheetSelectors(`@media (min-width: 40rem) { .summary-total { color: red; } }`, markup), []);
check("dynamic class usage counts as present", unmatchedStylesheetSelectors(`.summary-total { color: red; }`, "className={`card ${x} summary-total`}"), []);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
