#!/usr/bin/env node
/**
 * Guards literal content requirements reaching the acceptance contract.
 *
 * Live on 2026-07-22 a request said: must show exactly the heading "Sam Carter", the bio line
 * "Product designer who likes calm interfaces", and three skill tags labelled Design, Prototyping and
 * Research. The browser gate reported "No deterministic rendered capability contract could be derived
 * from this request", verified nothing, and the mission reported Done with 1 of 3 requirements present.
 * requiredVisibleTextsForTask now turns those literals into checkable assertions.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { const t = r.startsWith("@/") ? path.join(root, r.slice(2)) : r; try { return orig.call(this, t, ...a); } catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${t}${x}`)) return `${t}${x}`; throw e; } };

const { requiredVisibleTextsForTask } = require(path.join(root, "lib/ai/mission/requirement-contract.ts"));

let failures = 0;
const ok = (label, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  — ${detail ?? ""}`}`); };

const liveTask = 'A single static HTML page — a personal profile card for Sam Carter. Plain HTML and CSS only, no framework, no build step, one index.html. It must show exactly: the heading "Sam Carter", the bio line "Product designer who likes calm interfaces", and three skill tags labelled Design, Prototyping and Research that lift on hover. Nothing else — no dashboard, no records, no forms.';
const texts = requiredVisibleTextsForTask(liveTask);

console.log("=== the exact live request that verified nothing ===");
console.log("   extracted:", JSON.stringify(texts));
ok("extracts the quoted heading", texts.includes("Sam Carter"), JSON.stringify(texts));
ok("extracts the quoted bio line", texts.includes("Product designer who likes calm interfaces"), JSON.stringify(texts));
for (const tag of ["Design", "Prototyping", "Research"]) {
  ok(`extracts the labelled tag "${tag}"`, texts.includes(tag), JSON.stringify(texts));
}
ok("does not treat the filename index.html as on-screen content", !texts.some((t) => /index\.html/i.test(t)), JSON.stringify(texts));

console.log("\n=== the gate would now catch the real failure ===");
// What the live run actually rendered: the heading only.
const renderedBody = "sam carter profile edit profile";
const normalize = (v) => v.replace(/\s+/g, " ").trim().toLowerCase();
const missing = texts.filter((t) => !normalize(renderedBody).includes(normalize(t)));
ok("the delivered page fails the contract (2+ requirements missing)", missing.length >= 2, JSON.stringify(missing));
ok("the present heading is not reported missing", !missing.includes("Sam Carter"));
// And a page that actually satisfies the request passes.
const goodBody = "Sam Carter Product designer who likes calm interfaces Design Prototyping Research";
ok("a faithful page satisfies every required text", texts.every((t) => normalize(goodBody).includes(normalize(t))));

console.log("\n=== requests with no literal demands stay unaffected ===");
ok("a vague request extracts nothing", requiredVisibleTextsForTask("Make the site look nicer and more modern.").length === 0);
ok("stack mentions are not content", requiredVisibleTextsForTask("Build it with React and TypeScript.").length === 0);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
