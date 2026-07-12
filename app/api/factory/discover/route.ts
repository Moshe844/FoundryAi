import { NextResponse } from "next/server";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { apiKeyForProvider, envVarNameForProvider, providerForTier } from "@/lib/ai/providers/dispatch";
import { TIER_DISPLAY, resolveModelForTier, tierForRuntimePayload } from "@/lib/ai/model-router";
import type { ModelMode, ModelTier } from "@/lib/ai/model-router";
import { DISCOVERY_REFINEMENT_SYSTEM_PROMPT, REFINE_PROJECT_DISCOVERY_TOOL, discoveryRefinementUserText, parseDiscoveryRefinement } from "@/lib/ai/project-discovery-llm";
import type { DiscoveryRefinementContext } from "@/lib/ai/project-discovery-llm";
import type { ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import type { ProviderId } from "@/lib/ai/providers/types";

const DEFAULT_MODE: ModelMode = "builder";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { context?: DiscoveryRefinementContext; heuristic?: ProjectDiscoveryResult; provider?: ProviderId; mode?: ModelMode };
    const heuristic = body.heuristic;
    if (!heuristic) {
      return NextResponse.json({ ok: false, error: "A heuristic discovery result is required." }, { status: 400 });
    }

    // provider defaults to "openai" — see app/api/factory/intent/route.ts for the same pattern and rationale.
    let provider: ProviderId = body.provider ?? "openai";
    let apiKey = apiKeyForProvider(provider);
    if (body.provider && !apiKey) {
      return NextResponse.json({ ok: false, error: `${envVarNameForProvider(provider)} is not configured.`, discovery: heuristic, alternativeStacks: [], deploymentNote: "", lede: "" }, { status: 503 });
    }

    const context = compactContext(body.context);
    // mode defaults to "builder" — the fixed tier this route always used before the mode selector
    // existed, so a client that doesn't send mode gets byte-identical behavior. "auto" classifies from
    // the actual project context/description rather than re-deriving anything client-side.
    const mode: ModelMode = body.mode ?? DEFAULT_MODE;
    const autoSelected = mode === "auto";
    const tier: ModelTier = autoSelected ? tierForRuntimePayload({ context, heuristic }) : mode;
    if (!body.provider) {
      const automatic = providerForTier(tier);
      provider = automatic?.provider ?? provider;
      apiKey = automatic?.apiKey;
    }
    if (!apiKey) return NextResponse.json({ ok: false, error: "No configured AI provider is available.", discovery: heuristic }, { status: 503 });
    const { model, effort } = resolveModelForTier(tier, { provider });

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: effort ?? "medium",
        system: DISCOVERY_REFINEMENT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: discoveryRefinementUserText(context, heuristic) }],
          },
        ],
        tools: [REFINE_PROJECT_DISCOVERY_TOOL],
        toolChoice: { name: "refine_project_discovery" },
        // Was 3000 — with stack_options added, that budget was too tight and the model's tool-call JSON
        // was getting truncated before parsing could succeed, silently falling back to defaults on every
        // call. Reasoning tokens count against this same budget, so headroom matters here.
        maxOutputTokens: 6000,
      },
      { apiKey, workspaceId: "factory-discover", userId: "local-user", maxAttempts: 2 },
    );

    const call = result.toolCalls.find((item) => item.name === "refine_project_discovery");
    const refined = parseDiscoveryRefinement(call?.arguments, heuristic);

    return NextResponse.json({
      ok: true,
      discovery: refined.discovery,
      alternativeStacks: refined.alternativeStacks,
      deploymentNote: refined.deploymentNote,
      lede: refined.lede,
      stackOptions: refined.stackOptions,
      usage: result.usage,
      modelSelection: {
        tier,
        provider,
        model,
        autoSelected,
        reason: autoSelected ? `Auto-classified as ${TIER_DISPLAY[tier].label} from the project description.` : undefined,
      },
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
