#!/usr/bin/env node
/**
 * Deterministic repair for lucide-react's removed brand icons — the exact failure that stalled the
 * login-auth-page build across 4 model calls (NO_PROGRESS_AFTER_MUTATION).
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (mod, file) => {
  mod._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file }).outputText, file);
};
const { deterministicCompilerSourceRepair } = require(path.join(root, "lib/verification/deterministic-source-repair.ts"));

let failures = 0;
const ok = (label, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`); };

// The literal webpack + tsc diagnostics from the user's paste.
const webpackDiag = `Attempted import error: 'Github' is not exported from '__barrel_optimize__?names=AlertCircle,CheckCircle2,Eye,EyeOff,Github,Loader2,Lock,Mail!=!lucide-react' (imported as 'Github').`;
const tscDiag = `Failed to compile. Type error: Module '"lucide-react"' has no exported member 'Github'.`;

const source = `import { Mail, Lock, Github, Loader2 } from 'lucide-react';\n\nexport function SignIn() {\n  return <button><Github className="h-4 w-4" /> Sign in with GitHub</button>;\n}\n`;

console.log("=== the exact login-auth-page failure ===");
const r1 = deterministicCompilerSourceRepair({ sourcePath: "src/app/login/page.tsx", content: source, diagnostic: webpackDiag });
ok("webpack 'not exported' diagnostic triggers a repair", Boolean(r1), r1 && r1.reason);
ok("import now aliases Github to Circle", Boolean(r1 && /Circle as Github/.test(r1.content)));
ok("<Github/> usage is untouched (still resolves via alias)", Boolean(r1 && /<Github className/.test(r1.content)));
ok("other icons (Mail, Lock, Loader2) are preserved", Boolean(r1 && /Mail/.test(r1.content) && /Lock/.test(r1.content) && /Loader2/.test(r1.content)));

const r2 = deterministicCompilerSourceRepair({ sourcePath: "src/app/login/page.tsx", content: source, diagnostic: tscDiag });
ok("tsc 'no exported member' diagnostic also triggers the repair", Boolean(r2 && /Circle as Github/.test(r2.content)));

console.log("\n=== the repaired output actually compiles (transpile check) ===");
try {
  const out = ts.transpileModule(r1.content, { compilerOptions: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  ok("repaired source transpiles with no syntax error", !out.diagnostics || out.diagnostics.length === 0);
} catch (e) { ok("repaired source transpiles", false, String(e)); }

console.log("\n=== aliased import (X as Foo) form ===");
const aliasedSrc = `import { Github as GhIcon, Mail } from 'lucide-react';\nexport const x = <GhIcon/>;`;
const r3 = deterministicCompilerSourceRepair({ sourcePath: "a.tsx", content: aliasedSrc, diagnostic: tscDiag });
ok("Github as GhIcon becomes Circle as GhIcon", Boolean(r3 && /Circle as GhIcon/.test(r3.content) && /<GhIcon\/>/.test(r3.content)));

console.log("\n=== does NOT fire on unrelated errors or valid icons ===");
ok("no repair when lucide is not in the diagnostic", deterministicCompilerSourceRepair({ sourcePath: "a.tsx", content: source, diagnostic: "some other error" }) === undefined);
ok("no repair for a valid lucide import (Mail exists)", deterministicCompilerSourceRepair({ sourcePath: "a.tsx", content: "import { Mail } from 'lucide-react';", diagnostic: "Module '\"lucide-react\"' has no exported member 'Github'." }) === undefined);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
