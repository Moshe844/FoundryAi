#!/usr/bin/env node
/**
 * Guards the cross-batch build-loop cost breaker. The continuation loop stops after the SAME production
 * build failure survives three repair batches, using the structural failure signature so a model that
 * re-narrates one unchanging failure (Next.js build-worker crash → "workspace root" → "turbopack root"
 * → "TypeScript 7") — while churning config files to look like progress — is recognized and stopped,
 * yet a genuine sequence of DIFFERENT compiler errors (peel-off recovery) keeps going.
 *
 * Recorded live in .foundry-data/journals/marketing-site-2: 82 turns / $3.17 on one such loop.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { const t = r.startsWith("@/") ? path.join(root, r.slice(2)) : r; try { return orig.call(this, t, ...a); } catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${t}${x}`)) return `${t}${x}`; throw e; } };

const { compilerFailureSignature } = require(path.join(root, "lib/verification/compiler-evidence.ts"));

let failures = 0;
const ok = (label, cond) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

// Simulate the continuation-loop counter: same signature 3× => stop; different signatures never accumulate.
function stopsAfter(buildFailures, threshold = 3) {
  const counts = new Map();
  for (let i = 0; i < buildFailures.length; i += 1) {
    const sig = compilerFailureSignature(buildFailures[i], "/proj");
    const n = (counts.get(sig) ?? 0) + 1;
    counts.set(sig, n);
    if (n >= threshold) return i + 1; // 1-based batch index at which it stops
  }
  return null;
}

const cmd = (stderr) => ({ command: "npm.cmd run build", stdout: "", stderr });

console.log("=== the disguised-repeat loop (same failure, re-narrated + config churn) must STOP at batch 3 ===");
// The real signal is the same failing worker line; the model's prose diagnosis differs and durations vary.
const nextWorkerCrash = [
  cmd("> next build\n\nError: Command failed with exit code 1: next build\n  at ChildProcess (node:child_process:291)\nBuild worker exited with code 1 and signal null\nTook 12.4s"),
  cmd("> next build\n\nError: Command failed with exit code 1: next build\n  at ChildProcess (node:child_process:291)\nBuild worker exited with code 1 and signal null\nTook 9.1s"),
  cmd("> next build\n\nError: Command failed with exit code 1: next build\n  at ChildProcess (node:child_process:287)\nBuild worker exited with code 1 and signal null\nTook 15.8s"),
  cmd("> next build\n\nError: Command failed with exit code 1: next build\nBuild worker exited with code 1 and signal null\nTook 8.0s"),
];
ok("same build-worker crash stops the loop at the 3rd batch", stopsAfter(nextWorkerCrash) === 3);

console.log("\n=== a genuine peel-off of DIFFERENT errors must NOT be stopped ===");
const differentErrors = [
  cmd("./src/app/page.tsx\nType error: Cannot find module '@/lib/data' or its corresponding type declarations."),
  cmd("./src/app/layout.tsx\nType error: Property 'title' does not exist on type 'Metadata'."),
  cmd("./src/components/Nav.tsx\nType error: 'href' is possibly 'undefined'."),
  cmd("./src/app/page.tsx\nModule not found: Can't resolve 'react-icons/fa'."),
];
ok("four distinct compiler errors never accumulate to the stop threshold", stopsAfter(differentErrors) === null);

console.log("\n=== structural signature collapses re-narrated type text ===");
const a = cmd("./x.tsx\nType error: Type '(v: number) => [string]' is not assignable to type 'Formatter<number>'.");
const b = cmd("./x.tsx\nType error: Type '(l: string) => string' is not assignable to type 'Formatter<string>'.");
ok("same defect with different concrete types => same signature", compilerFailureSignature(a, "/proj") === compilerFailureSignature(b, "/proj"));
const c = cmd("./y.tsx\nType error: Cannot find name 'useState'.");
ok("a truly different error => different signature", compilerFailureSignature(a, "/proj") !== compilerFailureSignature(c, "/proj"));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
