#!/usr/bin/env node
/**
 * Guards requiresSubstantialUiAcceptance — the classifier that decides whether the browser gate should
 * demand a feature-rich UI (>=2 form fields, >=10 controls, etc.). It MUST NOT fire for a simple static
 * content page: a complete Alex Rivera profile card (6 regions, 7 controls, 0 forms) was judged a "thin
 * shell" and looped expensive gpt-5.5 repairs forever, purely because the brief said "Static site" and
 * listed five small features. Reproduced live 2026-07-21 (.foundry-data/journals/alex-profile-card).
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { const t = r.startsWith("@/") ? path.join(root, r.slice(2)) : r; try { return orig.call(this, t, ...a); } catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${t}${x}`)) return `${t}${x}`; throw e; } };

const { requiresSubstantialUiAcceptance } = require(path.join(root, "lib/ai/mission/requirement-contract.ts"));

let failures = 0;
const ok = (label, cond) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

const profileCardBrief = `Project type: Personal profile page
Template: Static site
Selected stack: HTML + CSS + JavaScript
Main features: A centered profile card; the name "Alex Rivera" as a heading; a one-sentence bio; three skill tags (Design, Prototyping, Research); a subtle hover lift on each tag.`;

console.log("=== simple static content pages must NOT require substantial UI ===");
ok("the exact profile-card brief that looped is NOT substantial", requiresSubstantialUiAcceptance(profileCardBrief) === false);
ok("a landing page with five features is NOT substantial", requiresSubstantialUiAcceptance("Project type: Marketing landing page\nMain features: hero; value prop; testimonials; pricing; footer.") === false);
ok("a portfolio site is NOT substantial", requiresSubstantialUiAcceptance("Build a personal portfolio site with a projects grid and an about section.") === false);

console.log("\n=== genuine feature-rich apps STILL require substantial UI ===");
ok("an explicit 'advanced dashboard app' is substantial (quality word)", requiresSubstantialUiAcceptance("Build an advanced analytics dashboard app.") === true);
ok("a feature-rich admin tool is substantial", requiresSubstantialUiAcceptance("Build a feature-rich admin tool for managing users.") === true);
ok("an expense tracker with five features is substantial (app surface + list)", requiresSubstantialUiAcceptance("Project type: Expense tracker\nMain features: add expense; edit expense; categories; monthly totals; charts.") === true);
ok("a kanban board with five features is substantial", requiresSubstantialUiAcceptance("Project type: Kanban board\nMain features: columns; cards; drag and drop; labels; filters.") === true);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
