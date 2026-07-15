const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync, rmSync, readFileSync } = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "tmp", "context-compaction-test");
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const sources = [path.join(root, "lib", "ai", "context-compaction", "types.ts"), path.join(root, "lib", "ai", "context-compaction", "compactor.ts")];
const compile = spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), ...sources, "--outDir", out, "--module", "commonjs", "--target", "es2022", "--skipLibCheck"], { cwd: root, encoding: "utf8" });
if (compile.status !== 0) { console.error(compile.stdout); console.error(compile.stderr); process.exit(compile.status || 1); }
const { compactMission, buildContextPackage, shouldCompactMission, validateCompactionSnapshot } = require(path.join(out, "compactor.js"));

const plan = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, label: `Requirement ${i}`, status: i < 10 ? "completed" : i === 10 ? "blocked" : "pending", evidence: i < 10 ? "verified" : undefined }));
const hugeLog = `${"noise\n".repeat(8000)}ERROR checkout failed\nexpected 2 actual 1`;
const mission = {
  missionId: "m1", objective: "Build inventory system", status: "active", currentStage: "waitingForExecutionEngine", desiredOutcome: "project", artifactType: "project",
  messages: Array.from({ length: 220 }, (_, i) => ({ id: `msg${i}`, tone: i % 2 ? "system" : "human", body: i === 218 ? "Always keep mobile navigation on top." : `Repeated status ${i}` })),
  attachments: [{ fileId: "f1", fileName: "src/app.ts", uploadStatus: "readable" }], createdArtifacts: [], sources: [], lastResult: "Continuing", activeExecutionMissionId: "exec1",
  executionMissions: [{ id: "exec1", source_requirements: ["Build inventory system"], state: "blocked", activeStep: "r10", plan, files_touched: [{ path: "src/app.ts", status: "edited", verified: true, diff: "+ inventory" }], commands_run: [{ command: "npm test", exitCode: 1, stdout: hugeLog, stderr: "" }], verification: [{ id: "v1", status: "failed" }], verification_status: "failed", approvals: [{ id: "a1", command: "npm install x", decidedAs: "allow_project" }, { id: "a2", command: "rm data", decidedAs: "deny" }], blocked_reason: "Requirement 10 needs a decision", undo_snapshot: "journal-42", summary: "Tests failed", timeline: Array.from({ length: 180 }, (_, i) => ({ id: `e${i}`, kind: "command", status: "completed", title: `event ${i}`, tier: "trace" })) }],
  workMemory: { currentGoal: "Build inventory system", currentBlocker: "Requirement 10 needs a decision", completedWork: [], resolvedErrors: [], rejectedHypotheses: ["Do not use cookies"], latestEvidence: [], relevantFiles: ["src/app.ts"], recommendedNextAction: "Resolve requirement 10", summary: "", updatedAt: "now" },
  followUpContext: { type: "followUp", summary: "Continue inventory build" }, liveWorkEvents: [], createdAt: "now", updatedAt: "now",
};

assert.equal(shouldCompactMission(mission), true, "hundreds of events trigger compaction");
const state = compactMission(mission, "p1"); const snapshot = state.snapshot;
assert.equal(validateCompactionSnapshot(snapshot).valid, true);
assert.equal(Object.values(snapshot.requirements).flat().length, 30, "all requirements survive");
assert.equal(snapshot.commands.approved[0].text, "npm install x", "approval survives");
assert.equal(snapshot.commands.denied[0].text, "rm data", "denial survives");
assert.match(snapshot.commands.failed[0].rationale, /ERROR checkout failed/, "important error survives log compaction");
assert.equal(snapshot.restorePoints[0].text, "journal-42", "undo restore point survives");
assert.equal(snapshot.rawArchive.messageIds.length, 220, "full raw history remains referenced");
assert.match(snapshot.userPreferences[0].text, /Always keep mobile navigation/, "latest preference survives");
assert.match(snapshot.failedApproaches[0].text, /Do not use cookies/, "rejected decision stays rejected");
const fast = buildContextPackage({ ...mission, compaction: state }, "fast");
const architect = buildContextPackage({ ...mission, compaction: state }, "architect");
assert.ok(!fast.mission && architect.mission, "model-aware packages expand by tier");
const rawTokens = Math.ceil(JSON.stringify(mission).length / 4);
assert.ok(fast.estimatedTokens < rawTokens * 0.2, "active context is materially smaller");
assert.equal(snapshot.references.rawMessages, "mission:m1:messages", "page refresh/archive reference remains stable");
const anthropic = readFileSync(path.join(root, "lib", "ai", "providers", "anthropic-runtime.ts"), "utf8");
assert.match(anthropic, /cache_control:\s*\{ type: "ephemeral" \}/, "Anthropic automatic prompt caching enabled");
const openai = readFileSync(path.join(root, "lib", "ai", "providers", "openai-runtime.ts"), "utf8");
assert.match(openai, /prompt_cache_key/, "OpenAI stable prompt cache key enabled");
const google = readFileSync(path.join(root, "lib", "ai", "providers", "google-runtime.ts"), "utf8");
assert.match(google, /cachedContentTokenCount/, "Google implicit cache hits tracked");
const factory = readFileSync(path.join(root, "lib", "factory", "runtime.ts"), "utf8");
assert.match(factory, /emitModelSelection\(execution, "(?:planning|implementation|verification|repair)"/, "mission stages emit model selection into execution info");
const missionCanvas = readFileSync(path.join(root, "components", "canvas", "MissionCanvas.tsx"), "utf8");
const canvasComposer = readFileSync(path.join(root, "components", "canvas", "CanvasComposer.tsx"), "utf8");
assert.match(missionCanvas, /Earlier project activity compacted into project memory/, "compacted history indicator is user-visible");
const reasonRoute = readFileSync(path.join(root, "app", "api", "reason", "route.ts"), "utf8");
assert.match(reasonRoute, /modelSelection/, "ordinary asks return model selection metadata");
const providerTypes = readFileSync(path.join(root, "lib", "ai", "providers", "types.ts"), "utf8");
assert.match(providerTypes, /type: "image"; dataUrl:/, "neutral provider protocol carries screenshot evidence");
assert.match(openai, /type: "input_image"/, "OpenAI adapter receives real image content");
assert.match(anthropic, /source: \{ type: "base64"/, "Anthropic adapter receives base64 image content");
assert.match(google, /inlineData: \{ mimeType:/, "Google adapter receives inline image content");
assert.match(canvasComposer, /accept="image\/\*"/, "project follow-up composer accepts screenshots");
assert.match(missionCanvas, /latestLiveEvent\(activeExecution\.timeline\)/, "mission canvas consumes recorded live events");
assert.doesNotMatch(missionCanvas, /mission\.liveWorkEvents/, "mission canvas never renders simulated live-work placeholders");
assert.match(factory, /evidenceImages,/, "screenshot evidence reaches mission execution");
assert.match(factory, /Working set selected:|Project discovery found no task-specific files/, "execution emits factual discovery results");
console.log(JSON.stringify({ passed: 27, rawTokens, fastTokens: fast.estimatedTokens, reductionPercent: Number(((1 - fast.estimatedTokens / rawTokens) * 100).toFixed(1)) }));
rmSync(out, { recursive: true, force: true });
