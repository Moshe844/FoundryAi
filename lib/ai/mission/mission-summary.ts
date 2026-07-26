import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import { routingContext } from "@/lib/ai/routing/request-context";
import { formatJournalDigest, journalDigest } from "@/lib/factory/execution-journal";

/**
 * The mission's closing report, written from the Execution Journal.
 *
 * The existing summary is assembled from the live timeline, which has two problems. It dies with the
 * request, so a mission resumed across windows can only describe the last one — the files an earlier
 * window wrote are invisible to it. And a timeline entry is something Foundry *said*, whereas the
 * journal is what it *did*, so grounding the report in the journal makes the report checkable.
 *
 * This is the cheapest stage in the mission by design. Every fact it needs is already established;
 * nothing is being worked out, so a stronger model would buy nothing but a larger bill.
 */

export type JournalGroundedSummary = {
  outcome: string;
  source: "journal";
  usage?: RuntimeUsageRecord;
};

const SUMMARY_TOOL: NeutralTool = {
  name: "report_outcome",
  description: "State what this mission actually did, using only the recorded evidence provided.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      outcome: {
        type: "string",
        description: "Two or three plain sentences describing what was done and what state the project is in. Every claim must come from the record you were given.",
      },
    },
    required: ["outcome"],
  },
};

const SUMMARY_SYSTEM_PROMPT = [
  "You write the closing report for a software mission, using only the record you are given.",
  "The record is what actually happened: the files that changed and why, the commands that ran and their exit codes, the decisions taken, and any blockers.",
  "Every claim you make must be traceable to that record. Do not add anything you were not told.",
  "Never say something was verified, tested, or working unless the record shows the check that proves it. A file being written is not proof that it works.",
  "Describe the state the project is in now, not the process of getting there. The user cares what they have, not how many attempts it took.",
  "If requirements are reported as incomplete, say plainly what is still outstanding rather than implying the work is finished.",
  "Write in plain language, in the past tense, addressed to the person who made the request. Two or three sentences.",
].join("\n");

export async function summarizeFromJournal(input: {
  projectId: string;
  /** Executions belonging to this mission. A continued mission spans several. */
  missionIds?: string[];
  request: string;
  /** Requirement-ledger position, when requirement accounting ran. */
  requirements?: { finalized: number; total: number };
  status: string;
  apiKey?: string;
  tier?: ModelTier;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
}): Promise<JournalGroundedSummary | undefined> {
  if (!input.apiKey || !input.projectId) return undefined;

  try {
    const digest = await journalDigest(input.projectId, input.missionIds?.length ? { missionIds: input.missionIds } : undefined);
    // Nothing recorded means there is nothing to report from. Inventing a narrative to fill the gap is
    // precisely what grounding the summary in the journal is meant to prevent.
    if (digest.empty || (!digest.filesChanged.length && !digest.commands.length && !digest.decisions.length)) return undefined;

    const provider: ProviderId = input.provider ?? "openai";
    const tier = input.tier ?? "fast";
    const { model, effort } = resolveModelForTier(tier, { provider });

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: effort ?? "low",
        system: [SUMMARY_SYSTEM_PROMPT, "Always call report_outcome with your answer. Do not respond with plain text."].join("\n"),
        messages: [{ role: "user", content: [{ type: "text", text: [
          `What the user asked for:\n${input.request.slice(0, 4_000)}`,
          `Recorded verdict: ${input.status}`,
          input.requirements
            ? `Requirement accounting: ${input.requirements.finalized} of ${input.requirements.total} requested item(s) finalized.`
            : "",
          formatJournalDigest(digest),
        ].filter(Boolean).join("\n\n") }] }],
        tools: [SUMMARY_TOOL],
        toolChoice: "auto",
        maxOutputTokens: 400,
        routing: routingContext(input.request, "summarize", tier, input.workspaceId),
      },
      { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 2 },
    );

    const call = result.toolCalls.find((item) => item.name === "report_outcome");
    const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;
    const outcome = typeof parsed?.outcome === "string" ? parsed.outcome.replace(/\s+/g, " ").trim() : "";
    if (!outcome) return undefined;

    return { outcome, source: "journal", usage: result.usage };
  } catch {
    // The caller keeps whatever summary it already had. A failed summary stage must never cost a
    // mission its report.
    return undefined;
  }
}

function safeJsonParse(value: string): { outcome?: unknown } | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
