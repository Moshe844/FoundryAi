import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier } from "@/lib/ai/model-router";
import type { ModelTier } from "@/lib/ai/model-router";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import type { FactoryObjectiveChecklistItem } from "@/lib/factory/types";
import { routingContext } from "@/lib/ai/routing/request-context";
import type { DynamicTaskAssessment } from "@/lib/ai/routing/types";

export type ArchitectureReviewResult = {
  concerns: string[];
  revisedChecklist?: FactoryObjectiveChecklistItem[];
};

const REVIEW_TOOL: NeutralTool = {
  name: "submit_architecture_review",
  description: "Review a plan for a large or high-risk engineering mission before implementation starts, and flag any real architectural concerns.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      concerns: {
        type: "array",
        items: { type: "string" },
        description: "Plain-language architectural concerns worth the implementer's attention (e.g. a missed edge case, a risky ordering, a phase that should be split). Empty array if the plan is sound as-is.",
      },
      revise_checklist: {
        type: "boolean",
        description: "true only if the checklist itself needs real changes (missing/wrong items), not just a heads-up.",
      },
      revised_items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            phase: { type: "string" },
          },
          required: ["id", "label", "phase"],
        },
        description: "The full replacement checklist. Only meaningful when revise_checklist is true; otherwise leave empty.",
      },
    },
    required: ["concerns", "revise_checklist", "revised_items"],
  },
};

const REVIEW_SYSTEM_PROMPT = [
  "You are a principal engineer doing a pre-implementation architecture review of a plan for a large or high-risk mission — you are not the one implementing it.",
  "Look for real risks: missing steps, dangerous ordering (e.g. removing the old implementation before the new one is verified), scope that should be split into its own phase, or a checklist item that isn't actually independently verifiable.",
  "Be decisive and terse. Most reviews should have 0-3 concerns. Do not invent concerns to seem thorough — an empty concerns array for a genuinely sound plan is the correct, common outcome.",
  "Only set revise_checklist=true when the checklist itself is wrong or incomplete in a way that matters — not for stylistic preferences. When true, revised_items must be the complete replacement list (not a diff), preserving ids for unchanged items and using the same phase-grouping convention (short label per item, same phase label verbatim for items in the same phase).",
  "Always call submit_architecture_review. Do not respond with plain text.",
].join("\n");

/**
 * Advisory-only pre-implementation review — mirrors lib/ai/mission/mission-planner.ts's exact shape
 * (single forced-tool-call, NeutralTool, callManagedModel). Never blocks: concerns get folded into the
 * executor's system prompt as extra context, and a revised checklist (rare) replaces the plan's, but a
 * failed/malformed response just means "no concerns, no revision" rather than failing the mission.
 */
export async function reviewArchitecture(input: {
  objective: string;
  task: string;
  checklist: FactoryObjectiveChecklistItem[];
  projectSnapshot: string;
  apiKey: string;
  workspaceId?: string;
  userId?: string;
  provider?: ProviderId;
  tier?: ModelTier;
  routingAssessment?: DynamicTaskAssessment;
}): Promise<ArchitectureReviewResult> {
  const provider: ProviderId = input.provider ?? "openai";
  const reviewTier = input.tier ?? "architect";
  const { model, effort } = resolveModelForTier(reviewTier, { provider });

  const userText = [
    `Objective: ${input.objective}`,
    `Task: ${input.task}`,
    "",
    "Planned checklist:",
    ...input.checklist.map((item) => `- [${item.id}]${item.phase ? ` [${item.phase}]` : ""} ${item.label}`),
    "",
    "Current project snapshot:",
    input.projectSnapshot || "(empty or unknown project structure)",
  ].join("\n");

  try {
    const result = await callManagedModel(
      {
        provider,
        model,
        effort: effort ?? "high",
        system: REVIEW_SYSTEM_PROMPT,
        messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
        tools: [REVIEW_TOOL],
        toolChoice: { name: "submit_architecture_review" },
        maxOutputTokens: 1500,
        routing: routingContext(input.task, "review", reviewTier, input.workspaceId, input.routingAssessment),
      },
      { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 2 },
    );

    const call = result.toolCalls.find((item) => item.name === "submit_architecture_review");
    if (!call?.arguments) return { concerns: [] };
    const parsed = safeJsonParse(call.arguments);
    if (!parsed) return { concerns: [] };

    const concerns = Array.isArray(parsed.concerns) ? parsed.concerns.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    const revisedChecklist = parsed.revise_checklist && Array.isArray(parsed.revised_items) ? parseRevisedItems(parsed.revised_items) : undefined;

    return { concerns, revisedChecklist: revisedChecklist?.length ? revisedChecklist : undefined };
  } catch {
    // Advisory only — a failed review call must never block or fail the mission.
    return { concerns: [] };
  }
}

function parseRevisedItems(raw: unknown[]): FactoryObjectiveChecklistItem[] {
  const cleaned: FactoryObjectiveChecklistItem[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const label = typeof value.label === "string" ? value.label.trim() : "";
    if (!label) continue;
    cleaned.push({
      id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : `item-${index + 1}`,
      label,
      status: "pending",
      phase: typeof value.phase === "string" && value.phase.trim() ? value.phase.trim() : undefined,
    });
  }
  return cleaned;
}

function safeJsonParse(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
