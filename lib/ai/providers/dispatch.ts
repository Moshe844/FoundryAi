import { callOpenAIManaged } from "@/lib/ai/providers/openai-runtime";
import { callAnthropicManaged } from "@/lib/ai/providers/anthropic-runtime";
import { callGoogleManaged } from "@/lib/ai/providers/google-runtime";
import type { ManagedCallOptions, ManagedModelRequest, ManagedModelResult, ProviderId } from "@/lib/ai/providers/types";
import { getModelConfig, resolveModelForTier, TIER_MODEL_TABLE, type ModelTier } from "@/lib/ai/model-router";

/** The env var each provider's key lives in — same "read directly, 503 if missing" pattern every route already used for OPENAI_API_KEY. */
export function apiKeyForProvider(provider: ProviderId): string | undefined {
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  return process.env.GEMINI_API_KEY;
}

export function envVarNameForProvider(provider: ProviderId): string {
  if (provider === "openai") return "OPENAI_API_KEY";
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  return "GEMINI_API_KEY";
}

const AUTO_PROVIDER_ORDER: Record<ModelTier, ProviderId[]> = {
  fast: ["google", "openai", "anthropic"],
  builder: ["anthropic", "openai", "google"],
  architect: ["openai", "anthropic", "google"],
  "enterprise-architect": ["anthropic", "openai", "google"],
  "super-reasoning": ["anthropic", "openai", "google"],
};

/** Picks the best configured provider for a tier and falls back cleanly when a key is absent. */
export function providerForTier(tier: ModelTier, preferred?: ProviderId): { provider: ProviderId; apiKey: string } | undefined {
  const order = preferred ? [preferred, ...AUTO_PROVIDER_ORDER[tier].filter((item) => item !== preferred)] : AUTO_PROVIDER_ORDER[tier];
  for (const provider of order) {
    const apiKey = apiKeyForProvider(provider);
    if (apiKey) return { provider, apiKey };
  }
  return undefined;
}

/**
 * The single entry point every migrated call site should import instead of calling
 * callOpenAIResponsesManaged (or a provider-specific function) directly. Dispatches on
 * request.provider.
 */
export async function callManagedModel(request: ManagedModelRequest, options: ManagedCallOptions): Promise<ManagedModelResult> {
  const tier = inferTier(request);
  const candidates = [request.provider, ...AUTO_PROVIDER_ORDER[tier].filter((provider) => provider !== request.provider)];
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 90_000);
  const overallSignal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  let lastResult: ManagedModelResult | undefined;

  for (const provider of candidates) {
    if (overallSignal.aborted) break;
    const apiKey = apiKeyForProvider(provider);
    if (!apiKey) continue;
    const resolution = resolveModelForTier(tier, { provider });
    const candidateRequest = { ...request, provider, model: resolution.model, effort: resolution.effort ?? request.effort };
    const candidateOptions = { ...options, apiKey, signal: overallSignal };
    const result = await callProvider(candidateRequest, candidateOptions);
    if (result.stopReason !== "error") return result;
    lastResult = result;
  }

  return lastResult ?? callProvider(request, options);
}

function callProvider(request: ManagedModelRequest, options: ManagedCallOptions) {
  if (request.provider === "openai") return callOpenAIManaged(request, options);
  if (request.provider === "anthropic") return callAnthropicManaged(request, options);
  return callGoogleManaged(request, options);
}

function inferTier(request: ManagedModelRequest): ModelTier {
  if (request.provider === "openai") {
    if (request.model === getModelConfig().fast) return "fast";
    return request.effort === "high" ? "architect" : "builder";
  }
  for (const tier of Object.keys(TIER_MODEL_TABLE) as ModelTier[]) {
    if (TIER_MODEL_TABLE[tier][request.provider].model === request.model) return tier;
  }
  return request.effort === "high" ? "architect" : "builder";
}
