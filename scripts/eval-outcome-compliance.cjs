#!/usr/bin/env node
/**
 * Compliance checking, tested against the three real outcomes observed on 2026-07-20 for one request:
 * "can you move the total spend number so it shows above the filter bar?"
 *
 *   A. deleted the total and never re-added it   -> mission said "Repair stopped" (right verdict, wrong reason)
 *   B. deleted one comment line, changed nothing -> mission said "Done"  <-- the false success
 *   C. removed it and re-inserted it above       -> mission said "Done"  <-- genuinely correct
 *
 * A and B must be caught. C must pass. Anything less and the check is not worth shipping.
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
    for (const extension of [".ts", ".tsx"]) if (fs.existsSync(`${target}${extension}`)) return `${target}${extension}`;
    throw error;
  }
};

const { deriveOutcomeAssertions, complianceVerdict } = require(path.join(root, "lib/verification/outcome-compliance.ts"));

const REQUEST = "can you move the total spend number so it shows above the filter bar?";
const before = fs.readFileSync(path.join(root, "projects/single-page-personal-expense-tracker/src/app/page.tsx"), "utf8");

const SUMMARY_BLOCK = `            <div className="filter-summary">
              <span className="summary-count">{filtered.length} expense{filtered.length !== 1 ? 's' : ''}</span>
              <span className="summary-sep">&bull;</span>
              <span className="summary-total">Total: <strong>\${totalSpend.toFixed(2)}</strong></span>
            </div>
`;
const MOVED_BLOCK = `            <div className="filter-summary">
              <span className="summary-total">Total: <strong>\${totalSpend.toFixed(2)}</strong></span>
              <span className="summary-sep">&bull;</span>
              <span className="summary-count">{filtered.length} expense{filtered.length !== 1 ? 's' : ''}</span>
            </div>
`;

if (!before.includes(SUMMARY_BLOCK)) {
  // This reads the live project file so the fixtures are real source rather than a hand-written mock.
  // The trade-off is that a mission which edits that file breaks the baseline, so say so plainly instead
  // of failing with a confusing assertion error.
  console.error("FIXTURE ERROR: the pristine summary block was not found in src/app/page.tsx.");
  console.error("This eval uses the live project file as its baseline; restore it to its unmodified state and re-run.");
  process.exit(2);
}

// A: deleted, never re-added.
const runA = before.replace(SUMMARY_BLOCK, "");
// B: only a comment line removed (the exact false success).
const runB = before.replace("      {/* Filter Bar */}\n", "");
// C: removed from below the dates, re-inserted above them.
const runC = before.replace(SUMMARY_BLOCK, "").replace(
  `            <span className="filter-label">Filter by date:</span>\n`,
  `${MOVED_BLOCK}            <span className="filter-label">Filter by date:</span>\n`,
);
// D: untouched file — a mission that wrote nothing at all.
const runD = before;

let failures = 0;
function check(label, after, expected) {
  const verdict = complianceVerdict(deriveOutcomeAssertions(REQUEST, [{ path: "src/app/page.tsx", before, after }]));
  const ok = verdict.status === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`      status=${verdict.status} (want ${expected})`);
  console.log(`      ${verdict.summary}\n`);
}

console.log("=== the three real outcomes ===\n");
check("A. deleted the total, never re-added it", runA, "violated");
check("B. deleted one comment, changed nothing  <-- reported \"Done\"", runB, "violated");
check("C. genuine move", runC, "satisfied");
check("D. wrote nothing at all", runD, "violated");

// The executor's "request already satisfied" guard feeds exactly this shape: the file as it currently
// stands on both sides. A violated verdict rejects the claim and sends the model back to do real work;
// an underivable one must let the claim stand, so requests the checker cannot judge are never blocked.
console.log("=== \"request already satisfied\" claims ===\n");
const claim = (label, request, content, expected) => {
  const verdict = complianceVerdict(deriveOutcomeAssertions(request, [{ path: "src/app/page.tsx", before: content, after: content }]));
  const ok = verdict.status === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  status=${verdict.status} (want ${expected})`);
};
claim("no-op claim on the real move request is REJECTED", REQUEST, before, "violated");
claim("no-op claim on an unjudgeable request is allowed", "make the styling nicer", before, "underivable");
claim("no-op claim on an addition that truly is present is allowed", "add a category breakdown section", before, "satisfied");
console.log("");

console.log("=== other request shapes ===\n");
const other = (label, request, changes, expected) => {
  const verdict = complianceVerdict(deriveOutcomeAssertions(request, changes));
  const ok = verdict.status === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  status=${verdict.status} (want ${expected})`);
};
other("addition that happened", "add a category filter dropdown",
  [{ path: "a.tsx", before: "<div/>", after: "<div><select className=\"category-filter\"/></div>" }], "satisfied");
other("addition that did not happen", "add a category filter dropdown",
  [{ path: "a.tsx", before: "<div/>", after: "<div>{/* todo */}</div>" }], "violated");
other("removal that happened", "remove the export button",
  [{ path: "a.tsx", before: "<button>export</button>", after: "<div/>" }], "satisfied");
other("removal that did not happen", "remove the export button",
  [{ path: "a.tsx", before: "<button>export</button>", after: "<button>export</button><span/>" }], "violated");
other("no derivable check is NOT a pass", "make it look nicer",
  [{ path: "a.tsx", before: "<div/>", after: "<div class=\"x\"/>" }], "underivable");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
