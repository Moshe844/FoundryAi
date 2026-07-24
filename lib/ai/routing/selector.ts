import type { CapabilityRegistry } from "./capability-registry";
import type { ModelTier, RegisteredModel, RoutingBudget, RoutingDecision, RoutingPreference, TaskProfile } from "./types";

const RANK: Record<ModelTier, number> = { fast: 1, builder: 2, architect: 3, "enterprise-architect": 4, "super-reasoning": 5 };
const COST = { "ultra-low": 0.05, low: 0.15, medium: 0.35, high: 0.7, premium: 1 };
const LATENCY = { instant: 0, fast: 0.2, normal: 0.55, slow: 1 };

export function selectModel(profile: TaskProfile, registry: CapabilityRegistry, options: { preference?: RoutingPreference; budget?: RoutingBudget; preferredProvider?: RegisteredModel["provider"]; disabledProviders?: RegisteredModel["provider"][]; includeUnavailable?: boolean } = {}): RoutingDecision | undefined {
  const tier = capTier(profile.recommendedIntelligenceTier, options.budget?.maximumTier);
  const requirements = requirementsFor(tier, profile);
  const preference = options.preference ?? "balanced";
  const costWeight = preference === "economy" ? 0.55 : preference === "quality-first" ? 0.12 : 0.32;
  const latencyWeight = preference === "lowest-latency" || tier === "fast" ? 0.3 : 0.1;
  // `includeUnavailable` is the caller's explicit last resort: when every candidate has been marked
  // unhealthy by recent failures, trying the least-unhealthy one beats refusing to route at all.
  const candidates = registry.list().filter((model) => (options.includeUnavailable || model.available) && !model.deprecated && model.status !== "unknown-alias" && !options.disabledProviders?.includes(model.provider) && withinBudget(model, options.budget) && satisfies(model, requirements));
  // Capability requirements are a gate, not a score bonus that lets an unnecessarily expensive
  // model beat a capable cheap one. Choose within the cheapest cost class that clears the gate.
  const cheapestCost = candidates.reduce((minimum, model) => Math.min(minimum, COST[model.costClass]), Number.POSITIVE_INFINITY);
  const cheapestCapable = candidates.filter((model) => COST[model.costClass] === cheapestCost);
  const ranked = cheapestCapable.map((model) => {
    const capabilityFit = average(Object.values(model.capabilities));
    const preferred = options.preferredProvider === model.provider ? 0.04 : 0;
    const tierFit = model.tierFit?.[tier] ?? 0.5;
    const runtimeConfidence = model.runtimeValidatedAt ? 0.04 : model.status === "discovered" ? 0 : -0.04;
    return { model, score: capabilityFit * 0.55 * model.providerHealth + tierFit * 0.4 + model.freshness * 0.05 + runtimeConfidence + preferred - COST[model.costClass] * costWeight - LATENCY[model.latencyClass] * latencyWeight };
  }).sort((a, b) => b.score - a.score || b.model.freshness - a.model.freshness || COST[a.model.costClass] - COST[b.model.costClass] || `${a.model.provider}:${a.model.modelId}`.localeCompare(`${b.model.provider}:${b.model.modelId}`));
  const selected = ranked[0];
  if (!selected) return undefined;
  const effort = selected.model.supportedEfforts.length && RANK[tier] >= RANK.architect ? "high" : undefined;
  return { tier, executionDepth: profile.recommendedExecutionDepth, provider: selected.model.provider, model: selected.model.modelId, effort,
    reason: `Selected the lowest-cost healthy candidate meeting ${tier} capabilities: ${profile.reasons.join("; ")}.`, score: selected.score,
    estimatedInputCostPerMillion: selected.model.inputUsdPerMillion, costClass: selected.model.costClass };
}

export function sameTierFallbacks(decision: RoutingDecision, registry: CapabilityRegistry, profile: TaskProfile) {
  const requirements = requirementsFor(decision.tier, profile);
  return registry.list().filter((model) => model.available && !model.deprecated && model.status !== "unknown-alias" && model.modelId !== decision.model && satisfies(model, requirements)).sort((a, b) =>
    COST[a.costClass] - COST[b.costClass]
    || (b.tierFit?.[decision.tier] ?? 0) - (a.tierFit?.[decision.tier] ?? 0)
    || b.providerHealth - a.providerHealth
    || b.freshness - a.freshness
    || COST[a.costClass] - COST[b.costClass]
    || `${a.provider}:${a.modelId}`.localeCompare(`${b.provider}:${b.modelId}`));
}

function requirementsFor(tier: ModelTier, profile: TaskProfile) {
  const minimum = tier === "fast" ? 0.55 : tier === "builder" ? 0.7 : tier === "architect" ? 0.82 : tier === "enterprise-architect" ? 0.88 : 0.93;
  return { coding: profile.intent === "change" ? minimum : 0.45, debugging: profile.taskType === "debugging" ? minimum : 0.45, architecture: RANK[tier] >= 3 ? minimum : 0.4, reasoning: minimum, tools: profile.toolUseNeed > 0.5 };
}
function satisfies(model: RegisteredModel, requirement: ReturnType<typeof requirementsFor>) {
  return (!requirement.tools || model.supportsTools) && model.capabilities.coding >= requirement.coding && model.capabilities.debugging >= requirement.debugging && model.capabilities.architecture >= requirement.architecture && model.capabilities.reasoning >= requirement.reasoning;
}
function capTier(tier: ModelTier, maximum?: ModelTier) { return maximum && RANK[tier] > RANK[maximum] ? maximum : tier; }
function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function withinBudget(model: RegisteredModel, budget?: RoutingBudget) {
  if (budget?.premiumCallLimit === 0 && (model.costClass === "premium" || model.costClass === "high")) return false;
  if (budget?.estimatedCostUsd != null && budget.estimatedCostUsd <= 0.001 && !["ultra-low", "low"].includes(model.costClass)) return false;
  return true;
}
