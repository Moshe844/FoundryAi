/**
 * Locks the rule that the deterministic browser gate may only HARD-FAIL on things it can objectively
 * check or actually drive — never on a noun matched in the task text. The motivating bug: "remove all
 * the images" matched an "images" DOM rule, the gate then demanded the page keep the images the user
 * asked to delete, failed a correct implementation, and burned the mission budget in a repair loop.
 *
 * Source-contract style (no browser needed): asserts the shape of the verdict computation in
 * runtime.ts so a future edit cannot quietly turn presence heuristics back into hard failures.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");

let failures = 0;
const assert = (condition, message) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${message}`);
  if (!condition) failures += 1;
};

// A requested element derived by matching a noun ("images" -> <img>) must NOT be part of the hard
// verified verdict. It is negation-blind and cannot fail a page that renders cleanly.
assert(
  /const verified = missing\.length === 0 && workflow\.problems\.length === 0 && declaredWorkflow\.problems\.length === 0 && missingTexts\.length === 0;/.test(runtime),
  "The acceptance verdict must not include missingDom — element presence is negation-blind and cannot be a hard failure.",
);

// Only a capability Foundry can DRIVE end-to-end may be a hard shortfall.
assert(
  runtime.includes("const drivenWorkflowCapabilities = new Set<ObservableBrowserCapability>([")
    && runtime.includes("const hardRequested = requested.filter((capability) => drivenWorkflowCapabilities.has(capability));"),
  "Only driven-workflow capabilities may hard-fail; presence-only capabilities (upload input, visual polish, price field) must be soft.",
);

// missingDom and unmet presence capabilities are reported as non-blocking best-effort notes.
assert(
  runtime.includes("const softNotes = [")
    && runtime.includes("unmetPresenceCapabilities")
    && /softNotes[\s\S]{0,200}missingDom/.test(runtime),
  "Unconfirmed element presence and presence capabilities must be reported as best-effort soft notes, not problems.",
);

// The hard problems list must no longer contain the "rendered page contains none" DOM assertion.
assert(
  !runtime.includes("but the rendered page contains none"),
  "The hard problems list must not fail on a missing text-matched element.",
);

// A mutating request that changed no file must never conclude "passed" with an unfinished plan — that
// is the "returned success before completing the mission plan" false-success the user was charged for.
assert(
  /if \(truthfulStatus === "passed" && unfinishedPlan\.length\)/.test(runtime)
    && /failedGate \|\| changedFileCount === 0/.test(runtime)
    && runtime.includes("did not edit any file — the requested change was not applied"),
  "Every existing-project path must reconcile a passed verdict against its plan: zero file changes on an unfinished plan fails honestly, not a papered-over success.",
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
