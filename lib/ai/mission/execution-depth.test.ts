import { describe, expect, it } from "vitest";

import { DEPTH_ORDER, depthPolicy, tierWithinDepth, type ExecutionDepthPolicy } from "./execution-depth";
import { tierForStage } from "./orchestration";
import type { MissionQualityLevel } from "./quality-level";

const policies = DEPTH_ORDER.map((depth) => depthPolicy(depth));
const pairs = policies.slice(0, -1).map((lower, index) => [lower, policies[index + 1]] as const);

/** Every numeric dial the depth policy exposes, so a new one cannot be added without being checked. */
const NUMERIC_DIMENSIONS: Array<{ name: string; read: (policy: ExecutionDepthPolicy) => number }> = [
  { name: "context.maxFiles", read: (policy) => policy.context.maxFiles },
  { name: "context.maxBytes", read: (policy) => policy.context.maxBytes },
  { name: "planning.maxChecklistItems", read: (policy) => policy.planning.maxChecklistItems },
  { name: "retry.maxRepairStages", read: (policy) => policy.retry.maxRepairStages },
  { name: "retry.maxContinuationBatches", read: (policy) => policy.retry.maxContinuationBatches },
  { name: "budget.maximumModelCalls", read: (policy) => policy.budget.maximumModelCalls },
  { name: "budget.estimatedCostUsd", read: (policy) => policy.budget.estimatedCostUsd },
  { name: "budget.premiumCallLimit", read: (policy) => policy.budget.premiumCallLimit },
];

/** Every switch, grouped by the dimension it belongs to. */
const BOOLEAN_DIMENSIONS: Array<{ name: string; read: (policy: ExecutionDepthPolicy) => boolean[] }> = [
  { name: "planning", read: (policy) => [policy.planning.runPlanner] },
  {
    name: "verification",
    read: (policy) => [
      policy.verification.runVerifyStage,
      policy.verification.requireBrowserEvidence,
      policy.verification.runRegressionChecks,
      policy.verification.runSecurityAndDependencyChecks,
    ],
  },
  { name: "review", read: (policy) => [policy.review.runArchitectureReview, policy.review.runCriticalDiffReview] },
  { name: "behavior", read: (policy) => [policy.behavior.baselineBeforeChange, policy.behavior.liveWorkflowTesting, policy.behavior.rollbackPlan] },
];

describe("no dimension is decoration", () => {
  it.each(NUMERIC_DIMENSIONS)("scales $name across every depth", ({ read }) => {
    // Strictly increasing: if any two depths shared a value, choosing between them would buy nothing.
    for (const [lower, higher] of pairs) {
      expect(read(higher)).toBeGreaterThan(read(lower));
    }
  });

  it.each(BOOLEAN_DIMENSIONS)("never weakens $name as the depth rises", ({ read }) => {
    for (const [lower, higher] of pairs) {
      read(lower).forEach((enabled, index) => {
        if (enabled) expect(read(higher)[index]).toBe(true);
      });
    }
  });

  it.each(BOOLEAN_DIMENSIONS)("changes $name somewhere between the shallowest and deepest depth", ({ read }) => {
    expect(read(policies[0])).not.toEqual(read(policies[policies.length - 1]));
  });

  it("changes model capability across depths", () => {
    expect(depthPolicy("quick").maximumTier).not.toBe(depthPolicy("production").maximumTier);
  });
});

describe("the depth is a real ceiling", () => {
  it("caps a stage that wants more reasoning than the depth allows", () => {
    // A critical diagnosis prefers the top tier; a Quick mission is the user choosing not to pay for it.
    const preferred = tierForStage("diagnose", "quick", "critical");
    expect(preferred).toBe("super-reasoning");
    expect(tierWithinDepth(preferred, "quick")).toBe("builder");
  });

  it("lets a production mission reach the top tier", () => {
    expect(tierWithinDepth(tierForStage("diagnose", "production", "critical"), "production")).toBe("super-reasoning");
  });

  it("never raises a cheap stage just because the depth is deep", () => {
    // Depth is a ceiling, not a floor — a summary stays cheap on a Production mission.
    expect(tierWithinDepth(tierForStage("summarize", "production", "critical"), "production")).toBe("fast");
    expect(tierWithinDepth("fast", "production")).toBe("fast");
  });

  it("caps architecture work on a standard mission", () => {
    expect(tierForStage("architecture", "standard", "critical")).toBe("enterprise-architect");
    expect(tierWithinDepth("enterprise-architect", "standard")).toBe("architect");
  });
});

describe("depth policy lookup", () => {
  it("returns the matching policy for each depth", () => {
    for (const depth of DEPTH_ORDER) {
      expect(depthPolicy(depth).depth).toBe(depth);
    }
  });

  it("falls back to standard for an unrecognised depth", () => {
    expect(depthPolicy("unknown" as MissionQualityLevel).depth).toBe("standard");
  });
});

describe("agreement with the stage router", () => {
  it("matches the review and verify stages the orchestration already gates on quality", () => {
    // Two sources describing the same decision must not disagree about it.
    expect(depthPolicy("quick").review.runArchitectureReview).toBe(false);
    expect(depthPolicy("standard").review.runArchitectureReview).toBe(false);
    expect(depthPolicy("thorough").review.runArchitectureReview).toBe(true);
    expect(depthPolicy("production").review.runArchitectureReview).toBe(true);

    expect(depthPolicy("quick").verification.runVerifyStage).toBe(false);
    expect(depthPolicy("standard").verification.runVerifyStage).toBe(false);
    expect(depthPolicy("thorough").verification.runVerifyStage).toBe(true);
    expect(depthPolicy("production").verification.runVerifyStage).toBe(true);
  });
});
