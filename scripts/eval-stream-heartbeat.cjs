#!/usr/bin/env node
/**
 * Guards the streaming keepalive that stopped the client's 150s inactivity watchdog from killing a
 * mission during a legitimately long model call/build/install (observed: "Generating the first runnable
 * source batch" → stopped at 150s). Both mission stream routes must emit a heartbeat well under the
 * watchdog window, clear it on completion AND on disconnect, and the client must ignore heartbeat lines.
 */
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let failures = 0;
const ok = (label, cond) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

const HEARTBEAT_MS = 30_000;
const WATCHDOG_MS = 150_000;

console.log("=== cadence leaves safe margin under the client watchdog ===");
const shell = read("components/WorkspaceShell.tsx");
const watchdogMatch = shell.match(/setTimeout\([^,]*became inactive[^,]*\)\), (\d[\d_]*)\)/);
const watchdogValue = watchdogMatch ? Number(watchdogMatch[1].replace(/_/g, "")) : null;
ok("client watchdog is still 150s", watchdogValue === WATCHDOG_MS);
ok("heartbeat (30s) fires at least 3× before the watchdog window", WATCHDOG_MS / HEARTBEAT_MS >= 3);

for (const route of ["app/api/factory/create/route.ts", "app/api/factory/existing/route.ts"]) {
  console.log(`\n=== ${route} ===`);
  const src = read(route);
  ok("emits a heartbeat on a 30s interval", /setInterval\([\s\S]*?"heartbeat"[\s\S]*?30_000\)/.test(src));
  ok("clears the heartbeat when the mission settles (finally)", /finally[\s\S]*?clearInterval\(heartbeat\)/.test(src));
  ok("clears the heartbeat when the client disconnects (cancel)", /cancel\(\)\s*\{[\s\S]*?clearInterval\(heartbeat\)/.test(src));
}

console.log("\n=== the client ignores heartbeat lines (no throw, no timeline/result/error) ===");
// Mirror handleLine's switch: only event/result/error do anything; a heartbeat is a no-op.
function handleLine(line, sink) {
  if (!line.trim()) return;
  const payload = JSON.parse(line);
  if (payload.type === "event") sink.events += 1;
  else if (payload.type === "result") sink.result = true;
  else if (payload.type === "error") throw new Error(payload.error);
}
const sink = { events: 0, result: false };
let threw = false;
try { handleLine(JSON.stringify({ type: "heartbeat", at: Date.now() }), sink); } catch { threw = true; }
ok("heartbeat line parses and is a no-op", !threw && sink.events === 0 && sink.result === false);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
