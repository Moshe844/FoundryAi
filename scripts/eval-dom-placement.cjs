#!/usr/bin/env node
/**
 * DOM placement checking, tested against the real rendered layouts observed on 2026-07-20 for
 * "can you move the total spend number so it shows above the filter bar?"
 *
 * The box coordinates below are taken from the actual rendered preview at 127.0.0.1:3112: the mission
 * placed "Total: $0.00" inside the filter bar's flex row, beside "Filter by date:", and Foundry
 * reported "Done". Geometry is what exposes it — the source moved 30 lines and every build check passed.
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

const { spatialRequirementForRequest, evaluatePlacement } = require(path.join(root, "lib/verification/dom-placement.ts"));

const REQUEST = "can you move the total spend number so it shows above the filter bar?";

const header = { selectorHint: "header.site-header", text: "Expense Tracker + Add Expense", x: 0, y: 0, width: 1280, height: 84 };

// Exactly what shipped: the total nested in the bar's flex row, sharing a line with the date filter.
const observedFailure = [
  header,
  { selectorHint: "section.filter-bar", text: "Total: $0.00 Filter by date: to", x: 0, y: 100, width: 1280, height: 56 },
  { selectorHint: "div.filter-summary", text: "Total: $0.00", x: 63, y: 118, width: 104, height: 20 },
  { selectorHint: "span.filter-label", text: "Filter by date:", x: 188, y: 118, width: 110, height: 20 },
];

// The layout the request actually describes: its own band above the bar.
const correctLayout = [
  header,
  { selectorHint: "section.spend-summary-bar", text: "Total: $0.00", x: 0, y: 92, width: 1280, height: 40 },
  { selectorHint: "div.filter-summary", text: "Total: $0.00", x: 63, y: 102, width: 104, height: 20 },
  { selectorHint: "section.filter-bar", text: "Filter by date: to", x: 0, y: 140, width: 1280, height: 56 },
];

// Below instead of above — moved, but the wrong way.
const belowLayout = [
  header,
  { selectorHint: "section.filter-bar", text: "Filter by date: to", x: 0, y: 100, width: 1280, height: 56 },
  { selectorHint: "div.filter-summary", text: "Total: $0.00", x: 63, y: 180, width: 104, height: 20 },
];

// Regression, found by running this live: the landmark resolved to a page-level wrapper whose innerText
// contained Foundry's own mission report ("...moving total spend number above filter bar was completed
// execution message 1784555194761..."), because the landmark was picked as the LARGEST text match. An
// ancestor's text contains every descendant's words, so text alone cannot identify an element.
const noisyWrapperText = "Total: $0.00 Filter by date: to report requested change moving total spend number above filter bar was completed execution message 1784555194761 project request verified build preview http 127 3112 checklist items marked complete";
const pageWrapperDecoy = [
  header,
  { selectorHint: "div.app", text: noisyWrapperText, x: 0, y: 61, width: 1440, height: 620 },
  { selectorHint: "section.filter-bar", text: "Filter by date: to", x: 0, y: 140, width: 1280, height: 56 },
  { selectorHint: "section.spend-summary-bar", text: "Total: $0.00", x: 0, y: 92, width: 1280, height: 40 },
  { selectorHint: "div.filter-summary", text: "Total: $0.00", x: 63, y: 102, width: 104, height: 20 },
];

let failures = 0;
function check(label, boxes, expected, expectNested) {
  const requirement = spatialRequirementForRequest(REQUEST);
  if (!requirement) {
    failures += 1;
    console.log(`FAIL  ${label}  — no spatial requirement derived from the request`);
    return;
  }
  const result = evaluatePlacement(requirement, boxes);
  const nestedOk = expectNested === undefined || /INSIDE/.test(result.evidence) === expectNested;
  const ok = result.verdict === expected && nestedOk;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`      verdict=${result.verdict} (want ${expected})`);
  console.log(`      ${result.evidence}`);
  if (result.correction) console.log(`      correction: ${result.correction}`);
  console.log("");
}

const requirement = spatialRequirementForRequest(REQUEST);
console.log(`derived requirement: relation=${requirement && requirement.relation} subject=${JSON.stringify(requirement && requirement.subjectTokens)} landmark=${JSON.stringify(requirement && requirement.landmarkTokens)}\n`);

console.log("=== the layout that shipped as \"Done\" ===\n");
check("total nested in the filter bar, same row", observedFailure, "violated", true);
console.log("=== layouts that must be judged correctly ===\n");
check("total in its own band above the bar", correctLayout, "satisfied", false);
check("total moved below the bar instead", belowLayout, "violated", false);
check("subject not rendered at all", [header, { selectorHint: "section.filter-bar", text: "Filter by date:", x: 0, y: 100, width: 1280, height: 56 }], "indeterminate");
check("correct layout, but a noisy page wrapper is present (live regression)", pageWrapperDecoy, "satisfied", false);

console.log("=== other relations ===\n");
const relation = (request, wantRelation) => {
  const derived = spatialRequirementForRequest(request);
  const actual = derived ? derived.relation : undefined;
  const ok = actual === wantRelation;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(request)} -> ${String(actual)} (want ${String(wantRelation)})`);
};
relation("move the logo below the nav", "below");
relation("put the badge to the right of the title", "right-of");
relation("place the total inside the header", "inside");
relation("move the database to Postgres", undefined);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
