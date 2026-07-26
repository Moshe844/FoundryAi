import { describe, expect, it } from "vitest";

import { assessMissionComplexity, stageUsesModel, tierForStage, type MissionStage } from "./orchestration";
import { createExecutionStrategy, tierForCapability, type MissionSignals } from "./execution-strategy";

const RANK = { fast: 1, builder: 2, architect: 3, "enterprise-architect": 4, "super-reasoning": 5 } as const;

const ALL_STAGES: MissionStage[] = [
  "understand", "search", "discover", "plan", "architecture", "review",
  "implement", "repetitive", "diagnose", "build", "interpret-failure", "verify", "summarize",
];

describe("every stage routes independently", () => {
  it("gives each stage a defined tier at every quality level", () => {
    for (const stage of ALL_STAGES) {
      for (const quality of ["quick", "standard", "thorough", "production"] as const) {
        expect(RANK[tierForStage(stage, quality, "medium")]).toBeGreaterThan(0);
      }
    }
  });

  it("spends no model tokens on running builds and tests", () => {
    expect(stageUsesModel("build")).toBe(false);
    for (const stage of ALL_STAGES.filter((item) => item !== "build")) {
      expect(stageUsesModel(stage)).toBe(true);
    }
  });
});

describe("the strongest model does not stay active", () => {
  // The governing rule: one hard stage must not raise the price of the whole mission.
  it("keeps cheap stages cheap on a critical mission", () => {
    for (const stage of ["understand", "search", "discover", "verify", "summarize", "repetitive"] as const) {
      expect(tierForStage(stage, "production", "critical")).toBe("fast");
    }
  });

  it("de-escalates from diagnosis to implementation and then to the summary", () => {
    const diagnose = RANK[tierForStage("diagnose", "production", "critical")];
    const implement = RANK[tierForStage("implement", "production", "critical")];
    const summarize = RANK[tierForStage("summarize", "production", "critical")];

    expect(diagnose).toBeGreaterThan(implement);
    expect(implement).toBeGreaterThan(summarize);
  });

  it("writes the final report on the cheapest tier regardless of how hard the mission was", () => {
    for (const complexity of ["trivial", "small", "medium", "large", "critical"] as const) {
      expect(tierForStage("summarize", "production", complexity)).toBe("fast");
    }
  });
});

describe("intelligence goes where the difficulty is", () => {
  it("reserves the top tier for a critical diagnosis", () => {
    expect(tierForStage("diagnose", "standard", "critical")).toBe("super-reasoning");
    expect(tierForStage("diagnose", "standard", "medium")).toBe("architect");
  });

  it("buys breadth for critical architecture and nowhere else by default", () => {
    expect(tierForStage("architecture", "standard", "critical")).toBe("enterprise-architect");
    expect(tierForStage("architecture", "standard", "medium")).toBe("architect");
    expect(tierForStage("implement", "standard", "critical")).toBe("architect");
  });

  it("treats a repeated mechanical change as cheap however large the mission", () => {
    expect(tierForStage("repetitive", "production", "critical")).toBe("fast");
  });

  it("scales failure interpretation with how tangled the failure is likely to be", () => {
    expect(tierForStage("interpret-failure", "standard", "small")).toBe("builder");
    expect(tierForStage("interpret-failure", "standard", "large")).toBe("architect");
  });

  it("keeps a quick mission cheap even to implement", () => {
    expect(tierForStage("implement", "quick", "medium")).toBe("fast");
    expect(tierForStage("plan", "quick", "medium")).toBe("fast");
  });
});

describe("difficult diagnosis gets its own tier", () => {
  const signals = (overrides: Partial<MissionSignals> = {}): MissionSignals => ({
    kind: "existing-project",
    complexity: "medium",
    quality: "standard",
    fileCount: 120,
    estimatedArtifacts: 0,
    independentlyGeneratable: false,
    highRisk: false,
    securitySensitive: false,
    needsVisualValidation: false,
    repeatedFailures: 0,
    ...overrides,
  });

  it("assigns a debug tier instead of silently falling back", () => {
    // `debug` was a declared capability that no strategy assigned, so every lookup returned the
    // caller's fallback and difficult diagnosis never actually had a tier of its own.
    const strategy = createExecutionStrategy(signals());
    expect(strategy.stages.some((stage) => stage.capability === "debug")).toBe(true);
    expect(tierForCapability(strategy, "debug", "fast")).not.toBe("fast");
  });

  it("assigns one on a localized mission too", () => {
    const strategy = createExecutionStrategy(signals({ complexity: "trivial", fileCount: 4 }));
    expect(tierForCapability(strategy, "debug", "fast")).toBe("builder");
  });

  it("raises diagnosis after a repeated failure without raising implementation", () => {
    const strategy = createExecutionStrategy(signals({ complexity: "trivial", fileCount: 4, repeatedFailures: 1 }));
    expect(tierForCapability(strategy, "debug", "fast")).toBe("architect");
    expect(tierForCapability(strategy, "implement", "fast")).toBe("fast");
  });

  it("raises diagnosis for coupled or security-sensitive work", () => {
    expect(tierForCapability(createExecutionStrategy(signals({ complexity: "large" })), "debug", "fast")).toBe("architect");
    expect(tierForCapability(createExecutionStrategy(signals({ securitySensitive: true })), "debug", "fast")).toBe("architect");
  });
});

describe("repository size and task difficulty stay separate", () => {
  it("keeps a small change in a huge repository cheap", () => {
    // A 500,000-line project with one known CSS change is trivial work, and complexity is what routes.
    const complexity = assessMissionComplexity({ highRisk: false, multiPart: false, distinctPhases: 1, stackCapabilityLevel: 3, fileCount: 500_000 });
    expect(tierForStage("implement", "standard", complexity)).toBe("builder");
    expect(tierForStage("understand", "standard", complexity)).toBe("fast");
  });

  it("lets a small repository carry a hard problem", () => {
    const complexity = assessMissionComplexity({ highRisk: true, multiPart: false, distinctPhases: 2, stackCapabilityLevel: 2, fileCount: 30 });
    expect(complexity).toBe("critical");
    expect(tierForStage("diagnose", "standard", complexity)).toBe("super-reasoning");
  });
});
