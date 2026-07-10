import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier } from "@/lib/ai/model-router";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";

export type MissionIntent = "question" | "edit" | "debug" | "build" | "analyze" | "status" | "undo" | "deploy";

export type IntentClassification = {
  intent: MissionIntent;
  needsProjectInspection: boolean;
  rationale: string;
  usage?: RuntimeUsageRecord;
};

const EXPLICIT_ADVICE_PATTERN = /\b(?:only|just)\s+(?:explain|advise|inspect|review|analy[sz]e|tell me|show me|summarize)\b|\b(?:how would|how should|what would be the best way to|what should i)\b/i;
const DEBUG_PATTERN = /\b(?:fix|repair|bug|error|crash|broken|exception|stack trace|failing|failed)\b/i;
const BUILD_PATTERN = /\b(?:create|build|scaffold|generate(?: a new)?|set up|make a new)\b/i;
const MUTATION_PATTERN =
  /\b(?:add|create|make|build|generate|implement|edit|change|update|modify|fix|repair|separate|split|extract|move|delete|remove|rename|refactor|install|allow|enable|wire|hook up|replace)\b/i;
// "start/restart/stop the server" reads like a status question ("is it running?") but is really an action
// request — without this, it fell through to the LLM classifier with no deterministic safety net and could
// get answered as read-only inspection instead of actually starting anything.
const SERVER_ACTION_PATTERN = /\b(?:start|restart|launch|stop|kill|run)\b[^.?!\n]{0,30}\b(?:server|app|project|service|api|backend|frontend|dev server|application|build|tests?|lint|linter|typecheck)\b/i;
const READ_ONLY_PATTERN = /\b(?:can you see|what does|what is this|explain|tell me about|do you understand|review|audit|analy[sz]e|architecture assessment|status|what happened|last run|previous run)\b/i;

export function deterministicMutationIntent(message: string): MissionIntent | undefined {
  const text = message.trim();
  if (!text || EXPLICIT_ADVICE_PATTERN.test(text)) return undefined;
  if (/\b(?:undo|revert|roll back|rollback)\b/i.test(text)) return "undo";
  if (/\b(?:deploy|production|release|ship it|hosting)\b/i.test(text) && /\b(?:deploy|ship|release|publish|prepare)\b/i.test(text)) return "deploy";
  if (BUILD_PATTERN.test(text)) return "build";
  if (DEBUG_PATTERN.test(text)) return "debug";
  if (SERVER_ACTION_PATTERN.test(text)) return "edit";
  if (MUTATION_PATTERN.test(text)) return "edit";
  return undefined;
}

const CLASSIFY_TOOL: NeutralTool = {
  name: "classify_intent",
  description: "Classify what the user actually wants Foundry to do with the connected project.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: ["question", "edit", "debug", "build", "analyze", "status", "undo", "deploy"],
      },
      needs_project_inspection: { type: "boolean" },
      rationale: { type: "string" },
    },
    required: ["intent", "needs_project_inspection", "rationale"],
  },
};

const CLASSIFY_SYSTEM_PROMPT = [
  "You classify a single user message sent inside a connected software project.",
  "question: the user wants information/explanation and expects no files to change.",
  "edit: the user wants Foundry to change/add/remove real files.",
  "debug: the user wants a specific error or bug investigated and fixed.",
  "build: the user wants something scaffolded/created that does not exist yet.",
  "analyze: the user wants a review/audit/architecture assessment, read-only.",
  "status: the user is asking what happened in a previous run.",
  "undo: the user wants a previous change reverted.",
  "deploy: the user wants to ship/release/production-prep the project.",
  "Only 'edit', 'debug', 'build', and 'deploy' should ever result in file writes. Everything else must be read-only.",
  "Hard rule: if the user asks to add, make, change, update, move, create, fix, implement, allow, enable, replace, or wire project behavior, classify it as edit/build/debug/deploy unless they explicitly ask only for advice or explanation.",
  "Do not classify a change request as question/analyze just because it mentions inspection, summary, verification, events, or status as part of the requested fix.",
].join("\n");

export async function classifyIntent(input: {
  message: string;
  hasProjectContext: boolean;
  apiKey: string;
  workspaceId?: string;
  userId?: string;
  provider?: ProviderId;
}): Promise<IntentClassification> {
  // provider defaults to "openai" — matches this function's behavior before the provider abstraction
  // existed; the caller (lib/factory/runtime.ts) doesn't pass one yet.
  const provider: ProviderId = input.provider ?? "openai";
  const { model, effort } = resolveModelForTier("fast", { provider });

  const result = await callManagedModel(
    {
      provider,
      model,
      effort: effort ?? "low",
      system: [CLASSIFY_SYSTEM_PROMPT, input.hasProjectContext ? "A project is connected." : "No project is connected yet.", "Always call classify_intent with your answer. Do not respond with plain text."].join("\n"),
      messages: [{ role: "user", content: [{ type: "text", text: input.message }] }],
      tools: [CLASSIFY_TOOL],
      toolChoice: "auto",
      maxOutputTokens: 800,
    },
    { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 4 },
  );

  const call = result.toolCalls.find((item) => item.name === "classify_intent");
  const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;

  if (!parsed) {
    const detail = result.errorMessage;
    return {
      intent: guessIntentHeuristically(input.message),
      needsProjectInspection: true,
      rationale: detail
        ? `Model classification was unavailable (${detail}); used a conservative heuristic fallback.`
        : "Model classification was unavailable; used a conservative heuristic fallback.",
      usage: result.usage,
    };
  }

  const deterministicIntent = deterministicMutationIntent(input.message);
  if (
    deterministicIntent &&
    deterministicIntent !== "undo" &&
    (parsed.intent === "question" || parsed.intent === "analyze" || parsed.intent === "status")
  ) {
    return {
      intent: deterministicIntent,
      needsProjectInspection: true,
      rationale: `Deterministic edit-intent guard overrode ${parsed.intent}: the message asks Foundry to change the project.`,
      usage: result.usage,
    };
  }

  return {
    intent: parsed.intent,
    needsProjectInspection: Boolean(parsed.needs_project_inspection),
    rationale: String(parsed.rationale ?? ""),
    usage: result.usage,
  };
}

export function guessIntentHeuristically(message: string): MissionIntent {
  const text = message.toLowerCase();
  const deterministicIntent = deterministicMutationIntent(message);
  if (deterministicIntent) return deterministicIntent;
  if (/\b(can you see|what does|what is this|explain|tell me about|do you understand)\b/.test(text)) return "question";
  if (/\b(undo|revert|roll back|rollback)\b/.test(text)) return "undo";
  if (/\b(deploy|production|release|ship it|hosting)\b/.test(text)) return "deploy";
  if (/\b(fix|bug|error|crash|broken|exception|stack trace)\b/.test(text)) return "debug";
  if (/\b(review|audit|analy[sz]e|architecture assessment)\b/.test(text)) return "analyze";
  if (/\b(status|what happened|last run|previous run)\b/.test(text)) return "status";
  if (/\b(create|build|scaffold|generate a new)\b/.test(text)) return "build";
  if (READ_ONLY_PATTERN.test(text)) return "question";
  return "edit";
}

function safeJsonParse(value: string): { intent: MissionIntent; needs_project_inspection?: boolean; rationale?: string } | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
