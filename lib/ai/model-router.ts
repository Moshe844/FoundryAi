import type { ReasoningRequest } from "@/lib/ai/context";
import type { ProviderId } from "@/lib/ai/providers/types";

export type ModelProfile = "fast" | "standard" | "advanced" | "autonomous";

export type ModelDecision = {
  profile: ModelProfile;
  model: string;
  reason: string;
};

type ModelConfig = Record<ModelProfile, string>;

const defaultModelConfig: ModelConfig = {
  fast: "gpt-5-mini",
  standard: "gpt-5",
  advanced: "gpt-5",
  autonomous: "gpt-5",
};

const fallbackOrder: Record<ModelProfile, ModelProfile[]> = {
  fast: ["standard", "advanced", "autonomous"],
  standard: ["fast", "advanced", "autonomous"],
  advanced: ["standard", "autonomous", "fast"],
  autonomous: ["advanced", "standard", "fast"],
};

const profilePricingUsdPerMillion: Record<ModelProfile, { input: number; output: number }> = {
  fast: { input: 0.25, output: 2 },
  standard: { input: 1.25, output: 10 },
  advanced: { input: 1.25, output: 10 },
  autonomous: { input: 1.25, output: 10 },
};

export function modelForReasoningRequest(request: ReasoningRequest): ModelDecision {
  const profile = profileForReasoningRequest(request);
  return modelDecision(profile, "reasoning request");
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
  const profile = profileForModel(model);
  return profilePricingUsdPerMillion[profile];
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
  return {
    profile,
    model: getModelConfig()[profile],
    reason,
  };
}

function profileForReasoningRequest(request: ReasoningRequest): ModelProfile {
  const text = [
    request.userMessage,
    request.missionTitle,
    request.desiredOutcome,
    request.attachments.map((attachment) => `${attachment.fileName} ${attachment.evidenceKind} ${attachment.fileType}`).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const readableAttachments = request.attachments.filter((attachment) => attachment.uploadStatus === "readable").length;
  const hasImages = request.attachments.some((attachment) => attachment.uploadStatus === "image");

  if (/\b(autonomous|execute plan|run the plan|self-review|verify everything|long-running|multi-step execution)\b/i.test(text)) {
    return "autonomous";
  }

  if (
    request.troubleshooting.active ||
    readableAttachments >= 2 ||
    hasImages ||
    /\b(android|gradle|build failed|root cause|investigation|compare files|uploaded logs?|screenshots?|payment investigation|multi-file|correlat(?:e|ion)|large log)\b/i.test(text)
  ) {
    return "advanced";
  }

  if (request.desiredOutcome === "code" || /\b(refactor|architecture|explain code|compare two snippets|documentation|api explanation|moderate debugging)\b/i.test(text)) {
    return "standard";
  }

  if (/\b(what is|define|flush dns|ping|restart windows|cmd|powershell|simple|basic syntax|small rewrite|show .*command)\b/i.test(text)) {
    return "fast";
  }

  return "standard";
}

function profileForRuntimePayload(payload: unknown, requestedModel: string): ModelProfile {
  const requestedProfile = requestedModel ? profileForModel(requestedModel) : undefined;
  const text = JSON.stringify(payload).toLowerCase();

  if (/\b(autonomous|execute plan|self-review|long-running|tool orchestration)\b/i.test(text)) return strongest(requestedProfile, "autonomous");
  if (/\b(uploaded logs?|screenshots?|multi-file|android|gradle|build failed|root cause|investigation|large comparison|payment)\b/i.test(text)) {
    return strongest(requestedProfile, "advanced");
  }
  if (/\b(refactor|architecture|explain code|compare|documentation|api explanation)\b/i.test(text)) return strongest(requestedProfile, "standard");
  if (text.length < 12000 && /\b(simple answer|short answer|what is|how do i|verify|next step|command)\b/i.test(text)) return "fast";

  return requestedProfile ?? "standard";
}

function strongest(left: ModelProfile | undefined, right: ModelProfile): ModelProfile {
  const rank: Record<ModelProfile, number> = {
    fast: 1,
    standard: 2,
    advanced: 3,
    autonomous: 4,
  };
  if (!left) return right;
  return rank[left] >= rank[right] ? left : right;
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
export const TIER_MODEL_TABLE: Record<ModelTier, Record<"anthropic" | "google", TierModelEntry>> = {
  fast: {
    anthropic: { model: "claude-haiku-4-5" },
    google: { model: "gemini-flash-lite-latest" },
  },
  builder: {
    anthropic: { model: "claude-sonnet-5" },
    google: { model: "gemini-pro-latest" },
  },
  architect: {
    anthropic: { model: "claude-opus-4-8", effort: "high" },
    google: { model: "gemini-pro-latest", effort: "high" },
  },
  "enterprise-architect": {
    // Same models as Architect — the difference is workflow (planning-only use of the strong model,
    // see the module comment for level 4 in the product spec), not a stronger model id, since no
    // higher tier exists in any of the three providers' current lineups known to this repo.
    anthropic: { model: "claude-opus-4-8", effort: "high" },
    google: { model: "gemini-pro-latest", effort: "high" },
  },
  "super-reasoning": {
    anthropic: { model: "claude-opus-4-8", effort: "high" },
    google: { model: "gemini-pro-latest", effort: "high" },
  },
};

export type TierResolution = { tier: ModelTier; provider: ProviderId; model: string; effort?: "low" | "medium" | "high" };

export function resolveModelForTier(tier: ModelTier, opts?: { provider?: ProviderId }): TierResolution {
  const provider = opts?.provider ?? "openai";
  if (provider === "openai") {
    const config = getModelConfig();
    // fast -> the configured fast model; every other tier -> the configured "standard" model
    // (defaultModelConfig already maps standard/advanced/autonomous to the same gpt-5 id), scaled by
    // reasoning effort instead of a different model id, since no higher OpenAI model id is asserted
    // anywhere else in this repo.
    const model = tier === "fast" ? config.fast : config.standard;
    const effort = tier === "fast" || tier === "builder" ? undefined : "high";
    return { tier, provider, model, effort };
  }
  const entry = TIER_MODEL_TABLE[tier][provider];
  return { tier, provider, model: entry.model, effort: entry.effort };
}

/**
 * Non-OpenAI pricing (USD per million tokens). Anthropic figures are current. Google's "-latest"
 * aliases (see TIER_MODEL_TABLE) don't publish pricing under the alias name itself — these are
 * carried over from the flash-lite/pro tier they currently resolve to and should be re-checked if
 * Google repoints the alias to a different generation. OpenAI pricing is NOT duplicated here — see
 * pricingForProviderModel, which reuses the existing profilePricingUsdPerMillion table above to avoid
 * two tables that could drift apart.
 */
const NON_OPENAI_PRICING: Record<"anthropic" | "google", Record<string, { input: number; output: number }>> = {
  anthropic: {
    "claude-haiku-4-5": { input: 1, output: 5 },
    "claude-sonnet-5": { input: 3, output: 15 },
    "claude-opus-4-8": { input: 5, output: 25 },
  },
  google: {
    "gemini-flash-lite-latest": { input: 0.1, output: 0.4 },
    "gemini-pro-latest": { input: 1.25, output: 10 },
  },
};

export function pricingForProviderModel(provider: ProviderId, model: string) {
  if (provider === "openai") return pricingForModel(model);
  const table = NON_OPENAI_PRICING[provider];
  return table[model] ?? table[Object.keys(table)[0]];
}

/**
 * 5-bucket remap of profileForReasoningRequest's existing regex heuristic — extends rather than
 * replaces it, adding Enterprise Architect/Super Reasoning buckets and the user's literal example
 * vocabulary. Modifiers ("quick"/"be careful"/"big refactor") apply after the bucket match.
 */
export function tierForReasoningRequest(request: ReasoningRequest): ModelTier {
  const text = [
    request.userMessage,
    request.missionTitle,
    request.desiredOutcome,
    request.attachments.map((attachment) => `${attachment.fileName} ${attachment.evidenceKind} ${attachment.fileType}`).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const readableAttachments = request.attachments.filter((attachment) => attachment.uploadStatus === "readable").length;
  const hasImages = request.attachments.some((attachment) => attachment.uploadStatus === "image");

  const base = classifyTierFromText(text, { readableAttachments, hasImages, troubleshootingActive: request.troubleshooting.active, desiredOutcomeIsCode: request.desiredOutcome === "code" });
  return applyTierModifiers(text, base);
}

/** 5-bucket remap of profileForRuntimePayload — same ratcheting ("strongest wins") behavior, extended to 5 ranks. */
export function tierForRuntimePayload(payload: unknown, requestedTier?: ModelTier): ModelTier {
  const text = JSON.stringify(payload).toLowerCase();
  const base = classifyTierFromText(text, { readableAttachments: 0, hasImages: false, troubleshootingActive: false, desiredOutcomeIsCode: false });
  const withRequested = requestedTier ? strongestTier(requestedTier, base) : base;
  return applyTierModifiers(text, withRequested);
}

const SUPER_REASONING_PATTERN =
  /\b(500,?000\+?\s*lines|unknown legacy system|major production incident|multi-day migration|complex architecture design|cross-language project|deep performance debugging|security architecture|agent\/?runtime architecture|foundry (?:core|runtime|architecture))\b/i;
const ENTERPRISE_ARCHITECT_PATTERN =
  /\b(100,?000\+?\s*lines|large android app|large next\.?js|large saas app|multi-service backend|large refactor|architecture redesign|migrat(?:e|ion) from .{0,40}(?:to|into)|complex dependency upgrade|security-sensitive|payment[- ]processing|large codebase)\b/i;
const ARCHITECT_PATTERN =
  /\b(refactor (?:several|multiple) modules|unclear runtime issue|android|gradle|kotlin|payment sdk|auth system|multi-file|complex backend|backend\/?frontend coordination|large typescript|large react|database schema|hard build failures?|multi-step recovery|root cause|investigation)\b/i;
const BUILDER_PATTERN =
  /\b(add a feature|fix a bug|update .*component|add .*endpoint|node\/?express|small database change|form validation|refactor one module|fix build errors?|package configuration)\b/i;
const FAST_PATTERN =
  /\b(css|button color|small html|simple javascript|read(?:ing)? (?:one|two|1|2) files?|explain(?:ing)? an error|find(?:ing)? where|copy update|simple debugging|make it darker|small (?:css|text|copy) change)\b/i;

function classifyTierFromText(
  text: string,
  signals: { readableAttachments: number; hasImages: boolean; troubleshootingActive: boolean; desiredOutcomeIsCode: boolean },
): ModelTier {
  if (SUPER_REASONING_PATTERN.test(text)) return "super-reasoning";
  if (ENTERPRISE_ARCHITECT_PATTERN.test(text)) return "enterprise-architect";
  if (FAST_PATTERN.test(text)) return "fast";
  if (
    signals.troubleshootingActive ||
    signals.readableAttachments >= 2 ||
    signals.hasImages ||
    ARCHITECT_PATTERN.test(text) ||
    /\b(build failed|payment sdk integration|android\/gradle\/kotlin)\b/i.test(text)
  ) {
    return "architect";
  }
  if (signals.desiredOutcomeIsCode || BUILDER_PATTERN.test(text) || /\b(refactor|architecture|api endpoint)\b/i.test(text)) return "builder";
  if (/\b(what is|define|simple|basic syntax|small rewrite)\b/i.test(text)) return "fast";
  return "builder";
}

/** Cost Rule + Auto Routing Rules modifiers: "quick" forces down, "be careful" forces up, "big refactor" ratchets to at least Architect. */
function applyTierModifiers(text: string, tier: ModelTier): ModelTier {
  let result = tier;
  if (/\bquick\b/i.test(text) && tier !== "enterprise-architect" && tier !== "super-reasoning") {
    result = "fast";
  }
  if (/\bbe careful\b/i.test(text)) {
    result = strongestTier(result, "architect");
  }
  if (/\bbig refactor\b/i.test(text)) {
    result = strongestTier(result, ENTERPRISE_ARCHITECT_PATTERN.test(text) ? "enterprise-architect" : "architect");
  }
  return result;
}

function strongestTier(left: ModelTier, right: ModelTier): ModelTier {
  const rank: Record<ModelTier, number> = { fast: 1, builder: 2, architect: 3, "enterprise-architect": 4, "super-reasoning": 5 };
  return rank[left] >= rank[right] ? left : right;
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
