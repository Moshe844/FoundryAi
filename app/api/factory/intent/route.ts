import { NextResponse } from "next/server";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { apiKeyForProvider, envVarNameForProvider, providerForTier } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier, tierForRuntimePayload } from "@/lib/ai/model-router";
import type { ModelMode } from "@/lib/ai/model-router";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";

const projectIntentValues = ["question", "inspection", "diagnose", "status", "debug", "edit", "undo", "continue", "retrospective", "clarify"] as const;

type ProjectTurnIntent = (typeof projectIntentValues)[number];

type ProjectIntentContext = {
  missionTitle?: string;
  objective?: string;
  lastResult?: string;
  source?: string;
  execution?: {
    status?: string;
    objective?: string;
    blocker?: string;
    changedFiles?: string[];
    checklist?: Array<{ label?: string; status?: string; evidence?: string }>;
  } | null;
  recentMissionMemory?: Array<{
    task?: string;
    status?: string;
    summary?: string;
    filesChanged?: Array<{ path?: string; status?: string; rationale?: string }>;
    commandsRun?: Array<{ command?: string; exitCode?: number | null }>;
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
    },
    required: ["intent", "execution_mode", "confidence", "rationale", "continuity", "clarifying_question"],
  },
};

type ResolveToolResult = {
  intent?: ProjectTurnIntent;
  execution_mode?: "read-only" | "mutate" | "control" | "status";
  confidence?: number;
  rationale?: string;
  continuity?: "carry_forward_plan" | "fresh_plan" | "not_applicable";
  clarifying_question?: string;
  clarify_options?: string[];
};

const SYSTEM_PROMPT = [
  "You resolve user intent for Foundry, an AI software agent working inside a connected project.",
  "Use the whole message and the current mission state. Do not rely on keyword triggers or fixed phrases.",
  "Return exactly one intent:",
  "- question: answer a general question; no project inspection or file writes are needed.",
  "- inspection: read or summarize the project; no file writes.",
  "- diagnose: investigate/explain root cause or tell the user how to fix something; no file writes.",
  "- status: report prior execution state, result, blocker, or changed files.",
  "- retrospective: explain why Foundry previously did something or how a previous fix worked.",
  "- debug: investigate a bug/error and apply the repair to project files.",
  "- edit: modify existing project behavior, UI, code, config, docs, or files.",
  "- undo: revert a previous Foundry change.",
  "- continue: continue or retry an unfinished mutating project run.",
  "- clarify: the message could mean two structurally different actions with materially different consequences given the current mission state/blocker, and you cannot tell which without asking. Only use this when genuinely ambiguous — never as a default when you're merely not fully confident.",
  "If the user asks Foundry to perform the change, choose debug/edit/undo/continue.",
  "A bare bug report in a connected project is a request to investigate and fix. If the user gives an error/failure/screenshot/log and says it happens during a workflow, choose debug unless they explicitly ask only for explanation, root cause, review, or instructions they will apply themselves.",
  "If the user asks why, how, what happened, what should I change, or asks for an explanation without asking Foundry to apply the repair, choose a read-only intent.",
  "If the message is ambiguous between explanation and file mutation, choose the read-only interpretation and say why in rationale — this is a normal, common resolution and does not need clarify.",
  "Reserve clarify for real forks in the road: e.g. the mission is blocked needing approval for one specific command and the user's message could equally mean 'retry that same command' or 'abandon it and use something else instead', and the wording doesn't say which.",
  "Resolve short replies such as yes, do it, continue, stop, or no using the mission state and previous execution.",
  "For edit/debug/continue intents, set continuity: carry_forward_plan when this message revises, corrects, or continues the work described in mission_state.execution (e.g. 'actually don't use that package', 'now add validation', 'switch it to .NET' while a mission is still open) — it should not restart from a blank plan. Set fresh_plan when it's an unrelated new request. Set not_applicable for every other intent.",
  "Always call resolve_project_turn_intent. Do not answer in prose.",
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
    const tier = body.mode && body.mode !== "auto" ? body.mode : tierForRuntimePayload({ message, context: body.context });
    const automatic = body.provider ? undefined : providerForTier(tier);
    const provider: ProviderId = body.provider ?? automatic?.provider ?? "openai";
    const apiKey = body.provider ? apiKeyForProvider(provider) : automatic?.apiKey;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: `${envVarNameForProvider(provider)} is not configured.` }, { status: 503 });
    }

    const { model, effort } = resolveModelForTier(tier, { provider });

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
                text: JSON.stringify({ message, mission_state: compactProjectIntentContext(body.context) }, null, 2),
              },
            ],
          },
        ],
        tools: [RESOLVE_PROJECT_TURN_INTENT_TOOL],
        toolChoice: { name: "resolve_project_turn_intent" },
        // Reasoning models count hidden reasoning against this budget. Higher manual tiers need
        // enough room left to emit the required tool call after thinking.
        maxOutputTokens: 3000,
      },
      { apiKey, workspaceId: "factory-intent", userId: "local-user", maxAttempts: 3 },
    );

    const call = result.toolCalls.find((item) => item.name === "resolve_project_turn_intent");
    const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;
    const intent = normalizeProjectIntent(parsed?.intent);

    const modelSelection = { tier, provider, model, autoSelected: body.mode === "auto" };

    if (!intent) {
      return NextResponse.json({
        ok: false,
        error: result.errorMessage || "Intent classifier did not return a valid intent.",
        usage: result.usage,
        modelSelection,
      });
    }

    const finalIntent = applyProjectIntentPolicy(intent, message, body.context);
    const rationale =
      finalIntent === intent
        ? String(parsed?.rationale ?? "")
        : `Product policy corrected ${intent} to ${finalIntent}: a concrete imperative change request (or a real project error report) starts an edit/debug mission — any conflicting requirements are resolved inside the mission's decision prompt — unless the user explicitly asked for read-only explanation. ${String(parsed?.rationale ?? "")}`.trim();

    return NextResponse.json({
      ok: true,
      intent: finalIntent,
      executionMode: finalIntent === intent ? parsed?.execution_mode ?? executionModeForIntent(finalIntent) : executionModeForIntent(finalIntent),
      confidence: clampConfidence(parsed?.confidence),
      rationale,
      continuity: finalIntent === intent ? parsed?.continuity ?? "not_applicable" : "not_applicable",
      clarifyingQuestion: finalIntent === "clarify" ? String(parsed?.clarifying_question ?? "").trim() : "",
      clarifyingOptions:
        finalIntent === "clarify" && Array.isArray(parsed?.clarify_options)
          ? parsed.clarify_options.map((option) => String(option).trim()).filter(Boolean).slice(0, 4)
          : [],
      usage: result.usage,
      modelSelection,
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
    execution: execution
      ? {
          status: truncate(execution.status, 80),
          objective: truncate(execution.objective, 800),
          blocker: truncate(execution.blocker, 800),
          changedFiles: execution.changedFiles?.slice(0, 30).map((item) => truncate(item, 220) ?? ""),
          checklist: execution.checklist?.slice(0, 20).map((item) => ({
            label: truncate(item.label, 220),
            status: truncate(item.status, 60),
            evidence: truncate(item.evidence, 260),
          })),
        }
      : null,
    recentMissionMemory: context?.recentMissionMemory?.slice(-5).map((run) => ({
      task: truncate(run.task, 300),
      status: truncate(run.status, 80),
      summary: truncate(run.summary, 600),
      filesChanged: run.filesChanged?.slice(0, 20).map((file) => ({
        path: truncate(file.path, 220),
        status: truncate(file.status, 60),
        rationale: truncate(file.rationale, 260),
      })),
      commandsRun: run.commandsRun?.slice(0, 12).map((command) => ({
        command: truncate(command.command, 260),
        exitCode: command.exitCode,
      })),
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
    (intent === "clarify" || intent === "question" || intent === "inspection") &&
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
  return /\b(?:start|restart|launch|stop|kill|run)\b[^.?!\n]{0,30}\b(?:server|app|project|service|api|backend|frontend|dev server|application)\b/i.test(message);
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
