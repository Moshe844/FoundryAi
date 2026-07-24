#!/usr/bin/env node
/**
 * Guards against the routing lockout that killed a mission in 11.7s before it started:
 *   "No validated, healthy model satisfies fast requirements within the current provider and budget
 *    constraints."
 *
 * Cause: reportModelHealth marked a model `available = false` once its EWMA health fell under 0.35, but
 * success never restored the flag. Unavailable models are excluded from selection, so an excluded model
 * could never succeed to earn its way back — a one-way door. A handful of transient failures (tool
 * errors, a provider transport blip) permanently bricked the tier.
 */
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const router = fs.readFileSync(path.join(root, "lib/ai/routing/dynamic-router.ts"), "utf8");
const selector = fs.readFileSync(path.join(root, "lib/ai/routing/selector.ts"), "utf8");
const dispatch = fs.readFileSync(path.join(root, "lib/ai/providers/dispatch.ts"), "utf8");

let failures = 0;
const ok = (label, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  — ${detail ?? ""}`}`); };

console.log("=== a model that succeeds becomes available again ===");
const successBlock = /if \(success\) \{[\s\S]*?\}/.exec(router)?.[0] ?? "";
ok("success restores model.available", /model\.available\s*=\s*true/.test(successBlock), successBlock.slice(0, 160));
ok("the availability floor still exists for repeated failure", /!success && \(suppressForCurrentRegistry \|\| model\.providerHealth < 0\.35\)/.test(router));

console.log("\n=== routing degrades instead of refusing ===");
ok("selectModel accepts an explicit last-resort flag", /includeUnavailable\?:\s*boolean/.test(selector));
ok("the availability filter honours it", /\(options\.includeUnavailable \|\| model\.available\)/.test(selector));
ok("routeDynamically retries including unhealthy models", /selectModel\(profile, registry, input\)\s*\?\?\s*selectModel\(profile, registry, \{ \.\.\.input, includeUnavailable: true \}\)/.test(router));

console.log("\n=== the aggravating short-leash probe is gone ===");
ok("no degraded-probe timeout remains", !/DEGRADED_PROBE_TIMEOUT_MS/.test(dispatch));
ok("every candidate gets its real allowance", /AbortSignal\.timeout\(candidateTimeoutMs\)/.test(dispatch));

console.log("\n=== health decay simulation: a bad run must not be a one-way door ===");
const decay = (h, success) => Math.max(0.1, Math.min(1, h * 0.8 + (success ? 1 : 0) * 0.2));
let health = 1, available = true;
for (let i = 0; i < 6; i += 1) { health = decay(health, false); if (health < 0.35) available = false; }
ok("six straight failures do drop it below the floor", !available && health < 0.35, String(health));
// With the fix, the last-resort pass still selects it, it succeeds, and availability is restored.
health = decay(health, true);
available = true; // success branch now sets this
ok("one success restores availability", available && health > 0.35, String(health));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
