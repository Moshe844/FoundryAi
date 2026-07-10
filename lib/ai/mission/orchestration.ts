import type { ModelTier } from "@/lib/ai/model-router";
import type { MissionQualityLevel } from "@/lib/ai/mission/quality-level";

export type MissionComplexity = "trivial" | "small" | "medium" | "large" | "critical";

export type MissionStage = "discover" | "plan" | "review" | "implement" | "verify";

/**
 * Centralizes the already-computed real signals (mission-planner.ts's isHighRiskArchitectureRequest/
 * isMultiPartRequest, runtime.ts's distinct-phase count and stack capability level, and a project
 * file count) into one complexity bucket, instead of every call site re-deriving its own notion of
 * "how big is this." Callers pass in signals they already compute — this never re-derives them.
 */
export function assessMissionComplexity(input: {
  highRisk: boolean;
  multiPart: boolean;
  distinctPhases: number;
  stackCapabilityLevel: number;
  fileCount: number;
}): MissionComplexity {
  if (input.highRisk && input.distinctPhases >= 2) return "critical";
  if (input.highRisk || (input.multiPart && input.distinctPhases >= 2)) return "large";
  if (input.multiPart || input.distinctPhases >= 2 || input.fileCount > 200) return "medium";
  if (input.fileCount > 20) return "small";
  return "trivial";
}

/**
 * The Cost Optimization mapping: never spend a premium tier on cheap work, reserve it for the stages
 * and complexity levels that actually need it. Quality level scales how far each stage is willing to
 * go; complexity only ever pushes implement up to architect, never down.
 */
export function tierForStage(stage: MissionStage, quality: MissionQualityLevel, complexity: MissionComplexity): ModelTier {
  if (stage === "discover") return "fast";

  if (stage === "plan") {
    if (quality === "quick") return "fast";
    if (quality === "standard") return "builder";
    return "architect";
  }

  if (stage === "review") return "architect";

  if (stage === "implement") {
    if (quality === "quick") return "fast";
    if (complexity === "large" || complexity === "critical") return "architect";
    return "builder";
  }

  // verify
  return "fast";
}

/** Whether the Architecture Review stage should run at all for this mission — advisory-only, skipped entirely (zero cost/behavior change) unless quality and complexity both justify it. */
export function shouldRunArchitectureReview(quality: MissionQualityLevel, complexity: MissionComplexity, highRisk: boolean): boolean {
  if (quality !== "thorough" && quality !== "production") return false;
  return highRisk || complexity === "medium" || complexity === "large" || complexity === "critical";
}

/** Whether the Verify stage should run at all — quick/standard skip it entirely, matching today's behavior/cost exactly. */
export function shouldRunVerify(quality: MissionQualityLevel): boolean {
  return quality === "thorough" || quality === "production";
}
