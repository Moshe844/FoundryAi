#!/usr/bin/env node
/**
 * Guards the preview readiness contract.
 *
 * `beginPreviewRefreshForProject` returns previewState:"starting" IMMEDIATELY and resolves the real
 * outcome into previewRefreshOutcomes in the background. The client used to POST once and keep whatever
 * came back, so the dock read "Starting the preview server…" forever whenever no mission stream was
 * running to deliver readiness — reported live 2026-07-22 as "stuck at this page forever across the
 * board". The client must poll until the state settles, and must give up with a real error.
 */
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const canvas = fs.readFileSync(path.join(root, "components/canvas/MissionCanvas.tsx"), "utf8");
const panel = fs.readFileSync(path.join(root, "components/execution/PreviewPanel.tsx"), "utf8");
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const route = fs.readFileSync(path.join(root, "app/api/factory/preview/route.ts"), "utf8");

let failures = 0;
const ok = (label, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  — ${detail ?? ""}`}`); };

console.log("=== the server really is fire-and-forget (so the client MUST poll) ===");
ok("refresh returns 'starting' without awaiting readiness", /return \{ previewState: "starting", previewPlatform: "web" \};/.test(runtime));
ok("the resolved outcome is stored for later retrieval", /previewRefreshOutcomes\.set\(projectId, outcome\)/.test(runtime));
ok("a status request returns the stored outcome", /previewRefreshOutcomes\.get\(projectId\)/.test(runtime));
ok("the route exposes a status path", /getPreviewStatus\(body\.projectId\)/.test(route));

console.log("\n=== the client polls until the state settles ===");
ok("a polling effect is keyed on the 'starting' state", /effectiveExecution\?\.previewState !== "starting"/.test(canvas));
ok("it re-queries the preview endpoint on an interval", /setInterval\([\s\S]{0,400}\/api\/factory\/preview/.test(canvas));
ok("polling stops once the state is no longer 'starting'", /status\.previewState !== "starting"[\s\S]{0,120}clearInterval/.test(canvas));
ok("the interval is cleared on unmount", /return \(\) => \{ cancelled = true; clearInterval\(timer\); \};/.test(canvas));

console.log("\n=== it fails honestly instead of spinning forever ===");
ok("there is a bounded attempt cap", /maximumAttempts\s*=\s*\d+/.test(canvas));
ok("hitting the cap reports a real error state", /attempts >= maximumAttempts[\s\S]{0,220}previewState: "error"/.test(canvas));
ok("the error names a next step for the user", /Retry preview/.test(canvas));

console.log("\n=== the panel still renders each settled state ===");
for (const [state, marker] of [["starting", "Starting the preview server"], ["error", "Preview couldn"]]) {
  ok(`panel renders the ${state} state`, panel.includes(marker));
}

console.log("\n=== refresh never blanks a proven preview ===");
ok("the server reuses a healthy owned preview", /if \(active\?\.previewUrl\)[\s\S]{0,180}previewState: "ready"/.test(runtime));
ok("the previous ready outcome survives an in-flight refresh", /previous\?\.previewState === "ready"/.test(runtime));
ok("the panel retains the last ready URL during startup", /lastReadyPreviewRef[\s\S]{0,500}visiblePreviewUrl/.test(panel));
ok("the starting screen appears only when no retained preview exists", /previewState === "starting" && !visiblePreviewUrl/.test(panel));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
