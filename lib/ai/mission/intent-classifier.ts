import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier } from "@/lib/ai/model-router";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import { routingContext } from "@/lib/ai/routing/request-context";
import { profileTask } from "@/lib/ai/routing/task-profiler";
import type { DynamicTaskAssessment } from "@/lib/ai/routing/types";
import { explicitReadOnlyProjectIntent, looksLikeReadOnlyQuestionForm } from "@/lib/mission/classifyFollowUp";

export type MissionIntent = "question" | "edit" | "debug" | "build" | "analyze" | "status" | "undo" | "deploy";

export type IntentClassification = {
  intent: MissionIntent;
  needsProjectInspection: boolean;
  rationale: string;
  routingAssessment: DynamicTaskAssessment;
  usage?: RuntimeUsageRecord;
};

// Advice/recommendation phrasings and explicit do-not-act qualifiers. A message matching this is a
// question about a change, not a request to make one — the deterministic mutation guard must stand
// down and let the read-only classification survive (test B08/B09).
const EXPLICIT_ADVICE_PATTERN = /\b(?:only|just)\s+(?:explain|advise|inspect|review|analy[sz]e|tell me|show me|summarize)\b|\b(?:how would|how should|what would be the best way to|what should i|would it be better|is it better|would you recommend|do you (?:think|recommend)|should (?:i|we|it)|what do you think|advice only)\b|\b(?:don'?t|do not)\s+(?:change|implement|edit|touch|modify|apply)\b/i;
const DEBUG_PATTERN = /\b(?:fix|repair|bug|error|crash(?:es|ed|ing)?|broken|exception|stack trace|failing|failed|clos(?:e|es|ed|ing)|exit(?:s|ed|ing)?|shuts?\s+down|stops?\s+working|freezes?|hangs?|disappears?)\b/i;
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
  if (!text || explicitReadOnlyProjectIntent(text) || EXPLICIT_ADVICE_PATTERN.test(text)) return undefined;
  if (/\b(?:undo|revert|roll back|rollback)\b/i.test(text)) return "undo";
  if (/\b(?:deploy|production|release|ship it|hosting)\b/i.test(text) && /\b(?:deploy|ship|release|publish|prepare)\b/i.test(text)) return "deploy";
  const questionForm = looksLikeReadOnlyQuestionForm(text);
  if (BUILD_PATTERN.test(text) && !questionForm) return "build";
  if (DEBUG_PATTERN.test(text)) return "debug";
  if (SERVER_ACTION_PATTERN.test(text)) return "edit";
  if (MUTATION_PATTERN.test(text) && !questionForm) return "edit";
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
      task_type: { type: "string", enum: ["inspect", "explain", "edit", "build", "debug", "refactor", "migrate", "review", "operate"] },
      affected_scope: { type: "string", enum: ["single-location", "single-file", "few-files", "multi-subsystem", "project-wide"] },
      estimated_files: { type: "integer", minimum: 1, maximum: 100 },
      estimated_subsystems: { type: "integer", minimum: 1, maximum: 10 },
      difficulty: { type: "number", minimum: 0, maximum: 1 },
      uncertainty: { type: "number", minimum: 0, maximum: 1 },
      risk: { type: "number", minimum: 0, maximum: 1 },
      context_required: { type: "number", minimum: 0, maximum: 1 },
      security_or_payment: { type: "boolean" },
      migration: { type: "boolean" },
      repetitive: { type: "boolean" },
      project_creation: { type: "boolean" },
      independent_review_needed: { type: "boolean" },
      visual_outcome: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      routing_reasons: { type: "array", items: { type: "string" }, maxItems: 4 },
    },
    required: ["intent", "needs_project_inspection", "rationale", "task_type", "affected_scope", "estimated_files", "estimated_subsystems", "difficulty", "uncertainty", "risk", "context_required", "security_or_payment", "migration", "repetitive", "project_creation", "independent_review_needed", "visual_outcome", "confidence", "routing_reasons"],
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
  "Set visual_outcome true whenever success depends on what a user sees or experiences in a rendered interface, regardless of the user's exact vocabulary.",
  "Hard rule: if the user asks to add, make, change, update, move, create, fix, implement, allow, enable, replace, or wire project behavior, classify it as edit/build/debug/deploy unless they explicitly ask only for advice or explanation.",
  "Manual how-to questions describe steps the user will perform themselves and are read-only, even when those steps contain add/create/change verbs.",
  "Explicit no-change constraints are authoritative: explanation, review, and architecture requests that say not to change files must be question/analyze.",
  "Do not classify a change request as question/analyze just because it mentions inspection, summary, verification, events, or status as part of the requested fix.",
  "Also assess only the CURRENT message's work. Previous project size or a prior model is never a reason to increase difficulty, risk, scope, or context.",
  "Estimate affected files/subsystems from the requested change, not repository size. A new project is not automatically difficult.",
  "Use low scores for searching, reading, formatting, summaries, explanations, repetitive edits, copy/style changes, and bounded scaffolds.",
  "Use higher scores only for genuine coupling, difficult diagnosis, uncertainty, migrations, security/authentication, payments, data loss, or broad coordination.",
  "Do not recommend a model or tier. Report normalized engineering facts; deterministic routing code chooses the model.",
].join("\n");

export async function classifyIntent(input: {
  message: string;
  hasProjectContext: boolean;
  apiKey: string;
  workspaceId?: string;
  userId?: string;
  provider?: ProviderId;
  projectEvidence?: { likelyFiles: string[]; estimatedSubsystems: number; crossLayer: boolean };
}): Promise<IntentClassification> {
  const enforcedReadOnlyIntent = explicitReadOnlyProjectIntent(input.message);
  if (enforcedReadOnlyIntent) {
    return {
      intent: enforcedReadOnlyIntent === "question" ? "question" : "analyze",
      needsProjectInspection: enforcedReadOnlyIntent === "inspection",
      rationale: enforcedReadOnlyIntent === "inspection"
        ? "Deterministic read-only guard: inspect relevant project evidence and answer without mutation."
        : "Deterministic read-only guard: answer the manual guidance request without project mutation.",
      routingAssessment: deterministicTaskAssessment(input.message, "deterministic-obvious"),
    };
  }
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
      messages: [{ role: "user", content: [{ type: "text", text: [
        `Current user message:\n${input.message}`,
        input.projectEvidence ? `Current-task working-set evidence (not total repository size):\nLikely files: ${input.projectEvidence.likelyFiles.slice(0, 20).join(", ") || "none located yet"}\nEstimated subsystems: ${input.projectEvidence.estimatedSubsystems}\nCross-layer evidence: ${input.projectEvidence.crossLayer}` : "",
      ].filter(Boolean).join("\n\n") }] }],
      tools: [CLASSIFY_TOOL],
      toolChoice: "auto",
      maxOutputTokens: 700,
      routing: routingContext(input.message, "classify", "fast", input.workspaceId),
    },
    { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 4 },
  );

  const call = result.toolCalls.find((item) => item.name === "classify_intent");
  const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;

  if (!parsed || !isMissionIntent(parsed.intent)) {
    const detail = result.errorMessage;
    return {
      intent: guessIntentHeuristically(input.message),
      needsProjectInspection: true,
      rationale: detail
        ? `Model classification was unavailable (${detail}); used a conservative heuristic fallback.`
        : "Model classification was unavailable; used a conservative heuristic fallback.",
      routingAssessment: deterministicTaskAssessment(input.message, "heuristic-fallback"),
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
      routingAssessment: assessmentFromParsed(parsed),
      usage: result.usage,
    };
  }

  return {
    intent: parsed.intent,
    needsProjectInspection: Boolean(parsed.needs_project_inspection),
    rationale: String(parsed.rationale ?? ""),
    routingAssessment: assessmentFromParsed(parsed),
    usage: result.usage,
  };
}

export function guessIntentHeuristically(message: string): MissionIntent {
  const text = message.toLowerCase();
  const enforcedReadOnlyIntent = explicitReadOnlyProjectIntent(message);
  if (enforcedReadOnlyIntent) return enforcedReadOnlyIntent === "question" ? "question" : "analyze";
  const deterministicIntent = deterministicMutationIntent(message);
  if (deterministicIntent) return deterministicIntent;
  if (/\b(can you see|what does|what is this|explain|tell me about|do you understand)\b/.test(text)) return "question";
  if (/\b(undo|revert|roll back|rollback)\b/.test(text)) return "undo";
  if (/\b(deploy|production|release|ship it|hosting)\b/.test(text)) return "deploy";
  if (/\b(?:fix|bug|error|crash(?:es|ed|ing)?|broken|exception|stack trace|clos(?:e|es|ed|ing)|exit(?:s|ed|ing)?|shuts?\s+down|stops?\s+working|freezes?|hangs?|disappears?)\b/.test(text)) return "debug";
  if (/\b(review|audit|analy[sz]e|architecture assessment)\b/.test(text)) return "analyze";
  if (/\b(status|what happened|last run|previous run)\b/.test(text)) return "status";
  if (/\b(create|build|scaffold|generate a new)\b/.test(text)) return "build";
  if (READ_ONLY_PATTERN.test(text)) return "question";
  return "edit";
}

type ParsedClassification = {
  intent: MissionIntent; needs_project_inspection?: boolean; rationale?: string;
  task_type?: DynamicTaskAssessment["taskType"]; affected_scope?: DynamicTaskAssessment["affectedScope"];
  estimated_files?: number; estimated_subsystems?: number; difficulty?: number; uncertainty?: number; risk?: number; context_required?: number;
  security_or_payment?: boolean; migration?: boolean; repetitive?: boolean; project_creation?: boolean; independent_review_needed?: boolean; visual_outcome?: boolean;
  confidence?: number; routing_reasons?: string[];
};

export function deterministicTaskAssessment(message: string, source: DynamicTaskAssessment["source"] = "deterministic-obvious"): DynamicTaskAssessment {
  const profile = profileTask({ message });
  return {
    taskType: normalizeTaskType(profile.taskType),
    affectedScope: profile.scope.projectWide ? "project-wide" : profile.scope.crossLayer ? "multi-subsystem" : profile.scope.estimatedFiles <= 1 ? "single-file" : "few-files",
    estimatedFiles: profile.scope.estimatedFiles,
    estimatedSubsystems: profile.scope.estimatedSubsystems,
    difficulty: profile.difficulty,
    uncertainty: profile.ambiguity,
    risk: profile.risk,
    contextRequired: profile.contextNeed,
    securityOrPayment: profile.risk >= 0.45,
    migration: profile.taskType === "migration",
    repetitive: /\b(?:repeat|same|every|all occurrences?|across these)\b/i.test(message),
    projectCreation: profile.taskType === "project_creation",
    independentReviewNeeded: false,
    visualOutcome: profile.visualNeed >= 0.35,
    confidence: profile.confidence,
    reasons: profile.reasons,
    source,
  };
}

function assessmentFromParsed(parsed: ParsedClassification): DynamicTaskAssessment {
  return {
    taskType: parsed.task_type ?? "edit",
    affectedScope: parsed.affected_scope ?? "few-files",
    estimatedFiles: boundedInteger(parsed.estimated_files, 1, 100, 3),
    estimatedSubsystems: boundedInteger(parsed.estimated_subsystems, 1, 10, 1),
    difficulty: boundedScore(parsed.difficulty, 0.5), uncertainty: boundedScore(parsed.uncertainty, 0.4), risk: boundedScore(parsed.risk, 0.25),
    contextRequired: boundedScore(parsed.context_required, 0.5), securityOrPayment: Boolean(parsed.security_or_payment), migration: Boolean(parsed.migration),
    repetitive: Boolean(parsed.repetitive), projectCreation: Boolean(parsed.project_creation), independentReviewNeeded: Boolean(parsed.independent_review_needed), visualOutcome: Boolean(parsed.visual_outcome),
    confidence: boundedScore(parsed.confidence, 0.6), reasons: Array.isArray(parsed.routing_reasons) ? parsed.routing_reasons.map(String).slice(0, 4) : [],
    source: "dynamic-fast-classifier",
  };
}

function normalizeTaskType(value: string): DynamicTaskAssessment["taskType"] {
  if (value === "inspection" || value === "localized-edit" || value === "project_creation" || value === "implementation" || value === "migration" || value === "debugging") {
    return value === "inspection" ? "inspect" : value === "localized-edit" ? "edit" : value === "project_creation" ? "build" : value === "migration" ? "migrate" : value === "debugging" ? "debug" : "edit";
  }
  return "explain";
}
function boundedScore(value: number | undefined, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback; }
function boundedInteger(value: number | undefined, minimum: number, maximum: number, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.round(value))) : fallback; }
function isMissionIntent(value: unknown): value is MissionIntent { return typeof value === "string" && ["question", "edit", "debug", "build", "analyze", "status", "undo", "deploy"].includes(value); }

function safeJsonParse(value: string): ParsedClassification | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
