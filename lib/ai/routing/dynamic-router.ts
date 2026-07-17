import { CapabilityRegistry, discoverProviderModels } from "@/lib/ai/routing/capability-registry";
import { selectModel } from "@/lib/ai/routing/selector";
import { profileTask, type TaskContext } from "@/lib/ai/routing/task-profiler";
import type { ModelTier, RoutingBudget, RoutingDecision, RoutingPreference } from "@/lib/ai/routing/types";
import type { ProviderId } from "@/lib/ai/providers/types";
import { recordRoutingDecision } from "@/lib/ai/routing/telemetry";
import { getLiveRegistry, liveRegistryRefreshedAt, liveRegistrySnapshot, setLiveRegistry } from "@/lib/ai/routing/registry-state";

const REFRESH_MS = 10 * 60 * 1000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 5_000;
let refreshPromise: Promise<CapabilityRegistry> | undefined;

export async function refreshModelRegistry(force = false): Promise<CapabilityRegistry> {
  const current = getLiveRegistry();
  if (!force && current.list().length && Date.now() - liveRegistryRefreshedAt() < REFRESH_MS) return current;
  if (refreshPromise) return refreshPromise;
  const configuredTimeout = Number(process.env.FOUNDRY_MODEL_DISCOVERY_TIMEOUT_MS);
  const discoveryTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.min(configuredTimeout, 20_000)
    : DEFAULT_DISCOVERY_TIMEOUT_MS;
  // Catalogue discovery improves routing, but it is not the user's mission. A provider whose model
  // listing endpoint stalls must never leave the canvas hanging before the first paid call. Keep the
  // configured registry available and bound the refresh independently from executor/provider timeouts.
  refreshPromise = discoverProviderModels(
    { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY, google: process.env.GEMINI_API_KEY },
    AbortSignal.timeout(discoveryTimeoutMs),
  )
    .then((models) => {
      for (const model of models) {
        const previous = current.get(model.provider, model.modelId);
        if (previous) {
          model.providerHealth = previous.providerHealth;
          if (model.status === "unavailable" && previous.available) {
            model.status = previous.status;
            model.available = true;
            model.lastVerifiedAt = previous.lastVerifiedAt;
          }
          if (previous.runtimeValidatedAt) {
            model.runtimeValidatedAt = previous.runtimeValidatedAt;
            model.status = "valid";
            model.available = true;
          }
        }
      }
      const registry = new CapabilityRegistry(models);
      setLiveRegistry(registry);
      return registry;
    })
    .finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}

export async function routeDynamically(input: TaskContext & {
  tier?: ModelTier;
  preference?: RoutingPreference;
  budget?: RoutingBudget;
  preferredProvider?: ProviderId;
  disabledProviders?: ProviderId[];
  missionId?: string;
  stepId?: string;
}): Promise<{ profile: ReturnType<typeof profileTask>; decision: RoutingDecision }> {
  const registry = await refreshModelRegistry();
  const profile = profileTask(input);
  if (input.tier) profile.recommendedIntelligenceTier = input.tier;
  const decision = selectModel(profile, registry, input);
  if (!decision) throw new Error(`No validated, healthy model satisfies ${profile.recommendedIntelligenceTier} requirements within the current provider and budget constraints.`);
  await recordRoutingDecision(decision, profile, input);
  return { profile, decision };
}

export function liveModelRegistrySnapshot() {
  return liveRegistrySnapshot();
}

export function reportModelHealth(provider: ProviderId, modelId: string, success: boolean, suppressForCurrentRegistry = false) {
  const registry = getLiveRegistry();
  const model = registry.get(provider, modelId);
  if (!model) return;
  model.providerHealth = Math.max(0.1, Math.min(1, model.providerHealth * 0.8 + (success ? 1 : 0) * 0.2));
  if (success) {
    model.status = "valid";
    model.runtimeValidatedAt = new Date().toISOString();
  }
  if (!success && (suppressForCurrentRegistry || model.providerHealth < 0.35)) model.available = false;
  registry.upsert(model);
}

export async function routePayloadDynamically(payload: unknown, tier: ModelTier, preferredProvider?: ProviderId) {
  return routeDynamically({
    message: typeof payload === "string" ? payload : JSON.stringify(payload),
    tier,
    preferredProvider,
    disabledProviders: preferredProvider ? (["openai", "anthropic", "google"] as ProviderId[]).filter((provider) => provider !== preferredProvider) : undefined,
  });
}
