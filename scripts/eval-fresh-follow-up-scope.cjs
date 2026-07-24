#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const contract = fs.readFileSync(path.join(root, "lib/ai/mission/requirement-contract.ts"), "utf8");

assert.match(runtime, /exactRetry && !standaloneMutationRequest/, "A concrete retry instruction must remain fresh scope instead of reopening the creation plan.");
assert.match(runtime, /const explicitlyContinuingIncompleteMission = isControlContinuation/, "Only a real control continuation may inherit unfinished saved-brief work.");
assert.match(contract, /portfolio\|profile\|website\|site\|page/, "Personal portfolio identity must produce literal browser acceptance requirements.");
assert.match(contract, /works\?\|working\|employed/, "Company identity must produce literal browser acceptance requirements.");
assert.match(contract, /works\?\|working\)\\s\+as/, "Professional role must produce literal browser acceptance requirements.");

console.log("Fresh follow-up scope regression checks passed.");
