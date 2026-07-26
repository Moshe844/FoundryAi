import { describe, expect, it } from "vitest";

import { applyObservedEvidence, evidenceWeight, normalizeFreshness, observedSignals } from "./model-evidence";
import type { ModelStageFeedback } from "./telemetry";
import type { ProviderId, RegisteredModel } from "./types";

function feedback(overrides: Partial<ModelStageFeedback> & Pick<ModelStageFeedback, "provider" | "model">): ModelStageFeedback {
  return {
    key: `${overrides.stage ?? "implement"}::${overrides.provider}::${overrides.model}`,
    stage: "implement",
    tier: "architect",
    calls: 10,
    acceptanceRate: 1,
    fallbackRate: 0,
    meanLatencyMs: 4_000,
    meanCostUsd: 0.02,
    contributionRate: 1,
    ...overrides,
  };
}

function model(modelId: string, provider: ProviderId = "openai", capabilities: Partial<RegisteredModel["capabilities"]> = {}): RegisteredModel {
  return {
    provider,
    modelId,
    displayName: modelId,
    status: "discovered",
    available: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsVision: true,
    supportsReasoning: true,
    supportedEfforts: [],
    costClass: "high",
    latencyClass: "normal",
    capabilities: { coding: 0.88, debugging: 0.88, architecture: 0.84, toolReliability: 0.88, longContext: 0.86, vision: 0.7, structuredOutput: 0.88, instructionFollowing: 0.88, reasoning: 0.86, ...capabilities },
    providerHealth: 1,
    tierFit: { fast: 0.62, builder: 0.92, architect: 0.82, "enterprise-architect": 0.7, "super-reasoning": 0.62 },
    freshness: 0.5,
    deprecated: false,
  };
}

describe("evidence gains influence as it accumulates", () => {
  it("barely moves a rating on a single observation", () => {
    expect(evidenceWeight(1)).toBeLessThan(0.2);
  });

  it("governs once there are many", () => {
    expect(evidenceWeight(100)).toBeGreaterThan(0.9);
  });

  it("leaves a model with no history exactly as inferred", () => {
    const prior = model("brand-new-model");
    expect(applyObservedEvidence(prior, undefined)).toBe(prior);
  });
});

describe("a model is rated by what it delivered", () => {
  const signals = (entries: ModelStageFeedback[]) => observedSignals(entries);

  it("raises a model whose work consistently survives into finished missions", () => {
    const [signal] = [...signals([feedback({ provider: "openai", model: "gpt-5.5", calls: 200, contributionRate: 1, acceptanceRate: 1 })]).values()];
    const rated = applyObservedEvidence(model("gpt-5.5"), signal);
    // A frontier model whose name contains none of the "premium" words was previously capped at 0.84
    // architecture and locked out of the top tiers no matter how well it performed.
    expect(rated.capabilities.architecture).toBeGreaterThan(0.84);
    expect(rated.capabilities.reasoning).toBeGreaterThan(0.86);
  });

  it("lowers a model whose work keeps getting discarded", () => {
    const [signal] = [...signals([feedback({ provider: "google", model: "some-pro-model", calls: 200, contributionRate: 0.1, acceptanceRate: 0.4 })]).values()];
    const rated = applyObservedEvidence(model("some-pro-model", "google", { architecture: 0.94, reasoning: 0.96 }), signal);
    expect(rated.capabilities.architecture).toBeLessThan(0.94);
    expect(rated.capabilities.toolReliability).toBeLessThan(0.88);
  });

  it("separates two models that name-based inference rated identically", () => {
    // The exact defect: gemini-pro-latest and an Opus model inferred to byte-identical capabilities,
    // so the selector could not tell them apart and fell through to a freshness tiebreak.
    const strong = [...signals([feedback({ provider: "anthropic", model: "claude-opus-5", calls: 60, contributionRate: 0.95 })]).values()][0];
    const weak = [...signals([feedback({ provider: "google", model: "gemini-pro-latest", calls: 60, contributionRate: 0.35 })]).values()][0];

    const opus = applyObservedEvidence(model("claude-opus-5", "anthropic", { architecture: 0.94, reasoning: 0.96 }), strong);
    const gemini = applyObservedEvidence(model("gemini-pro-latest", "google", { architecture: 0.94, reasoning: 0.96 }), weak);

    expect(opus.capabilities.architecture).toBeGreaterThan(gemini.capabilities.architecture);
    expect(opus.capabilities.reasoning).toBeGreaterThan(gemini.capabilities.reasoning);
  });

  it("never lets a run of luck promote a weak model without limit", () => {
    const [signal] = [...signals([feedback({ provider: "openai", model: "tiny", calls: 5_000, contributionRate: 1 })]).values()];
    const rated = applyObservedEvidence(model("tiny", "openai", { architecture: 0.4, reasoning: 0.4 }), signal);
    // Bounded movement: evidence corrects a bad guess, it does not rewrite a model's nature.
    expect(rated.capabilities.architecture).toBeLessThanOrEqual(0.4 + 0.18 + 1e-6);
  });

  it("records measured cost and latency instead of guessing them", () => {
    const [signal] = [...signals([feedback({ provider: "openai", model: "m", meanLatencyMs: 800, meanCostUsd: 0.0123 })]).values()];
    const rated = applyObservedEvidence(model("m"), signal);
    expect(rated.latencyClass).toBe("instant");
    expect(rated.observedCostUsdPerCall).toBeCloseTo(0.0123, 6);
    expect(rated.observations).toBe(10);
  });

  it("weights a stage by how often it was actually used", () => {
    const merged = [...observedSignals([
      feedback({ provider: "openai", model: "m", stage: "implement", calls: 100, acceptanceRate: 1 }),
      feedback({ provider: "openai", model: "m", stage: "verify", calls: 2, acceptanceRate: 0 }),
    ]).values()][0];
    // Two samples must not outvote a hundred.
    expect(merged.observations).toBe(102);
    expect(merged.acceptanceRate).toBeGreaterThan(0.95);
  });
});

describe("freshness ranks within a provider's own line-up", () => {
  it("no longer ranks a newer model below an older one", () => {
    // opus-5 scored 0.833 and opus-4-6 scored 1.0 under the old rule, because the last number in the id
    // was divided by six.
    const ranked = normalizeFreshness([model("claude-opus-5", "anthropic"), model("claude-opus-4-6", "anthropic")]);
    const five = ranked.find((entry) => entry.modelId === "claude-opus-5")!;
    const fourSix = ranked.find((entry) => entry.modelId === "claude-opus-4-6")!;
    expect(five.freshness).toBeGreaterThan(fourSix.freshness);
  });

  it("stops an alias outscoring the newest named model", () => {
    // An id ending in "latest" was hardcoded to 1.0, which is how it won the tiebreak that decided the
    // top tier. An alias tracks the current model — it is never ahead of it.
    const ranked = normalizeFreshness([model("gemini-pro-latest", "google"), model("gemini-3-5", "google")]);
    const alias = ranked.find((entry) => entry.modelId === "gemini-pro-latest")!;
    const named = ranked.find((entry) => entry.modelId === "gemini-3-5")!;
    expect(alias.freshness).toBeLessThanOrEqual(named.freshness);
  });

  it("compares only within a provider", () => {
    const ranked = normalizeFreshness([model("gpt-5.5", "openai"), model("claude-opus-5", "anthropic")]);
    // Each is the newest its provider offers, so both are current.
    expect(ranked.every((entry) => entry.freshness === 1)).toBe(true);
  });

  it("orders date-stamped snapshots against each other", () => {
    const ranked = normalizeFreshness([model("gpt-5-2025-08-07", "openai"), model("gpt-5-2026-02-01", "openai")]);
    const older = ranked.find((entry) => entry.modelId === "gpt-5-2025-08-07")!;
    const newer = ranked.find((entry) => entry.modelId === "gpt-5-2026-02-01")!;
    expect(newer.freshness).toBeGreaterThan(older.freshness);
  });
});
