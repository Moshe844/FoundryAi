#!/usr/bin/env node
/**
 * Guards the narrative-quality dedup: the executor's reasoning emitter suppresses a user-facing line
 * when it is near-identical (token similarity > 0.72) to a recently emitted one, so a hard-coded
 * lifecycle template can never repeat verbatim the way it did across continuation batches
 * (.foundry-data/journals/marketing-site: the same two sentences emitted 4×), while genuinely distinct
 * engineering reasoning always gets through.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { const t = r.startsWith("@/") ? path.join(root, r.slice(2)) : r; try { return orig.call(this, t, ...a); } catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${t}${x}`)) return `${t}${x}`; throw e; } };

const { normalizeForSimilarity, textSimilarity } = require(path.join(root, "lib/ai/mission/executor.ts"));

let failures = 0;
const ok = (label, cond) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

// Reproduce the emit-level dedup exactly: keep a window of recent normalized lines, suppress > 0.72.
function emitStream(lines) {
  const recent = [];
  const shown = [];
  for (const line of lines) {
    const normalized = normalizeForSimilarity(line.trim());
    if (recent.some((prior) => textSimilarity(normalized, prior) > 0.72)) continue;
    recent.push(normalized);
    if (recent.length > 8) recent.shift();
    shown.push(line);
  }
  return shown;
}

console.log("=== the exact repeated journal templates collapse to one ===");
const repeated = [
  "The real page structure is in place. I’m connecting its visual design and interactions now.",
  "The complete source set is ready. I’m opening it in a real browser now and checking the rendered experience.",
  "The real page structure is in place. I’m connecting its visual design and interactions now.",
  "The complete source set is ready. I’m opening it in a real browser now and checking the rendered experience.",
  "The real page structure is in place. I’m connecting its visual design and interactions now.",
];
const shown = emitStream(repeated);
ok("five emissions of two templates collapse to exactly two shown lines", shown.length === 2);

console.log("\n=== genuinely distinct engineering reasoning is never suppressed ===");
const engineerVoice = [
  "I'm checking the upload route because the browser error occurs after the file reaches the server.",
  "The middleware expects AUTH_TOKEN, but this project defines UPLOAD_TOKEN. I'm updating the middleware to use the existing variable.",
  "The patch is saved. I'm running the targeted test and repeating the upload flow.",
  "The upload now completes successfully. The targeted test passes and the browser console is clean.",
];
ok("four distinct engineering messages all get through", emitStream(engineerVoice).length === 4);

console.log("\n=== similarity thresholds ===");
ok("identical templates => similarity 1.0 (suppressed)", textSimilarity(normalizeForSimilarity(repeated[0]), normalizeForSimilarity(repeated[2])) === 1);
const a = normalizeForSimilarity(engineerVoice[0]);
const b = normalizeForSimilarity(engineerVoice[1]);
ok("distinct reasoning stays well under the 0.72 suppress threshold", textSimilarity(a, b) < 0.72);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
