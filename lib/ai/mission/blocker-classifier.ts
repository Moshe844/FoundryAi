import { assessAutonomousBlocker, type BlockerDisposition } from "@/lib/ai/mission/autonomy-contract";
import { resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import { routingContext } from "@/lib/ai/routing/request-context";

/**
 * Decides whether a blocker is a real wall or something Foundry should keep working on.
 *
 * The deterministic contract in autonomy-contract.ts recognises six concrete failure signatures. When it
 * matches one, it is right — those patterns describe specific, unambiguous boundaries. The problem is its
 * default: everything it does not recognise falls through to "recoverable-engineering", so a missing
 * credential, an unreachable service, or an unsupported platform phrased in wording nobody enumerated
 * gets retried against a wall until the recovery budget runs out, and the user is then told about a
 * dead end Foundry could have named immediately.
 *
 * This composes the two rather than replacing one with the other:
 *
 * - A deterministic match is authoritative and costs nothing. No model call is made.
 * - Only the catch-all default is escalated to the model, which is exactly where an unenumerated
 *   boundary hides.
 *
 * The bias is deliberately toward continuing. Wrongly declaring a wall pushes a solvable problem back
 * to the user, which is the failure the reliability contract cares most about; wrongly continuing costs
 * a bounded number of recovery attempts. So the model must name a concrete, externally-owned reason to
 * stop, and anything softer stays recoverable.
 */

export type BlockerClassification = {
  disposition: BlockerDisposition;
  terminal: boolean;
  nextAction?: string;
  source: "deterministic" | "model" | "model-unavailable";
};

const CLASSIFY_TOOL: NeutralTool = {
  name: "classify_blocker",
  description: "Decide whether an autonomous engineering agent should keep working on this failure or stop and ask the user.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      disposition: {
        type: "string",
        enum: ["recoverable-engineering", "external-dependency", "authority-required", "user-stopped"],
        description: "recoverable-engineering: a defect in the project that more engineering work could fix. external-dependency: something outside the project must change first. authority-required: the user must approve or decide. user-stopped: the user cancelled.",
      },
      concrete_boundary: {
        type: "string",
        description: "The specific external thing that must change, named exactly. Empty when there is none.",
      },
      required_input: {
        type: "string",
        description: "What the user must provide or decide, phrased as an instruction to them. Empty when nothing is needed from them.",
      },
    },
    required: ["disposition", "concrete_boundary", "required_input"],
  },
};

const CLASSIFY_SYSTEM_PROMPT = [
  "You decide whether an autonomous software agent should keep trying to fix a failure or stop and ask the user.",
  "Default to recoverable-engineering. A bug, a failing build, a broken test, a wrong output, a missing file, a type error, or a model's own inability to solve something is ordinary engineering work — the agent should continue.",
  "Choose external-dependency only when something outside the project's own source must change first, and you can name it: an absent or invalid credential, an unreachable service or network endpoint, a required platform, SDK, device or emulator that is not present, or a file locked by another process.",
  "Choose authority-required only when the user must approve or decide something: a destructive action needing confirmation, an action outside the approved scope, or a genuine product decision the agent cannot infer.",
  "Choose user-stopped only when the text says the user cancelled or stopped the work.",
  "Being stuck is not an external dependency. Repeated failure is not an external dependency. A confusing error is not an external dependency.",
  "If you cannot name the concrete external thing that must change, the answer is recoverable-engineering.",
  "Stopping when the agent could have continued is the worse mistake: it hands the user a problem the agent was capable of solving.",
].join("\n");

export async function classifyBlocker(input: {
  reason: string;
  /** What the mission already tried, so repeated failure is not mistaken for an external wall. */
  attemptedSummary?: string;
  apiKey?: string;
  tier?: ModelTier;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
}): Promise<BlockerClassification> {
  const deterministic = assessAutonomousBlocker(input.reason);
  // A matched signature is precise and free. Only the catch-all default is worth a model call.
  if (deterministic.disposition !== "recoverable-engineering") {
    return { ...deterministic, source: "deterministic" };
  }
  if (!input.apiKey || !input.reason.trim()) {
    return { ...deterministic, source: "model-unavailable" };
  }

  try {
    const provider: ProviderId = input.provider ?? "openai";
    const tier = input.tier ?? "fast";
    const { model, effort } = resolveModelForTier(tier, { provider });

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: effort ?? "low",
        system: [CLASSIFY_SYSTEM_PROMPT, "Always call classify_blocker with your answer. Do not respond with plain text."].join("\n"),
        messages: [{ role: "user", content: [{ type: "text", text: [
          `Recorded blocker:\n${input.reason}`,
          input.attemptedSummary ? `What the agent already tried:\n${input.attemptedSummary}` : "",
        ].filter(Boolean).join("\n\n") }] }],
        tools: [CLASSIFY_TOOL],
        toolChoice: "auto",
        maxOutputTokens: 400,
        routing: routingContext(input.reason, "classify", tier, input.workspaceId),
      },
      { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 2 },
    );

    const call = result.toolCalls.find((item) => item.name === "classify_blocker");
    const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;
    const disposition = isDisposition(parsed?.disposition) ? parsed.disposition : "recoverable-engineering";
    if (disposition === "recoverable-engineering") return { ...deterministic, source: "model" };

    const boundary = typeof parsed?.concrete_boundary === "string" ? parsed.concrete_boundary.trim() : "";
    // The prompt says an unnameable boundary is not a boundary. Enforce that here too rather than
    // trusting the label alone, so a vague "external-dependency" cannot stop a recoverable mission.
    if (disposition !== "user-stopped" && !boundary) return { ...deterministic, source: "model" };

    const requiredInput = typeof parsed?.required_input === "string" ? parsed.required_input.trim() : "";
    return {
      disposition,
      terminal: true,
      nextAction: requiredInput || `Resolve ${boundary}, then resume — no completed work needs to be repeated.`,
      source: "model",
    };
  } catch {
    // Classification is a judgment about how to proceed, not the mission itself. If it cannot run, keep
    // the deterministic reading, which errs toward continuing.
    return { ...deterministic, source: "model-unavailable" };
  }
}

type ParsedClassification = { disposition?: unknown; concrete_boundary?: unknown; required_input?: unknown };

function isDisposition(value: unknown): value is BlockerDisposition {
  return value === "recoverable-engineering" || value === "external-dependency" || value === "authority-required" || value === "user-stopped";
}

function safeJsonParse(value: string): ParsedClassification | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
