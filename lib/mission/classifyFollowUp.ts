export type ProjectTurnIntent =
  | "question"
  | "inspection"
  | "diagnose"
  | "status"
  | "debug"
  | "edit"
  | "undo"
  | "continue"
  | "retrospective"
  | "clarify";

export type ProjectIntentContext = {
  missionTitle?: string;
  objective?: string;
  lastResult?: string;
  source?: string;
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

export type ReferencedPriorAction = {
  executionId: string;
  description: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * The durable record required before a project follow-up can execute. It is persisted on the
 * ExecutionMission and sent to the runtime so intent, timeline, writes, and the final handoff all
 * describe the same resolved work.
 */
export type FollowUpResolutionRecord = {
  currentIntent: ProjectTurnIntent;
  referencedPriorAction: ReferencedPriorAction | null;
  relevantFiles: string[];
  expectedScope: string;
  destructive: boolean;
  referenceConfidence: number;
  plannedAction: string;
  continuity: "carry_forward_plan" | "fresh_plan" | "not_applicable";
  rationale: string;
  clarifyingQuestion: string;
  clarifyingOptions: string[];
};

export type FollowUpControlAction = "run" | "queue" | "hard_stop" | "resolve_approval";

/** Controller-owned latest-instruction queue. `take` is atomic and never observes a stale UI render. */
export class LatestFollowUpQueue<T> {
  private readonly pending = new Map<string, T>();

  replace(missionId: string, value: T) {
    this.pending.set(missionId, value);
  }

  take(missionId: string): T | undefined {
    const value = this.pending.get(missionId);
    this.pending.delete(missionId);
    return value;
  }

  clear(missionId: string) {
    this.pending.delete(missionId);
  }

  peek(missionId: string): T | undefined {
    return this.pending.get(missionId);
  }
}

const HARD_STOP_PATTERN = /^(?:stop|halt|cancel|wait[, ]+stop)\b/i;
const APPROVAL_REPLY_PATTERN = /^(?:approved:\s*run\s|denied approval to run\s)/i;
const BARE_CONTINUE_PATTERN = /^(?:continue|keep going|resume|carry on|go ahead|proceed|do it|yes|yes please)[.!]?$/i;
const REFERENTIAL_PATTERN = /\b(?:that|this|it|those|them|back|again)\b/i;
const DESTRUCTIVE_PATTERN = /\b(?:undo|revert|roll back|rollback|delete|remove|drop|erase|clear|reset|change (?:it|that) back)\b/i;
const MUTATING_PATTERN = /\b(?:add|create|make|build|implement|edit|change|update|modify|fix|repair|move|delete|remove|rename|refactor|install|enable|wire|replace|style|darken|lighten)\b/i;

export function isApprovalReplyMessage(message: string): boolean {
  return APPROVAL_REPLY_PATTERN.test(message.trim());
}

export function isBareContinuationMessage(message: string): boolean {
  return BARE_CONTINUE_PATTERN.test(message.trim());
}

/** One synchronous control gate for every project follow-up. Semantic resolution happens only for `run`. */
export function classifyFollowUpControl(input: {
  message: string;
  isBusy: boolean;
  pendingApproval: boolean;
  hasApprovalResponse?: boolean;
}): FollowUpControlAction {
  const message = input.message.trim();
  if (input.isBusy && HARD_STOP_PATTERN.test(message)) return "hard_stop";
  if (input.isBusy) return "queue";
  if (input.pendingApproval && !input.hasApprovalResponse && !isApprovalReplyMessage(message)) return "resolve_approval";
  return "run";
}

export function fallbackFollowUpResolution(message: string, context: ProjectIntentContext): FollowUpResolutionRecord {
  const text = message.trim();
  const recent = [...(context.recentMissionMemory ?? [])].reverse().find((item) => item.id || item.task || item.filesChanged?.length);
  const referencedPriorAction = priorActionOf(recent);
  const recentFiles = uniquePaths(recent?.filesChanged?.map((file) => file.path) ?? []);
  const visualFiles = recentFiles.filter((file) => /\.(?:css|scss|sass|less|html?|jsx?|tsx?|vue|svelte)$/i.test(file));
  const explicitFiles = uniquePaths(text.match(/(?:^|\s|[`"'])([\w@./\\-]+\.[a-z0-9]{1,12})(?=$|\s|[`"',:;])/gi)?.map((item) => item.replace(/^[\s`"']+|[\s`"',:;]+$/g, "")) ?? []);

  if (/^(?:undo|revert|roll back|rollback)(?:\s+that)?[.!]?$/i.test(text) || /\bchange (?:it|that) back\b/i.test(text)) {
    if (!referencedPriorAction || recentFiles.length === 0) {
      return clarifyRecord("undo", "I cannot tie that undo request to one recorded change. Which change should I revert?", 0.2, true);
    }
    return record({
      currentIntent: "undo",
      referencedPriorAction,
      relevantFiles: recentFiles,
      expectedScope: `Revert only execution ${referencedPriorAction.executionId} across ${recentFiles.join(", ")}.`,
      destructive: true,
      referenceConfidence: 0.99,
      plannedAction: "Restore only the files changed by the immediately relevant recorded execution.",
      continuity: "carry_forward_plan",
      rationale: "The request explicitly refers to the immediately preceding recorded change.",
    });
  }

  if (/\bwhy (?:did|do|does|would) you\b|\bwhy (?:was|is) (?:that|this|it)\b/i.test(text)) {
    return record({
      currentIntent: "retrospective",
      referencedPriorAction,
      relevantFiles: recentFiles,
      expectedScope: "Read the recorded execution journal; do not modify project files.",
      destructive: false,
      referenceConfidence: referencedPriorAction ? 0.96 : 0.35,
      plannedAction: "Explain the referenced action, routing reason, affected files, and evidence from the journal.",
      continuity: "not_applicable",
      rationale: "This is a read-only retrospective request.",
    });
  }

  if (isBareContinuationMessage(text)) {
    const incomplete = Boolean(context.execution && context.execution.status !== "complete");
    if (!incomplete) return clarifyRecord("continue", "There is no paused or incomplete mission to resume. What should I work on next?", 0.3, false);
    return record({
      currentIntent: "continue",
      referencedPriorAction: context.execution?.id
        ? { executionId: context.execution.id, description: context.execution.objective || "the active incomplete mission", createdAt: context.execution.createdAt, updatedAt: context.execution.updatedAt }
        : referencedPriorAction,
      relevantFiles: uniquePaths([...(context.execution?.changedFiles ?? []).map(pathFromChangedFile), ...recentFiles]),
      expectedScope: "Resume only the active mission from its last persisted incomplete step.",
      destructive: false,
      referenceConfidence: 0.99,
      plannedAction: "Continue the incomplete plan without replaying completed steps.",
      continuity: "carry_forward_plan",
      rationale: "A bare continuation deterministically targets the active incomplete mission.",
    });
  }

  if (/\bremove that\b/i.test(text)) {
    if (!referencedPriorAction || recentFiles.length !== 1) {
      return clarifyRecord("edit", "What exactly should I remove? Name the file, component, or most recent change.", 0.25, true);
    }
    return record({
      currentIntent: "edit",
      referencedPriorAction,
      relevantFiles: recentFiles,
      expectedScope: `Remove only the referenced element in ${recentFiles[0]}.`,
      destructive: true,
      referenceConfidence: 0.82,
      plannedAction: "Inspect the referenced file, remove only the resolved element, then verify that file's behavior.",
      continuity: "carry_forward_plan",
      rationale: "There is exactly one file in the immediately preceding change, making the reference bounded.",
    });
  }

  if (/\bmake (?:it|that) (?:darker|lighter)\b/i.test(text)) {
    if (!referencedPriorAction || visualFiles.length === 0) {
      return clarifyRecord("edit", "Which visual element should I change?", 0.3, false);
    }
    return record({
      currentIntent: "edit",
      referencedPriorAction,
      relevantFiles: visualFiles,
      expectedScope: `Change only the most recently discussed visual target in ${visualFiles.join(", ")}.`,
      destructive: false,
      referenceConfidence: 0.86,
      plannedAction: "Inspect the recent visual diff, adjust the referenced styling, and verify the affected surface.",
      continuity: "carry_forward_plan",
      rationale: "The prior action contains the visual files that can ground the pronoun reference.",
    });
  }

  if (/\b(?:what changed|what did you change|show changes|status|last run|previous run|what happened|summary)\b/i.test(text) && !MUTATING_PATTERN.test(text)) {
    return record({
      currentIntent: "status",
      referencedPriorAction,
      relevantFiles: recentFiles,
      expectedScope: "Read persisted mission state only; do not modify files.",
      destructive: false,
      referenceConfidence: referencedPriorAction ? 0.9 : 0.5,
      plannedAction: "Report the actual recorded outcome, files, commands, and verification.",
      continuity: "not_applicable",
      rationale: "The message asks for recorded status.",
    });
  }

  if (MUTATING_PATTERN.test(text)) {
    const referential = REFERENTIAL_PATTERN.test(text);
    if (referential && !referencedPriorAction && explicitFiles.length === 0) {
      return clarifyRecord("edit", "Which prior change, file, or component are you referring to?", 0.25, DESTRUCTIVE_PATTERN.test(text));
    }
    const files = explicitFiles.length ? explicitFiles : referential ? recentFiles : [];
    return record({
      currentIntent: /\b(?:bug|broken|error|failing|crash)\b/i.test(text) ? "debug" : "edit",
      referencedPriorAction: referential ? referencedPriorAction : null,
      relevantFiles: files,
      expectedScope: files.length ? `Modify only ${files.join(", ")} unless a dependency is explicitly recorded.` : "Plan the new request from current project evidence and record every file before modifying it.",
      destructive: DESTRUCTIVE_PATTERN.test(text),
      referenceConfidence: referential ? 0.78 : 0.92,
      plannedAction: text,
      continuity: referential ? "carry_forward_plan" : "fresh_plan",
      rationale: referential ? "The mutation refers to the immediately preceding recorded work." : "This is a concrete new mutation request.",
    });
  }

  if (text.endsWith("?")) {
    return record({
      currentIntent: "question",
      referencedPriorAction: REFERENTIAL_PATTERN.test(text) ? referencedPriorAction : null,
      relevantFiles: REFERENTIAL_PATTERN.test(text) ? recentFiles : explicitFiles,
      expectedScope: "Answer read-only from persisted state and real project evidence.",
      destructive: false,
      referenceConfidence: REFERENTIAL_PATTERN.test(text) ? (referencedPriorAction ? 0.78 : 0.25) : 0.9,
      plannedAction: "Answer without changing files.",
      continuity: "not_applicable",
      rationale: "The message is a read-only question.",
    });
  }

  return clarifyRecord("clarify", "What should I change, and which file or component should I apply it to?", 0.2, false);
}

export function normalizeFollowUpResolution(
  value: Partial<FollowUpResolutionRecord> | null | undefined,
  message: string,
  context: ProjectIntentContext,
): FollowUpResolutionRecord {
  const fallback = fallbackFollowUpResolution(message, context);
  if (!value || !isProjectTurnIntent(value.currentIntent)) return fallback;

  const knownExecutions = new Map((context.recentMissionMemory ?? []).filter((item) => item.id).map((item) => [item.id as string, item]));
  if (context.execution?.id) knownExecutions.set(context.execution.id, {
    id: context.execution.id,
    task: context.execution.objective,
    filesChanged: (context.execution.changedFiles ?? []).map((path) => ({ path: pathFromChangedFile(path) })),
    createdAt: context.execution.createdAt,
    updatedAt: context.execution.updatedAt,
  });
  const requestedReference = value.referencedPriorAction?.executionId
    ? knownExecutions.get(value.referencedPriorAction.executionId)
    : undefined;
  const referencedPriorAction = requestedReference ? priorActionOf(requestedReference) : null;
  const knownFiles = uniquePaths([
    ...(requestedReference?.filesChanged?.map((file) => file.path) ?? []),
    ...(context.execution?.changedFiles ?? []).map(pathFromChangedFile),
    ...(context.recentMissionMemory ?? []).flatMap((item) => item.filesChanged?.map((file) => file.path) ?? []),
  ]);
  const requestedFiles = uniquePaths(value.relevantFiles ?? []);
  const relevantFiles = referencedPriorAction ? requestedFiles.filter((file) => knownFiles.some((known) => samePath(known, file))) : requestedFiles;
  const destructive = Boolean(value.destructive) || DESTRUCTIVE_PATTERN.test(message);
  const referentialMutation = REFERENTIAL_PATTERN.test(message) && isMutatingIntent(value.currentIntent);
  const confidence = clampConfidence(value.referenceConfidence);
  const ambiguousRemoval = /\bremove that\b/i.test(message) && relevantFiles.length !== 1;
  const unsafeReference = (destructive || referentialMutation || value.currentIntent === "undo") && (!referencedPriorAction || confidence < 0.72);

  if (unsafeReference || ambiguousRemoval) {
    return clarifyRecord(
      value.currentIntent,
      ambiguousRemoval
        ? "What exactly should I remove? Name the file, component, or most recent change."
        : value.clarifyingQuestion || "Which exact prior change, file, or component should I use as the target?",
      confidence,
      destructive,
    );
  }

  return record({
    currentIntent: value.currentIntent,
    referencedPriorAction,
    relevantFiles,
    expectedScope: String(value.expectedScope || fallback.expectedScope).trim(),
    destructive,
    referenceConfidence: confidence,
    plannedAction: String(value.plannedAction || fallback.plannedAction).trim(),
    continuity: value.continuity === "carry_forward_plan" || value.continuity === "fresh_plan" ? value.continuity : "not_applicable",
    rationale: String(value.rationale || fallback.rationale).trim(),
    clarifyingQuestion: value.currentIntent === "clarify" ? String(value.clarifyingQuestion || fallback.clarifyingQuestion).trim() : "",
    clarifyingOptions: value.currentIntent === "clarify" && Array.isArray(value.clarifyingOptions) ? value.clarifyingOptions.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4) : [],
  });
}

export function resolutionNeedsClarification(resolution: FollowUpResolutionRecord): boolean {
  return resolution.currentIntent === "clarify" || ((resolution.destructive || isMutatingIntent(resolution.currentIntent)) && /\b(?:that|this|it|those|them)\b/i.test(resolution.plannedAction) && resolution.referenceConfidence < 0.72);
}

function record(input: Omit<FollowUpResolutionRecord, "clarifyingQuestion" | "clarifyingOptions"> & Partial<Pick<FollowUpResolutionRecord, "clarifyingQuestion" | "clarifyingOptions">>): FollowUpResolutionRecord {
  return { ...input, clarifyingQuestion: input.clarifyingQuestion ?? "", clarifyingOptions: input.clarifyingOptions ?? [] };
}

function clarifyRecord(originalIntent: ProjectTurnIntent, question: string, confidence: number, destructive: boolean): FollowUpResolutionRecord {
  return record({
    currentIntent: "clarify",
    referencedPriorAction: null,
    relevantFiles: [],
    expectedScope: "No files may change until the reference is resolved.",
    destructive,
    referenceConfidence: confidence,
    plannedAction: originalIntent === "clarify" ? "Clarify the requested action." : `Clarify the target before attempting ${originalIntent}.`,
    continuity: "not_applicable",
    rationale: "The target is not resolved confidently enough to act safely.",
    clarifyingQuestion: question,
  });
}

function priorActionOf(item: ProjectIntentContext["recentMissionMemory"] extends Array<infer T> | undefined ? T | undefined : never): ReferencedPriorAction | null {
  if (!item?.id) return null;
  return {
    executionId: item.id,
    description: item.summary || item.task || "the referenced prior execution",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function isProjectTurnIntent(value: unknown): value is ProjectTurnIntent {
  return ["question", "inspection", "diagnose", "status", "debug", "edit", "undo", "continue", "retrospective", "clarify"].includes(String(value));
}

function isMutatingIntent(intent: ProjectTurnIntent) {
  return intent === "edit" || intent === "debug" || intent === "undo" || intent === "continue";
}

function uniquePaths(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const path = String(value ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
    const key = path.toLowerCase();
    if (!path || seen.has(key)) return;
    seen.add(key);
    result.push(path);
  });
  return result;
}

function pathFromChangedFile(value: string): string {
  return value.replace(/^(?:created|edited|changed|uploaded)\s+/i, "").replace(/\s+\((?:un)?verified\)$/i, "").trim();
}

function samePath(left: string, right: string) {
  return left.replace(/\\/g, "/").toLowerCase() === right.replace(/\\/g, "/").toLowerCase();
}

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
