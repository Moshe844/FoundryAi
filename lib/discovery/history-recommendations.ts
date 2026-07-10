import type { MissionState } from "@/lib/mission-engine";
import { isSoftwareProjectMission, projectTitleFor } from "@/lib/mission/status";
import type { NeutralTool } from "@/lib/ai/providers/types";

export type HistoryRecommendation = {
  id: string;
  /** Short card title, e.g. "Add supplier management" — a suggested next project/feature, not a generic label. */
  title: string;
  /** One sentence explaining why this follows from the user's actual history. */
  reason: string;
  /** The exact message to submit (becomes a normal user message / new mission) if the card is clicked. */
  suggestedMessage: string;
};

/**
 * Mirrors lib/ai/mission/recommendations.ts's proven pattern exactly (deterministic fallback + LLM
 * path with a tool schema and a defensive, minimum-count-guarded parser) — applied to cross-project
 * history instead of a single just-completed project. Only this one card is worth an LLM call; the
 * rest of FactoryHome's personalization (lib/discovery/personalization.ts) is cheap enough to stay
 * fully deterministic.
 */
const MIN_VALID_HISTORY_RECOMMENDATIONS = 1;
const TOOL_NAME = "suggest_next_project";

export const SUGGEST_NEXT_PROJECT_TOOL: NeutralTool = {
  name: TOOL_NAME,
  description: "Suggest what the user might want to build or extend next, based on their recent project history.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      recommendations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            reason: { type: "string" },
            suggested_message: { type: "string" },
          },
          required: ["title", "reason", "suggested_message"],
        },
      },
    },
    required: ["recommendations"],
  },
};

export type HistorySummaryItem = { title: string; domain: string; stack: string; status: string };

/** Deterministic, no-LLM-cost fallback used before the LLM call resolves and whenever it fails or no API key is configured. */
export function genericHistoryRecommendation(missions: MissionState[]): HistoryRecommendation[] {
  const recent = missions.filter(isSoftwareProjectMission).slice(0, 1);
  if (!recent.length) return [];
  const title = projectTitleFor(recent[0]);
  return [
    {
      id: "history-generic",
      title: "Continue building on your last project",
      reason: `You recently worked on "${title}" — extending it is usually faster than starting something new.`,
      suggestedMessage: `Suggest a valuable next feature to add to "${title}" and build it.`,
    },
  ];
}

export const HISTORY_RECOMMENDATION_SYSTEM_PROMPT = [
  "You are a senior engineer who knows this user's recent project history and proactively suggests what they might want to build or extend next.",
  "You are given a list of their recent projects: title, inferred domain, stack, and status.",
  "Ground every suggestion in the ACTUAL history given — reference a specific real past project by name in the reason, never a generic 'based on your history' filler.",
  "Return 1-3 recommendations, most valuable first. It is fine to return just 1 if that's genuinely the best fit.",
  "title: 3-6 words, like a button, e.g. 'Add supplier management'.",
  "reason: one short sentence naming the specific past project this follows from.",
  "suggested_message: the exact message the user would send to start this — written as if the user is asking Foundry to do it.",
  "Always call suggest_next_project. Do not answer in prose.",
].join("\n");

export function historyRecommendationUserText(history: HistorySummaryItem[]): string {
  return JSON.stringify({ recentProjects: history }, null, 2);
}

export function parseHistoryRecommendations(rawArguments: string | undefined, fallback: HistoryRecommendation[]): HistoryRecommendation[] {
  if (!rawArguments) return fallback;

  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments);
  } catch {
    return fallback;
  }

  if (!raw || typeof raw !== "object") return fallback;
  const list = (raw as Record<string, unknown>).recommendations;
  if (!Array.isArray(list)) return fallback;

  const cleaned: HistoryRecommendation[] = [];
  for (const [index, item] of list.entries()) {
    const parsed = parseOne(item, index);
    if (parsed) cleaned.push(parsed);
  }

  return cleaned.length >= MIN_VALID_HISTORY_RECOMMENDATIONS ? cleaned : fallback;
}

function parseOne(raw: unknown, index: number): HistoryRecommendation | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const suggestedMessage = typeof value.suggested_message === "string" ? value.suggested_message.trim() : "";
  if (!title || !suggestedMessage) return null;
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  return { id: `history-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`, title, reason, suggestedMessage };
}
