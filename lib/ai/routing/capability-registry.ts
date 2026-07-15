import type { ModelCapabilities, ModelStatus, ProviderId, RegisteredModel } from "./types";

const PROVIDERS: ProviderId[] = ["openai", "anthropic", "google"];
const ALIAS = /(^|[-_.])(latest|sonnet|opus|haiku|pro)([-_.]|$)/i;

export class CapabilityRegistry {
  private models = new Map<string, RegisteredModel>();

  constructor(seed: RegisteredModel[] = configuredModels()) {
    for (const model of seed) this.upsert(model);
  }

  upsert(model: RegisteredModel) {
    this.models.set(`${model.provider}:${model.modelId}`, model);
  }

  list(provider?: ProviderId) {
    return [...this.models.values()].filter((model) => !provider || model.provider === provider);
  }

  get(provider: ProviderId, modelId: string) {
    return this.models.get(`${provider}:${modelId}`);
  }
}

export async function discoverProviderModels(apiKeys: Partial<Record<ProviderId, string>>, signal?: AbortSignal): Promise<RegisteredModel[]> {
  const discovered = await Promise.all(PROVIDERS.map(async (provider) => {
    const apiKey = apiKeys[provider];
    if (!apiKey) return configuredForProvider(provider).map((model) => ({ ...model, status: "missing-api-key" as const, available: false }));
    try {
      const ids = (await listProviderModelIds(provider, apiKey, signal)).filter((id) => isRoutableGenerativeModel(provider, id));
      const now = new Date().toISOString();
      // Listing proves catalogue availability, not that generation/tools are accepted.
      return ids.map((id) => inferModel(provider, id, "discovered", now));
    } catch (error) {
      const status: ModelStatus = error instanceof ProviderDiscoveryError ? error.status : "unavailable";
      return configuredForProvider(provider).map((model) => ({ ...model, status, available: false, lastVerifiedAt: new Date().toISOString() }));
    }
  }));
  return discovered.flat();
}

function isRoutableGenerativeModel(provider: ProviderId, id: string) {
  if (provider === "openai") return /^(gpt-5|o[1-9])/.test(id) && !/(chat-latest|search|audio|image|transcribe|tts)/i.test(id);
  if (provider === "anthropic") return /^claude-/i.test(id);
  return /^gemini-/i.test(id) && !/(image|tts|embedding|aqa)/i.test(id);
}

async function listProviderModelIds(provider: ProviderId, key: string, signal?: AbortSignal): Promise<string[]> {
  const url = provider === "openai" ? "https://api.openai.com/v1/models" : provider === "anthropic" ? "https://api.anthropic.com/v1/models?limit=100" : `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const headers: Record<string, string> = provider === "openai" ? { authorization: `Bearer ${key}` } : provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : {};
  const response = await fetch(url, { headers, signal });
  if (!response.ok) throw new ProviderDiscoveryError(response.status === 401 || response.status === 403 ? "permission-denied" : "unavailable");
  const body = await response.json() as { data?: Array<{ id?: string }>; models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
  if (provider === "google") return (body.models ?? []).filter((model) => model.supportedGenerationMethods?.includes("generateContent")).map((model) => (model.name ?? "").replace(/^models\//, "")).filter(Boolean);
  return (body.data ?? []).map((model) => model.id ?? "").filter(Boolean);
}

class ProviderDiscoveryError extends Error {
  constructor(readonly status: ModelStatus) { super(status); }
}

function configuredModels(): RegisteredModel[] {
  return PROVIDERS.flatMap(configuredForProvider);
}

function configuredForProvider(provider: ProviderId): RegisteredModel[] {
  const envNames = provider === "openai"
    ? [process.env.FOUNDRY_MODEL_FAST ?? process.env.OPENAI_FAST_MODEL, process.env.FOUNDRY_MODEL_STANDARD ?? process.env.OPENAI_MODEL]
    : provider === "anthropic"
      ? [process.env.FOUNDRY_ANTHROPIC_FAST_MODEL, process.env.FOUNDRY_ANTHROPIC_BUILDER_MODEL, process.env.FOUNDRY_ANTHROPIC_REASONING_MODEL]
      : [process.env.FOUNDRY_GOOGLE_FAST_MODEL, process.env.FOUNDRY_GOOGLE_BUILDER_MODEL, process.env.FOUNDRY_GOOGLE_REASONING_MODEL];
  return [...new Set(envNames.filter((id): id is string => Boolean(id)))].map((id) => inferModel(provider, id, ALIAS.test(id) ? "unknown-alias" : "unverified"));
}

function inferModel(provider: ProviderId, modelId: string, status: ModelStatus, verifiedAt?: string): RegisteredModel {
  const id = modelId.toLowerCase();
  const small = /(mini|nano|haiku|flash-lite)/.test(id);
  const premium = /(opus|pro|o[134](?:-|$)|reasoning|max)/.test(id);
  const codingSpecialist = /(codex|code)/.test(id);
  const strong = premium || (!small && /(sonnet|gpt-5|gemini-3)/.test(id));
  const base = small ? 0.66 : premium ? 0.95 : strong ? 0.88 : 0.76;
  const capabilities: ModelCapabilities = {
    coding: codingSpecialist ? Math.max(base, 0.93) : base, debugging: strong ? Math.max(base, 0.86) : base, architecture: premium ? 0.94 : strong ? 0.84 : 0.58,
    toolReliability: base, longContext: strong ? 0.86 : 0.68, vision: 0.7, structuredOutput: base,
    instructionFollowing: base, reasoning: premium ? 0.96 : strong ? 0.86 : 0.62,
  };
  return {
    provider, modelId, displayName: modelId, status, available: status === "valid" || status === "discovered" || status === "unverified",
    supportsTools: true, supportsStructuredOutput: true, supportsVision: true, supportsReasoning: strong,
    supportedEfforts: provider === "openai" && strong ? ["low", "medium", "high"] : [],
    costClass: premium ? "premium" : strong ? "high" : small ? "ultra-low" : "medium",
    latencyClass: small ? "fast" : premium ? "slow" : "normal", capabilities, providerHealth: 1,
    tierFit: inferTierFit({ small, premium, strong, codingSpecialist }), freshness: inferFreshness(id),
    deprecated: false, lastVerifiedAt: verifiedAt,
  };
}

function inferTierFit(flags: { small: boolean; premium: boolean; strong: boolean; codingSpecialist: boolean }): RegisteredModel["tierFit"] {
  const { small, premium, strong, codingSpecialist } = flags;
  return {
    fast: small ? 1 : premium ? 0.25 : 0.62,
    builder: codingSpecialist ? 1 : small ? 0.72 : strong ? 0.92 : 0.78,
    architect: premium ? 0.96 : strong ? 0.82 : 0.45,
    "enterprise-architect": premium ? (codingSpecialist ? 1 : 0.94) : strong ? 0.7 : 0.3,
    "super-reasoning": premium ? (codingSpecialist ? 0.94 : 1) : strong ? 0.62 : 0.2,
  };
}

function inferFreshness(id: string) {
  const version = [...id.matchAll(/(?:^|[-.])(20\d{2})[-.]?(0[1-9]|1[0-2])?[-.]?([0-3]\d)?|(?:^|[-.])(\d+)(?:\.(\d+))?/g)].at(-1);
  if (!version) return /latest/.test(id) ? 1 : 0.5;
  if (version[1]) return Math.min(1, (Number(version[1]) - 2024) * 0.2 + Number(version[2] ?? 1) / 60);
  return Math.min(1, Number(version[4] ?? 0) / 6 + Number(version[5] ?? 0) / 30);
}
