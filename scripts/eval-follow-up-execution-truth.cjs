#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const executor = fs.readFileSync(path.join(root, "lib/ai/mission/executor.ts"), "utf8");
const shell = fs.readFileSync(path.join(root, "components/WorkspaceShell.tsx"), "utf8");
const dispatch = fs.readFileSync(path.join(root, "lib/ai/providers/dispatch.ts"), "utf8");

assert.doesNotMatch(runtime, /boundedStaticFollowUp \? \{ estimatedCostUsd: 0\.5 \}/, "A normal static follow-up must use the selected model tier's viable budget instead of a preflight-rejecting $0.50 ceiling.");
assert.match(runtime, /"inspection", "completed", `Staged \$\{materializedAssets\.length\} attached project asset/, "Staged user input must be reported as preparation, not delivered source implementation.");
assert.doesNotMatch(runtime, /"file", "completed", `Imported \$\{materializedAssets\.length\} attached project asset/, "Attachment staging must not appear as a completed source edit.");
assert.match(executor, /paidModelCallsThisBatch === 0 \? "Implementation pass could not start"/, "A cost-guard refusal before any call must be shown as a pre-implementation failure.");
assert.doesNotMatch(executor, /forcedMutationRecovery\s*\? "Applying the required source change"/, "Provider waiting must not claim an edit is being applied before a tool action exists.");
assert.match(shell, /const previewMayVerifyMission = result\.status === "passed"/, "Existing preview health must not verify a failed follow-up.");
assert.match(shell, /verification: previewMayVerifyMission/, "Preview reconciliation must preserve failed follow-up evidence without adding a false pass.");
assert.match(dispatch, /Estimated request cost would exceed[\s\S]{0,80}continue;/, "A candidate-specific cost estimate must try a cheaper configured fallback before failing the follow-up.");

console.log("Follow-up execution truth regression checks passed.");
