import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import type { ExtractedRequirement, RequirementKind } from "@/lib/ai/mission/requirement-ledger";
import { extractAtomicUserRequirements } from "@/lib/ai/mission/requirement-contract";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import { routingContext } from "@/lib/ai/routing/request-context";

/**
 * Turning a request into requirements is a language problem, not a pattern-matching one. A clause
 * list built from action verbs cannot tell "add a filter" from "put the total above the filter bar",
 * cannot see that "keep desktop exactly the same" is a constraint rather than a feature, and cannot
 * recognise a requirement phrased without any of the verbs someone thought to enumerate. The model
 * reads the request; the ledger does the bookkeeping.
 */

/**
 * Something the request does not settle.
 *
 * The distinction carries real weight: a contradiction cannot be resolved by guessing, because whichever
 * way Foundry guesses may be the wrong half of the request — so it is worth stopping to ask. An undecided
 * detail is an ordinary gap a competent engineer fills from context, and stopping to ask about those is
 * how a product becomes exhausting to use. Only the model can tell them apart, so it is asked to.
 */
export type OpenQuestion = {
  question: string;
  kind: "contradiction" | "undecided-detail";
};

export type RequirementExtraction = {
  requirements: ExtractedRequirement[];
  /** How the list was produced, so callers never present a degraded pass as a full understanding. */
  source: "model" | "deterministic-fallback";
  /** The model's own estimate that it captured every requirement, used to decide on a second pass. */
  coverageConfidence: number;
  /** Contradictions and undecided points the request leaves open. */
  openQuestions: OpenQuestion[];
  note?: string;
  usage?: RuntimeUsageRecord;
};

const EXTRACT_TOOL: NeutralTool = {
  name: "extract_requirements",
  description: "Break a software request into every requirement it contains, including constraints and exclusions.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      requirements: {
        type: "array",
        maxItems: 80,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string", description: "The requirement stated plainly as a single outcome." },
            source_quote: { type: "string", description: "The user's own words for this requirement, copied exactly." },
            kind: {
              type: "string",
              enum: ["deliverable", "constraint", "exclusion", "optional-suggestion"],
              description: "deliverable: something to build. constraint: a rule the result must respect. exclusion: something that must NOT happen. optional-suggestion: an improvement the user did not ask for.",
            },
            depends_on_quotes: {
              type: "array",
              maxItems: 4,
              items: { type: "string" },
              description: "source_quote values of requirements that must be done before this one.",
            },
            verification: {
              type: "string",
              description: "The specific check that would prove this requirement is satisfied once built.",
            },
          },
          required: ["text", "source_quote", "kind", "depends_on_quotes", "verification"],
        },
      },
      coverage_confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence that no requirement in the request was missed." },
      open_questions: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string", description: "The question, phrased for the user in plain language." },
            kind: {
              type: "string",
              enum: ["contradiction", "undecided-detail"],
              description: "contradiction: two things the request asks for cannot both be true, so guessing may deliver the wrong half. undecided-detail: an ordinary gap that a competent engineer fills from context.",
            },
          },
          required: ["question", "kind"],
        },
        description: "Anything the request does not settle.",
      },
    },
    required: ["requirements", "coverage_confidence", "open_questions"],
  },
};

const EXTRACT_SYSTEM_PROMPT = [
  "You decompose a software request into the complete set of requirements it contains.",
  "The request is the source of truth. Capture what it asks for — never what you would have asked for.",
  "Every independently checkable outcome is its own requirement. If a request contains eighteen, return eighteen.",
  "A requirement does not need an action verb. Acceptance criteria, exact strings the result must show, behavioral rules, and stated limits are all requirements.",
  "Constraints are requirements: preserving existing behavior, keeping a platform untouched, matching exact wording, staying within a stated approach.",
  "Exclusions are requirements: anything the user says must not happen, must not change, or must not be added.",
  "Copy source_quote from the request verbatim. It is how Foundry preserves exact wording, so never paraphrase or tidy it.",
  "A landmark that says where something goes is not a separate requirement. Moving a total above a filter bar is one requirement about the total, not a request for a filter.",
  "Background context, saved briefs, and descriptions of what the project already does are not requirements for this mission. Only extract what this request asks Foundry to do now.",
  "Attached material is part of the request, not a document to summarize. When an attachment states requirements, acceptance criteria, or exact content, extract each one as its own requirement exactly as an attachment-free request would be treated.",
  "Mark something optional-suggestion only if you are proposing it and the user did not ask for it. Do not invent suggestions to fill the list.",
  "Set coverage_confidence low when the request is long, ambiguous, or references material you cannot see.",
  "For every requirement, state in `verification` the concrete check that would prove it is satisfied: what to look at, run, or exercise, and what result counts as proof.",
  "A verification check must be something that can come back false. \"Confirm it works\" is not a check; \"the settings page renders a theme toggle that persists across a reload\" is.",
  "For a constraint or exclusion, the check is evidence the forbidden change did not happen.",
  "Report anything the request does not settle in open_questions, and classify each one.",
  "Use 'contradiction' only when two things the request asks for cannot both hold, so choosing one may deliver the opposite of what the user wants. These are worth stopping for.",
  "Use 'undecided-detail' for an ordinary gap you would fill from context: which visual style, where ordinary state lives, whether a prototype persists data, or any detail the existing project already answers. These are not worth stopping for — infer the smallest complete behavior and proceed.",
].join("\n");

export async function extractRequirements(input: {
  request: string;
  apiKey: string;
  tier?: ModelTier;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
  /** Readable attachment content that forms part of the request, such as a specification document. */
  attachments?: Array<{ fileName: string; excerpt: string }>;
}): Promise<RequirementExtraction> {
  const request = input.request.trim();
  if (!request) return { requirements: [], source: "model", coverageConfidence: 1, openQuestions: [] };

  const provider: ProviderId = input.provider ?? "openai";
  // Request understanding is the fastest stage that must still be exhaustive. Callers that get back a
  // low coverageConfidence can re-run at a higher tier rather than paying for one on every request.
  const tier = input.tier ?? "fast";
  const { model, effort } = resolveModelForTier(tier, { provider });

  const attachmentBlock = (input.attachments ?? [])
    .map((attachment) => `Attached ${attachment.fileName}:\n${attachment.excerpt}`)
    .join("\n\n");

  const result = await callManagedModel(
    {
      provider,
      model,
      effort: effort ?? "low",
      system: [EXTRACT_SYSTEM_PROMPT, "Always call extract_requirements with your answer. Do not respond with plain text."].join("\n"),
      messages: [{ role: "user", content: [{ type: "text", text: [
        `Request:\n${request}`,
        attachmentBlock ? `Attached material that forms part of this request:\n${attachmentBlock}` : "",
      ].filter(Boolean).join("\n\n") }] }],
      tools: [EXTRACT_TOOL],
      toolChoice: "auto",
      maxOutputTokens: 2_000,
      // Request understanding is its own stage in the routing spec, but the stage vocabulary does not
      // carry it yet. "classify" is the closest existing fast-tier understanding stage; this moves to a
      // dedicated stage when the full stage set lands.
      routing: routingContext(request, "classify", tier, input.workspaceId),
    },
    { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 3 },
  );

  const call = result.toolCalls.find((item) => item.name === "extract_requirements");
  const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;
  const requirements = normalizeRequirements(parsed?.requirements);

  if (!requirements.length) {
    // Losing requirement tracking entirely is worse than tracking a coarse split, but the caller has
    // to know the understanding is degraded — a fallback list must never be presented as a full read
    // of the request.
    return {
      ...deterministicFallback(request),
      note: result.errorMessage
        ? `Requirement extraction was unavailable (${result.errorMessage}); used a coarse deterministic split of the request.`
        : "Requirement extraction returned nothing usable; used a coarse deterministic split of the request.",
      usage: result.usage,
    };
  }

  return {
    requirements,
    source: "model",
    coverageConfidence: boundedScore(parsed?.coverage_confidence, 0.6),
    openQuestions: normalizeOpenQuestions(parsed?.open_questions),
    usage: result.usage,
  };
}

/**
 * The degraded path. It reuses the clause splitter the acceptance contract already relies on rather
 * than introducing a second, competing notion of what a requirement is — but it can only ever see
 * deliverables, so constraints and exclusions in the request are lost here. That is precisely why
 * callers must surface `source` instead of treating this as equivalent.
 */
export function deterministicFallback(request: string): RequirementExtraction {
  const requirements: ExtractedRequirement[] = extractAtomicUserRequirements(request).map((text) => ({
    text,
    sourceQuote: text,
    kind: "deliverable" as RequirementKind,
  }));
  return {
    requirements,
    source: "deterministic-fallback",
    coverageConfidence: 0.3,
    // Not a contradiction — nothing here should stop the mission. It is a caveat about the reading.
    openQuestions: [{
      question: "Requirements were split mechanically; constraints and exclusions in the request may be missing.",
      kind: "undecided-detail",
    }],
  };
}

type ParsedExtraction = {
  requirements?: Array<{ text?: unknown; source_quote?: unknown; kind?: unknown; depends_on_quotes?: unknown; verification?: unknown }>;
  coverage_confidence?: number;
  open_questions?: Array<{ question?: unknown; kind?: unknown }>;
};

function normalizeRequirements(items: ParsedExtraction["requirements"]): ExtractedRequirement[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const requirements: ExtractedRequirement[] = [];

  for (const item of items) {
    const text = typeof item?.text === "string" ? item.text.replace(/\s+/g, " ").trim() : "";
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      text,
      sourceQuote: typeof item.source_quote === "string" && item.source_quote.trim() ? item.source_quote.trim() : text,
      kind: isRequirementKind(item.kind) ? item.kind : "deliverable",
      verification: typeof item.verification === "string" && item.verification.trim() ? item.verification.trim() : undefined,
      dependsOnQuotes: Array.isArray(item.depends_on_quotes)
        ? item.depends_on_quotes.filter((quote): quote is string => typeof quote === "string" && quote.trim().length > 0)
        : undefined,
    });
  }
  return requirements;
}

function normalizeOpenQuestions(items: ParsedExtraction["open_questions"]): OpenQuestion[] {
  if (!Array.isArray(items)) return [];
  return items
    .flatMap<OpenQuestion>((item) => {
      const question = typeof item?.question === "string" ? item.question.replace(/\s+/g, " ").trim() : "";
      if (!question) return [];
      // An unrecognised classification defaults to the non-blocking one. Guessing that something is a
      // contradiction would stop a mission the user never needed stopped.
      return [{ question, kind: item.kind === "contradiction" ? "contradiction" : "undecided-detail" }];
    })
    .slice(0, 8);
}

function isRequirementKind(value: unknown): value is RequirementKind {
  return value === "deliverable" || value === "constraint" || value === "exclusion" || value === "optional-suggestion";
}

function boundedScore(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function safeJsonParse(value: string): ParsedExtraction | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
