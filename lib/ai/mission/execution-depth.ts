import type { ModelTier } from "@/lib/ai/model-router";
import type { MissionQualityLevel } from "@/lib/ai/mission/quality-level";

/**
 * What choosing a depth actually changes.
 *
 * The four depths were only partly real. Model capability, review depth and verification scope already
 * responded to them, but the retry limit came from an environment variable and the cost ceilings were
 * fixed constants — so picking Production over Quick bought no extra persistence and authorised no extra
 * spend, and picking Quick did not save any. A selector that does not change behavior is decoration.
 *
 * Every dimension the reliability contract names is settled here, in one place, so a depth cannot be
 * partially implemented: adding a dimension to this type forces a value for all four depths, and the
 * tests assert that no dimension is flat across them.
 */
export type ExecutionDepthPolicy = {
  depth: MissionQualityLevel;

  /** 1. Model capability — the strongest tier this depth may buy, whatever a stage would prefer. */
  maximumTier: ModelTier;

  /** 2. Context budget — how much of the project may be gathered before working. */
  context: { maxFiles: number; maxBytes: number };

  /** 3. Planning depth. */
  planning: { runPlanner: boolean; maxChecklistItems: number };

  /** 4. Verification scope. */
  verification: {
    runVerifyStage: boolean;
    requireBrowserEvidence: boolean;
    runRegressionChecks: boolean;
    runSecurityAndDependencyChecks: boolean;
  };

  /** 5. Review depth. */
  review: { runArchitectureReview: boolean; runCriticalDiffReview: boolean };

  /** 6. Retry strategy — how hard Foundry tries before reporting a blocker. */
  retry: { maxRepairStages: number; maxContinuationBatches: number; escalateAfterFailures: number };

  /**
   * 7. Cost budget for the whole mission.
   *
   * Declared but NOT applied as the mission's routing budget. It was, briefly, and that starved work:
   * the tier budget already scales with the selected tier, and the depth already caps which tier may be
   * selected, so imposing a flat depth budget on top double-counted — a Standard mission routed at the
   * architect tier was funded for 24 calls instead of that tier's 32 and could run out mid-repair.
   *
   * Depth still governs spend through the tier ceiling (`tierWithinDepth`) and the retry limits below,
   * which are the dials that do not double-count. Wiring this figure needs a design that reconciles the
   * two budgets rather than stacking them.
   */
  budget: { maximumModelCalls: number; estimatedCostUsd: number; premiumCallLimit: number };

  /** 8. Execution behavior. */
  behavior: { baselineBeforeChange: boolean; liveWorkflowTesting: boolean; rollbackPlan: boolean };
};

const POLICIES: Record<MissionQualityLevel, ExecutionDepthPolicy> = {
  quick: {
    depth: "quick",
    // Targeted retrieval, minimal reasoning, a focused edit and a proportional check. Deliberately
    // cannot reach the architect tier: choosing Quick is choosing not to pay for deep reasoning.
    maximumTier: "builder",
    context: { maxFiles: 12, maxBytes: 200_000 },
    planning: { runPlanner: false, maxChecklistItems: 4 },
    verification: { runVerifyStage: false, requireBrowserEvidence: false, runRegressionChecks: false, runSecurityAndDependencyChecks: false },
    review: { runArchitectureReview: false, runCriticalDiffReview: false },
    retry: { maxRepairStages: 1, maxContinuationBatches: 1, escalateAfterFailures: 2 },
    budget: { maximumModelCalls: 8, estimatedCostUsd: 0.5, premiumCallLimit: 1 },
    behavior: { baselineBeforeChange: false, liveWorkflowTesting: false, rollbackPlan: false },
  },
  standard: {
    depth: "standard",
    maximumTier: "architect",
    context: { maxFiles: 40, maxBytes: 600_000 },
    planning: { runPlanner: true, maxChecklistItems: 8 },
    verification: { runVerifyStage: false, requireBrowserEvidence: true, runRegressionChecks: false, runSecurityAndDependencyChecks: false },
    review: { runArchitectureReview: false, runCriticalDiffReview: false },
    retry: { maxRepairStages: 2, maxContinuationBatches: 2, escalateAfterFailures: 1 },
    budget: { maximumModelCalls: 24, estimatedCostUsd: 2, premiumCallLimit: 2 },
    behavior: { baselineBeforeChange: false, liveWorkflowTesting: false, rollbackPlan: false },
  },
  thorough: {
    depth: "thorough",
    maximumTier: "architect",
    context: { maxFiles: 120, maxBytes: 2_000_000 },
    planning: { runPlanner: true, maxChecklistItems: 16 },
    verification: { runVerifyStage: true, requireBrowserEvidence: true, runRegressionChecks: true, runSecurityAndDependencyChecks: false },
    review: { runArchitectureReview: true, runCriticalDiffReview: true },
    retry: { maxRepairStages: 4, maxContinuationBatches: 3, escalateAfterFailures: 1 },
    budget: { maximumModelCalls: 40, estimatedCostUsd: 4, premiumCallLimit: 4 },
    behavior: { baselineBeforeChange: true, liveWorkflowTesting: false, rollbackPlan: false },
  },
  production: {
    depth: "production",
    // The only depth that may reach the top tier, and only because a production mission is the one
    // where a wrong answer is most expensive.
    maximumTier: "super-reasoning",
    context: { maxFiles: 400, maxBytes: 8_000_000 },
    planning: { runPlanner: true, maxChecklistItems: 40 },
    verification: { runVerifyStage: true, requireBrowserEvidence: true, runRegressionChecks: true, runSecurityAndDependencyChecks: true },
    review: { runArchitectureReview: true, runCriticalDiffReview: true },
    retry: { maxRepairStages: 6, maxContinuationBatches: 4, escalateAfterFailures: 1 },
    budget: { maximumModelCalls: 64, estimatedCostUsd: 8, premiumCallLimit: 6 },
    behavior: { baselineBeforeChange: true, liveWorkflowTesting: true, rollbackPlan: true },
  },
};

export function depthPolicy(depth: MissionQualityLevel): ExecutionDepthPolicy {
  return POLICIES[depth] ?? POLICIES.standard;
}

/** Depths in increasing order, so callers can compare two without re-deriving the ordering. */
export const DEPTH_ORDER: readonly MissionQualityLevel[] = ["quick", "standard", "thorough", "production"];

const TIER_RANK: Record<ModelTier, number> = { fast: 1, builder: 2, architect: 3, "enterprise-architect": 4, "super-reasoning": 5 };

/**
 * Caps a stage's preferred tier at what the chosen depth allows.
 *
 * This is what makes the depth a real ceiling rather than a suggestion: a Quick mission that hits a
 * stage wanting architect reasoning gets builder, because the user chose to trade depth for speed and
 * cost. Depth never *raises* a tier — a cheap stage stays cheap on a Production mission.
 */
export function tierWithinDepth(preferred: ModelTier, depth: MissionQualityLevel): ModelTier {
  const ceiling = depthPolicy(depth).maximumTier;
  return TIER_RANK[preferred] > TIER_RANK[ceiling] ? ceiling : preferred;
}
