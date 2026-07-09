import {
  actionForDecision,
  deriveQuestionsAndAssumptions,
  discoveryDimensions,
  discoverySourceValues,
  discoveryStakesValues,
  questionFor,
} from "@/lib/ai/project-discovery";
import type { DiscoveryDecision, DiscoveryDimension, DiscoverySource, DiscoveryStakes, ProjectDiscoveryResult } from "@/lib/ai/project-discovery";

export type DiscoveryRefinementContext = {
  starter: { id: string; title: string };
  subtype: string;
  customSubtype: string;
  projectDescription: string;
  location: {
    choice: string;
    label: string;
    existingSourceRisky: boolean;
    existingSourceSignals: string[];
  };
};

const TOOL_NAME = "refine_project_discovery";
const MIN_VALID_DECISIONS = 3;

export const REFINE_PROJECT_DISCOVERY_TOOL = {
  type: "function",
  name: TOOL_NAME,
  strict: true,
  description: "Refine a heuristic first-pass project understanding into a sharper, more specific decision memo for the user.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      lede: { type: "string" },
      project_type: { type: "string" },
      recommended_stack: { type: "string" },
      architecture: { type: "string" },
      style_direction: { type: "string" },
      main_features: { type: "array", items: { type: "string" } },
      data_model: { type: "array", items: { type: "string" } },
      alternative_stacks: { type: "array", items: { type: "string" } },
      deployment_note: { type: "string" },
      key_facts: { type: "array", items: { type: "string" } },
      future_capabilities: { type: "array", items: { type: "string" } },
      decisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            dimension: { type: "string", enum: discoveryDimensions as unknown as string[] },
            hypothesis: { type: "string" },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            stakes: { type: "string", enum: discoveryStakesValues as unknown as string[] },
            source: { type: "string", enum: discoverySourceValues as unknown as string[] },
            rationale: { type: "string" },
            question: { type: ["string", "null"] },
          },
          required: ["dimension", "hypothesis", "confidence", "stakes", "source", "rationale", "question"],
        },
      },
    },
    required: ["lede", "project_type", "recommended_stack", "architecture", "style_direction", "main_features", "data_model", "alternative_stacks", "deployment_note", "key_facts", "future_capabilities", "decisions"],
  },
} as const;

export function buildDiscoveryRequestBody(context: DiscoveryRefinementContext, heuristic: ProjectDiscoveryResult, model: string) {
  return {
    model,
    reasoning: { effort: "medium" },
    tools: [REFINE_PROJECT_DISCOVERY_TOOL],
    tool_choice: { type: "function", name: TOOL_NAME },
    max_output_tokens: 3000,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You are a principal software architect who has just heard a one-line project request. You've already spent an hour thinking about it in your head, and you're now writing down your understanding for the person who asked — not interviewing them. You are refining a first-pass heuristic guess for Foundry, an AI software factory.",
              "You are given a heuristic (keyword-matched) guess plus the user's actual starter choice, subtype, and any free-text description.",
              "TRUST THE ACTUAL REQUEST OVER THE HEURISTIC. The heuristic is a dumb keyword matcher and is sometimes flatly wrong — e.g. it will mislabel \"gym signup page\" or \"event registration for a workshop\" as a generic login/auth page just because the word \"signup\" appears. If the heuristic's project_type/architecture/style/features don't actually fit the real request, DISCARD them and reclassify from scratch based on what the person actually described. Never let the heuristic anchor you into the wrong category.",
              "BE DECISIVE. A principal architect assumes correctly about 95% of the time and only asks about the few things that would actually change the architecture if the answer were different (e.g. single-tenant vs multi-tenant, whether auth is required, whether a specific compliance/payment requirement applies). Do not ask about things you can reasonably infer — likely users, complexity, visual style, and navigation should almost always be confident assumptions, never questions. Target at most 1-3 'ask' decisions total across all 10 dimensions, and only when the answer is genuinely architecture-changing. Every decision you don't ask about should read as a stated fact, not a hedge.",
              "Name real technologies, patterns, and providers, not categories. 'Secure authentication' is not a decision — 'JWT sessions in httpOnly cookies, bcrypt password hashing, middleware-enforced route protection, Google + GitHub OAuth, magic-link support' is. 'Responsive layout' is not a decision — 'glassmorphism card over an animated gradient, dark-mode-first palette, inline validation, skeleton loading states' is.",
              "Apply this same level of specificity across domains: for auth/accounts name providers and session/security mechanisms; for e-commerce/inventory name the data operations and table/workflow patterns; for dashboards name the chart/filter/drill-down mechanics; for games name the scene/input/scoring mechanics; for APIs name the validation/error/versioning approach; for anything else (bookings, registrations, memberships, niche tools) reason from first principles the same way — never fall back to a generic label just because it doesn't match one of these examples.",
              "For decisions: rewrite each hypothesis to be specific — 8-16 words naming real things, not a 2-3 word label. rationale must be ONE short sentence explaining WHY this is the right call for this specific project (not a generic process note like 'this can be adjusted later') — e.g. 'Chosen because inventory staff spend hours inside dense tables where speed matters more than decoration,' not 'Style follows the domain.'",
              "Set 'question' only for the rare genuinely architecture-changing dimension; otherwise use null. Phrase any question tersely, like a colleague asking a sharp clarifying question, e.g. 'Single business or multi-tenant?' not 'What kind of tool or product is this, and who is it for?'",
              "Cover all 10 dimensions: domain, likely-users, complexity, platform, data-shape, architecture, features, style, navigation, auth-database-api.",
              "lede: 3-5 sentences, written in a confident first-person-plural voice, painting a picture of the product like a principal architect describing it to a colleague — not a technical restatement. Explicitly gesture at where this grows (e.g. 'while remaining scalable enough to grow into X, Y, Z'), not just what v1 is. Example tone: \"I believe you're building a production-ready inventory management system for business operations. The experience should prioritize speed, accuracy, and day-to-day efficiency while remaining scalable enough to grow into purchasing, reporting, barcode scanning, permissions, and inventory analytics.\"",
              "key_facts: 5-8 short, confident, decisive tags (3-8 words each, no percentages, no hedging language) capturing the most important things you now understand about this project — the kind of list that makes someone think 'I never told it that, but that's exactly right.' Example: 'Production-ready inventory management application', 'Business operations workflow', 'Responsive web application', 'Modern SaaS interface', 'Next.js App Router', 'Local-first development'.",
              "future_capabilities: 4-6 SPECIFIC capabilities you predict this project will need later even though they're out of scope for v1 — the kind of thing that makes the user think 'it already planned for that?'. Ground these in the actual domain (e.g. for inventory: purchase orders, vendor management, audit trail, barcode scanning, role-based permissions — not generic items like 'add more features').",
              "alternative_stacks should list 1-3 other reasonable stack choices distinct from recommended_stack.",
              "deployment_note should be one or two sentences about how this specific project would ship.",
              "Always call refine_project_discovery. Do not answer in prose.",
            ].join("\n"),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({ context, heuristic }, null, 2),
          },
        ],
      },
    ],
  };
}

export type DiscoveryRefinementResult = {
  discovery: ProjectDiscoveryResult;
  alternativeStacks: string[];
  deploymentNote: string;
  lede: string;
};

/**
 * Defensively parses the model's tool-call arguments into a refined discovery result.
 * Never trusts the model for `action`/`questions`/`assumptions` — those are always
 * recomputed deterministically from (confidence, stakes) so the model cannot violate
 * the silent-infer/disclose/ask/default-disclose policy no matter what it returns.
 * Falls back field-by-field to the heuristic result on any structural problem.
 */
export function parseDiscoveryRefinement(rawArguments: string | undefined, heuristic: ProjectDiscoveryResult): DiscoveryRefinementResult {
  const fallback: DiscoveryRefinementResult = { discovery: heuristic, alternativeStacks: [], deploymentNote: "", lede: "" };
  if (!rawArguments) return fallback;

  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments);
  } catch {
    return fallback;
  }

  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Record<string, unknown>;

  const decisions = parseDecisions(value.decisions, heuristic.decisions);
  const { questions, assumptions } = deriveQuestionsAndAssumptions(decisions);

  return {
    discovery: {
      prompt: heuristic.prompt,
      projectType: stringOr(value.project_type, heuristic.projectType),
      recommendedStack: stringOr(value.recommended_stack, heuristic.recommendedStack),
      architecture: stringOr(value.architecture, heuristic.architecture),
      styleDirection: stringOr(value.style_direction, heuristic.styleDirection),
      mainFeatures: stringArrayOr(value.main_features, heuristic.mainFeatures),
      dataModel: stringArrayOr(value.data_model, heuristic.dataModel),
      assumptions,
      questions,
      decisions,
      keyFacts: stringArrayOr(value.key_facts, heuristic.keyFacts),
      futureCapabilities: stringArrayOr(value.future_capabilities, heuristic.futureCapabilities),
    },
    alternativeStacks: stringArrayOr(value.alternative_stacks, []),
    deploymentNote: stringOr(value.deployment_note, ""),
    lede: stringOr(value.lede, ""),
  };
}

function parseDecisions(raw: unknown, fallback: DiscoveryDecision[]): DiscoveryDecision[] {
  if (!Array.isArray(raw)) return fallback;

  const cleaned: DiscoveryDecision[] = [];
  for (const item of raw) {
    const decision = parseDecision(item);
    if (decision) cleaned.push(decision);
  }

  return cleaned.length >= MIN_VALID_DECISIONS ? cleaned : fallback;
}

function parseDecision(raw: unknown): DiscoveryDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const dimension = discoveryDimensions.find((candidate) => candidate === value.dimension) as DiscoveryDimension | undefined;
  if (!dimension) return null;

  const hypothesis = typeof value.hypothesis === "string" ? value.hypothesis.trim() : "";
  if (!hypothesis) return null;

  const confidence = clampConfidence(value.confidence);
  const stakes = discoveryStakesValues.find((candidate) => candidate === value.stakes) as DiscoveryStakes | undefined ?? "low";
  const source = discoverySourceValues.find((candidate) => candidate === value.source) as DiscoverySource | undefined ?? "inferred";
  const rationale = typeof value.rationale === "string" ? value.rationale.trim() : "";

  const action = actionForDecision(confidence, stakes);
  const partial: DiscoveryDecision = { dimension, hypothesis, confidence, stakes, source, rationale, action };
  if (action !== "ask") return partial;

  const question = typeof value.question === "string" && value.question.trim() ? value.question.trim() : questionFor(partial);
  return { ...partial, question };
}

function clampConfidence(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 50;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return cleaned.length ? cleaned : fallback;
}
