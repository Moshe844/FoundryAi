import type { ModelStageFeedback } from "@/lib/ai/routing/telemetry";
import type { ModelTier, RegisteredModel } from "@/lib/ai/routing/types";

/**
 * Rating a model by what it has done, rather than by what it is called.
 *
 * Capability used to be guessed entirely from the model id: a name containing "opus" or "pro" was
 * premium, one containing "sonnet" or "gpt-5" was strong, everything else was average. That produced
 * three defects at once. Every premium-named model scored *identically*, so the selector could not tell
 * two frontier models apart and fell through to a freshness tiebreak where an id ending in "latest"
 * outscored a real version number. A frontier model whose name happened to contain none of those words
 * was capped below the top tiers no matter how well it performed. And a genuinely new family name was
 * rated average by default.
 *
 * Foundry now records what actually happened on every call — whether the model produced what was asked,
 * how long it took, what it cost, and whether its work survived into the finished mission. That is a
 * direct measurement of the things capability is supposed to predict, so it should outrank a guess made
 * from spelling.
 *
 * The name-derived value is kept as a *prior*: it is what a model is worth before anything is known
 * about it. Evidence then moves the rating, gaining influence as observations accumulate, so a new
 * model is neither trusted blindly nor locked out of the work it is good at.
 */

/** Observations needed before evidence carries as much weight as the prior. */
const CONFIDENCE_HALF_LIFE = 8;

/** How far evidence may move a capability away from its prior, in either direction. */
const MAX_EVIDENCE_SHIFT = 0.18;

export type ObservedModelSignal = {
  provider: string;
  model: string;
  observations: number;
  /** Share of calls that produced what the caller asked for. */
  acceptanceRate: number;
  /** Share of this model's work that survived into a finished mission, when known. */
  contributionRate: number | null;
  /** Share of calls that needed a fallback candidate. */
  fallbackRate: number;
  meanLatencyMs: number | null;
  meanCostUsd: number;
  /** Stages this model has actually been used for. */
  stages: string[];
};

/**
 * Collapses per-stage feedback into one signal per model.
 *
 * A model is one thing across the mission; the stage breakdown matters for choosing *where* to use it,
 * but its reliability and speed are properties of the model itself and are pooled here. Rates are
 * weighted by call count so a stage with two samples cannot outvote one with two hundred.
 */
export function observedSignals(feedback: ModelStageFeedback[]): Map<string, ObservedModelSignal> {
  const grouped = new Map<string, ModelStageFeedback[]>();
  for (const entry of feedback) {
    const key = `${entry.provider}:${entry.model}`;
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }

  const signals = new Map<string, ObservedModelSignal>();
  for (const [key, entries] of grouped) {
    const calls = entries.reduce((sum, entry) => sum + entry.calls, 0);
    if (!calls) continue;

    const weighted = (read: (entry: ModelStageFeedback) => number) =>
      entries.reduce((sum, entry) => sum + read(entry) * entry.calls, 0) / calls;

    const withContribution = entries.filter((entry) => entry.contributionRate !== null);
    const contributionCalls = withContribution.reduce((sum, entry) => sum + entry.calls, 0);
    const withLatency = entries.filter((entry) => entry.meanLatencyMs !== null);
    const latencyCalls = withLatency.reduce((sum, entry) => sum + entry.calls, 0);

    signals.set(key, {
      provider: entries[0].provider,
      model: entries[0].model,
      observations: calls,
      acceptanceRate: weighted((entry) => entry.acceptanceRate),
      contributionRate: contributionCalls
        ? withContribution.reduce((sum, entry) => sum + (entry.contributionRate ?? 0) * entry.calls, 0) / contributionCalls
        : null,
      fallbackRate: weighted((entry) => entry.fallbackRate),
      meanLatencyMs: latencyCalls
        ? Math.round(withLatency.reduce((sum, entry) => sum + (entry.meanLatencyMs ?? 0) * entry.calls, 0) / latencyCalls)
        : null,
      meanCostUsd: weighted((entry) => entry.meanCostUsd),
      stages: [...new Set(entries.map((entry) => entry.stage))],
    });
  }
  return signals;
}

/**
 * How much to trust evidence over the prior.
 *
 * Shrinkage rather than a threshold: one observation nudges, many observations govern. A hard cutoff
 * would make the rating lurch the moment a counter crossed it, and would treat the ninth call as
 * revealing something the eighth did not.
 */
export function evidenceWeight(observations: number): number {
  return observations / (observations + CONFIDENCE_HALF_LIFE);
}

/**
 * Applies observed behavior to a model's inferred profile.
 *
 * Only the things the evidence genuinely speaks to are moved. Acceptance and fallback rate measure
 * whether a model does what it is told and returns usable structure, so they inform tool reliability,
 * instruction following and structured output directly. Contribution — whether the work survived into
 * the finished mission — is the closest thing to a measurement of whether the model was actually good
 * enough for the job, so it moves the reasoning, coding and architecture ratings that decide which
 * tiers it can serve. Latency and cost are simply observed rather than guessed.
 *
 * Movement is bounded in both directions. Evidence should correct a bad guess, not let a handful of
 * lucky calls promote a small model into critical work.
 */
export function applyObservedEvidence(model: RegisteredModel, signal: ObservedModelSignal | undefined): RegisteredModel {
  if (!signal || !signal.observations) return model;

  const weight = evidenceWeight(signal.observations);
  const reliability = signal.acceptanceRate * (1 - signal.fallbackRate * 0.5);
  // Contribution is the strongest available statement about quality, but it is only known once missions
  // have closed. Until then, reliability alone carries the evidence.
  const quality = signal.contributionRate ?? reliability;

  const move = (prior: number, measured: number) => {
    const target = Math.max(0, Math.min(1, measured));
    const shifted = prior + (target - prior) * weight;
    return Number(Math.max(prior - MAX_EVIDENCE_SHIFT, Math.min(prior + MAX_EVIDENCE_SHIFT, shifted)).toFixed(4));
  };

  return {
    ...model,
    capabilities: {
      ...model.capabilities,
      toolReliability: move(model.capabilities.toolReliability, reliability),
      instructionFollowing: move(model.capabilities.instructionFollowing, reliability),
      structuredOutput: move(model.capabilities.structuredOutput, reliability),
      reasoning: move(model.capabilities.reasoning, quality),
      coding: move(model.capabilities.coding, quality),
      architecture: move(model.capabilities.architecture, quality),
      debugging: move(model.capabilities.debugging, quality),
      longContext: model.capabilities.longContext,
      vision: model.capabilities.vision,
    },
    latencyClass: signal.meanLatencyMs === null ? model.latencyClass : latencyClassFor(signal.meanLatencyMs),
    /** Measured spend per call is a better cost signal than a class inferred from the name. */
    observedCostUsdPerCall: Number(signal.meanCostUsd.toFixed(6)),
    observations: signal.observations,
  };
}

function latencyClassFor(meanLatencyMs: number): RegisteredModel["latencyClass"] {
  if (meanLatencyMs < 2_000) return "instant";
  if (meanLatencyMs < 6_000) return "fast";
  if (meanLatencyMs < 20_000) return "normal";
  return "slow";
}

/**
 * Freshness, comparing a model only against its own provider's line-up.
 *
 * The previous rule read the last number in an id and divided it by six, so `opus-5` scored 0.83 while
 * `opus-4-6` scored 1.0 — a newer model ranking below an older one. Worse, any id ending in "latest" was
 * hardcoded to 1.0, which is how an alias beat a named frontier model on the tiebreak that decided the
 * top tier. Versions only mean anything relative to their own family, so they are ranked within it.
 */
export function normalizeFreshness(models: RegisteredModel[]): RegisteredModel[] {
  const byProvider = new Map<string, RegisteredModel[]>();
  for (const model of models) byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);

  const scored = new Map<string, number>();
  for (const [, group] of byProvider) {
    const versions = group.map((model) => ({ model, version: versionOf(model.modelId) }));
    const highest = Math.max(...versions.map((entry) => entry.version), 0);
    for (const { model, version } of versions) {
      // An alias tracks whatever its provider currently points it at, so it is treated as current —
      // but only as current, never ahead of the newest explicitly versioned model.
      const isAlias = /latest/i.test(model.modelId);
      scored.set(`${model.provider}:${model.modelId}`, highest > 0 ? (isAlias ? 1 : version / highest) : isAlias ? 1 : 0.5);
    }
  }

  return models.map((model) => ({ ...model, freshness: Number((scored.get(`${model.provider}:${model.modelId}`) ?? 0.5).toFixed(4)) }));
}

/**
 * A comparable version number for a model id.
 *
 * Reads every numeric segment and combines them positionally, so 5 outranks 4.6 and 4.6 outranks 4.
 * A date-stamped id contributes its date, which keeps snapshot ids ordered against each other.
 */
function versionOf(modelId: string): number {
  const date = modelId.match(/(20\d{2})[-.]?(0[1-9]|1[0-2])[-.]?([0-3]\d)/);
  if (date) return Number(date[1]) + Number(date[2]) / 100 + Number(date[3]) / 10_000;

  const segments = [...modelId.matchAll(/(?<![a-z0-9])(\d+)(?![a-z])/gi)].map((match) => Number(match[1]));
  if (!segments.length) return 0;
  return segments.slice(0, 3).reduce((total, part, index) => total + part / 10 ** (index * 2), 0);
}

/** The tiers a model has demonstrably contributed at, for reporting why it is trusted. */
export function provenTiers(signal: ObservedModelSignal | undefined, tierForStage: (stage: string) => ModelTier | undefined): ModelTier[] {
  if (!signal || signal.contributionRate === null || signal.contributionRate < 0.5) return [];
  return [...new Set(signal.stages.map((stage) => tierForStage(stage)).filter((tier): tier is ModelTier => Boolean(tier)))];
}
