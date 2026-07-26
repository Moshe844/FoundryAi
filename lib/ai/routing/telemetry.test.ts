import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordProviderCall, recordStageOutcome, routingFeedbackSnapshot } from "./telemetry";
import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";

// An isolated directory per run. These files are real operational data in a live workspace —
// provider-calls.ndjson is what the spend ledger reconciles the day's cost from — so a test must
// never write to, or truncate, the workspace's own copies.
const routingRoot = mkdtempSync(path.join(tmpdir(), "foundry-routing-telemetry-"));
process.env.FOUNDRY_ROUTING_DATA_DIR = routingRoot;

function usage(overrides: Partial<RuntimeUsageRecord> = {}): RuntimeUsageRecord {
  return {
    provider: "openai",
    workspaceId: "w",
    userId: "u",
    model: "test-model",
    requestedModel: "test-model",
    inputTokens: 1_000,
    outputTokens: 200,
    totalTokens: 1_200,
    estimatedCostUsd: 0.01,
    requestCount: 1,
    rateLimitCount: 0,
    failureCount: 0,
    contextCompressed: false,
    cached: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as RuntimeUsageRecord;
}

const call = (overrides: Partial<Parameters<typeof recordProviderCall>[0]> = {}) => recordProviderCall({
  requestId: "r1",
  missionId: "m1",
  stage: "implement",
  tier: "builder",
  provider: "openai",
  model: "test-model",
  reason: "routine implementation",
  estimatedCostUsd: 0.01,
  usage: usage(),
  latencyMs: 1_000,
  outcome: "accepted",
  attempt: 1,
  ...overrides,
});

async function cleanup() {
  await Promise.all([
    rm(path.join(routingRoot, "provider-calls.ndjson"), { force: true }),
    rm(path.join(routingRoot, "stage-outcomes.ndjson"), { force: true }),
  ]);
}

beforeEach(cleanup);
afterEach(cleanup);

describe("what a call record now carries", () => {
  it("records latency, outcome and which attempt answered", async () => {
    await call({ latencyMs: 2_400, outcome: "wrong-shape", attempt: 2 });
    const [entry] = await routingFeedbackSnapshot();

    expect(entry.meanLatencyMs).toBe(2_400);
    expect(entry.acceptanceRate).toBe(0);
    // A fallback answering the call is a fact about the primary model, not a detail to discard.
    expect(entry.fallbackRate).toBe(1);
  });

  it("separates an unsuitable response from an unavailable provider", async () => {
    await call({ outcome: "wrong-shape" });
    await call({ outcome: "provider-error" });
    const [entry] = await routingFeedbackSnapshot();
    expect(entry.calls).toBe(2);
    expect(entry.acceptanceRate).toBe(0);
  });

  it("averages latency and cost across calls", async () => {
    await call({ latencyMs: 1_000, usage: usage({ estimatedCostUsd: 0.02 }) });
    await call({ latencyMs: 3_000, usage: usage({ estimatedCostUsd: 0.04 }) });
    const [entry] = await routingFeedbackSnapshot();
    expect(entry.meanLatencyMs).toBe(2_000);
    expect(entry.meanCostUsd).toBeCloseTo(0.03, 6);
  });

  it("groups separately per stage and per model", async () => {
    await call({ stage: "implement" });
    await call({ stage: "verify", model: "cheap-model" });
    const snapshot = await routingFeedbackSnapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.map((entry) => entry.stage).sort()).toEqual(["implement", "verify"]);
  });
});

describe("whether the spend bought anything", () => {
  it("reports the share of a stage's work that reached the finished mission", async () => {
    await call({ stage: "implement" });
    await recordStageOutcome({ missionId: "m1", stage: "implement", tier: "builder", provider: "openai", model: "test-model", contributed: true, escalated: false, quality: "accepted" });
    await recordStageOutcome({ missionId: "m2", stage: "implement", tier: "builder", provider: "openai", model: "test-model", contributed: false, escalated: true, quality: "discarded" });

    const [entry] = await routingFeedbackSnapshot();
    // Half this stage's work was thrown away — the thing per-call cost alone can never show.
    expect(entry.contributionRate).toBe(0.5);
  });

  it("leaves contribution unknown rather than assuming it", async () => {
    await call({ stage: "implement" });
    const [entry] = await routingFeedbackSnapshot();
    // No outcome recorded yet is not the same as work that contributed nothing.
    expect(entry.contributionRate).toBeNull();
  });

  it("reports the call count beside every rate", async () => {
    await call();
    const [entry] = await routingFeedbackSnapshot();
    // A rate from one observation is noise; the count is what tells a caller whether to trust it.
    expect(entry.calls).toBe(1);
    expect(entry.acceptanceRate).toBe(1);
  });
});

describe("reading a record that predates the new fields", () => {
  it("treats an unlabelled call as an accepted first attempt", async () => {
    await call({ latencyMs: undefined, outcome: undefined, attempt: undefined });
    const [entry] = await routingFeedbackSnapshot();
    expect(entry.acceptanceRate).toBe(1);
    expect(entry.fallbackRate).toBe(0);
    expect(entry.meanLatencyMs).toBeNull();
  });

  it("returns nothing when no call has been recorded", async () => {
    expect(await routingFeedbackSnapshot()).toEqual([]);
  });
});
