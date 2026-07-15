import { callOpenAIManaged } from "@/lib/ai/providers/openai-runtime";
import { callAnthropicManaged } from "@/lib/ai/providers/anthropic-runtime";
import { callGoogleManaged } from "@/lib/ai/providers/google-runtime";
import type { ManagedCallOptions, ManagedModelRequest, ManagedModelResult, ProviderId } from "@/lib/ai/providers/types";
import { getModelConfig, resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import { refreshModelRegistry, reportModelHealth } from "@/lib/ai/routing/dynamic-router";
import { sameTierFallbacks } from "@/lib/ai/routing/selector";
import type { TaskProfile } from "@/lib/ai/routing/types";
import { profileTask } from "@/lib/ai/routing/task-profiler";
import { selectModel } from "@/lib/ai/routing/selector";
import { CostGuardError, releaseModelCall, reserveModelCall, settleModelCall } from "@/lib/ai/routing/cost-guard";
import { recordProviderCall } from "@/lib/ai/routing/telemetry";

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

const PROVIDERS: ProviderId[] = ["openai", "anthropic", "google"];
const managedResultCache = new Map<string, { result: ManagedModelResult; expiresAt: number }>();
type CandidateFailure = { provider: ProviderId; model: string; message: string; kind: NonNullable<ManagedModelResult["failureKind"]> };

/** Picks the best configured provider for a tier and falls back cleanly when a key is absent. */
export function providerForTier(tier: ModelTier, preferred?: ProviderId): { provider: ProviderId; apiKey: string } | undefined {
  const ranked = PROVIDERS.map((provider) => ({ provider, resolution: resolveModelForTier(tier, { provider }) }))
    .filter(({ provider }) => Boolean(apiKeyForProvider(provider)))
    .sort((left, right) => providerCost(left.resolution.model) - providerCost(right.resolution.model));
  const order = preferred ? [preferred, ...ranked.map(({ provider }) => provider).filter((item) => item !== preferred)] : ranked.map(({ provider }) => provider);
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
  const tier = request.routing?.tier ?? inferTier(request);
  const registry = await refreshModelRegistry();
  const profile = request.routing ? profileTask({ message: request.routing.task, dynamicAssessment: request.routing.dynamicAssessment }) : fallbackProfile(tier);
  profile.recommendedIntelligenceTier = tier;
  const freshDecision = selectModel(profile, registry, { preferredProvider: request.provider, budget: request.routing?.budget });
  const original = freshDecision ? registry.get(freshDecision.provider, freshDecision.model) : registry.get(request.provider, request.model);
  const rankedCandidates = [
    ...(original ? [original] : []),
    ...sameTierFallbacks({ tier, executionDepth: "standard", provider: request.provider, model: request.model, reason: "managed call", score: 0 }, registry, profile),
  ].filter((model, index, all) => apiKeyForProvider(model.provider) && all.findIndex((item) => item.provider === model.provider && item.modelId === model.modelId) === index);
  // A logical fallback is provider diversity, not a catalogue walk. The previous list could spend
  // the entire deadline trying several OpenAI model ids before it ever reached a healthy Anthropic
  // or Google key. Try the selected model, then the most reliable eligible model from each other
  // configured provider. Only use a second model from the same provider when no alternate provider
  // is configured at all.
  const primary = original ?? rankedCandidates[0];
  const crossProviderCandidates = primary
    ? PROVIDERS
        .filter((provider) => provider !== primary.provider)
        .map((provider) => bestProviderCandidate(rankedCandidates.filter((candidate) => candidate.provider === provider)))
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .sort(compareFallbackReliability)
    : [];
  const sameProviderAlternate = primary
    ? bestProviderCandidate(rankedCandidates.filter((candidate) => candidate.provider === primary.provider && candidate.modelId !== primary.modelId))
    : undefined;
  // Keep one independently selected alternate available by default so a zero-token transport
  // timeout cannot block the entire mission. This still produces only one paid provider response:
  // the loop below stops after any failed attempt that consumed tokens unless paid fallback was
  // explicitly enabled. Operators may force one provider or permit up to three through the env var.
  const maximumProviders = Math.max(1, Math.min(3, Number(process.env.FOUNDRY_MAX_PROVIDERS_PER_CALL) || 2));
  const candidates = (primary
    ? [primary, ...(crossProviderCandidates.length ? crossProviderCandidates : sameProviderAlternate ? [sameProviderAlternate] : [])]
    : []).slice(0, maximumProviders);
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 90_000);
  const overallSignal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  let lastResult: ManagedModelResult | undefined;
  const candidateFailures: CandidateFailure[] = [];

  for (const candidate of candidates) {
    if (overallSignal.aborted) break;
    const provider = candidate.provider;
    const apiKey = apiKeyForProvider(provider);
    if (!apiKey) continue;
    const effort = candidate.supportedEfforts.includes(request.effort ?? "low") ? request.effort : undefined;
    const candidateRequest = { ...request, provider, model: candidate.modelId, effort };
    const duplicateKey = JSON.stringify({ provider, model: candidate.modelId, system: request.system, messages: request.messages, tools: request.tools, toolChoice: request.toolChoice, maxOutputTokens: request.maxOutputTokens, effort });
    const duplicate = managedResultCache.get(duplicateKey);
    if (duplicate && duplicate.expiresAt > Date.now()) return { ...duplicate.result, usage: { ...duplicate.result.usage, cached: true, requestCount: 0 } };
    const requestId = request.routing?.requestId ?? crypto.randomUUID();
    let reservation;
    try {
      reservation = reserveModelCall(candidateRequest, {
        requestId,
        missionId: request.routing?.missionId,
        tier,
        costClass: candidate.costClass,
        budget: request.routing?.budget,
      });
    } catch (error) {
      if (error instanceof CostGuardError) {
        lastResult = blockedResult(candidateRequest, options, error.message, "guardrail");
        candidateFailures.push({ provider, model: candidate.modelId, message: error.message, kind: "guardrail" });
        break;
      }
      throw error;
    }
    // One audited provider attempt per reservation. A fallback is only started after this result
    // fails, so actual network calls cannot multiply invisibly inside one logical model call.
    // One slow provider must not consume the entire logical-call window and prevent same-tier
    // fallback. Keep the caller's overall deadline, but bound each candidate independently so a
    // healthy alternate provider can still complete the requested tool action.
    const logicalTimeoutMs = options.timeoutMs ?? 90_000;
    const candidateTimeoutMs = Math.min(75_000, Math.max(15_000, Math.floor(logicalTimeoutMs / Math.max(1, candidates.length))));
    // Always compose the per-candidate deadline with the logical call's deadline. Previously,
    // supplying the mission signal accidentally dropped the overall 90-second limit, allowing a
    // long fallback list to consume 45 seconds per model while the canvas appeared stalled.
    const candidateSignal = AbortSignal.any([overallSignal, AbortSignal.timeout(candidateTimeoutMs)]);
    const candidateOptions = { ...options, apiKey, signal: candidateSignal, timeoutMs: candidateTimeoutMs, maxAttempts: 1 };
    let result: ManagedModelResult;
    try {
      result = await callProvider(candidateRequest, candidateOptions);
      settleModelCall(reservation, result.usage);
    } catch (error) {
      releaseModelCall(reservation);
      throw error;
    }
    await recordProviderCall({
      requestId, missionId: request.routing?.missionId, stage: request.routing?.stage ?? "unspecified", tier,
      provider, model: candidate.modelId,
      reason: freshDecision?.reason ?? `Explicit ${tier} provider call with same-tier fallback.`,
      estimatedCostUsd: reservation.estimatedCostUsd, usage: result.usage,
    });
    const requiredTool = typeof request.toolChoice === "object" ? request.toolChoice.name : undefined;
    const obeyedToolChoice = !requiredTool || result.toolCalls.some((call) => call.name === requiredTool);
    const successful = result.stopReason !== "error" && obeyedToolChoice;
    // A forced tool response with no such tool cannot advance this executor at all. Suppress that
    // model for the current registry window so the executor's bounded recovery turn routes to a
    // different healthy provider instead of paying the same model for the same unusable behavior.
    reportModelHealth(provider, candidate.modelId, successful, Boolean(requiredTool && !obeyedToolChoice));
    if (successful) {
      managedResultCache.set(duplicateKey, { result, expiresAt: Date.now() + 10 * 60_000 });
      if (managedResultCache.size > 200) managedResultCache.delete(managedResultCache.keys().next().value!);
      return result;
    }
    const providerError = result.stopReason === "error" ? result.errorMessage?.trim() : "";
    const failedResult = obeyedToolChoice
      ? result
      : {
          ...result,
          stopReason: "error" as const,
          errorMessage: providerError || `Model did not call required tool ${requiredTool}.`,
          failureKind: providerError ? classifyProviderFailure(providerError) : "tool" as const,
        };
    const failureKind = failedResult.failureKind ?? classifyProviderFailure(failedResult.errorMessage);
    candidateFailures.push({ provider, model: candidate.modelId, message: failedResult.errorMessage || "Provider returned an unusable response.", kind: failureKind });
    lastResult = { ...failedResult, failureKind };
    // A charged but unusable response must not silently trigger another provider bill. Automatic
    // fallback remains available for zero-token transport failures; paid fallback is explicit opt-in.
    const consumedPaidTokens = result.usage.requestCount > 0 && result.usage.totalTokens > 0;
    if (consumedPaidTokens && process.env.FOUNDRY_ALLOW_PAID_PROVIDER_FALLBACK !== "true") break;
  }

  if (lastResult && candidateFailures.length) {
    const failureKind = candidateFailures.every((failure) => failure.kind === "transport")
      ? "transport"
      : candidateFailures.some((failure) => failure.kind === "tool")
        ? "tool"
        : candidateFailures.some((failure) => failure.kind === "guardrail")
          ? "guardrail"
          : "provider";
    return { ...lastResult, failureKind, errorMessage: summarizeCandidateFailures(candidateFailures, failureKind) };
  }
  return lastResult ?? blockedResult(request, options, "No configured model remained within the routing and cost guardrails.", "guardrail");
}

function blockedResult(request: ManagedModelRequest, options: ManagedCallOptions, message: string, failureKind: NonNullable<ManagedModelResult["failureKind"]>): ManagedModelResult {
  return {
    provider: request.provider, model: request.model, text: "", toolCalls: [], stopReason: "error", errorMessage: message,
    failureKind,
    usage: { provider: request.provider, workspaceId: options.workspaceId ?? "default-workspace", userId: options.userId ?? "default-user", model: request.model, requestedModel: request.model, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, requestCount: 0, rateLimitCount: 0, failureCount: 0, contextCompressed: false, cached: false, createdAt: new Date().toISOString() },
  };
}

function bestProviderCandidate<T extends { runtimeValidatedAt?: string; providerHealth: number }>(candidates: T[]): T | undefined {
  return [...candidates].sort(compareFallbackReliability)[0];
}

function compareFallbackReliability<T extends { runtimeValidatedAt?: string; providerHealth: number }>(left: T, right: T) {
  return Number(Boolean(right.runtimeValidatedAt)) - Number(Boolean(left.runtimeValidatedAt))
    || right.providerHealth - left.providerHealth;
}

function classifyProviderFailure(message = ""): NonNullable<ManagedModelResult["failureKind"]> {
  return /network request|fetch failed|socket|connection|timed?\s*out|timeout|aborted due to timeout|econn|enotfound|dns/i.test(message)
    ? "transport"
    : "provider";
}

function summarizeCandidateFailures(failures: CandidateFailure[], failureKind: NonNullable<ManagedModelResult["failureKind"]>) {
  const attempts = failures.slice(0, 3).map((failure) => `${failure.provider}/${failure.model}`).join(", ");
  if (failureKind === "transport") {
    return `Configured provider fallbacks timed out or could not be reached (${attempts}).`;
  }
  const last = failures.at(-1)?.message ?? "No provider produced a usable response.";
  return `Configured provider fallbacks did not produce a usable action (${attempts}). ${last}`;
}

function fallbackProfile(tier: ModelTier): TaskProfile {
  return { intent: "change", taskType: tier === "fast" ? "localized-edit" : "implementation", requestedOutcome: "", scope: { estimatedFiles: tier === "fast" ? 1 : 3, estimatedSubsystems: 1, crossLayer: false, projectWide: false }, projectScale: 0, taskLocality: 1, difficulty: 0.5, ambiguity: 0, risk: 0, blastRadius: 0.2, contextNeed: 0.4, reasoningNeed: 0.5, toolUseNeed: 0.7, visualNeed: 0, verificationNeed: 0.5, reversibility: 0.8, failureHistory: 0, recommendedIntelligenceTier: tier, recommendedExecutionDepth: "standard", confidence: 1, reasons: ["same-tier provider fallback"] };
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
  return request.effort === "high" ? "architect" : "builder";
}

function providerCost(model: string) {
  if (/flash-lite|mini|nano|haiku/i.test(model)) return 1;
  if (/flash/i.test(model)) return 2;
  if (/sonnet|gpt-5$/i.test(model)) return 3;
  return 4;
}
