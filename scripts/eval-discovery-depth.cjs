#!/usr/bin/env node
/**
 * Guards which discovery refinement path a request takes.
 *
 * The bug (observed 2026-07-20): picking the "Mobile App" starter and then typing a specific
 * description — "a habit tracker where I add daily habits, check them off, and see a streak calendar" —
 * produced byte-identical generic boilerplate (entities: User, Screen state, Sync queue; features:
 * dashboard/list/settings) because a selected starter forced the STACK-ONLY path, which is told not to
 * regenerate features, entities, or architecture. The description was ignored for everything but stack.
 *
 * The fix: a starter card WITH a substantive description must use the full description-driven
 * refinement, so the understanding reflects the actual product. Only a starter with no real
 * description stays stack-only.
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

const { discoveryRefinementDepth } = require(path.join(root, "lib/ai/project-discovery-llm.ts"));

const wc = (text) => text.trim().split(/\s+/).filter(Boolean).length;

let failures = 0;
const check = (label, input, expected) => {
  const actual = discoveryRefinementDepth({ subtypeWordCount: 0, ...input });
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  -> ${actual} (want ${expected})`);
};

const habitTracker = "a habit tracker where I add daily habits, check them off, and see a streak calendar";

console.log("=== the reported bug: starter + real description ===");
check("Mobile App starter + habit-tracker description",
  { knownStarter: true, descriptionWordCount: wc(habitTracker), highConfidenceCustom: false }, "full");
check("Mobile App starter + delivery-driver description",
  { knownStarter: true, descriptionWordCount: wc("an app for delivery drivers to see their route, mark stops complete, and log mileage"), highConfidenceCustom: false }, "full");

console.log("\n=== second reported bug: starter + a chosen subtype, NO typed description ===");
check("Mobile App starter + 'Workout Trackers, Calorie Counters, Meditation Timers' subtype",
  { knownStarter: true, descriptionWordCount: 0, subtypeWordCount: wc("Workout Trackers, Calorie Counters, Meditation Timers"), highConfidenceCustom: false }, "full");
check("Mobile App starter + a two-word specific subtype",
  { knownStarter: true, descriptionWordCount: 0, subtypeWordCount: wc("Habit Tracker"), highConfidenceCustom: false }, "full");

console.log("\n=== starter with no product signal at all stays stack-only ===");
check("Mobile App starter, empty description, generic subtype",
  { knownStarter: true, descriptionWordCount: 0, subtypeWordCount: 0, highConfidenceCustom: false }, "starter-stack");
check("Mobile App starter, trivial description, generic subtype",
  { knownStarter: true, descriptionWordCount: wc("a mobile app"), subtypeWordCount: 0, highConfidenceCustom: false }, "starter-stack");

console.log("\n=== custom briefs unchanged ===");
check("high-confidence custom brief", { knownStarter: false, descriptionWordCount: 20, highConfidenceCustom: true }, "compact-custom");
check("ambiguous custom brief", { knownStarter: false, descriptionWordCount: 5, highConfidenceCustom: false }, "full");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
