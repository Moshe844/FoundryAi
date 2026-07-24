import { NextResponse } from "next/server";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { apiKeyForProvider, envVarNameForProvider } from "@/lib/ai/providers/dispatch";
import { TIER_DISPLAY } from "@/lib/ai/model-router";
import { profileTask } from "@/lib/ai/routing/task-profiler";
import { routePayloadDynamically } from "@/lib/ai/routing/dynamic-router";
import type { ModelMode, ModelTier } from "@/lib/ai/model-router";
import { DISCOVERY_REFINEMENT_SYSTEM_PROMPT, REFINE_PROJECT_DISCOVERY_TOOL, discoveryRefinementDepth, discoveryRefinementUserText, hasCompleteDiscoveryRefinement, parseDiscoveryRefinement } from "@/lib/ai/project-discovery-llm";
import type { DiscoveryRefinementResult } from "@/lib/ai/project-discovery-llm";
import type { DiscoveryRefinementContext } from "@/lib/ai/project-discovery-llm";
import { explicitPersistenceFromPrompt, explicitProjectNameFromPrompt, explicitStackFromPrompt, reconcileDiscoveryWithExplicitBrief, reconcileDiscoveryWithUserProductSignal, type ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import type { ProviderId } from "@/lib/ai/providers/types";
import type { NeutralTool } from "@/lib/ai/providers/types";
import { discoveryWithSelectedStack, platformFamilyForProject } from "@/lib/discovery/platform-stack-policy";
import { composeProjectArchitecture, defaultEnvironmentCapabilities, extractProductProfile, recommendStack } from "@/lib/certified-build";

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
    const subtypeSignal = (context.customSubtype || context.subtype || "").trim();
    const subtypeIsGeneric = !subtypeSignal || /^(other\s*\/?\s*custom|other|general|custom|none|misc(?:ellaneous)?)$/i.test(subtypeSignal);
    const authoritativeBrief = [
      context.projectDescription.trim(),
      subtypeIsGeneric ? "" : `Selected product: ${subtypeSignal}`,
      context.starter.title ? `Selected starter: ${context.starter.title}` : "",
      heuristic.prompt,
    ].filter(Boolean).join("\n");
    const preserveUserProductSignal = (discovery: ProjectDiscoveryResult) => reconcileDiscoveryWithUserProductSignal(
      reconcileDiscoveryWithExplicitBrief(discovery, authoritativeBrief),
      { productSignal: subtypeIsGeneric ? context.projectDescription.trim() : subtypeSignal, starterTitle: context.starter.title },
    );
    // mode defaults to "builder" — the fixed tier this route always used before the mode selector
    // existed, so a client that doesn't send mode gets byte-identical behavior. "auto" classifies from
    // the actual project context/description rather than re-deriving anything client-side.
    const mode: ModelMode = body.mode ?? DEFAULT_MODE;
    const autoSelected = mode === "auto";
    const discoveryProfile = profileTask({
      message: `Create project: ${authoritativeBrief || heuristic.projectType}. Stack: ${heuristic.recommendedStack}. ${heuristic.keyFacts.join(" ")}`,
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
    const descriptionWordCount = context.projectDescription.trim().split(/\s+/).filter(Boolean).length;
    // The subtype/category the user picked is real product signal, not decoration. Exclude placeholder
    // values ("Other / Custom", "General", etc.) so an unmodified default doesn't force a full pass.
    const subtypeWordCount = subtypeIsGeneric ? 0 : subtypeSignal.split(/\s+/).filter(Boolean).length;
    const highConfidenceCustom = !knownStarter
      && descriptionWordCount >= 12
      && (domainDecision?.confidence ?? 0) >= 85
      && (platformDecision?.confidence ?? 0) >= 85;
    // Depth = how much of the understanding the model regenerates. A starter card with no product signal
    // (no description AND only a generic subtype) gets a stack-only pass — the category template is all
    // we know. A starter card WITH a typed description OR a specific chosen subtype, or an ambiguous
    // custom brief, gets the full description-driven refinement so features/entities/architecture
    // reflect what the user actually picked — not a generic template.
    const depth = discoveryRefinementDepth({ knownStarter, descriptionWordCount, subtypeWordCount, highConfidenceCustom });
    const starterStackOnly = depth === "starter-stack";
    const useCompactCustom = depth === "compact-custom";
    // Controls model effort/timeout only; the stack-only and compact-custom passes are both fast.
    const stackDecisionOnly = starterStackOnly || useCompactCustom;

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: stackDecisionOnly ? "low" : effort ?? "low",
        system: starterStackOnly ? STARTER_STACK_SYSTEM_PROMPT : useCompactCustom ? COMPACT_CUSTOM_DISCOVERY_SYSTEM_PROMPT : DISCOVERY_REFINEMENT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: discoveryRefinementUserText(context, heuristic) }],
          },
        ],
        tools: [starterStackOnly ? STARTER_STACK_TOOL : useCompactCustom ? COMPACT_CUSTOM_DISCOVERY_TOOL : REFINE_PROJECT_DISCOVERY_TOOL],
        toolChoice: { name: "refine_project_discovery" },
        // Was 3000 — with stack_options added, that budget was too tight and the model's tool-call JSON
        // was getting truncated before parsing could succeed, silently falling back to defaults on every
        // call. Reasoning tokens count against this same budget, so headroom matters here.
        maxOutputTokens: starterStackOnly ? 1000 : useCompactCustom ? 1800 : 3200,
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
      || (useCompactCustom && !hasCompleteCompactCustomRefinement(call.arguments))
      || (!stackDecisionOnly && !hasCompleteDiscoveryRefinement(call.arguments))) {
      const explicitBriefCanProceed = !knownStarter
        && Boolean(explicitStackFromPrompt(authoritativeBrief))
        && context.projectDescription.trim().split(/\s+/).length >= 12;
      // A heuristic seed is always present (required at the top of this handler), and showing it is
      // always better than a hard error: it is exactly what the user saw before refinement ran, plus
      // the correct platform/stack contract. The full description-specific refinement is the model's
      // real value-add, but it can time out or truncate — when it does, degrade to the seed, never to a
      // 502. This makes discovery reliable across the board: worst case is the generic-but-valid seed,
      // best case is the specific understanding.
      const fallbackDiscovery = { ...preserveUserProductSignal(heuristic), prompt: authoritativeBrief };
      const certified = certifiedDecision(authoritativeBrief, fallbackDiscovery);
      const platformContract = certifiedPlatformContract(context.starter.id, certified.discovery, certified.stackOptions);
      return NextResponse.json({
        ok: true,
        provenance: "brief",
        discovery: { ...certified.discovery, recommendedStack: platformContract.recommendedStack },
        alternativeStacks: platformContract.stackOptions.filter((option) => !option.recommended).map((option) => option.name),
        deploymentNote: deploymentNoteRespectingExplicitPersistence(
          authoritativeBrief,
          "The starter's platform and stack contract is authoritative; deployment will be verified from the generated project's real tooling.",
        ),
        lede: explicitBriefCanProceed
          ? "Foundry preserved the explicit project brief after the optional discovery refinement returned an incomplete payload."
          : "Foundry preserved your selected product scope with deterministic discovery because optional model refinement did not complete; you can still edit any decision before building.",
        stackOptions: platformContract.stackOptions,
        productProfile: certified.productProfile,
        stackRecommendation: certified.stackRecommendation,
        projectArchitecture: certified.projectArchitecture,
        usage: result.usage,
        incompleteRefinement: true,
        modelSelection: {
          tier,
          provider,
          model,
          autoSelected,
          reason: "The model refinement was incomplete, so Foundry used the explicit brief-derived decision instead of blocking or inventing a different stack.",
          taskType: discoveryProfile.taskType,
          missionComplexity: discoveryProfile.missionComplexity,
          repositoryComplexity: discoveryProfile.repositoryComplexity,
          expectedFiles: discoveryProfile.expectedFiles,
          executionDepth: discoveryProfile.recommendedExecutionDepth,
          platformContractRepaired: platformContract.repaired,
          platformFamily: platformContract.family,
        },
      });
    }
    const parsedRefinement = sanitizeDiscoveryStackLabels(parseDiscoveryRefinement(call?.arguments, heuristic));
    const explicitProjectName = explicitProjectNameFromPrompt(authoritativeBrief);
    if (explicitProjectName) parsedRefinement.discovery.projectType = explicitProjectName;
    // `prompt` records user evidence. A model can echo its own proposed stack there, but that must
    // never turn the model's React Native suggestion into an explicit user constraint.
    parsedRefinement.discovery = { ...preserveUserProductSignal(parsedRefinement.discovery), prompt: authoritativeBrief };
    const certified = certifiedDecision(authoritativeBrief, parsedRefinement.discovery);
    const platformContract = certifiedPlatformContract(context.starter.id, certified.discovery, certified.stackOptions);
    const refined: DiscoveryRefinementResult = {
      ...parsedRefinement,
      // The model wrote its memo for ITS stack pick, and preserveUserProductSignal already copied that
      // sentence into the decisions and key facts. If policy overrode the pick, EVERY field must follow —
      // rewriting only `architecture` left the rejected framework on screen and in the build brief.
      discovery: discoveryWithSelectedStack(
        { ...parsedRefinement.discovery, recommendedStack: platformContract.recommendedStack },
        parsedRefinement.discovery.recommendedStack,
        platformContract.recommendedStack,
      ),
      stackOptions: platformContract.stackOptions,
      alternativeStacks: platformContract.stackOptions.filter((option) => !option.recommended).map((option) => option.name),
    };

    return NextResponse.json({
      ok: true,
      provenance: "model",
      discovery: refined.discovery,
      alternativeStacks: refined.alternativeStacks,
      deploymentNote: deploymentNoteRespectingExplicitPersistence(authoritativeBrief, refined.deploymentNote),
      lede: refined.lede,
      stackOptions: refined.stackOptions,
      productProfile: certified.productProfile,
      stackRecommendation: certified.stackRecommendation,
      projectArchitecture: certified.projectArchitecture,
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

/** AI may interpret the brief, but this deterministic gate owns stack eligibility. */
function certifiedDecision(prompt: string, discovery: ProjectDiscoveryResult) {
  const productProfile = extractProductProfile(prompt, discovery);
  const stackRecommendation = recommendStack(productProfile, defaultEnvironmentCapabilities());
  const selected = stackRecommendation.selectedStack;
  const selectedName = selected?.displayName ?? discovery.recommendedStack;
  const nextDiscovery = discoveryWithSelectedStack(discovery, discovery.recommendedStack, selectedName);
  const stackOptions = selected
    ? [{ name: selected.displayName, why: stackRecommendation.reasons.join(" "), recommended: true }]
    : [];
  return { productProfile, stackRecommendation, projectArchitecture: composeProjectArchitecture(productProfile, stackRecommendation), discovery: nextDiscovery, stackOptions };
}

function certifiedPlatformContract(starterId: string, discovery: ProjectDiscoveryResult, stackOptions: Array<{ name: string; why: string; recommended: boolean }>) {
  return { stackOptions, recommendedStack: stackOptions[0]?.name ?? discovery.recommendedStack, repaired: discovery.recommendedStack !== stackOptions[0]?.name, family: platformFamilyForProject(starterId, discovery) };
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

function deploymentNoteRespectingExplicitPersistence(prompt: string, proposed: string) {
  const persistence = explicitPersistenceFromPrompt(prompt);
  if (!persistence) return proposed;
  const datastorePattern = /\b(?:SQLite|PostgreSQL|Postgres|MySQL|MongoDB|SQL Server|Supabase|localStorage)\b/gi;
  const conflicts = Array.from(proposed.matchAll(datastorePattern)).some((match) => match[0].toLowerCase() !== persistence.toLowerCase()
    && !(persistence === "PostgreSQL" && match[0].toLowerCase() === "postgres"));
  const safeProposed = conflicts ? "" : proposed.trim();
  return [`Persistence uses the explicitly selected ${persistence} datastore through replaceable repository and migration boundaries.`, safeProposed].filter(Boolean).join(" ");
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
