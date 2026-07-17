import { NextResponse } from "next/server";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { apiKeyForProvider, envVarNameForProvider } from "@/lib/ai/providers/dispatch";
import { TIER_DISPLAY } from "@/lib/ai/model-router";
import { profileTask } from "@/lib/ai/routing/task-profiler";
import { routePayloadDynamically } from "@/lib/ai/routing/dynamic-router";
import type { ModelMode, ModelTier } from "@/lib/ai/model-router";
import { DISCOVERY_REFINEMENT_SYSTEM_PROMPT, REFINE_PROJECT_DISCOVERY_TOOL, discoveryRefinementUserText, hasCompleteDiscoveryRefinement, parseDiscoveryRefinement } from "@/lib/ai/project-discovery-llm";
import type { DiscoveryRefinementResult } from "@/lib/ai/project-discovery-llm";
import type { DiscoveryRefinementContext } from "@/lib/ai/project-discovery-llm";
import type { ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import type { ProviderId } from "@/lib/ai/providers/types";
import type { NeutralTool } from "@/lib/ai/providers/types";
import { reconcilePlatformStackOptions } from "@/lib/discovery/platform-stack-policy";

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
  "You are Foundry's principal stack architect. The project shape is already authoritative from either a selected starter or an explicit high-confidence request; do not reclassify or interview the user.",
  "The selected platform is a hard constraint. Desktop starters require installable desktop stacks, mobile starters require mobile stacks, API starters require backend stacks, and game starters require game engines or game frameworks. Never fill those choices with unrelated web-site stacks.",
  "The supplied heuristic is the authoritative product memo. Preserve its exact project_type; your only job is the project-specific stack/language decision, not regenerating features, data models, style, or architecture prose.",
  "Choose 3-5 concrete stacks that can all build the exact requested product, using genuinely different languages/frameworks when a backend is warranted.",
  "Recommend only currently supported, security-maintained releases. Avoid pinning an obsolete major version; if current version certainty is low, name the framework without a major number.",
  "Exactly one option must be recommended. Right-size every choice and explain its fit in one short, project-specific sentence.",
  "Return only the refine_project_discovery tool call.",
].join("\n");

const COMPACT_CUSTOM_DISCOVERY_TOOL: NeutralTool = {
  name: "refine_project_discovery",
  description: "Turn an already-recognized custom project shape into a concise, request-specific build memo and stack decision.",
  parameters: {
    type: "object", additionalProperties: false,
    properties: {
      project_type: { type: "string" },
      recommended_stack: { type: "string" },
      architecture: { type: "string", description: "A concrete implementation architecture for the named project. For API/backend work, never mention UI, screens, optimistic feedback, or client-side state unless explicitly requested." },
      main_features: { type: "array", description: "Exact workflows, endpoints, tests, and documentation named in the user brief; use the project's nouns instead of generic CRUD or Resource labels.", items: { type: "string" } },
      data_model: { type: "array", description: "Named domain entities and fields from the user brief. Include every explicitly listed field; never return generic Resource, Item, or envelope placeholders when concrete nouns were provided.", items: { type: "string" } },
      alternative_stacks: { type: "array", items: { type: "string" } },
      deployment_note: { type: "string" },
      key_facts: { type: "array", items: { type: "string" } },
      future_capabilities: { type: "array", items: { type: "string" } },
      stack_options: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        name: { type: "string" }, why: { type: "string" }, recommended: { type: "boolean" },
      }, required: ["name", "why", "recommended"] } },
    },
    required: ["project_type", "recommended_stack", "architecture", "main_features", "data_model", "alternative_stacks", "deployment_note", "key_facts", "future_capabilities", "stack_options"],
  },
};

const COMPACT_CUSTOM_DISCOVERY_SYSTEM_PROMPT = [
  "You are Foundry's principal software architect. The domain and platform were already recognized with high confidence from the explicit user brief; do not interview or reclassify broadly.",
  "Produce a concise, request-specific build memo. Preserve the user's named product, resources, endpoints, workflows, persistence choice, tests, documentation, and negative constraints. Never replace concrete nouns with generic Resource or Item placeholders.",
  "Choose 3-5 concrete, security-maintained stacks that can all build the same plan. Exactly one must be recommended, and each reason must connect to this project's requirements.",
  "Recommend only currently supported releases. Do not pin a Node.js major version; say Node.js/Express with TypeScript so Foundry can use the installed maintained runtime.",
  "The first build must run locally without undeclared hosted services or secrets. Respect explicit local-file/SQLite persistence; do not invent auth, payments, databases, or a visual UI.",
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
    const domainDecision = heuristic.decisions.find((decision) => decision.dimension === "domain");
    const platformDecision = heuristic.decisions.find((decision) => decision.dimension === "platform");
    const highConfidenceCustom = !knownStarter
      && context.projectDescription.trim().split(/\s+/).length >= 12
      && (domainDecision?.confidence ?? 0) >= 85
      && (platformDecision?.confidence ?? 0) >= 85;
    // A clear custom brief already has a reliable local product memo. Ask the model only for the
    // language/stack judgment the user expects instead of resending a large principal-architect
    // essay and ten-decision schema. Ambiguous briefs still receive the full refinement call.
    const stackDecisionOnly = knownStarter || highConfidenceCustom;

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: stackDecisionOnly ? "low" : effort ?? "low",
        system: knownStarter ? STARTER_STACK_SYSTEM_PROMPT : highConfidenceCustom ? COMPACT_CUSTOM_DISCOVERY_SYSTEM_PROMPT : DISCOVERY_REFINEMENT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: discoveryRefinementUserText(context, heuristic) }],
          },
        ],
        tools: [knownStarter ? STARTER_STACK_TOOL : highConfidenceCustom ? COMPACT_CUSTOM_DISCOVERY_TOOL : REFINE_PROJECT_DISCOVERY_TOOL],
        toolChoice: { name: "refine_project_discovery" },
        // Was 3000 — with stack_options added, that budget was too tight and the model's tool-call JSON
        // was getting truncated before parsing could succeed, silently falling back to defaults on every
        // call. Reasoning tokens count against this same budget, so headroom matters here.
        maxOutputTokens: knownStarter ? 1000 : highConfidenceCustom ? 1800 : 3200,
      },
      {
        apiKey,
        workspaceId: "factory-discover",
        userId: "local-user",
        maxAttempts: 1,
        signal: request.signal,
        timeoutMs: stackDecisionOnly ? 24_000 : 45_000,
      },
    );

    const call = result.toolCalls.find((item) => item.name === "refine_project_discovery");
    if (!call?.arguments
      || (highConfidenceCustom && !hasCompleteCompactCustomRefinement(call.arguments))
      || (!stackDecisionOnly && !hasCompleteDiscoveryRefinement(call.arguments))) {
      return NextResponse.json(
        {
          ok: false,
          error: result.errorMessage || "The discovery model did not return a complete project decision before the time limit.",
        },
        { status: 502 },
      );
    }
    const parsedRefinement = sanitizeDiscoveryStackLabels(parseDiscoveryRefinement(call?.arguments, heuristic));
    const platformContract = reconcilePlatformStackOptions(context.starter.id, parsedRefinement.discovery, parsedRefinement.stackOptions);
    const refined: DiscoveryRefinementResult = {
      ...parsedRefinement,
      discovery: { ...parsedRefinement.discovery, recommendedStack: platformContract.recommendedStack },
      stackOptions: platformContract.stackOptions,
      alternativeStacks: platformContract.stackOptions.filter((option) => !option.recommended).map((option) => option.name),
    };

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
        platformContractRepaired: platformContract.repaired,
        platformFamily: platformContract.family,
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

function hasCompleteCompactCustomRefinement(rawArguments: string | undefined) {
  if (!rawArguments) return false;
  try {
    const value = JSON.parse(rawArguments) as Record<string, unknown>;
    return ["project_type", "recommended_stack", "architecture", "deployment_note"].every((key) => typeof value[key] === "string" && Boolean((value[key] as string).trim()))
      && ["main_features", "data_model", "alternative_stacks", "key_facts", "future_capabilities", "stack_options"].every((key) => Array.isArray(value[key]) && (value[key] as unknown[]).length > 0);
  } catch {
    return false;
  }
}

function sanitizeDiscoveryStackLabels(refined: DiscoveryRefinementResult): DiscoveryRefinementResult {
  const normalize = (value: string) => value.replace(/\bNode(?:\.js)?\s*\d+\b/gi, "Node.js");
  return {
    ...refined,
    discovery: { ...refined.discovery, recommendedStack: normalize(refined.discovery.recommendedStack) },
    alternativeStacks: refined.alternativeStacks.map(normalize),
    stackOptions: refined.stackOptions.map((option) => ({ ...option, name: normalize(option.name) })),
  };
}
