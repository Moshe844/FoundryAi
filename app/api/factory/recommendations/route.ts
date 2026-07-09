import { NextResponse } from "next/server";
import { callOpenAIResponsesManaged } from "@/lib/ai/foundry-runtime";
import { modelForProfile } from "@/lib/ai/model-router";
import { buildRecommendationsRequestBody, parseRecommendations } from "@/lib/ai/mission/recommendations";
import type { MissionRecommendation, RecommendationContext } from "@/lib/ai/mission/recommendations";

type RecommendOutputItem = {
  type?: string;
  name?: string;
  arguments?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { context?: RecommendationContext; heuristic?: MissionRecommendation[] };
    const heuristic = body.heuristic ?? [];
    if (!heuristic.length) {
      return NextResponse.json({ ok: false, error: "A heuristic recommendation list is required." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY is not configured.", recommendations: heuristic }, { status: 503 });
    }

    const context = compactContext(body.context);
    const model = modelForProfile("fast").model;

    const result = await callOpenAIResponsesManaged<{ output?: RecommendOutputItem[]; error?: { message?: string } }>({
      apiKey,
      body: JSON.stringify(buildRecommendationsRequestBody(context, model)),
      workspaceId: "factory-recommendations",
      userId: "local-user",
      maxAttempts: 2,
    });

    const call = result.data.output?.find((item) => item.type === "function_call" && item.name === "suggest_improvements");
    const recommendations = parseRecommendations(call?.arguments, heuristic);

    return NextResponse.json({ ok: true, recommendations, usage: result.usage });
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
