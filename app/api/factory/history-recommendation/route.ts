import { NextResponse } from "next/server";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { apiKeyForProvider, envVarNameForProvider } from "@/lib/ai/providers/dispatch";
import { TIER_DISPLAY } from "@/lib/ai/model-router";
import { routePayloadDynamically } from "@/lib/ai/routing/dynamic-router";
import type { ModelMode, ModelTier } from "@/lib/ai/model-router";
import { HISTORY_RECOMMENDATION_SYSTEM_PROMPT, SUGGEST_NEXT_PROJECT_TOOL, historyRecommendationUserText, parseHistoryRecommendations } from "@/lib/discovery/history-recommendations";
import type { HistoryRecommendation, HistorySummaryItem } from "@/lib/discovery/history-recommendations";
import type { ProviderId } from "@/lib/ai/providers/types";

const DEFAULT_MODE: ModelMode = "fast";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { history?: HistorySummaryItem[]; heuristic?: HistoryRecommendation[]; provider?: ProviderId; mode?: ModelMode };
    const heuristic = body.heuristic ?? [];
    if (!heuristic.length) {
      return NextResponse.json({ ok: false, error: "A heuristic recommendation is required." }, { status: 400 });
    }

    // provider defaults to "openai" — see app/api/factory/intent/route.ts for the same pattern and rationale.
    let provider: ProviderId = body.provider ?? "openai";
    let apiKey = apiKeyForProvider(provider);
    if (body.provider && !apiKey) {
      return NextResponse.json({ ok: false, error: `${envVarNameForProvider(provider)} is not configured.`, recommendations: heuristic }, { status: 503 });
    }

    const history = compactHistory(body.history);
    // mode defaults to "fast" — the fixed tier this route always used before the mode selector existed.
    const mode: ModelMode = body.mode ?? DEFAULT_MODE;
    const autoSelected = mode === "auto";
    // A suggestion card is always a low-stakes Fast task. Never let project-history wording route
    // passive personalization to Builder/Architect capacity that belongs to actual implementation.
    const tier: ModelTier = "fast";
    const routed = await routePayloadDynamically(history, tier, body.provider);
    provider = routed.decision.provider;
    apiKey = apiKeyForProvider(provider);
    if (!apiKey) return NextResponse.json({ ok: false, error: "No configured AI provider is available.", recommendations: heuristic }, { status: 503 });
    const { model, effort } = routed.decision;

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: effort ?? "low",
        system: HISTORY_RECOMMENDATION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: [{ type: "text", text: historyRecommendationUserText(history) }] }],
        tools: [SUGGEST_NEXT_PROJECT_TOOL],
        toolChoice: { name: "suggest_next_project" },
        maxOutputTokens: 600,
      },
      { apiKey, workspaceId: "factory-history-recommendation", userId: "local-user", maxAttempts: 1 },
    );

    const call = result.toolCalls.find((item) => item.name === "suggest_next_project");
    const recommendations = parseHistoryRecommendations(call?.arguments, heuristic);

    return NextResponse.json({
      ok: true,
      recommendations,
      usage: result.usage,
      modelSelection: {
        tier,
        provider,
        model,
        autoSelected,
        reason: autoSelected ? `Auto-classified as ${TIER_DISPLAY[tier].label} from the project history.` : undefined,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "History recommendation generation failed." },
      { status: 500 },
    );
  }
}

function compactHistory(history: HistorySummaryItem[] | undefined): HistorySummaryItem[] {
  return (history ?? []).slice(0, 10).map((item) => ({
    title: truncate(item.title, 120) ?? "",
    domain: truncate(item.domain, 60) ?? "",
    stack: truncate(item.stack, 60) ?? "",
    status: truncate(item.status, 40) ?? "",
  }));
}

function truncate(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
