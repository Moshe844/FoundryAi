import { NextResponse } from "next/server";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { apiKeyForProvider, envVarNameForProvider } from "@/lib/ai/providers/dispatch";
import { routePayloadDynamically } from "@/lib/ai/routing/dynamic-router";
import type { ModelMode } from "@/lib/ai/model-router";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import { explicitReadOnlyProjectIntent, interpretationConfirmation, isAcceptedInterpretationReply, normalizeFollowUpResolution } from "@/lib/mission/classifyFollowUp";
import type { FollowUpResolutionRecord, InterpretationKind } from "@/lib/mission/classifyFollowUp";

const projectIntentValues = ["question", "inspection", "diagnose", "status", "debug", "edit", "undo", "continue", "retrospective", "clarify"] as const;

type ProjectTurnIntent = (typeof projectIntentValues)[number];

type ProjectIntentContext = {
  missionTitle?: string;
  objective?: string;
  lastResult?: string;
  source?: string;
  recentConversation?: Array<{ author: "user" | "foundry"; body: string }>;
  execution?: {
    id?: string;
    status?: string;
    objective?: string;
    blocker?: string;
    changedFiles?: string[];
    checklist?: Array<{ label?: string; status?: string; evidence?: string }>;
    createdAt?: string;
    updatedAt?: string;
  } | null;
  recentMissionMemory?: Array<{
    id?: string;
    task?: string;
    status?: string;
    summary?: string;
    filesChanged?: Array<{ path?: string; status?: string; rationale?: string }>;
    commandsRun?: Array<{ command?: string; exitCode?: number | null }>;
    createdAt?: string;
    updatedAt?: string;
  }>;
};

const RESOLVE_PROJECT_TURN_INTENT_TOOL: NeutralTool = {
  name: "resolve_project_turn_intent",
  description: "Resolve what the user wants Foundry to do in this connected project turn.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: projectIntentValues,
      },
      execution_mode: {
        type: "string",
        enum: ["read-only", "mutate", "control", "status"],
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      rationale: {
        type: "string",
      },
      continuity: {
        type: "string",
        enum: ["carry_forward_plan", "fresh_plan", "not_applicable"],
        description: "Only meaningful for edit/debug/continue. carry_forward_plan means this message revises or continues the still-open checklist from the mission state below. fresh_plan means it's a genuinely new, unrelated request that should replan from scratch.",
      },
      clarifying_question: {
        type: "string",
        description: "Populate only when intent is clarify: the single plain-language question to ask the user. Leave as an empty string for every other intent.",
      },
      clarify_options: {
        type: "array",
        items: { type: "string" },
        description: "Only when intent is clarify: 2-4 short, concrete, mutually-exclusive choices the user can click to resolve the question (e.g. the specific paths the fork splits into). Omit or leave empty when the answer is genuinely open-ended and only free text makes sense.",
      },
      interpreted_request: {
        type: "string",
        description: "A concise, grammatically clear restatement that preserves every requested action, target, constraint, quantity, and negation. Do not add requirements.",
      },
      interpretation_kind: {
        type: "string",
        enum: ["verbatim", "surface-only", "meaning-bearing", "ambiguous"],
        description: "verbatim when meaning needed no correction; surface-only for harmless spelling/grammar cleanup; meaning-bearing when an executable action/target/constraint/quantity/negation/UI label had to be inferred; ambiguous when multiple executable meanings remain plausible.",
      },
      interpretation_confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      interpretation_source: {
        type: "string",
        enum: ["message", "recent_conversation", "mission_state", "inferred", "ambiguous"],
        description: "Where executable scope came from. Use recent_conversation when resolving a reference to an actual prior user or Foundry turn; this is grounded context, not an invented correction.",
      },
      mutation_authorized: {
        type: "boolean",
        description: "True only when the user is asking Foundry itself to change the connected project. Judge authorization independently from whether you think planning or clarification would be helpful.",
      },
      mutation_kind: {
        type: "string",
        enum: ["none", "apply_change", "undo_recorded_change"],
        description: "The semantic side effect requested. Use undo_recorded_change whenever the desired outcome is to restore, roll back, revert, or otherwise return recorded project work to an earlier state, regardless of the user's exact wording.",
      },
      referenced_execution_id: { type: "string", description: "Exact execution id from mission_state that this turn refers to; empty for new work." },
      referenced_action_description: { type: "string", description: "Factual short description of the referenced recorded action; empty for new work." },
      relevant_files: { type: "array", items: { type: "string" }, description: "Only file paths from mission_state directly connected to this follow-up. Never invent a path." },
      expected_scope: { type: "string", description: "The precise boundary of work this instruction authorizes." },
      destructive: { type: "boolean", description: "True for delete, remove, undo, revert, reset, replacement, or other loss-producing work." },
      reference_confidence: { type: "number", minimum: 0, maximum: 1 },
      planned_action: { type: "string", description: "The exact next action consistent with the resolved target and scope." },
    },
    required: ["intent", "execution_mode", "confidence", "interpreted_request", "interpretation_kind", "interpretation_confidence", "interpretation_source", "mutation_authorized", "mutation_kind", "rationale", "continuity", "clarifying_question", "referenced_execution_id", "referenced_action_description", "relevant_files", "expected_scope", "destructive", "reference_confidence", "planned_action"],
  },
};

type ResolveToolResult = {
  intent?: ProjectTurnIntent;
  execution_mode?: "read-only" | "mutate" | "control" | "status";
  confidence?: number;
  interpreted_request?: string;
  interpretation_kind?: InterpretationKind;
  interpretation_confidence?: number;
  interpretation_source?: "message" | "recent_conversation" | "mission_state" | "inferred" | "ambiguous";
  mutation_authorized?: boolean;
  mutation_kind?: "none" | "apply_change" | "undo_recorded_change";
  rationale?: string;
  continuity?: "carry_forward_plan" | "fresh_plan" | "not_applicable";
  clarifying_question?: string;
  clarify_options?: string[];
  referenced_execution_id?: string;
  referenced_action_description?: string;
  relevant_files?: string[];
  expected_scope?: string;
  destructive?: boolean;
  reference_confidence?: number;
  planned_action?: string;
};

const SYSTEM_PROMPT = [
  "You resolve user intent for Foundry, an autonomous software engineering system working continuously inside a connected project.",
  "Use the whole message and the current mission state. Do not rely on keyword triggers or fixed phrases.",
  "Natural language is open-ended. Examples in this prompt and release tests illustrate intent; they are never passwords or exhaustive phrase lists.",
  "Understand colloquial wording, indirect requests, shorthand, reasonable misspellings, idioms, pronouns, and multi-clause requests from their meaning and conversation context.",
  "mission_state.recentConversation is ordered oldest-to-newest and contains the actual recent user and Foundry turns. Treat the latest Foundry response as usable discourse context, including every proposal, recommendation, checklist, or feature list it contains.",
  "When the user asks Foundry to implement, apply, build, or carry out what Foundry just proposed or described, and there is one clear preceding Foundry proposal, resolve that proposal directly: choose edit, reference its recorded execution, and put the complete proposed scope into planned_action. Never ask the user to repeat Foundry's own immediately preceding list or identify files before the project has been inspected.",
  "Project inspection, file selection, implementation order, prioritization, phasing, and converting outcome-level recommendations into concrete code are Foundry's planning responsibilities. They are not missing user requirements. If the user authorizes the complete preceding proposal, do not ask whether to implement all of it or which part to start with.",
  "Resolve three things semantically: what outcome the user wants, whether they authorize side effects, and which project or recorded mission evidence can answer them.",
  "Restate the complete request in interpreted_request without dropping clauses or adding features.",
  "Set interpretation_source to recent_conversation when the executable scope is grounded in an actual prior conversation turn. Expanding 'that', 'it', 'the list', 'your recommendations', or any equivalent reference from a stored turn is normal discourse resolution, not a meaning correction that needs confirmation.",
  "Set mutation_authorized independently from intent and execution_mode. It is true whenever the user asks Foundry to make the connected project embody, reflect, contain, apply, or otherwise realize an outcome, including indirect or colloquial wording. Wanting more planning does not make authorization false.",
  "Classify the requested side effect in mutation_kind from meaning, not vocabulary. If the requested end state is an earlier recorded project state, choose undo_recorded_change and intent undo—even for indirect wording such as asking to put something back how it was, remove what the last run did, or recover the prior version.",
  "Classify language normalization separately from task intent: verbatim means no correction; surface-only means spelling/grammar cleanup that cannot change executable scope; meaning-bearing means you inferred or corrected an action, target, constraint, quantity, negation, or referenced UI label; ambiguous means multiple executable interpretations remain plausible.",
  "Use meaning-bearing even when the intended correction seems likely. For example, correcting an unclear command verb or control label changes what Foundry will execute and must be confirmed. Harmless corrections such as 'teh header' to 'the header' are surface-only.",
  "If the message explicitly confirms an interpretation from Foundry's immediately preceding question, do not ask for the same confirmation again; treat the confirmed interpretation as authoritative.",
  "Return exactly one intent:",
  "- question: answer a general question; no project inspection or file writes are needed.",
  "- inspection: read or summarize the project; no file writes.",
  "A recommendation, critique, UX suggestion, architecture opinion, or 'what would you do' question is inspection whenever a responsible answer depends on the connected project's actual files or behavior. Use question only when project evidence is genuinely unnecessary.",
  "- diagnose: investigate/explain root cause or tell the user how to fix something; no file writes.",
  "- status: report prior execution state, result, blocker, or changed files.",
  "- retrospective: explain why Foundry previously did something or how a previous fix worked.",
  "Recognize retrospective intent semantically across paraphrases: questions about the reason, rationale, justification, decision, choice, motivation, thinking, or tradeoffs behind prior Foundry work do not need to contain the word 'why'.",
  "- debug: investigate a bug/error and apply the repair to project files.",
  "- edit: modify existing project behavior, UI, code, config, docs, or files.",
  "- undo: revert a previous Foundry change.",
  "- continue: continue or retry an unfinished mutating project run.",
  "- clarify: the message could mean two structurally different actions with materially different consequences given the current mission state/blocker, and you cannot tell which without asking. Only use this when genuinely ambiguous — never as a default when you're merely not fully confident.",
  "If the user asks Foundry to perform the change, choose debug/edit/undo/continue.",
  "A bare bug report in a connected project is a request to investigate and fix. If the user gives an error/failure/screenshot/log and says it happens during a workflow, choose debug unless they explicitly ask only for explanation, root cause, review, or instructions they will apply themselves.",
  "If the user asks why, how, what happened, what should I change, or asks for an explanation without asking Foundry to apply the repair, choose a read-only intent.",
  "A manual how-to request asks for instructions the user will perform themselves. Classify it as question or inspection, never edit/debug/clarify merely because the hypothetical steps contain verbs such as add, create, or change.",
  "An explicit constraint such as 'do not make changes', 'do not change anything', or 'without changing files' is authoritative. Keep explanation/review/architecture requests read-only even if another clause names project files or components.",
  "If the message is ambiguous between explanation and file mutation, choose the read-only interpretation and say why in rationale — this is a normal, common resolution and does not need clarify.",
  "Reserve clarify for real forks in the road: e.g. the mission is blocked needing approval for one specific command and the user's message could equally mean 'retry that same command' or 'abandon it and use something else instead', and the wording doesn't say which.",
  "Resolve short replies such as yes, do it, continue, stop, or no using the mission state and previous execution.",
  "For edit/debug/continue intents, set continuity: carry_forward_plan when this message revises, corrects, or continues the work described in mission_state.execution (e.g. 'actually don't use that package', 'now add validation', 'switch it to .NET' while a mission is still open) — it should not restart from a blank plan. Set fresh_plan when it's an unrelated new request. Set not_applicable for every other intent.",
  "Always call resolve_project_turn_intent. Do not answer in prose.",
  "Resolve the concrete prior execution and file target before acting. Use only execution ids and paths present in mission_state. If more than one target is plausible, choose clarify rather than guessing.",
  "For status and retrospective requests, set referenced_execution_id to the exact recorded run the user means whenever mission_state makes that reference resolvable. Do not silently substitute the latest run for an older named or contextually referenced run.",
  "References are not always to the latest run. When the user names an earlier review, proposal, decision, or other mission—or explicitly excludes intervening status, failure, or no-op turns—search the full supplied recentConversation and recentMissionMemory and select that exact execution. Never replace it with the newest superficially related run.",
  "A destructive or pronoun-based mutation needs reference_confidence >= 0.72 and an actual referenced_execution_id. Otherwise choose clarify with one focused question.",
].join("\n");

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { message?: string; context?: ProjectIntentContext; provider?: ProviderId; mode?: ModelMode };
    const message = String(body.message ?? "").trim();
    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    // provider defaults to "openai" — matches today's behavior exactly. The optional body.provider
    // override exists only for Phase A verification (forcing a real Anthropic/Google request against
    // this route); it is not yet exposed anywhere in the UI (that lands with the mode selector).
    // Intent resolution is a small structured classification task. Project size and the user's
    // selected implementation tier must never turn this bookkeeping call into Builder/premium spend.
    const tier = "fast" as const;
    const routed = await routePayloadDynamically({ message, context: body.context }, tier, body.provider);
    const provider: ProviderId = routed.decision.provider;
    const apiKey = apiKeyForProvider(provider);
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: `${envVarNameForProvider(provider)} is not configured.` }, { status: 503 });
    }

    const { model, effort } = routed.decision;

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: effort ?? "low",
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({ resolver_contract: "project-intent-v4", message, mission_state: compactProjectIntentContext(body.context) }, null, 2),
              },
            ],
          },
        ],
        tools: [RESOLVE_PROJECT_TURN_INTENT_TOOL],
        toolChoice: { name: "resolve_project_turn_intent" },
        maxOutputTokens: 1_000,
      },
      { apiKey, workspaceId: "factory-intent", userId: "local-user", maxAttempts: 3 },
    );

    const call = result.toolCalls.find((item) => item.name === "resolve_project_turn_intent");
    const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;
    const intent = normalizeProjectIntent(parsed?.intent);

    const modelSelection = {
      tier,
      provider: result.usage.provider ?? provider,
      model: result.usage.model ?? model,
      autoSelected: body.mode === "auto",
    };

    if (!intent) {
      return NextResponse.json({
        ok: false,
        error: result.errorMessage || "Intent classifier did not return a valid intent.",
        usage: result.usage,
        modelSelection,
      });
    }

    const acceptedInterpretation = isAcceptedInterpretationReply(message);
    const policyMessage = acceptedInterpretation
      ? String(parsed?.interpreted_request ?? parsed?.planned_action ?? message).trim()
      : message;
    const enforcedReadOnlyIntent = explicitReadOnlyProjectIntent(policyMessage);
    // Interpretation confirmation protects executable scope. A read-only question cannot mutate
    // the project, so pausing it because the classifier polished or restated its wording only adds
    // cost and produces a nonsensical approval-looking card.
    const conversationGroundedMutation = parsed?.mutation_authorized === true && parsed?.interpretation_source === "recent_conversation";
    const semanticUndo = parsed?.mutation_authorized === true && parsed?.mutation_kind === "undo_recorded_change";
    const semanticApplyChange = parsed?.mutation_authorized === true && parsed?.mutation_kind === "apply_change";
    const effectiveIntent = semanticUndo
      ? "undo"
      : semanticApplyChange && intent !== "debug" && intent !== "continue"
        ? "edit"
        : conversationGroundedMutation && intent === "clarify"
          ? "edit"
          : intent;
    const mutatingIntent = effectiveIntent === "edit" || effectiveIntent === "debug" || effectiveIntent === "undo" || effectiveIntent === "continue";
    const meaningCorrectionNeedsApproval = !enforcedReadOnlyIntent && mutatingIntent && !conversationGroundedMutation;
    const interpretation = acceptedInterpretation || !meaningCorrectionNeedsApproval
      ? null
      : interpretationConfirmation({
          originalRequest: message,
          interpretedRequest: String(parsed?.interpreted_request ?? message),
          kind: normalizeInterpretationKind(parsed?.interpretation_kind),
          confidence: clampConfidence(parsed?.interpretation_confidence),
        });
    const finalIntent = interpretation ? "clarify" : enforcedReadOnlyIntent ?? applyProjectIntentPolicy(effectiveIntent, policyMessage, body.context);
    const rationale =
      interpretation
        ? `Foundry must confirm a meaning-bearing interpretation before turning it into executable scope. ${String(parsed?.rationale ?? "")}`.trim()
        : enforcedReadOnlyIntent
        ? `Product policy enforced ${enforcedReadOnlyIntent}: manual guidance and explicit no-mutation constraints are read-only authority boundaries. ${String(parsed?.rationale ?? "")}`.trim()
        : finalIntent === intent
        ? String(parsed?.rationale ?? "")
        : `Product policy corrected ${intent} to ${finalIntent}: a concrete imperative change request (or a real project error report) starts an edit/debug mission — any conflicting requirements are resolved inside the mission's decision prompt — unless the user explicitly asked for read-only explanation. ${String(parsed?.rationale ?? "")}`.trim();

    const conversationGroundedMemory = conversationGroundedMutation
      ? memoryForLatestFoundryTurn(body.context)
      : undefined;
    const referencedExecutionId = String(parsed?.referenced_execution_id || conversationGroundedMemory?.id || "").trim();
    const referencedMemory = body.context?.recentMissionMemory?.find((item) => item.id === referencedExecutionId);
    const resolution = normalizeFollowUpResolution(
      {
        currentIntent: finalIntent,
        referencedPriorAction: referencedExecutionId
          ? {
              executionId: referencedExecutionId,
              description: String(parsed?.referenced_action_description || referencedMemory?.summary || referencedMemory?.task || "").trim(),
              createdAt: referencedMemory?.createdAt,
              updatedAt: referencedMemory?.updatedAt,
            }
          : null,
        relevantFiles: Array.isArray(parsed?.relevant_files) ? parsed.relevant_files.map(String) : [],
        expectedScope: String(parsed?.expected_scope ?? ""),
        destructive: Boolean(parsed?.destructive),
        referenceConfidence: conversationGroundedMemory ? Math.max(0.96, clampConfidence(parsed?.reference_confidence)) : clampConfidence(parsed?.reference_confidence),
        plannedAction: String(parsed?.planned_action ?? parsed?.interpreted_request ?? message),
        continuity: conversationGroundedMemory?.status === "complete" && (finalIntent === "edit" || finalIntent === "debug" || finalIntent === "continue")
          ? "fresh_plan"
          : finalIntent === effectiveIntent
            ? parsed?.continuity ?? "not_applicable"
            : "not_applicable",
        rationale,
        clarifyingQuestion: interpretation?.question ?? (finalIntent === "clarify" ? String(parsed?.clarifying_question ?? "").trim() : ""),
        clarifyingOptions: interpretation?.options ?? (finalIntent === "clarify" && Array.isArray(parsed?.clarify_options) ? parsed.clarify_options.map(String) : []),
      } satisfies Partial<FollowUpResolutionRecord>,
      policyMessage,
      body.context ?? {},
    );

    return NextResponse.json({
      ok: true,
      intent: resolution.currentIntent,
      executionMode: executionModeForIntent(resolution.currentIntent),
      confidence: clampConfidence(parsed?.confidence),
      rationale: resolution.rationale,
      continuity: resolution.continuity,
      clarifyingQuestion: resolution.clarifyingQuestion,
      clarifyingOptions: resolution.clarifyingOptions,
      resolution,
      usage: result.usage,
      modelSelection,
      interpretation: {
        accepted: acceptedInterpretation,
        kind: normalizeInterpretationKind(parsed?.interpretation_kind),
        request: String(parsed?.interpreted_request ?? message),
        source: parsed?.interpretation_source ?? "message",
        mutationAuthorized: parsed?.mutation_authorized === true,
        requestedExecutionMode: parsed?.execution_mode ?? executionModeForIntent(intent),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Intent classification failed.",
      },
      { status: 500 },
    );
  }
}

function compactProjectIntentContext(context: ProjectIntentContext | undefined): ProjectIntentContext {
  const execution = context?.execution ?? null;
  return {
    missionTitle: truncate(context?.missionTitle, 120),
    objective: truncate(context?.objective, 1200),
    lastResult: truncate(context?.lastResult, 800),
    source: truncate(context?.source, 120),
    recentConversation: context?.recentConversation?.slice(-20).map((turn) => ({
      author: turn.author,
      body: truncate(turn.body, 1_400) ?? "",
    })),
    execution: execution
      ? {
          id: truncate(execution.id, 120),
          status: truncate(execution.status, 80),
          objective: truncate(execution.objective, 800),
          blocker: truncate(execution.blocker, 800),
          changedFiles: execution.changedFiles?.slice(0, 30).map((item) => truncate(item, 220) ?? ""),
          checklist: execution.checklist?.slice(0, 20).map((item) => ({
            label: truncate(item.label, 220),
            status: truncate(item.status, 60),
            evidence: truncate(item.evidence, 260),
          })),
          createdAt: truncate(execution.createdAt, 80),
          updatedAt: truncate(execution.updatedAt, 80),
        }
      : null,
    recentMissionMemory: context?.recentMissionMemory?.slice(-20).map((run) => ({
      id: truncate(run.id, 120),
      task: truncate(run.task, 500),
      status: truncate(run.status, 80),
      summary: truncate(run.summary, 1_600),
      filesChanged: run.filesChanged?.slice(0, 20).map((file) => ({
        path: truncate(file.path, 220),
        status: truncate(file.status, 60),
        rationale: truncate(file.rationale, 260),
      })),
      commandsRun: run.commandsRun?.slice(0, 12).map((command) => ({
        command: truncate(command.command, 260),
        exitCode: command.exitCode,
      })),
      createdAt: truncate(run.createdAt, 80),
      updatedAt: truncate(run.updatedAt, 80),
    })),
  };
}

function normalizeProjectIntent(value: unknown): ProjectTurnIntent | undefined {
  return projectIntentValues.find((intent) => intent === value);
}

function executionModeForIntent(intent: ProjectTurnIntent) {
  if (intent === "debug" || intent === "edit" || intent === "undo" || intent === "continue") return "mutate";
  if (intent === "status" || intent === "retrospective") return "status";
  return "read-only";
}

function applyProjectIntentPolicy(intent: ProjectTurnIntent, message: string, context: ProjectIntentContext | undefined): ProjectTurnIntent {
  // Misroute guard: a concrete imperative change request must start an edit mission — even when it bundles
  // conflicting requirements. Contradictions are a *plan conflict* the mission resolves with its own
  // one-at-a-time decision prompt (which pauses and resumes the same run), NOT a reason to dead-end the turn
  // as a read-only "clarify" chat note that never touches the project. Without this,
  // "Change storage: use ONLY localStorage / ONLY IndexedDB / ONLY cookies — do all three" was classified
  // clarify and no mission ever started. Scoped to clarify (and bare read-only reads) so genuine forks the
  // model flags on an already-blocked mission still ask; explicitly read-only diagnostics still explain.
  if (
    (intent === "clarify" || intent === "question" || intent === "inspection" || intent === "status" || intent === "retrospective") &&
    isConnectedProjectContext(context) &&
    looksLikeImperativeMutation(message) &&
    !explicitlyReadOnlyDiagnostic(message)
  ) {
    return "edit";
  }

  if (intent !== "question" && intent !== "inspection" && intent !== "diagnose" && intent !== "status") return intent;
  if (!isConnectedProjectContext(context)) return intent;
  // "Is it running? Can you start it?" reads like a status question, but it's a request to actually take
  // action — without this override it was answered as read-only inspection and nothing ever started.
  if (looksLikeServerActionRequest(message)) return "edit";
  if (intent === "status") return intent;
  if (!looksLikeExecutableBugReport(message)) return intent;
  if (explicitlyReadOnlyDiagnostic(message)) return intent === "question" || intent === "inspection" ? "diagnose" : intent;
  return "debug";
}

function looksLikeImperativeMutation(message: string) {
  // The user is telling Foundry to alter the project. Broad on change verbs, but each must sit in an
  // imperative position (clause start, after a connector, or behind please/can you/now) so questions like
  // "why does the store fail" or "what should I use here" don't trip it.
  return /(?:^|[.!?;:\n]\s*|\b(?:and|then|also|please|now)\s+|,\s*|\bcan you\s+|\bcould you\s+|\bi(?:'d| would) like (?:you )?to\s+|\bi want (?:you )?to\s+)(change|add|remove|delete|drop|update|implement|build|create|make|replace|refactor|rename|move|set|switch|convert|store|save|persist|use|wire|integrate|install|migrate|rewrite|redesign|restyle|style|connect|enable|disable|configure|hook up|fix|support|allow)\b/i.test(
    message,
  );
}

function looksLikeServerActionRequest(message: string) {
  return /\b(?:start|restart|launch|stop|kill|run)\b[^.?!\n]{0,40}\b(?:server|app|project|service|api|backend|frontend|dev server|application|build|tests?|lint|linter|typecheck|checks?)\b/i.test(message);
}

function normalizeInterpretationKind(value: unknown): InterpretationKind {
  return value === "surface-only" || value === "meaning-bearing" || value === "ambiguous" ? value : "verbatim";
}

/**
 * Bind a discourse-grounded proposal to persisted mission evidence without guessing from the
 * user's wording. Exact/containment matching uses the stored Foundry turn and stored summary; if
 * the workspace exposes only one recorded run, that run is the only possible conversation source.
 */
function memoryForLatestFoundryTurn(context: ProjectIntentContext | undefined) {
  const foundryTurn = [...(context?.recentConversation ?? [])].reverse().find((turn) => turn.author === "foundry" && turn.body.trim());
  const memories = [...(context?.recentMissionMemory ?? [])].reverse().filter((item) => item.id);
  if (!foundryTurn || memories.length === 0) return undefined;

  const turnText = normalizeDiscourseText(foundryTurn.body);
  const matched = memories.find((memory) => {
    const summary = normalizeDiscourseText(memory.summary ?? "");
    return summary.length >= 32 && (turnText.includes(summary) || summary.includes(turnText));
  });
  return matched ?? (memories.length === 1 ? memories[0] : undefined);
}

function normalizeDiscourseText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function isConnectedProjectContext(context: ProjectIntentContext | undefined) {
  const source = context?.source ?? "";
  return /^(local-agent|local-path|browser-folder|uploaded-copy|previous-execution)/i.test(source) || Boolean(context?.objective);
}

function looksLikeExecutableBugReport(message: string) {
  const text = message.toLowerCase();
  const hasFailureSignal =
    /\b(upload failed|json\.?parse|unexpected character|syntaxerror|typeerror|referenceerror|uncaught|exception|stack trace|traceback|500|404|403|401)\b/i.test(text) ||
    /\b(error|failed|fails|failing|broken|crash|crashes|crashing|bug|issue|problem)\b/i.test(text);
  const hasWorkflowSignal = /\b(when|while|trying to|on upload|during|after|before|click|submit|save|load|parse|upload|download|import|export)\b/i.test(text);
  const hasProjectArtifactSignal = /\b(file|sheet|excel|csv|json|api|server|client|browser|frontend|backend|route|endpoint|form|upload|request|response)\b/i.test(text);
  return hasFailureSignal && (hasWorkflowSignal || hasProjectArtifactSignal);
}

function explicitlyReadOnlyDiagnostic(message: string) {
  return /\b(only|just)\s+(explain|tell me|diagnose|review|inspect|analy[sz]e|show me)\b|\b(how (do|can|should) i fix|how to fix|tell me how to fix|what should i change|what would fix|why is|why does|what caused|root cause|explain why)\b/i.test(message);
}

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function truncate(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function safeJsonParse(value: string): ResolveToolResult | undefined {
  try {
    return JSON.parse(value) as ResolveToolResult;
  } catch {
    return undefined;
  }
}
