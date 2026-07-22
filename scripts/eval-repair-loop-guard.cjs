#!/usr/bin/env node
/**
 * Guards the two bugs that put a real marketing-site build into an infinite repair loop:
 *
 *  1. The generated index.html had Astro/Markdown frontmatter (`---\ntitle: …\n---`) prepended to real
 *     HTML. Served raw, that frontmatter renders as garbage and fails the browser gate forever.
 *  2. The destructive-rewrite guard reverted the repair that fixed it: the cleaned HTML was under half the
 *     bloated original's line count, so the guard restored the broken frontmatter file every attempt.
 *
 * Recorded live in .foundry-data/journals/marketing-site: preview/error → edit +41/-39 → "Rejected a
 * repair that deleted most of 1 implemented file — restored the real implementation" → preview/error → …
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { const t = r.startsWith("@/") ? path.join(root, r.slice(2)) : r; try { return orig.call(this, t, ...a); } catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${t}${x}`)) return `${t}${x}`; throw e; } };

const { isDestructiveRewrite } = require(path.join(root, "lib/verification/outcome-compliance.ts"));
const { htmlEntryWithoutFrontmatter } = require(path.join(root, "lib/ai/mission/executor.ts"));

let failures = 0;
const ok = (label, cond) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

// ---- Fix 1: frontmatter is stripped from HTML entry files ----
const frontmattered = `---
title: Marketing Site
description: A calm, focused marketing experience
layout: marketing-page
---
<!doctype html>
<html lang="en"><head><title>Horizon</title></head><body><h1>Hi</h1></body></html>`;
const cleaned = htmlEntryWithoutFrontmatter("index.html", frontmattered);
ok("frontmatter block removed from index.html", !cleaned.startsWith("---") && /^<!doctype html>/i.test(cleaned.trim()));
ok("HTML body content preserved", cleaned.includes("<h1>Hi</h1>"));
ok("a clean HTML file is left untouched", htmlEntryWithoutFrontmatter("index.html", "<!doctype html><html></html>") === "<!doctype html><html></html>");
ok("a non-HTML file is never touched", htmlEntryWithoutFrontmatter("post.md", frontmattered) === frontmattered);
ok("HTML that merely contains a --- horizontal rule is not stripped", htmlEntryWithoutFrontmatter("index.html", "<hr>\n---\nnot frontmatter") === "<hr>\n---\nnot frontmatter");

// ---- Fix 2: destructive-rewrite guard no longer reverts a legitimate compacting rewrite ----
const bloated = Array.from({ length: 585 }, (_, i) => `<div class="row-${i}">line ${i}</div>`).join("\n");
const compactRealPage = Array.from({ length: 250 }, (_, i) => `<section id="s${i}"><h2>Section ${i}</h2><p>Real content ${i}</p></section>`).join("\n");
ok("a 585→250 line real rewrite is NOT flagged destructive (was the loop)", isDestructiveRewrite(bloated, compactRealPage) === false);
// The original defect this guard exists for: real implementation replaced with a near-empty stub.
const stub = `export default function Screen() {\n  return null;\n}`;
ok("a substantial file gutted to a tiny stub IS still flagged destructive", isDestructiveRewrite(bloated, stub) === true);
ok("a small original is never guarded", isDestructiveRewrite("a\nb\nc", "") === false);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
