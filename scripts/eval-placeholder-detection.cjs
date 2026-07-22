#!/usr/bin/env node
/**
 * Guards the placeholder-only write rejection — the check that killed a real portfolio build.
 *
 * The bug: a bare /\bplaceholder\b/ matched the HTML placeholder="…" attribute, so a portfolio's
 * contact form was rejected as "placeholder-only" twice and the build produced ZERO files. A real
 * page must be accepted; a genuine placeholder page must still be rejected.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (mod, file) => {
  mod._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file }).outputText, file);
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const target = request.startsWith("@/") ? path.join(root, request.slice(2)) : request;
  try { return originalResolve.call(this, target, ...rest); }
  catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${target}${x}`)) return `${target}${x}`; throw e; }
};
const { proposedFileIsPlaceholderOnly } = require(path.join(root, "lib/ai/mission/executor.ts"));

let failures = 0;
const ok = (label, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`); };

// A realistic portfolio index.html — the shape that was wrongly rejected. Has a contact form with the
// HTML placeholder attribute, CSS ::placeholder, and a "coming soon" note in one section.
const realPortfolio = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Jane Rivera — Designer</title>
<style>
  :root{--ink:#111;--bg:#fafafa}
  body{margin:0;font-family:system-ui;background:var(--bg);color:var(--ink)}
  .hero{padding:6rem 2rem;text-align:center}
  input::placeholder{color:#9aa}
  .grid{display:grid;gap:1.5rem;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));padding:2rem}
  .card{background:#fff;border-radius:12px;padding:1.25rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}
</style></head><body>
<header class="hero"><h1>Jane Rivera</h1><p>Product designer crafting calm, usable interfaces.</p></header>
<main>
  <section class="grid" id="work">
    <article class="card"><h3>Aster Banking</h3><p>End-to-end redesign of a mobile banking app.</p></article>
    <article class="card"><h3>Loop Calendar</h3><p>A scheduling tool for distributed teams.</p></article>
    <article class="card"><h3>More coming soon</h3><p>New case studies are in progress.</p></article>
  </section>
  <section id="contact" style="padding:2rem;max-width:520px;margin:0 auto">
    <h2>Get in touch</h2>
    <form onsubmit="event.preventDefault();this.reset();alert('Thanks — I will reply soon.')">
      <input name="name" placeholder="Your name" required style="display:block;width:100%;margin:.5rem 0;padding:.75rem">
      <input name="email" type="email" placeholder="Your email" required style="display:block;width:100%;margin:.5rem 0;padding:.75rem">
      <textarea name="message" placeholder="Tell me about your project" style="display:block;width:100%;margin:.5rem 0;padding:.75rem"></textarea>
      <button type="submit">Send</button>
    </form>
  </section>
</main>
<script>document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();document.querySelector(a.getAttribute('href')).scrollIntoView({behavior:'smooth'})}));</script>
</body></html>`;

console.log("=== the real portfolio (contact form + ::placeholder + one 'coming soon') must be ACCEPTED ===");
ok("real portfolio index.html is NOT rejected", proposedFileIsPlaceholderOnly("index.html", realPortfolio) === false);
ok("a small form snippet with placeholder attr is NOT rejected", proposedFileIsPlaceholderOnly("form.html", `<form><input placeholder="Email"><button>Send</button></form>`) === false);
ok("CSS ::placeholder is NOT rejected", proposedFileIsPlaceholderOnly("styles.css", `input::placeholder{color:#999}`) === false);
ok("JS object key placeholder: is NOT rejected", proposedFileIsPlaceholderOnly("form.tsx", `const props = { placeholder: "Enter name", value };`) === false);

console.log("\n=== genuine placeholders must STILL be rejected ===");
ok("a coming-soon holding page IS rejected", proposedFileIsPlaceholderOnly("index.html", `<!doctype html><html><body><h1>Coming soon</h1></body></html>`) === true);
ok("a prose 'this is a placeholder' stub IS rejected", proposedFileIsPlaceholderOnly("index.html", `<html><body><p>This is a placeholder. Real content will go here.</p></body></html>`) === true);
ok("Foundry-internal handoff artifact IS rejected", proposedFileIsPlaceholderOnly("notes.ts", `export const note = "touch to satisfy tool-call requirement";`) === true);
ok("tiny stub class IS rejected", proposedFileIsPlaceholderOnly("Model.kt", `object Model { const val x = 1 }`) === true);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
