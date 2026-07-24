#!/usr/bin/env node
/**
 * Guards element-level verification of claimed features.
 *
 * Live 2026-07-22: a portfolio build reported "10/10" with "✓ Implement and verify: Responsive images
 * with lazy loading" — against a page containing ZERO <img> tags (its "media" were CSS gradient divs).
 * Nothing checked, because the acceptance contract only understood quoted literals and CRUD verbs, and
 * the checklist was self-reported by the model. If the brief names a visible thing, the rendered page
 * must actually contain it.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { const t = r.startsWith("@/") ? path.join(root, r.slice(2)) : r; try { return orig.call(this, t, ...a); } catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${t}${x}`)) return `${t}${x}`; throw e; } };

const { requiredDomFeaturesForTask } = require(path.join(root, "lib/ai/mission/requirement-contract.ts"));

let failures = 0;
const ok = (label, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  — ${detail ?? ""}`}`); };

// The real brief bullets from the live portfolio run.
const portfolioBrief = [
  "Portfolio", "Responsive website", "Homepage with hero + feature sections",
  "Content listing (blog/portfolio grid)", "Detail page with rich content rendering",
  "Primary + footer navigation", "Responsive images with lazy loading", "SEO metadata per page",
].join("; ");

const features = requiredDomFeaturesForTask(portfolioBrief);
const labels = features.map((f) => f.label);

console.log("=== the brief's element claims are extracted ===");
console.log("   extracted:", JSON.stringify(labels));
ok("lazy-loaded media is required", labels.includes("lazy-loaded media"), JSON.stringify(labels));
ok("navigation is required", labels.includes("navigation"), JSON.stringify(labels));
ok("a footer is required", labels.includes("a footer"), JSON.stringify(labels));
ok("the stricter lazy rule replaces the plain images rule", !labels.includes("images"), JSON.stringify(labels));

console.log("\n=== the delivered page would now FAIL the gate ===");
// Exactly what shipped: gradient divs standing in for media, real nav + footer, no <img> anywhere.
const shipped = `<nav><a href='#'>Home</a></nav><main><div class='thumb' role='img' aria-label='Project'></div></main><footer>© Elara Studio</footer>`;
const present = (selector) => {
  if (/img\[loading='lazy'\]/.test(selector)) return /<img[^>]*loading=['"]lazy/.test(shipped);
  if (/^img, picture$/.test(selector)) return /<img|<picture/.test(shipped);
  if (/footer/.test(selector)) return /<footer/.test(shipped);
  if (/nav/.test(selector)) return /<nav/.test(shipped);
  return false;
};
const missing = features.filter((f) => !present(f.selector)).map((f) => f.label);
ok("the false 'lazy loading' claim is caught", missing.includes("lazy-loaded media"), JSON.stringify(missing));
ok("the genuinely present nav is NOT reported missing", !missing.includes("navigation"), JSON.stringify(missing));
ok("the genuinely present footer is NOT reported missing", !missing.includes("a footer"), JSON.stringify(missing));

console.log("\n=== briefs that claim nothing visible stay unaffected ===");
ok("a vague request extracts no element claims", requiredDomFeaturesForTask("Make it look nicer and more modern.").length === 0);
ok("'research' does not trigger the search rule", !requiredDomFeaturesForTask("A page about my research.").some((f) => /search/.test(f.label)));
ok("'platform' does not trigger the form rule", !requiredDomFeaturesForTask("A page describing our platform.").some((f) => /form/.test(f.label)));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
