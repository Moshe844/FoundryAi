import type { ReasoningRequest } from "@/lib/ai/context";
import type { ProviderId } from "@/lib/ai/providers/types";
import { CapabilityRegistry } from "@/lib/ai/routing/capability-registry";
import { liveRegistrySnapshot } from "@/lib/ai/routing/registry-state";
import { selectModel } from "@/lib/ai/routing/selector";
import { profileTask } from "@/lib/ai/routing/task-profiler";
import type { TaskProfile } from "@/lib/ai/routing/types";

export type ModelProfile = "fast" | "standard" | "advanced" | "autonomous";

export type ModelDecision = {
  profile: ModelProfile;
  model: string;
  reason: string;
};

type ModelConfig = Record<ModelProfile, string>;

const defaultModelConfig: ModelConfig = {
  fast: "",
  standard: "",
  advanced: "",
  autonomous: "",
};

const fallbackOrder: Record<ModelProfile, ModelProfile[]> = {
  fast: ["standard", "advanced", "autonomous"],
  standard: ["fast", "advanced", "autonomous"],
  advanced: ["standard", "autonomous", "fast"],
  autonomous: ["advanced", "standard", "fast"],
};

export function modelForReasoningRequest(request: ReasoningRequest): ModelDecision {
  const tier = tierForReasoningRequest(request);
  const profile: ModelProfile = tier === "fast" ? "fast" : tier === "builder" ? "standard" : tier === "architect" ? "advanced" : "autonomous";
  const resolved = resolveModelForTier(tier, { provider: "openai" });
  return { profile, model: resolved.model, reason: `Fresh current-message classification selected ${tier}.` };
}

export function modelForRuntimePayload(payload: unknown, requestedModel = ""): ModelDecision {
  const profile = profileForRuntimePayload(payload, requestedModel);
  return modelDecision(profile, "runtime payload");
}

export function modelForProfile(profile: ModelProfile): ModelDecision {
  return modelDecision(profile, "explicit profile");
}

export function modelForRepairTask(task: "command" | "troubleshooting" | "evidence" | "snippet" | "contract" | "verification"): ModelDecision {
  if (task === "command" || task === "verification") return modelDecision("fast", `${task} repair`);
  if (task === "troubleshooting" || task === "evidence" || task === "snippet") return modelDecision("standard", `${task} repair`);
  return modelDecision("standard", `${task} repair`);
}

export function fallbackModelForModel(model: string) {
  const profile = profileForModel(model);
  const fallback = fallbackOrder[profile].find((candidate) => modelForProfile(candidate).model !== model);
  return fallback ? modelForProfile(fallback) : undefined;
}

export function pricingForModel(model: string) {
  return pricingForProviderModel("openai", model);
}

export function profileForModel(model: string): ModelProfile {
  const config = getModelConfig();
  const found = (Object.keys(config) as ModelProfile[]).find((profile) => config[profile] === model);
  return found ?? "fast";
}

export function getModelConfig(): ModelConfig {
  return {
    fast: process.env.FOUNDRY_MODEL_FAST ?? process.env.OPENAI_FAST_MODEL ?? defaultModelConfig.fast,
    standard: process.env.FOUNDRY_MODEL_STANDARD ?? process.env.OPENAI_MODEL ?? defaultModelConfig.standard,
    advanced: process.env.FOUNDRY_MODEL_ADVANCED ?? process.env.OPENAI_MODEL ?? defaultModelConfig.advanced,
    autonomous: process.env.FOUNDRY_MODEL_AUTONOMOUS ?? process.env.OPENAI_MODEL ?? defaultModelConfig.autonomous,
  };
}

function modelDecision(profile: ModelProfile, reason: string): ModelDecision {
  const tier: ModelTier = profile === "fast" ? "fast" : profile === "standard" ? "builder" : profile === "advanced" ? "architect" : "enterprise-architect";
  const resolved = resolveModelForTier(tier, { provider: "openai" });
  return {
    profile,
    model: resolved.model,
    reason,
  };
}

function profileForRuntimePayload(payload: unknown, requestedModel: string): ModelProfile {
  void requestedModel; // A prior/requested model is intentionally not a routing signal.
  const tier = profileTask({ message: typeof payload === "string" ? payload : JSON.stringify(payload) }).recommendedIntelligenceTier;
  return tier === "fast" ? "fast" : tier === "builder" ? "standard" : tier === "architect" ? "advanced" : "autonomous";
}

// ─────────────────────────────────────────────────────────────────────────────
// 5-tier + Auto model routing (multi-provider). Extends the 4-profile system
// above rather than replacing it — modelForProfile() keeps its exact existing
// signature/output so every one of the ~9 call sites that hasn't migrated yet
// keeps working byte-for-byte. New call sites should prefer resolveModelForTier
// / modelForExplicitMode below.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelTier = "fast" | "builder" | "architect" | "enterprise-architect" | "super-reasoning";
export type ModelMode = ModelTier | "auto";

export type TierDisplay = { emoji: string; label: string; blurb: string };

export const TIER_DISPLAY: Record<ModelTier, TierDisplay> = {
  fast: { emoji: "⚡", label: "Fast", blurb: "Quick edits and questions" },
  builder: { emoji: "🛠", label: "Builder", blurb: "Everyday development" },
  architect: { emoji: "🧠", label: "Architect", blurb: "Hard debugging and multi-file work" },
  "enterprise-architect": { emoji: "🏗", label: "Enterprise Architect", blurb: "Huge codebases and major refactors" },
  "super-reasoning": { emoji: "🚀", label: "Super Reasoning", blurb: "Critical, very complex missions" },
};

export const AUTO_DISPLAY: TierDisplay = { emoji: "⭐", label: "Auto", blurb: "Foundry chooses for you" };

export type TierModelEntry = { model: string; effort?: "low" | "medium" | "high" };

/**
 * Per-tier model table for Anthropic and Google. Anthropic ids are current Anthropic model
 * identifiers as of this session. Google ids were re-verified live against ListModels + a real
 * generateContent call on 2026-07-10 — gemini-2.5-flash/pro and gemini-2.5-flash-lite are listed by
 * ListModels but reject generateContent for this account ("no longer available to new users"), and
 * gemini-flash-latest/gemini-3.5-flash returned live 503s under load — so the table uses the two ids
 * that actually returned 200s: gemini-flash-lite-latest (fast) and gemini-pro-latest (everything else).
 * Both are Google's auto-updating aliases, which also avoids re-pinning to a snapshot id that gets
 * deprecated again later.
 *
 * OpenAI deliberately has NO row here — resolveModelForTier() derives the OpenAI model from
 * getModelConfig() below instead, so the existing FOUNDRY_MODEL_ / OPENAI_MODEL env-var override
 * mechanism keeps working for tier-based lookups exactly as it already does for profile-based ones,
 * rather than introducing a second, disconnected table that could silently drift out of sync with it.
 */
export type TierResolution = { tier: ModelTier; provider: ProviderId; model: string; effort?: "low" | "medium" | "high" };

export function resolveModelForTier(tier: ModelTier, opts?: { provider?: ProviderId }): TierResolution {
  const registry = new CapabilityRegistry(liveRegistrySnapshot().models);
  const profile = syntheticProfile(tier);
  const disabledProviders: ProviderId[] | undefined = opts?.provider
    ? (["openai", "anthropic", "google"] as ProviderId[]).filter((provider) => provider !== opts.provider)
    : undefined;
  const decision = selectModel(profile, registry, { preferredProvider: opts?.provider, disabledProviders });
  if (decision) return { tier, provider: decision.provider, model: decision.model, effort: decision.effort };
  throw new Error(`The live model registry has no validated ${tier} candidate${opts?.provider ? ` for ${opts.provider}` : ""}. Refresh provider models before routing.`);
}

function syntheticProfile(tier: ModelTier): TaskProfile {
  return { intent: "change", taskType: tier === "fast" ? "localized-edit" : "implementation", requestedOutcome: "", scope: { estimatedFiles: tier === "fast" ? 1 : 3, estimatedSubsystems: 1, crossLayer: false, projectWide: false }, projectScale: 0, taskLocality: 1, difficulty: 0.5, ambiguity: 0, risk: 0, blastRadius: 0.2, contextNeed: 0.4, reasoningNeed: 0.5, toolUseNeed: 0.7, visualNeed: 0, verificationNeed: 0.5, reversibility: 0.8, failureHistory: 0, recommendedIntelligenceTier: tier, recommendedExecutionDepth: "standard", confidence: 1, reasons: ["explicit capability tier"] };
}

/**
 * Non-OpenAI pricing (USD per million tokens). Anthropic figures are current. Google's "-latest"
 * aliases (see TIER_MODEL_TABLE) don't publish pricing under the alias name itself — these are
 * carried over from the flash-lite/pro tier they currently resolve to and should be re-checked if
 * Google repoints the alias to a different generation. OpenAI pricing is NOT duplicated here — see
 * pricingForProviderModel, which reuses the existing profilePricingUsdPerMillion table above to avoid
 * two tables that could drift apart.
 */
export function pricingForProviderModel(provider: ProviderId, model: string) {
  const registered = liveRegistrySnapshot().models.find((candidate) => candidate.provider === provider && candidate.modelId === model);
  if (registered?.inputUsdPerMillion != null && registered.outputUsdPerMillion != null) return { input: registered.inputUsdPerMillion, output: registered.outputUsdPerMillion };
  const estimates = { "ultra-low": { input: 0.15, output: 1 }, low: { input: 0.5, output: 3 }, medium: { input: 1.5, output: 8 }, high: { input: 4, output: 20 }, premium: { input: 10, output: 50 } };
  return estimates[registered?.costClass ?? "medium"];
}

/**
 * 5-bucket remap of profileForReasoningRequest's existing regex heuristic — extends rather than
 * replaces it, adding Enterprise Architect/Super Reasoning buckets and the user's literal example
 * vocabulary. Modifiers ("quick"/"be careful"/"big refactor") apply after the bucket match.
 */
export function tierForReasoningRequest(request: ReasoningRequest): ModelTier {
  return profileTask({
    message: request.userMessage,
    activeMission: [request.missionTitle, request.desiredOutcome].filter(Boolean).join(" — "),
    likelyFiles: request.attachments.filter((attachment) => attachment.uploadStatus === "readable").map((attachment) => attachment.fileName),
    failureHistory: request.troubleshooting.active ? 1 : 0,
  }).recommendedIntelligenceTier;
}

/** Fresh task-first payload classification. A requested tier is a ceiling, never prior-turn inertia. */
export function tierForRuntimePayload(payload: unknown, requestedTier?: ModelTier): ModelTier {
  const base = profileTask({ message: typeof payload === "string" ? payload : JSON.stringify(payload) }).recommendedIntelligenceTier;
  return requestedTier ? lowerTier(base, requestedTier) : base;
}

function lowerTier(left: ModelTier, ceiling: ModelTier): ModelTier {
  const rank: Record<ModelTier, number> = { fast: 1, builder: 2, architect: 3, "enterprise-architect": 4, "super-reasoning": 5 };
  return rank[left] <= rank[ceiling] ? left : ceiling;
}

export type AutoResolution = TierResolution & { autoSelected: true; reason: string };

/** The exact value the UI's "Auto (selected: X)" transparency chip should read — never re-derived client-side. */
export function modelForAutoRequest(request: ReasoningRequest, opts?: { provider?: ProviderId }): AutoResolution {
  const tier = tierForReasoningRequest(request);
  const resolved = resolveModelForTier(tier, opts);
  return { ...resolved, autoSelected: true, reason: `Auto-classified as ${TIER_DISPLAY[tier].label} from the request text.` };
}

export type ExplicitResolution = TierResolution & { autoSelected: false };

/** Single dispatcher so call sites don't need their own auto/manual branching. */
export function modelForExplicitMode(mode: ModelMode, request?: ReasoningRequest, opts?: { provider?: ProviderId }): TierResolution & { autoSelected: boolean; reason?: string } {
  if (mode === "auto") {
    if (!request) return { ...resolveModelForTier("builder", opts), autoSelected: true, reason: "Auto-classified with no request context available; defaulted to Builder." };
    return modelForAutoRequest(request, opts);
  }
  return { ...resolveModelForTier(mode, opts), autoSelected: false };
}
