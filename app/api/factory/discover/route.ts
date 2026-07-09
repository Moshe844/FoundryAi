import { NextResponse } from "next/server";
import { callOpenAIResponsesManaged } from "@/lib/ai/foundry-runtime";
import { modelForProfile } from "@/lib/ai/model-router";
import { buildDiscoveryRequestBody, parseDiscoveryRefinement } from "@/lib/ai/project-discovery-llm";
import type { DiscoveryRefinementContext } from "@/lib/ai/project-discovery-llm";
import type { ProjectDiscoveryResult } from "@/lib/ai/project-discovery";

type DiscoverOutputItem = {
  type?: string;
  name?: string;
  arguments?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { context?: DiscoveryRefinementContext; heuristic?: ProjectDiscoveryResult };
    const heuristic = body.heuristic;
    if (!heuristic) {
      return NextResponse.json({ ok: false, error: "A heuristic discovery result is required." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY is not configured.", discovery: heuristic, alternativeStacks: [], deploymentNote: "", lede: "" }, { status: 503 });
    }

    const context = compactContext(body.context);
    const model = modelForProfile("standard").model;

    const result = await callOpenAIResponsesManaged<{ output?: DiscoverOutputItem[]; error?: { message?: string } }>({
      apiKey,
      body: JSON.stringify(buildDiscoveryRequestBody(context, heuristic, model)),
      workspaceId: "factory-discover",
      userId: "local-user",
      maxAttempts: 2,
    });

    const call = result.data.output?.find((item) => item.type === "function_call" && item.name === "refine_project_discovery");
    const refined = parseDiscoveryRefinement(call?.arguments, heuristic);

    return NextResponse.json({
      ok: true,
      discovery: refined.discovery,
      alternativeStacks: refined.alternativeStacks,
      deploymentNote: refined.deploymentNote,
      lede: refined.lede,
      usage: result.usage,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Discovery refinement failed.",
      },
      { status: 500 },
    );
  }
}

function compactContext(context: DiscoveryRefinementContext | undefined): DiscoveryRefinementContext {
  return {
    starter: {
      id: truncate(context?.starter?.id, 60) ?? "",
      title: truncate(context?.starter?.title, 120) ?? "",
    },
    subtype: truncate(context?.subtype, 120) ?? "",
    customSubtype: truncate(context?.customSubtype, 200) ?? "",
    projectDescription: truncate(context?.projectDescription, 2000) ?? "",
    location: {
      choice: truncate(context?.location?.choice, 60) ?? "",
      label: truncate(context?.location?.label, 200) ?? "",
      existingSourceRisky: Boolean(context?.location?.existingSourceRisky),
      existingSourceSignals: (context?.location?.existingSourceSignals ?? []).slice(0, 15).map((item) => truncate(item, 160) ?? ""),
    },
  };
}

function truncate(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
