export type ProviderId = "openai" | "anthropic" | "google";

export type ModelTier = "fast" | "builder" | "architect" | "enterprise-architect" | "super-reasoning";
export type ExecutionDepth = "quick" | "standard" | "thorough" | "production";
export type CostClass = "ultra-low" | "low" | "medium" | "high" | "premium";
export type LatencyClass = "instant" | "fast" | "normal" | "slow";
export type ModelStatus = "valid" | "discovered" | "unavailable" | "deprecated" | "permission-denied" | "unknown-alias" | "missing-api-key" | "unverified";
export type RoutingPreference = "economy" | "balanced" | "quality-first" | "lowest-latency";

/** Provider-neutral assessment produced once from the current message, never inherited from a prior turn. */
export type DynamicTaskAssessment = {
  taskType: "inspect" | "explain" | "edit" | "build" | "debug" | "refactor" | "migrate" | "review" | "operate";
  affectedScope: "single-location" | "single-file" | "few-files" | "multi-subsystem" | "project-wide";
  estimatedFiles: number;
  estimatedSubsystems: number;
  difficulty: number;
  uncertainty: number;
  risk: number;
  contextRequired: number;
  securityOrPayment: boolean;
  migration: boolean;
  repetitive: boolean;
  projectCreation: boolean;
  independentReviewNeeded: boolean;
  /** Semantic classifier signal: success depends on the rendered user-facing experience. */
  visualOutcome: boolean;
  confidence: number;
  reasons: string[];
  source: "dynamic-fast-classifier" | "deterministic-obvious" | "heuristic-fallback";
};

export type ModelCapabilities = {
  coding: number;
  debugging: number;
  architecture: number;
  toolReliability: number;
  longContext: number;
  vision: number;
  structuredOutput: number;
  instructionFollowing: number;
  reasoning: number;
};

export type RegisteredModel = {
  provider: ProviderId;
  modelId: string;
  displayName: string;
  status: ModelStatus;
  available: boolean;
  contextLimit?: number;
  outputLimit?: number;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportedEfforts: Array<"low" | "medium" | "high">;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  costClass: CostClass;
  latencyClass: LatencyClass;
  capabilities: ModelCapabilities;
  providerHealth: number;
  /** Suitability for each workload tier, inferred from the provider's current model metadata. */
  tierFit: Record<ModelTier, number>;
  /** Stable recency score used to avoid arbitrary catalogue-order tie breaking. */
  freshness: number;
  deprecated: boolean;
  lastVerifiedAt?: string;
  runtimeValidatedAt?: string;
};

export type TaskProfile = {
  intent: string;
  taskType: string;
  requestedOutcome: string;
  scope: { estimatedFiles: number; estimatedSubsystems: number; crossLayer: boolean; projectWide: boolean };
  projectScale: number;
  taskLocality: number;
  difficulty: number;
  ambiguity: number;
  risk: number;
  blastRadius: number;
  contextNeed: number;
  reasoningNeed: number;
  toolUseNeed: number;
  visualNeed: number;
  verificationNeed: number;
  reversibility: number;
  failureHistory: number;
  recommendedIntelligenceTier: ModelTier;
  recommendedExecutionDepth: ExecutionDepth;
  confidence: number;
  reasons: string[];
  missionComplexity?: number;
  repositoryComplexity?: number;
  expectedFiles?: number;
  effectiveIntelligence?: ModelTier;
};

export type RoutingBudget = {
  /** Hard total estimated-cost ceiling for the current user request. */
  estimatedCostUsd?: number;
  maximumModelCalls?: number;
  premiumCallLimit?: number;
  maximumTier?: ModelTier;
  maximumParallelCalls?: number;
};

export type RoutingDecision = {
  tier: ModelTier;
  executionDepth: ExecutionDepth;
  provider: ProviderId;
  model: string;
  effort?: "low" | "medium" | "high";
  reason: string;
  score: number;
  estimatedInputCostPerMillion?: number;
  estimatedCostUsd?: number;
  costClass?: CostClass;
  exceptionalReason?: string;
};
