import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier } from "@/lib/ai/model-router";
import type { ModelTier } from "@/lib/ai/model-router";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import type { FactoryNarrativeObject, FactoryObjectiveChecklistItem } from "@/lib/factory/types";
import type { MissionExecutorResult } from "@/lib/ai/mission/executor";
import { routingContext } from "@/lib/ai/routing/request-context";
import type { DynamicTaskAssessment } from "@/lib/ai/routing/types";

export type MissionVerification = {
  confidence: number;
  notes: string;
};

const VERIFY_TOOL: NeutralTool = {
  name: "submit_verification",
  description: "Judge, from the real evidence given, how confident you are that this mission's checklist claims are actually true.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      confidence: { type: "integer", minimum: 0, maximum: 100, description: "0-100: how confident you are the checklist evidence, changed files, and command results genuinely support 'this is done and correct'." },
      notes: { type: "string", description: "One or two sentences: what specifically supports or undermines that confidence. Empty string if fully confident and nothing stands out." },
    },
    required: ["confidence", "notes"],
  },
};

const VERIFY_SYSTEM_PROMPT = [
  "You are a skeptical senior engineer double-checking a just-completed mission's own claim that it's done — you did not do the work yourself.",
  "You are given the checklist with each item's recorded evidence, the files actually changed, the commands actually run and their exit codes, and the recorded findings/decisions.",
  "Judge only from this real evidence — never assume something is fine just because it was claimed. Look for: evidence that's vague or doesn't actually establish the item is done, a command that failed or was skipped where success was claimed, a changed-files list that doesn't match what the checklist describes, or a decision/finding that contradicts another one.",
  "confidence should reflect genuine uncertainty, not politeness — do not default to a high number. A mission with thin evidence for a real claim deserves a real confidence penalty.",
  "Always call submit_verification. Do not respond with plain text.",
].join("\n");

function verificationUserText(input: {
  objective: string;
  task: string;
  checklist: FactoryObjectiveChecklistItem[];
  changedFiles: string[];
  commands: MissionExecutorResult["commands"];
  narrativeObjects: FactoryNarrativeObject[];
}): string {
  return [
    `Objective: ${input.objective}`,
    `Task: ${input.task}`,
    "",
    "Checklist (with recorded evidence):",
    ...input.checklist.map((item) => `- [${item.status}] ${item.label}${item.evidence ? ` — evidence: ${item.evidence}` : " — (no evidence recorded)"}`),
    "",
    "Files actually changed and verified on disk:",
    input.changedFiles.length ? input.changedFiles.join(", ") : "(none)",
    "",
    "Commands actually run:",
    input.commands.length ? input.commands.map((command) => `${command.command} (exit ${command.exitCode ?? "unknown"})`).join("; ") : "(none)",
    "",
    "Recorded findings/decisions:",
    input.narrativeObjects.filter((item) => item.tier === "finding" || item.tier === "decision").map((item) => `[${item.tier}] ${item.rationale}`).join("\n") || "(none)",
  ].join("\n");
}

/**
 * The Verify stage — reviews the mission's own real evidence (the same inputs executor.ts's
 * verifyCompletion() already assembles deterministically) and returns a genuine confidence judgment,
 * closing the gap where record_decision's confidence field is recorded but never acted on. Only invoked
 * for thorough/production quality (see lib/ai/mission/orchestration.ts's shouldRunVerify) — a failed
 * call here is treated as low confidence rather than thrown, since the caller's escalation path already
 * knows how to handle "not confident."
 */
export async function verifyMissionResult(input: {
  objective: string;
  task: string;
  checklist: FactoryObjectiveChecklistItem[];
  changedFiles: string[];
  commands: MissionExecutorResult["commands"];
  narrativeObjects: FactoryNarrativeObject[];
  apiKey: string;
  workspaceId?: string;
  userId?: string;
  provider?: ProviderId;
  tier?: ModelTier;
  routingAssessment?: DynamicTaskAssessment;
}): Promise<MissionVerification> {
  const provider: ProviderId = input.provider ?? "openai";
  const verificationTier = input.tier ?? "fast";
  const { model, effort } = resolveModelForTier(verificationTier, { provider });

  try {
    const result = await callManagedModel(
      {
        provider,
        model,
        effort,
        system: VERIFY_SYSTEM_PROMPT,
        messages: [{ role: "user", content: [{ type: "text", text: verificationUserText(input) }] }],
        tools: [VERIFY_TOOL],
        toolChoice: { name: "submit_verification" },
        maxOutputTokens: 600,
        routing: routingContext(input.task, "verify", verificationTier, input.workspaceId, input.routingAssessment),
      },
      { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 2 },
    );

    const call = result.toolCalls.find((item) => item.name === "submit_verification");
    if (!call?.arguments) return { confidence: 50, notes: "Verification call did not return a judgment; treated as uncertain." };
    const parsed = safeJsonParse(call.arguments);
    if (!parsed) return { confidence: 50, notes: "Verification response was unreadable; treated as uncertain." };

    const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : 50;
    const notes = typeof parsed.notes === "string" ? parsed.notes.trim() : "";
    return { confidence, notes };
  } catch (error) {
    return { confidence: 50, notes: error instanceof Error ? `Verification call failed: ${error.message}` : "Verification call failed unexpectedly." };
  }
}

function safeJsonParse(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
