const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

const executor = source("lib/ai/mission/executor.ts");
const runtime = source("lib/factory/runtime.ts");
const canvas = source("components/canvas/MissionCanvas.tsx");
const shell = source("components/WorkspaceShell.tsx");

assert.match(executor, /approvalActionKind: "delete", approvalTarget: deletePath/,
  "File deletion approvals must carry structured operation identity.");
assert.match(executor, /const approvalActionKind = writeResult\.requestedCommand \? "command" : "write"/,
  "Approval-aware writes must distinguish file operations from dependency commands.");
assert.match(canvas, /actionKind, target/,
  "The approval UI must return the structured operation identity.");
assert.match(runtime, /const approvedCommand = approvedActionKind === "command" \? approvedAction : ""/,
  "Only genuine commands may enter the shell execution path.");
assert.match(runtime, /approvalResponse && approvalResponse\.decision !== "deny" && !consumedOneTimeApproval/,
  "Approved non-command actions must continue through the executor's action grant.");
assert.match(shell, /approvalResponse \? getActiveExecutionMission\(item\) : undefined/,
  "Approval continuations must inherit the blocked execution.");
assert.match(shell, /timeline: \[\.\.\.\(continuation\?\.timeline \?\? \[\]\)/,
  "Approval continuations must preserve the visible execution timeline.");

console.log("Approval action routing and execution continuity checks passed.");
