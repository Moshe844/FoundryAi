/**
 * Single place that decides what a user message means for mission continuity — replaces three
 * previously-separate mechanisms (the keyword/domain-overlap heuristic in lib/mission-engine.ts's
 * classifyFollowUp/decideWorkThread, the busy-state gate classifyProjectFollowUp, and the LLM intent
 * route caller resolveProjectMessageIntent, all in components/WorkspaceShell.tsx). Those three still
 * exist and run today; this module is additive until the orchestrator (lib/mission/useMissionOrchestrator.ts)
 * is wired up to call it instead, at which point the WorkspaceShell.tsx copies are deleted rather than
 * kept in parallel — see the execution-canvas rebuild plan, step 3/8.
 *
 * decideWorkThread's keyword-overlap approach is deliberately NOT carried forward: the spec's own
 * examples ("undo that", "why did you do that?", "actually don't use that package") need semantic
 * understanding of the current mission, not keyword overlap, so this always defers to the LLM intent
 * call (with a regex fallback only when that call is unavailable) rather than guessing from lexical
 * overlap first.
 */

export type FollowUpAction = "resolve_approval" | "hard_stop" | "continue_mission" | "new_mission" | "clarify";

export type ProjectTurnIntent = "question" | "inspection" | "diagnose" | "status" | "debug" | "edit" | "undo" | "continue" | "retrospective" | "clarify";

export type ProjectIntentContext = {
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

export type FollowUpResult = {
  action: FollowUpAction;
  /** Fine-grained intent behind a continue_mission/new_mission action, still needed to prompt the executor correctly (e.g. read-only question vs. mutating edit). Undefined for resolve_approval/hard_stop, which never reach the LLM call. */
  intent?: ProjectTurnIntent;
  /** True when this should carry forward the active mission's plan/context rather than replanning from scratch. Only meaningful when action is "continue_mission". */
  linkedProjectContent: boolean;
  /** Populated only when action is "clarify". */
  clarifyingQuestion?: string;
};

const HARD_STOP_PATTERN = /^(stop|halt|cancel|wait[, ]+stop)\b/i;
const APPROVAL_REPLY_PATTERN = /^(approved:\s*run\s|denied approval to run\s)/i;

export function isApprovalReplyMessage(message: string): boolean {
  return APPROVAL_REPLY_PATTERN.test(message.trim());
}

function isHardStopMessage(message: string): boolean {
  return HARD_STOP_PATTERN.test(message.trim());
}

const MUTATING_INTENTS: ProjectTurnIntent[] = ["edit", "debug", "undo", "continue"];
const READ_ONLY_NO_CONTINUITY_INTENTS: ProjectTurnIntent[] = ["question", "retrospective"];

export async function classifyFollowUp(input: {
  message: string;
  isBusy: boolean;
  pendingApproval: boolean;
  /** Null when there is no prior mission in this thread at all — necessarily a new mission. */
  context: ProjectIntentContext | null;
}): Promise<FollowUpResult> {
  const { message, isBusy, pendingApproval, context } = input;

  // Cheap synchronous branch first — no network call, and takes priority over everything else per
  // the approval system's "no execution continues while waiting" rule.
  if (pendingApproval) {
    if (isHardStopMessage(message) && !isApprovalReplyMessage(message)) {
      return { action: "hard_stop", linkedProjectContent: false };
    }
    return { action: "resolve_approval", linkedProjectContent: true };
  }
  if (isBusy && isHardStopMessage(message)) {
    return { action: "hard_stop", linkedProjectContent: false };
  }

  if (!context) {
    return { action: "new_mission", linkedProjectContent: false };
  }

  const resolved = await resolveIntent(context, message);

  if (resolved.intent === "clarify") {
    return { action: "clarify", linkedProjectContent: false, clarifyingQuestion: resolved.clarifyingQuestion };
  }
  if (READ_ONLY_NO_CONTINUITY_INTENTS.includes(resolved.intent)) {
    return { action: "continue_mission", intent: resolved.intent, linkedProjectContent: false };
  }
  if (MUTATING_INTENTS.includes(resolved.intent) && resolved.continuity === "fresh_plan") {
    return { action: "new_mission", intent: resolved.intent, linkedProjectContent: false };
  }
  return { action: "continue_mission", intent: resolved.intent, linkedProjectContent: true };
}

async function resolveIntent(
  context: ProjectIntentContext,
  message: string
): Promise<{ intent: ProjectTurnIntent; continuity: "carry_forward_plan" | "fresh_plan" | "not_applicable"; clarifyingQuestion?: string }> {
  try {
    const response = await fetch("/api/factory/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, context }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; intent?: unknown; continuity?: unknown; clarifyingQuestion?: unknown }
      | null;
    const intent = normalizeProjectTurnIntent(payload?.intent);
    if (response.ok && payload?.ok && intent) {
      const continuity = payload.continuity === "carry_forward_plan" || payload.continuity === "fresh_plan" ? payload.continuity : "not_applicable";
      return { intent, continuity, clarifyingQuestion: String(payload.clarifyingQuestion ?? "").trim() };
    }
  } catch {
    // Fall through to the local fallback below when the model-backed router is unavailable.
  }
  return { intent: classifyProjectMessageIntentFallback(message), continuity: "not_applicable" };
}

const PROJECT_TURN_INTENTS: ProjectTurnIntent[] = ["question", "inspection", "diagnose", "status", "debug", "edit", "undo", "continue", "retrospective", "clarify"];

function normalizeProjectTurnIntent(value: unknown): ProjectTurnIntent | null {
  return PROJECT_TURN_INTENTS.find((intent) => intent === value) ?? null;
}

/**
 * Regex-only fallback used when the LLM intent route is unavailable (no API key, network error, bad
 * response). Deliberately conservative and duplicated in spirit (not verbatim) from the retired
 * classifyProjectMessageIntentFallback in components/WorkspaceShell.tsx — kept intentionally small since
 * it only needs to cover the common cases; anything genuinely ambiguous falls through to "edit", the
 * safest default for a connected-project follow-up (matches the old fallback's own bias).
 */
function classifyProjectMessageIntentFallback(message: string): ProjectTurnIntent {
  const text = message.trim().toLowerCase();
  if (/^(undo|revert|roll back|rollback)\b/.test(text) || /\bundo that\b/.test(text)) return "undo";
  if (/^(continue|keep going|resume|carry on)\b/.test(text)) return "continue";
  if (/\b(what changed|what did you change|show changes|status|last run|previous run|what happened|summary)\b/.test(text) && !hasEditVerb(text)) return "status";
  if (/\bwhy (did|do|does|would) you\b/.test(text) || /\bwhy (was|is) (that|this|it)\b/.test(text)) return "retrospective";
  if (/\b(why is|why does|failing|failed|error|bug|broken|crash|diagnose)\b/.test(text)) return "debug";
  if (/\b(can you see|what does .*do|what my project does|inspect|look at|review|explain|summarize|understand)\b/.test(text) && !hasEditVerb(text)) return "inspection";
  if (hasEditVerb(text)) return "edit";
  if (/^(can|could|would|will) you\b/.test(text) && !/\b(explain|describe|tell me|show me|summarize|check|confirm|verify|see|look|review|understand)\b/.test(text)) return "edit";
  if (text.endsWith("?")) return "question";
  return "edit";
}

function hasEditVerb(text: string) {
  return /\b(add|remove|delete|change|update|fix|move|rename|refactor|replace|make|build|create|implement|set up|style|redesign|clean up)\b/.test(text);
}
