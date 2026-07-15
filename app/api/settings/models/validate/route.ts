import { NextResponse } from "next/server";
import { refreshModelRegistry } from "@/lib/ai/routing/dynamic-router";
import { resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import { apiKeyForProvider, callManagedModel } from "@/lib/ai/providers/dispatch";

export async function POST(request: Request) {
  if (request.signal.aborted) return NextResponse.json({ error: "Validation cancelled." }, { status: 499 });
  const registry = await refreshModelRegistry(true);
  const tiers: ModelTier[] = ["fast", "builder", "architect", "enterprise-architect", "super-reasoning"];
  const candidates = [...new Map(tiers.map((tier) => {
    const resolved = resolveModelForTier(tier);
    return [`${resolved.provider}:${resolved.model}`, resolved] as const;
  })).values()];
  const probes = await Promise.all(candidates.map(async (candidate) => {
    const apiKey = apiKeyForProvider(candidate.provider);
    if (!apiKey) return { ...candidate, ok: false, error: "Missing API key" };
    const result = await callManagedModel({
      provider: candidate.provider, model: candidate.model, effort: candidate.effort, maxOutputTokens: 32,
      messages: [{ role: "user", content: [{ type: "text", text: "Call the foundry_model_probe tool once." }] }],
      tools: [{ name: "foundry_model_probe", description: "Confirms that this model can use Foundry tools.", parameters: { type: "object", properties: {}, additionalProperties: false } }],
      toolChoice: { name: "foundry_model_probe" },
    }, { apiKey, maxAttempts: 1, timeoutMs: 20_000, signal: request.signal });
    return { ...candidate, requestedProvider: candidate.provider, requestedModel: candidate.model, provider: result.provider, model: result.model, ok: result.stopReason === "tool_call", error: result.errorMessage };
  }));
  const models = registry.list();
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    probes,
    models: models.map(({ provider, modelId, displayName, status, available, deprecated, lastVerifiedAt, runtimeValidatedAt }) => ({ provider, modelId, displayName, status, available, deprecated, lastDiscoveredAt: lastVerifiedAt, runtimeValidatedAt })),
  });
}
