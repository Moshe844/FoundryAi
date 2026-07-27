import { describe, expect, it } from "vitest";

import { CapabilityRegistry } from "./capability-registry";
import { sameTierFallbacks, selectModel } from "./selector";
import type { RegisteredModel, TaskProfile } from "./types";

function model(overrides: Partial<RegisteredModel> & Pick<RegisteredModel, "provider" | "modelId" | "costClass">): RegisteredModel {
  return {
    displayName: overrides.modelId,
    status: "valid",
    available: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsVision: true,
    supportsReasoning: true,
    supportedEfforts: [],
    capabilities: { coding: 0.95, debugging: 0.95, architecture: 0.95, toolReliability: 0.95, longContext: 0.95, vision: 0.9, structuredOutput: 0.95, instructionFollowing: 0.95, reasoning: 0.95 },
    providerHealth: 1,
    tierFit: { fast: 0.9, builder: 0.9, architect: 0.9, "enterprise-architect": 0.9, "super-reasoning": 0.9 },
    freshness: 1,
    deprecated: false,
    latencyClass: overrides.costClass === "premium" ? "slow" : "fast",
    ...overrides,
  };
}

function profile(tier: TaskProfile["recommendedIntelligenceTier"]): TaskProfile {
  return {
    intent: "change",
    taskType: "project_creation",
    requestedOutcome: "Build a static website",
    scope: { estimatedFiles: 4, estimatedSubsystems: 1, crossLayer: false, projectWide: false },
    projectScale: 0,
    taskLocality: 0.9,
    difficulty: 0.3,
    ambiguity: 0.2,
    risk: 0.1,
    blastRadius: 0.2,
    contextNeed: 0.3,
    reasoningNeed: 0.3,
    toolUseNeed: 0.7,
    visualNeed: 1,
    verificationNeed: 0.6,
    reversibility: 0.9,
    failureHistory: 0,
    recommendedIntelligenceTier: tier,
    recommendedExecutionDepth: "standard",
    confidence: 0.95,
    reasons: ["bounded presentation work"],
  };
}

describe("routine model cost ceiling", () => {
  it("does not select Opus for builder work when it is the only model", () => {
    const registry = new CapabilityRegistry([model({ provider: "anthropic", modelId: "claude-opus-5", costClass: "premium" })]);
    expect(selectModel(profile("builder"), registry)).toBeUndefined();
  });

  it("does not include Opus as a fallback for fast work", () => {
    const primary = model({ provider: "openai", modelId: "gpt-mini", costClass: "low" });
    const opus = model({ provider: "anthropic", modelId: "claude-opus-5", costClass: "premium" });
    const registry = new CapabilityRegistry([primary, opus]);
    const decision = selectModel(profile("fast"), registry)!;
    expect(decision.model).toBe("gpt-mini");
    expect(sameTierFallbacks(decision, registry, profile("fast"))).toEqual([]);
  });

  it("still permits premium models for architect work", () => {
    const registry = new CapabilityRegistry([model({ provider: "anthropic", modelId: "claude-opus-5", costClass: "premium" })]);
    expect(selectModel(profile("architect"), registry)?.model).toBe("claude-opus-5");
  });
});
