#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const executor = fs.readFileSync(path.join(root, "lib/ai/mission/executor.ts"), "utf8");
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const report = fs.readFileSync(path.join(root, "lib/factory/engineering-report.ts"), "utf8");

assert.match(executor, /firstStaticArtifactIssue = input\.staticProject && !runnableEntryExistsNow/, "The first-artifact guard must not reject repair writes after index.html exists.");
assert.doesNotMatch(runtime, /browserVerificationConflict \? "needs-clarification" : "failed"/, "A repeated browser defect is an engineering recovery state, not a customer product decision.");
assert.doesNotMatch(runtime, /Continue autonomous repair from the preserved browser evidence using a fresh strategy\?/, "Foundry must not ask permission to perform ordinary browser repair.");
assert.doesNotMatch(report, /Foundry has preserved the incomplete project and its verification evidence\. Continue autonomous repair/, "The completion contract must not manufacture a clarification prompt.");
assert.match(report, /status: "failed",\s+blocker,\s+clarificationQuestions: undefined/, "An exhausted bounded run must remain retryable without pretending user input is required.");

console.log("Autonomous browser recovery regression checks passed.");
