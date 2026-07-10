import { NextResponse } from "next/server";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { apiKeyForProvider, envVarNameForProvider } from "@/lib/ai/providers/dispatch";
import { TIER_DISPLAY, resolveModelForTier, tierForRuntimePayload } from "@/lib/ai/model-router";
import type { ModelMode, ModelTier } from "@/lib/ai/model-router";
import { RECOMMENDATIONS_SYSTEM_PROMPT, SUGGEST_IMPROVEMENTS_TOOL, parseRecommendations, recommendationsUserText } from "@/lib/ai/mission/recommendations";
import type { MissionRecommendation, RecommendationContext } from "@/lib/ai/mission/recommendations";
import type { ProviderId } from "@/lib/ai/providers/types";

const DEFAULT_MODE: ModelMode = "fast";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { context?: RecommendationContext; heuristic?: MissionRecommendation[]; provider?: ProviderId; mode?: ModelMode };
    const heuristic = body.heuristic ?? [];
    if (!heuristic.length) {
      return NextResponse.json({ ok: false, error: "A heuristic recommendation list is required." }, { status: 400 });
    }

    // provider defaults to "openai" — see app/api/factory/intent/route.ts for the same pattern and rationale.
    const provider: ProviderId = body.provider ?? "openai";
    const apiKey = apiKeyForProvider(provider);
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: `${envVarNameForProvider(provider)} is not configured.`, recommendations: heuristic }, { status: 503 });
    }

    const context = compactContext(body.context);
    // mode defaults to "fast" — the fixed tier this route always used before the mode selector existed.
    const mode: ModelMode = body.mode ?? DEFAULT_MODE;
    const autoSelected = mode === "auto";
    const tier: ModelTier = autoSelected ? tierForRuntimePayload(context) : mode;
    const { model, effort } = resolveModelForTier(tier, { provider });

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: effort ?? "low",
        system: RECOMMENDATIONS_SYSTEM_PROMPT,
        messages: [{ role: "user", content: [{ type: "text", text: recommendationsUserText(context) }] }],
        tools: [SUGGEST_IMPROVEMENTS_TOOL],
        toolChoice: { name: "suggest_improvements" },
        maxOutputTokens: 1500,
      },
      { apiKey, workspaceId: "factory-recommendations", userId: "local-user", maxAttempts: 2 },
    );

    const call = result.toolCalls.find((item) => item.name === "suggest_improvements");
    const recommendations = parseRecommendations(call?.arguments, heuristic);

    return NextResponse.json({
      ok: true,
      recommendations,
      usage: result.usage,
      modelSelection: {
        tier,
        provider,
        model,
        autoSelected,
        reason: autoSelected ? `Auto-classified as ${TIER_DISPLAY[tier].label} from the project context.` : undefined,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Recommendation generation failed." },
      { status: 500 },
    );
  }
}

function compactContext(context: RecommendationContext | undefined): RecommendationContext {
  return {
    brief: truncate(context?.brief, 4000) ?? "",
    objective: truncate(context?.objective, 500) ?? "",
    stack: truncate(context?.stack, 120) ?? "",
    changedFiles: (context?.changedFiles ?? []).slice(0, 30).map((item) => truncate(item, 200) ?? ""),
    checklistLabels: (context?.checklistLabels ?? []).slice(0, 20).map((item) => truncate(item, 160) ?? ""),
  };
}

function truncate(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
