export type StrategyModelTier = "fast" | "builder" | "architect" | "enterprise-architect" | "super-reasoning";
export type StrategyMissionComplexity = "trivial" | "small" | "medium" | "large" | "critical";
export type StrategyMissionStage = "discover" | "plan" | "review" | "implement" | "verify";
export type StrategyQualityLevel = "quick" | "standard" | "thorough" | "production";

export type MissionKind = "question" | "new-project" | "existing-project";
export type ExecutionWorkflow = "direct-answer" | "focused-edit" | "bounded-artifact" | "autonomous-mission" | "staged-migration";
export type StageCapability = "classify" | "discover" | "plan" | "generate" | "implement" | "debug" | "review" | "verify" | "visual" | "repair";

export type MissionSignals = {
  kind: MissionKind;
  complexity: StrategyMissionComplexity;
  quality: StrategyQualityLevel;
  fileCount: number;
  estimatedArtifacts: number;
  independentlyGeneratable: boolean;
  highRisk: boolean;
  securitySensitive: boolean;
  needsVisualValidation: boolean;
  repeatedFailures: number;
};

export type StageAssignment = {
  capability: StageCapability;
  tier: StrategyModelTier;
  reason: string;
  parallelizable: boolean;
};

export type ExecutionStrategy = {
  workflow: ExecutionWorkflow;
  concurrency: number;
  stages: StageAssignment[];
  reason: string;
};

export function createExecutionStrategy(signals: MissionSignals): ExecutionStrategy {
  if (signals.kind === "question") {
    return strategy("direct-answer", 1, "The user requested an answer, not project mutation.", [assignment("classify", "fast", "Intent classification is inexpensive and bounded."), assignment("discover", signals.complexity === "trivial" ? "fast" : "builder", "Use only the project context needed to answer accurately.")]);
  }
  if (signals.highRisk || signals.complexity === "critical") {
    return strategy("staged-migration", 1, "High-risk work needs ordered checkpoints, compatibility review, and rollback-aware verification.", [assignment("discover", "builder", "Inventory current behavior before changing architecture."), assignment("plan", "architect", "Architecture-scale sequencing needs strong cross-system reasoning."), assignment("review", "architect", "Review risks before implementation."), assignment("implement", "architect", "Changes are coupled and should remain staged."), assignment("verify", "builder", "Evaluate the full evidence set."), assignment("repair", "architect", "Escalate unresolved failures.")]);
  }
  const boundedNewProject = signals.kind === "new-project" && signals.independentlyGeneratable && signals.estimatedArtifacts <= 8 && (signals.complexity === "trivial" || signals.complexity === "small");
  if (boundedNewProject) {
    return strategy("bounded-artifact", Math.min(4, Math.max(1, signals.estimatedArtifacts)), "The project is small, greenfield, and decomposes into independently verifiable artifacts.", [assignment("classify", "fast", "The project shape is already bounded."), assignment("plan", "fast", "A compact manifest is sufficient."), assignment("generate", "fast", "A bounded project should be generated quickly in one coordinated pass.", true), ...(signals.needsVisualValidation ? [assignment("visual", "fast", "Rendered UI needs evidence-based inspection, not a more expensive generation model.")] : []), assignment("verify", "fast", "Deterministic checks provide the primary evidence."), assignment("repair", "builder", "Escalate only if deterministic verification exposes a real failure.")]);
  }
  if (signals.complexity === "trivial" || (signals.complexity === "small" && signals.fileCount <= 20)) {
    return strategy("focused-edit", 1, "The task is localized and should avoid project-wide ceremony.", [assignment("discover", "fast", "Locate only the relevant files."), assignment("implement", "fast", "Apply the bounded low-risk change without buying unnecessary intelligence."), ...(signals.needsVisualValidation ? [assignment("visual", "fast", "Validate the affected UI directly.")] : []), assignment("verify", "fast", "Run the smallest relevant check."), assignment("repair", signals.repeatedFailures ? "architect" : "builder", signals.repeatedFailures ? "A repeated failure needs stronger diagnosis." : "Escalate only if verification exposes a real repair need.")]);
  }
  const planningTier: StrategyModelTier = signals.complexity === "large" || signals.securitySensitive || signals.quality === "production" ? "architect" : "builder";
  return strategy("autonomous-mission", signals.independentlyGeneratable ? 3 : 1, "The mission needs a durable plan and autonomous multi-step execution.", [assignment("discover", "fast", "Indexing and stack detection are bounded."), assignment("plan", planningTier, "Planning strength scales with coupling and risk."), ...(signals.securitySensitive ? [assignment("review", "architect", "Security-sensitive work requires an independent review.")] : []), assignment("implement", signals.complexity === "large" ? "architect" : "builder", "Implementation strength scales with project coupling.", signals.independentlyGeneratable), ...(signals.needsVisualValidation ? [assignment("visual", "builder", "Validate rendered behavior rather than source alone.")] : []), assignment("verify", "fast", "Commands and evidence drive verification."), assignment("repair", signals.repeatedFailures >= 1 ? "architect" : "builder", signals.repeatedFailures >= 1 ? "One failed low-confidence diagnosis permits a single Architect escalation." : "Start repair at normal implementation strength.")]);
}

export function tierForCapability(strategy: ExecutionStrategy, capability: StageCapability, fallback: StrategyModelTier): StrategyModelTier {
  return strategy.stages.find((stage) => stage.capability === capability)?.tier ?? fallback;
}

export function capabilityForMissionStage(stage: StrategyMissionStage): StageCapability {
  if (stage === "discover") return "discover";
  if (stage === "plan") return "plan";
  if (stage === "review") return "review";
  if (stage === "implement") return "implement";
  return "verify";
}

function assignment(capability: StageCapability, tier: StrategyModelTier, reason: string, parallelizable = false): StageAssignment { return { capability, tier, reason, parallelizable }; }
function strategy(workflow: ExecutionWorkflow, concurrency: number, reason: string, stages: StageAssignment[]): ExecutionStrategy { return { workflow, concurrency, reason, stages }; }
