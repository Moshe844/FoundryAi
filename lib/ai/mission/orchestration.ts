import type { ModelTier } from "@/lib/ai/model-router";
import type { MissionQualityLevel } from "@/lib/ai/mission/quality-level";

export type MissionComplexity = "trivial" | "small" | "medium" | "large" | "critical";

/**
 * The stages a mission routes independently.
 *
 * One mission uses several different models, and the rule that matters is that the strongest one does
 * not stay active for the whole run merely because a single stage needed it. Each stage below names a
 * distinct kind of work with its own intelligence requirement, so a hard diagnosis can buy architect
 * reasoning and the routine implementation and summary that follow still cost what they should.
 */
export type MissionStage =
  /** Extracting every requirement from the request. The fastest model that can do so exhaustively. */
  | "understand"
  /** Locating relevant files. Deterministic tools first, a cheap model at most. */
  | "search"
  | "discover"
  | "plan"
  /** Designing structure across subsystems, rather than sequencing known work. */
  | "architecture"
  | "review"
  | "implement"
  /** The same mechanical change applied repeatedly. Never worth premium reasoning. */
  | "repetitive"
  /** Working out why something genuinely difficult is failing. */
  | "diagnose"
  /** Running builds, tests and commands. Deterministic — no model tokens are spent here. */
  | "build"
  /** Reading a failure and deciding what it means. */
  | "interpret-failure"
  | "verify"
  /** Reporting the outcome, grounded entirely in the Execution Journal. */
  | "summarize";

/**
 * Stages that spend no model tokens at all.
 *
 * Running a build is the Runtime's job. Paying a model to do work a deterministic tool already does
 * exactly is the clearest form of waste there is, so this is enforced rather than left to judgment.
 */
export function stageUsesModel(stage: MissionStage): boolean {
  return stage !== "build";
}

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
  // Cheap by construction. Locating files, extracting requirements, running checks and writing the
  // final report are all bounded work whose quality does not improve with a stronger model — and the
  // summary in particular is written from the Execution Journal, which is already established fact.
  if (stage === "discover" || stage === "search" || stage === "understand" || stage === "verify" || stage === "summarize") return "fast";

  // The same mechanical edit repeated is a transformation, not a reasoning problem, however large the
  // surrounding mission is. This is deliberately not scaled by complexity.
  if (stage === "repetitive") return "fast";

  // Deterministic. Included so a caller asking for a tier still gets a defined answer, but
  // stageUsesModel(stage) is false and nothing should be routed for it.
  if (stage === "build") return "fast";

  if (stage === "plan") {
    if (quality === "quick") return "fast";
    if (quality === "standard") return "builder";
    return "architect";
  }

  // Designing structure across subsystems is the one stage where breadth genuinely pays, so a critical
  // mission may buy the enterprise tier here — and nowhere else by default.
  if (stage === "architecture") return complexity === "critical" ? "enterprise-architect" : "architect";

  if (stage === "review") return "architect";

  // A genuinely difficult diagnosis is what strong reasoning is for. A critical one, where a wrong
  // answer is expensive and the evidence is ambiguous, is the narrow case for the top tier.
  if (stage === "diagnose") return complexity === "critical" ? "super-reasoning" : "architect";

  // Reading a failure scales with how tangled the failure is likely to be — most are ordinary.
  if (stage === "interpret-failure") return complexity === "large" || complexity === "critical" ? "architect" : "builder";

  // implement
  if (quality === "quick") return "fast";
  if (complexity === "large" || complexity === "critical") return "architect";
  return "builder";
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
