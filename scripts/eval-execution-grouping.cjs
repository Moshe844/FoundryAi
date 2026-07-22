#!/usr/bin/env node
/**
 * Guards the Execution Canvas event-grouping architecture: low-level file operations collapse into one
 * unit per file, command lifecycle rows collapse into one command unit, recovered errors are not shown
 * as failed units, and the single current-activity indicator reflects the real latest event.
 * Maps to redesign acceptance tests 1 (one-file change), 2 (multi-file), 3 (recovery).
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { const t = r.startsWith("@/") ? path.join(root, r.slice(2)) : r; try { return orig.call(this, t, ...a); } catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${t}${x}`)) return `${t}${x}`; throw e; } };

const { groupExecutionUnits, currentActivityOf, normalizeLineRange } = require(path.join(root, "lib/canvas/model.ts"));

let failures = 0;
const ok = (label, cond) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const w = (over) => ({ id: over.id || Math.random().toString(16).slice(2), kind: "inspection", status: "completed", text: "", timestamp: "2026-07-21T20:00:00Z", ...over });

console.log("=== Test 1: one-file change collapses read → edit → verify into ONE unit ===");
let units = groupExecutionUnits([
  w({ id: "a1", kind: "inspection", filePath: "server/auth.ts", text: "read server/auth.ts" }),
  w({ id: "a2", kind: "edit", filePath: "server/auth.ts", text: "edited server/auth.ts", lineRange: "lines 42–67", durationMs: 400 }),
  w({ id: "a3", kind: "inspection", filePath: "server/auth.ts", text: "read server/auth.ts" }),
]);
ok("three low-level events on one file => exactly ONE unit", units.length === 1);
ok("unit is labelled 'Updated auth.ts' (edit wins over read)", units[0].label === "Updated auth.ts");
ok("unit carries the changed line range", units[0].detail === "lines 42–67");
ok("unit keeps all three low-level steps for expansion", units[0].subSteps.length === 3);
ok("unit status is completed", units[0].status === "completed");

console.log("\n=== Test 2: multi-file — one unit per file, command folded separately ===");
units = groupExecutionUnits([
  w({ id: "b1", kind: "file", filePath: "src/api/auth.ts", text: "wrote src/api/auth.ts" }),
  w({ id: "b2", kind: "edit", filePath: "src/pages/Login.tsx", text: "edited src/pages/Login.tsx" }),
  w({ id: "b3", kind: "command", command: "npm run build", status: "running", text: "ran npm run build" }),
  w({ id: "b4", kind: "command", command: "npm run build", status: "completed", text: "ran npm run build → exit 0", durationMs: 21000 }),
]);
ok("two files + one command (2 lifecycle rows) => 3 units", units.length === 3);
ok("new file labelled 'Created auth.ts'", units.find((u) => u.filePath === "src/api/auth.ts").label === "Created auth.ts");
const cmd = units.find((u) => u.kind === "command");
ok("command lifecycle rows fold into ONE command unit", cmd && cmd.subSteps.length === 2);
ok("command unit reflects the final completed status", cmd.status === "completed");

console.log("\n=== Test 3: a recovered file edit is NOT a failed unit (error stays in the steps) ===");
units = groupExecutionUnits([
  w({ id: "c1", kind: "edit", filePath: "src/x.ts", status: "error", text: "edit rejected", output: "Tool arguments could not be parsed" }),
  w({ id: "c2", kind: "edit", filePath: "src/x.ts", status: "completed", text: "edited src/x.ts" }),
]);
ok("unit with a failed-then-succeeded edit is completed, not error", units[0].status === "completed");
ok("the raw failure is preserved in the expandable steps", units[0].subSteps.some((s) => s.status === "error" && s.output));

console.log("\n=== normalizeLineRange ===");
ok("'Lines 1-658' => 'lines 1–658'", normalizeLineRange("Lines 1-658") === "lines 1–658");
ok("single line collapses", normalizeLineRange("Lines 42-42") === "line 42");
ok("no range => undefined", normalizeLineRange("whole file") === undefined);

console.log("\n=== currentActivityOf: single unambiguous state ===");
const mission = (state, timeline) => ({ state, timeline });
ok("waiting_for_approval => waiting-approval", currentActivityOf(mission("waiting_for_approval", [])).state === "waiting-approval");
ok("editing a file => 'Editing x.ts'", currentActivityOf(mission("running", [{ kind: "edit", filePath: "a/x.ts", status: "running", title: "" }])).label === "Editing x.ts");
ok("running a test command => 'Running tests'", currentActivityOf(mission("running", [{ kind: "command", command: "npm test -- upload", status: "running", title: "" }])).state === "testing");
ok("a decision event => deciding", currentActivityOf(mission("running", [{ kind: "reasoning", tier: "decision", status: "completed", title: "" }])).state === "deciding");
ok("complete => completed", currentActivityOf(mission("complete", [])).state === "completed");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
