#!/usr/bin/env node
/**
 * Guards the provider-timeout policy in lib/ai/providers/dispatch.ts.
 *
 * A flaky provider used to burn its FULL per-attempt window (up to 160s) on every turn before the
 * dispatcher fell back — observed live as "gpt-5.3-codex did not return a usable response (transport)"
 * after a minute of dead waiting. Degraded candidates that still have an alternate are now probed on a
 * short leash. The inverse mistake is guarded too: an earlier build split one 60s call into two 30s
 * attempts and made BOTH healthy coding providers fail before either could return an edit, so a healthy
 * provider — and the last resort, whoever it is — must always keep the complete allowance.
 */
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "lib/ai/providers/dispatch.ts"), "utf8");

let failures = 0;
const ok = (label, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  — ${detail ?? ""}`}`); };
const num = (name) => { const m = new RegExp(`${name}\\s*=\\s*([\\d_]+)`).exec(src); return m ? Number(m[1].replace(/_/g, "")) : null; };

console.log("=== bounded worst case ===");
const fallbackWindow = num("MAX_LOGICAL_FALLBACK_WINDOW_MS");
const attemptMax = num("MAX_PROVIDER_ATTEMPT_TIMEOUT_MS");
ok("one logical model call cannot block longer than 210s", fallbackWindow !== null && fallbackWindow <= 210_000, String(fallbackWindow));
ok("a full attempt still allows real generation time (>=120s)", attemptMax !== null && attemptMax >= 120_000, String(attemptMax));

console.log("\n=== every candidate keeps its real allowance ===");
// A short leash on "degraded" candidates was tried and REVERTED: cutting a slow-but-valid call short
// recorded another failure, decayed that model's health, and a few of those in a row drove every model
// under the availability floor until routing refused to start at all. Slowness is surfaced, not enforced.
ok("no degraded-probe timeout exists", !/DEGRADED_PROBE_TIMEOUT_MS/.test(src));
ok("the per-attempt signal uses the full candidate timeout", /AbortSignal\.timeout\(candidateTimeoutMs\)/.test(src));
ok("the provider call receives the same timeout it is aborted on", /timeoutMs:\s*candidateTimeoutMs/.test(src));
ok("a slow candidate is reported rather than silently cut", /onAttemptFailure/.test(src));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
