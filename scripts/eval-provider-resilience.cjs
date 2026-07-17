const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dispatch = read("lib/ai/providers/dispatch.ts");
const executor = read("lib/ai/mission/executor.ts");
const adapter = read("lib/canvas/adapter.ts");
const missionBlock = read("components/canvas/MissionBlock.tsx");
const factoryRuntime = read("lib/factory/runtime.ts");
const openaiRuntime = read("lib/ai/providers/openai-runtime.ts");
const foundryRuntime = read("lib/ai/foundry-runtime.ts");
const costGuard = read("lib/ai/routing/cost-guard.ts");
const canvasModel = read("lib/canvas/model.ts");
const executionTimeline = read("components/execution/ExecutionTimeline.tsx");

assert(
  dispatch.includes("providerFallbackWindowMs(candidateTimeoutMs, candidates.length)"),
  "Fallback providers still share one undersized logical timeout.",
);
assert(
  !dispatch.includes("Math.floor(logicalTimeoutMs / Math.max(1, candidates.length))"),
  "Provider attempt time is still divided by fallback count.",
);
assert(
  dispatch.includes("All configured provider attempts timed out before returning a usable action"),
  "All-timeout failures are not reported precisely.",
);
assert(
  dispatch.includes("Configured providers could not be reached"),
  "Connection failures are not distinguished from timeouts.",
);
assert(
  executor.includes('timedOut ? "AI provider attempts timed out" : "AI providers unavailable"'),
  "The mission terminal title still labels every transport failure as provider unavailability.",
);
assert(
  executor.includes("input.staticProject ? 90_000 : input.fastLane ? 60_000 : 160_000"),
  "Existing static implementation calls do not receive a full coding-model attempt window.",
);
assert(
  adapter.includes("const eventTimes = execution.timeline") && adapter.includes("eventTimes.length >= 2"),
  "Terminal elapsed time is not based on recorded execution events.",
);
assert(
  missionBlock.includes("vm.summary?.elapsedMs"),
  "The mission canvas ignores evidence-based terminal elapsed time.",
);
assert(
  factoryRuntime.includes("const mutationReadyWorkingSet = boundedCoordinatedEdit || boundedStaticFollowUp")
    && factoryRuntime.includes("const boundedWorkingSetEvidence = mutationReadyWorkingSet"),
  "A known bounded static working set can still enter paid model discovery without deterministic source evidence.",
);
assert(
  factoryRuntime.includes("shouldRunVerify(quality) && !boundedStaticFollowUp")
    && factoryRuntime.includes("const boundedStaticChangeNeedsBrowserVerification")
    && factoryRuntime.includes("budgetBoundaryNeedsWebVerification || boundedStaticChangeNeedsBrowserVerification"),
  "A bounded static edit can still buy a model verification turn instead of using the deterministic browser gate.",
);
assert(
  executor.includes("let inspectedExistingProject = Boolean(input.initialProjectEvidence)")
    && executor.includes("turnTools.filter((tool) => tool.name === forcedMutationRecovery)"),
  "Runtime-supplied source evidence does not force the first model action to mutate the project.",
);
assert(
  executor.includes("input.staticProject && input.initialProjectEvidence && presentationChangeRequired")
    && executor.includes("input.initialProjectEvidence && input.requireFirstMutation"),
  "A bounded static presentation rewrite can still spend paid turns on discovery or wrap-up narration.",
);
assert(
  executor.includes("already billed (estimated $") && executor.includes("without producing a verified file change"),
  "Execution-limit handoffs still conceal paid calls that produced no verified edit.",
);
assert(
  dispatch.includes("No fallback call was sent") && dispatch.includes("did not produce the required executable action"),
  "A paid unusable action is still hidden behind the later fallback cost-guard message.",
);
assert(
  executor.includes('["read_file", "replace_in_file", "write_file"')
    && dispatch.includes("required tool ${requiredToolName} was not advertised")
    && dispatch.includes("provider call was prevented before billing"),
  "A forced static rewrite can still send a paid request without advertising its required tool.",
);
assert(
  openaiRuntime.includes("request.tools?.length")
    && foundryRuntime.includes("billable: Boolean(lastData.usage)")
    && foundryRuntime.includes("requestCount: input.billable ? 1 : 0")
    && executor.includes("if (result.usage.requestCount > 0) modelCallsSinceDurableProgress += 1")
    && costGuard.includes("ledger.calls = Math.max(0, ledger.calls - 1)"),
  "Rejected zero-usage provider requests can still be reported as billed or consume the task call allowance.",
);
assert(
  costGuard.includes("fast: { maximumModelCalls: 12")
    && costGuard.includes("builder: { maximumModelCalls: 24")
    && !factoryRuntime.includes("boundedStaticFollowUp ? { maximumModelCalls: 3"),
  "Ordinary tasks are still governed by the old three/four-call hard cutoff.",
);
assert(
  /"Model route selected",\s*\{\s*internal:\s*true/.test(factoryRuntime)
    && !factoryRuntime.includes("capabilityDisclosureLine(stackProfile)")
    && canvasModel.includes("isInternalExecutionEvent")
    && canvasModel.includes("I'm at Level")
    && executionTimeline.includes("if (isInternalExecutionEvent(event)) return false"),
  "Internal model routing or capability-level metadata can still leak into the user conversation.",
);
assert(
  executor.includes("Verified static edit ready for browser validation")
    && executor.includes('return finalize("passed", undefined, turn)')
    && executor.includes("redesign|overhaul|rewrite|rebuild|replace")
    && factoryRuntime.includes("const boundedStaticWriteAwaitingBrowser = boundedStaticFollowUp")
    && factoryRuntime.includes("boundedStaticWholeRewrite ? 16_000 : boundedStaticFollowUp ? 3_000")
    && factoryRuntime.includes("Verified static edit handed to browser validation"),
  "A localized static visual edit can still buy narration/server turns or become a false terminal failure after a verified write.",
);

console.log("Provider resilience regression checks passed.");
