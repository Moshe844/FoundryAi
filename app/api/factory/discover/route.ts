import { NextResponse } from "next/server";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { apiKeyForProvider, envVarNameForProvider } from "@/lib/ai/providers/dispatch";
import { TIER_DISPLAY } from "@/lib/ai/model-router";
import { profileTask } from "@/lib/ai/routing/task-profiler";
import { routePayloadDynamically } from "@/lib/ai/routing/dynamic-router";
import type { ModelMode, ModelTier } from "@/lib/ai/model-router";
import { DISCOVERY_REFINEMENT_SYSTEM_PROMPT, REFINE_PROJECT_DISCOVERY_TOOL, discoveryRefinementUserText, parseDiscoveryRefinement } from "@/lib/ai/project-discovery-llm";
import type { DiscoveryRefinementContext } from "@/lib/ai/project-discovery-llm";
import type { ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import type { ProviderId } from "@/lib/ai/providers/types";
import type { NeutralTool } from "@/lib/ai/providers/types";

const DEFAULT_MODE: ModelMode = "builder";

const STARTER_STACK_TOOL: NeutralTool = {
  name: "refine_project_discovery",
  description: "Choose several concrete language and stack options for an already-known starter project.",
  parameters: {
    type: "object", additionalProperties: false,
    properties: {
      project_type: { type: "string" },
      recommended_stack: { type: "string" },
      alternative_stacks: { type: "array", items: { type: "string" } },
      stack_options: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        name: { type: "string" }, why: { type: "string" }, recommended: { type: "boolean" },
      }, required: ["name", "why", "recommended"] } },
    },
    required: ["project_type", "recommended_stack", "alternative_stacks", "stack_options"],
  },
};

const STARTER_STACK_SYSTEM_PROMPT = [
  "You are Foundry's principal stack architect. The project category and subtype are already authoritative; do not reclassify or interview the user.",
  "The supplied heuristic is the authoritative product memo. Preserve its exact subtype in project_type; your only job is the project-specific stack/language decision, not regenerating features, data models, style, or architecture prose.",
  "Choose 3-5 concrete stacks that can all build the exact requested product, using genuinely different languages/frameworks when a backend is warranted.",
  "Recommend only currently supported, security-maintained releases. Avoid pinning an obsolete major version; if current version certainty is low, name the framework without a major number.",
  "Exactly one option must be recommended. Right-size every choice and explain its fit in one short, project-specific sentence.",
  "Return only the refine_project_discovery tool call.",
].join("\n");

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
    const discoveryProfile = profileTask({
      message: `Create project: ${context.projectDescription || heuristic.projectType}. Stack: ${heuristic.recommendedStack}. ${heuristic.keyFacts.join(" ")}`,
      likelyFiles: /\b(?:html|css|vanilla|static)\b/i.test(heuristic.recommendedStack) ? ["index.html", "styles.css", "script.js"] : undefined,
      requestedDepth: "standard",
    });
    const tier: ModelTier = autoSelected ? discoveryProfile.recommendedIntelligenceTier : mode;
    const routed = await routePayloadDynamically({ context, heuristic }, tier, body.provider);
    provider = routed.decision.provider;
    apiKey = apiKeyForProvider(provider);
    if (!apiKey) return NextResponse.json({ ok: false, error: "No configured AI provider is available.", discovery: heuristic }, { status: 503 });
    const { model, effort } = routed.decision;
    const knownStarter = Boolean(context.starter.id && context.starter.id !== "custom");

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: knownStarter ? "low" : effort ?? "low",
        system: knownStarter ? STARTER_STACK_SYSTEM_PROMPT : DISCOVERY_REFINEMENT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: discoveryRefinementUserText(context, heuristic) }],
          },
        ],
        tools: [knownStarter ? STARTER_STACK_TOOL : REFINE_PROJECT_DISCOVERY_TOOL],
        toolChoice: { name: "refine_project_discovery" },
        // Was 3000 — with stack_options added, that budget was too tight and the model's tool-call JSON
        // was getting truncated before parsing could succeed, silently falling back to defaults on every
        // call. Reasoning tokens count against this same budget, so headroom matters here.
        maxOutputTokens: knownStarter ? 1000 : 6000,
      },
      { apiKey, workspaceId: "factory-discover", userId: "local-user", maxAttempts: knownStarter ? 1 : 2 },
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
        taskType: discoveryProfile.taskType,
        missionComplexity: discoveryProfile.missionComplexity,
        repositoryComplexity: discoveryProfile.repositoryComplexity,
        expectedFiles: discoveryProfile.expectedFiles,
        executionDepth: discoveryProfile.recommendedExecutionDepth,
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
