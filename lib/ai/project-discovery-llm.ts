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
    required: ["lede", "project_type", "recommended_stack", "architecture", "style_direction", "main_features", "data_model", "alternative_stacks", "deployment_note", "decisions"],
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
              "You are a senior software architect who has just heard a one-line project request and is thinking out loud about exactly what you'd build. You are refining a first-pass heuristic guess for Foundry, an AI software factory.",
              "You are given a heuristic (keyword-matched) guess plus the user's actual starter choice, subtype, and any free-text description.",
              "The heuristic guess is deliberately generic — your job is to replace vague labels with the SPECIFIC technical and design decisions a senior engineer would actually reach for. Never restate a generic category label as if it were a decision.",
              "Concretely: name real technologies, patterns, and providers, not categories. 'Secure authentication' is not a decision — 'JWT sessions in httpOnly cookies, bcrypt password hashing, middleware-enforced route protection, Google + GitHub OAuth, magic-link support' is. 'Responsive layout' is not a decision — 'glassmorphism card over an animated gradient, dark-mode-first palette, inline validation, skeleton loading states' is.",
              "Apply this same level of specificity across domains: for auth/accounts name providers and session/security mechanisms; for e-commerce/inventory name the data operations and table/workflow patterns; for dashboards name the chart/filter/drill-down mechanics; for games name the scene/input/scoring mechanics; for APIs name the validation/error/versioning approach. A user who typed one short sentence should feel like they're reading a senior engineer's actual plan, not a paraphrase of their own words.",
              "For decisions: reuse the heuristic's dimensions where they're already directionally correct, but rewrite each hypothesis to be this specific — 8-16 words naming real things, not a 2-3 word label. Tighten rationale and confidence based on the real context you were given.",
              "Only lower confidence (raising the odds of a clarifying question) for a dimension when the context is genuinely ambiguous on that dimension — do not manufacture uncertainty, and do not manufacture false confidence either.",
              "Set 'question' only when you would want to ask the user something on that dimension; otherwise use null.",
              "Cover all 10 dimensions: domain, likely-users, complexity, platform, data-shape, architecture, features, style, navigation, auth-database-api.",
              "lede: 2-4 sentences, written in a confident first-person-plural voice ('We'll build...' / 'This will...'), summarizing what you believe they're building and why it matters to the people who'll use it — this is the opening of the memo, not a restatement of the project type.",
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
