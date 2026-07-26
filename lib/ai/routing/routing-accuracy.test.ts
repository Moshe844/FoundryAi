import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { describe, expect, it } from "vitest";

// Redirected before the telemetry module resolves a path, so logging assertions never write into the
// workspace's own routing data.
process.env.FOUNDRY_ROUTING_DATA_DIR = mkdtempSync(nodePath.join(tmpdir(), "foundry-routing-accuracy-"));

import { CapabilityRegistry } from "./capability-registry";
import { recordRoutingDecision, routingTelemetrySnapshot } from "./telemetry";
import { selectModel } from "./selector";
import { profileTask, type TaskContext } from "./task-profiler";
import type { DynamicTaskAssessment, ModelTier, ProviderId, RegisteredModel } from "./types";
import { deterministicMutationIntent } from "@/lib/ai/mission/intent-classifier";
import { assessMissionComplexity, tierForStage } from "@/lib/ai/mission/orchestration";

/**
 * Acceptance tests for routing.
 *
 * These drive the real path — the dynamic assessment a classifier produces, through profileTask, into
 * selectModel against a registry — rather than asserting on a shortcut. The scenarios are the ones the
 * routing contract names, expressed as the engineering facts a classifier would report about each. What
 * is asserted is the *decision*, never the wording of a request: routing that only worked for a
 * particular phrasing would be the keyword matching this whole design rejects.
 */

/** A neutral assessment. Each scenario overrides only the facts that make it what it is. */
function assessment(overrides: Partial<DynamicTaskAssessment> = {}): DynamicTaskAssessment {
  return {
    taskType: "edit",
    affectedScope: "few-files",
    estimatedFiles: 3,
    estimatedSubsystems: 1,
    difficulty: 0.4,
    uncertainty: 0.3,
    risk: 0.2,
    contextRequired: 0.4,
    securityOrPayment: false,
    migration: false,
    repetitive: false,
    projectCreation: false,
    independentReviewNeeded: false,
    visualOutcome: false,
    confidence: 0.9,
    reasons: [],
    source: "dynamic-fast-classifier",
    ...overrides,
  };
}

function tierFor(context: TaskContext): ModelTier {
  return profileTask(context).recommendedIntelligenceTier;
}

function model(overrides: Partial<RegisteredModel> & Pick<RegisteredModel, "provider" | "modelId">): RegisteredModel {
  return {
    displayName: overrides.modelId,
    status: "valid",
    available: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsVision: true,
    supportsReasoning: true,
    supportedEfforts: ["low", "medium", "high"],
    costClass: "medium",
    latencyClass: "normal",
    capabilities: { coding: 0.95, debugging: 0.95, architecture: 0.95, toolReliability: 0.95, longContext: 0.95, vision: 0.9, structuredOutput: 0.95, instructionFollowing: 0.95, reasoning: 0.95 },
    providerHealth: 1,
    tierFit: { fast: 0.9, builder: 0.9, architect: 0.9, "enterprise-architect": 0.9, "super-reasoning": 0.9 },
    freshness: 0.9,
    deprecated: false,
    ...overrides,
  };
}

/** One capable model per provider, so provider availability is the only variable in fallback tests. */
function registryOf(providers: ProviderId[]) {
  return new CapabilityRegistry(providers.map((provider) => model({ provider, modelId: `${provider}-capable` })));
}

describe("difficulty routes, not repository size", () => {
  it("keeps one known style change in a huge repository on the cheapest tier", () => {
    // 500,000 files, one localized edit. Scanning or escalating here is the waste the contract names.
    expect(tierFor({
      message: "change the save button colour",
      projectFileCount: 500_000,
      dynamicAssessment: assessment({ affectedScope: "single-location", estimatedFiles: 1, difficulty: 0.1, uncertainty: 0.1, risk: 0.05, contextRequired: 0.1 }),
    })).toBe("fast");
  });

  it("gives a hard concurrency bug in a tiny repository architect reasoning", () => {
    expect(tierFor({
      message: "sessions are being lost intermittently",
      projectFileCount: 30,
      dynamicAssessment: assessment({ taskType: "debug", difficulty: 0.85, uncertainty: 0.8, risk: 0.6, estimatedFiles: 4 }),
    })).toBe("architect");
  });
});

describe("ordinary work stays on the balanced tier", () => {
  it("routes a normal feature across several files to builder", () => {
    expect(tierFor({
      message: "add an export button to the reports page",
      projectFileCount: 800,
      dynamicAssessment: assessment({ estimatedFiles: 6, estimatedSubsystems: 2, difficulty: 0.5 }),
    })).toBe("builder");
  });

  it("routes a repeated mechanical change cheaply even across many files", () => {
    expect(tierFor({
      message: "rename the helper everywhere it is used",
      dynamicAssessment: assessment({ repetitive: true, estimatedFiles: 11, difficulty: 0.2, risk: 0.1 }),
    })).toBe("fast");
  });
});

describe("scale and criticality escalate", () => {
  it("routes a broad authentication redesign to the enterprise tier", () => {
    expect(tierFor({
      message: "redesign how authentication works across the product",
      dynamicAssessment: assessment({
        taskType: "migrate", migration: true, affectedScope: "project-wide",
        estimatedFiles: 40, estimatedSubsystems: 5, securityOrPayment: true, difficulty: 0.8, risk: 0.8,
      }),
    })).toBe("enterprise-architect");
  });

  it("routes a critical production incident to the strongest tier", () => {
    expect(tierFor({
      message: "checkout is failing in production and we cannot reproduce it",
      failureHistory: 2,
      dynamicAssessment: assessment({
        taskType: "debug", independentReviewNeeded: true,
        difficulty: 0.9, risk: 0.9, uncertainty: 0.7, estimatedSubsystems: 4, securityOrPayment: true,
      }),
    })).toBe("super-reasoning");
  });
});

describe("a question is answered, not executed", () => {
  it("does not read an explanation request as a mutation", () => {
    expect(deterministicMutationIntent("what does this function do?")).toBeUndefined();
    expect(deterministicMutationIntent("why did the build fail?")).toBeUndefined();
  });

  it("keeps a question cheap even inside an active mission", () => {
    // An expensive mission in progress must not make asking about it expensive.
    expect(tierFor({
      message: "what does the retry limit do?",
      activeMission: "Broad authentication redesign across every service",
      dynamicAssessment: assessment({ taskType: "explain", affectedScope: "single-file", estimatedFiles: 1, difficulty: 0.15, risk: 0.05 }),
    })).toBe("fast");
  });
});

describe("prior turns do not inflate the next one", () => {
  it("routes a simple follow-up cheaply after an expensive mission", () => {
    const tier = tierFor({
      message: "make it a bit darker",
      activeMission: "Critical production incident across authentication and payments",
      parentMission: "Broad migration of the whole platform",
      recentFollowUps: ["fix the concurrency bug", "resolve the data loss"],
      dynamicAssessment: assessment({ affectedScope: "single-location", estimatedFiles: 1, difficulty: 0.1, risk: 0.05 }),
    });
    // Inheriting the previous mission's tier is how a one-line tweak ends up costing architect money.
    expect(tier).toBe("fast");
  });

  it("de-escalates to routine implementation once the hard diagnosis is done", () => {
    const complexity = assessMissionComplexity({ highRisk: true, multiPart: false, distinctPhases: 2, stackCapabilityLevel: 3, fileCount: 400 });
    const rank: Record<ModelTier, number> = { fast: 1, builder: 2, architect: 3, "enterprise-architect": 4, "super-reasoning": 5 };

    expect(rank[tierForStage("diagnose", "standard", complexity)]).toBeGreaterThan(rank[tierForStage("implement", "standard", complexity)]);
    expect(rank[tierForStage("implement", "standard", complexity)]).toBeGreaterThan(rank[tierForStage("summarize", "standard", complexity)]);
  });
});

describe("failure escalates gradually", () => {
  const RANK: Record<ModelTier, number> = { fast: 1, builder: 2, architect: 3, "enterprise-architect": 4, "super-reasoning": 5 };
  const ordinary = {
    message: "the export button does nothing",
    dynamicAssessment: assessment({ taskType: "debug", estimatedFiles: 6, estimatedSubsystems: 2, difficulty: 0.5, risk: 0.35, uncertainty: 0.4 }),
  };
  const attempts = [0, 1, 2].map((failureHistory) => RANK[tierFor({ ...ordinary, failureHistory })]);

  it("starts an ordinary defect on the balanced tier", () => {
    expect(tierFor(ordinary)).toBe("builder");
  });

  it("keeps a bounded defect cheap while it is still bounded", () => {
    // A 3-file change with moderate difficulty is genuinely small work. Reading it as anything more
    // expensive would be the over-routing the contract warns against.
    expect(tierFor({ message: "the export button does nothing", dynamicAssessment: assessment({ taskType: "debug", estimatedFiles: 3, difficulty: 0.45, risk: 0.2 }) })).toBe("fast");
  });

  it("never steps down as failures accumulate", () => {
    expect(attempts).toEqual([...attempts].sort((left, right) => left - right));
  });

  it("does eventually escalate rather than retrying at the same strength forever", () => {
    expect(attempts[2]).toBeGreaterThan(attempts[0]);
  });

  it("never jumps to the strongest tier on ordinary repeated failure", () => {
    // Reserving the top tier for genuinely critical work is what stops repeated failure from becoming
    // an automatic escalator to the most expensive model available.
    expect(Math.max(...attempts)).toBeLessThan(RANK["super-reasoning"]);
  });
});

describe("a provider outage does not stop routing", () => {
  const profile = profileTask({ message: "add an export button", dynamicAssessment: assessment() });

  it("selects a compatible model from another provider when one is disabled", () => {
    const decision = selectModel(profile, registryOf(["openai", "anthropic", "google"]), { disabledProviders: ["openai"] });
    expect(decision).toBeDefined();
    expect(decision?.provider).not.toBe("openai");
  });

  it("still routes when only one provider remains configured", () => {
    const decision = selectModel(profile, registryOf(["google"]), { disabledProviders: ["openai", "anthropic"] });
    expect(decision?.provider).toBe("google");
  });

  it("keeps the requested tier while changing provider", () => {
    // Falling back must not quietly downgrade the work — the mission's requirements have not changed.
    const hard = profileTask({ message: "diagnose the outage", failureHistory: 2, dynamicAssessment: assessment({ taskType: "debug", difficulty: 0.9, risk: 0.9, uncertainty: 0.7, estimatedSubsystems: 4, securityOrPayment: true, independentReviewNeeded: true }) });
    const full = selectModel(hard, registryOf(["openai", "anthropic"]));
    const degraded = selectModel(hard, registryOf(["openai", "anthropic"]), { disabledProviders: ["openai"] });
    expect(degraded?.tier).toBe(full?.tier);
    expect(degraded?.provider).toBe("anthropic");
  });

  it("routes an unhealthy-but-only candidate rather than refusing entirely", () => {
    const unhealthy = new CapabilityRegistry([model({ provider: "openai", modelId: "degraded", available: false, providerHealth: 0.2 })]);
    // Refusing to route bricks the mission; the least-unhealthy option is the honest last resort.
    expect(selectModel(profile, unhealthy)).toBeUndefined();
    expect(selectModel(profile, unhealthy, { includeUnavailable: true })?.model).toBe("degraded");
  });
});

describe("every decision is inspectable", () => {
  it("carries the reason that produced it", () => {
    const profile = profileTask({ message: "add an export button", dynamicAssessment: assessment({ reasons: ["bounded feature work across two files"] }) });
    const decision = selectModel(profile, registryOf(["openai"]));
    expect(decision?.reason).toContain("bounded feature work across two files");
    expect(decision?.tier).toBeDefined();
    expect(decision?.model).toBeDefined();
  });

  it("logs the decision with the assessment that justified it", async () => {
    // "Routing decisions must be logged and testable" — a decision nobody can read back afterwards
    // cannot be audited for accuracy or cost, which is what makes the rest of this suite meaningful.
    const profile = profileTask({ message: "diagnose the outage", dynamicAssessment: assessment({ taskType: "debug", difficulty: 0.85, risk: 0.6, uncertainty: 0.8 }) });
    const decision = selectModel(profile, registryOf(["openai"]));
    expect(decision).toBeDefined();

    await recordRoutingDecision(decision!, profile, { missionId: "accuracy-suite" });
    const logged = (await routingTelemetrySnapshot()).recent.find((record) => record.missionId === "accuracy-suite");

    expect(logged?.tier).toBe(decision!.tier);
    expect(logged?.model).toBe(decision!.model);
    expect(logged?.reason).toBe(decision!.reason);
    // The facts behind the choice are recorded too, so a wrong route can be diagnosed rather than guessed at.
    expect(logged?.assessment.difficulty).toBeCloseTo(0.85, 5);
    expect(logged?.assessment.risk).toBeCloseTo(0.6, 5);
  });

  it("prefers the cheapest candidate that clears the capability gate", () => {
    const registry = new CapabilityRegistry([
      model({ provider: "openai", modelId: "expensive", costClass: "premium" }),
      model({ provider: "anthropic", modelId: "cheap", costClass: "low" }),
    ]);
    const profile = profileTask({ message: "add an export button", dynamicAssessment: assessment() });
    expect(selectModel(profile, registry)?.model).toBe("cheap");
  });
});
