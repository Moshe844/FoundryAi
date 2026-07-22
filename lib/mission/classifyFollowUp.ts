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
  /** Ordered recent conversation turns. This preserves proposals and lists Foundry itself wrote so
   * later references can be resolved from discourse instead of asking the user to repeat them. */
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

export type InterpretationKind = "verbatim" | "surface-only" | "meaning-bearing" | "ambiguous";

export type InterpretationAssessment = {
  originalRequest: string;
  interpretedRequest: string;
  kind: InterpretationKind;
  confidence: number;
};

export const ACCEPT_INTERPRETATION_OPTION = "Yes — use this interpretation";

/** Recognizes only the synthetic answer produced by Foundry's own clarification card. */
export function isAcceptedInterpretationReply(message: string): boolean {
  const text = message.trim();
  return /^Yes\b[^\r\n]*\buse this interpretation\b/i.test(text)
    && /\(This answers your question\b[\s\S]+\babout my earlier request:/i.test(text);
}

/**
 * Converts a model's generic language-understanding assessment into a user-visible gate. Foundry
 * does not pause for punctuation or harmless spelling cleanup, but it must show its work before an
 * inferred action, target, constraint, quantity, negation, or UI label becomes executable scope.
 */
export function interpretationConfirmation(assessment: InterpretationAssessment): { question: string; options: string[] } | null {
  const originalRequest = assessment.originalRequest.trim();
  const interpretedRequest = assessment.interpretedRequest.trim();
  const kind = assessment.kind;
  if (!originalRequest || !interpretedRequest || (kind !== "meaning-bearing" && kind !== "ambiguous")) return null;
  // A model sometimes labels its own restatement "meaning-bearing" even when it changed nothing.
  // If the interpretation says the same thing as the original (ignoring case, whitespace, and
  // punctuation), there is no correction to confirm — pausing on it just blocks a plain question
  // behind a pointless "Is that correct?" card (test B01).
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (normalize(originalRequest) === normalize(interpretedRequest)) return null;

  const prefix = kind === "ambiguous"
    ? "Your wording could mean more than one action. My current interpretation is:"
    : "I corrected wording that changes the action or target. I understood your request as:";
  return {
    question: `${prefix} “${interpretedRequest}” Is that correct?`,
    options: [ACCEPT_INTERPRETATION_OPTION],
  };
}

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
const DESTRUCTIVE_PATTERN = /\b(?:undo|revert|roll back|rollback|delete|remove|drop|erase|clear|reset|change (?:it|that) back)\b/i;
const MUTATING_PATTERN = /\b(?:add|create|make|build|implement|edit|change|update|modify|fix|repair|move|delete|remove|rename|refactor|install|enable|wire|replace|style|darken|lighten)\b/i;
const CURRENT_RUNTIME_FAILURE_PATTERN = /\b(?:crash(?:es|ed|ing)?|clos(?:e|es|ed|ing)|exit(?:s|ed|ing)?|shuts?\s+down|stops?\s+working|does\s+not\s+work|doesn['’]?t\s+work|not\s+working|freezes?|hangs?|disappears?|broken|failing|failed|throws?|errors?)\b/i;
const MANUAL_GUIDANCE_PATTERN = /\bhow\s+(?:do|can|should|would)\s+i\b[^.!?\n]{0,180}\b(?:manually|myself|by hand|on my own)\b|\b(?:manually|myself|by hand|on my own)\b[^.!?\n]{0,180}\b(?:steps?|instructions?|how)\b/i;
const EXPLICIT_NO_MUTATION_PATTERN = /\b(?:do not|don't|never)\b[^.!?\n]{0,100}\b(?:make|apply|perform|write|edit|modify|change|touch|implement|create|delete|remove|rewrite)(?:ing)?\b[^.!?\n]{0,80}\b(?:changes?|edits?|files?|code|anything)\b|\bwithout\b[^.!?\n]{0,100}\b(?:changing|editing|modifying|writing|touching|creating|deleting|removing)\b|\bno\s+(?:changes?|edits?|writes?|file changes?|code changes?)\b/i;
const READ_ONLY_REQUEST_PATTERN = /\b(?:explain|describe|summarize|inspect|review|analy[sz]e|walk me through|tell me|show me|what|why|how)\b/i;
const PROJECT_EVIDENCE_PATTERN = /\b(?:this|current|connected)\b[^.!?\n]{0,50}\b(?:project|codebase|repo(?:sitory)?|application|app)\b|(?:^|[\s`"'])(?:src|app|lib|components|packages)[/\\][\w./\\-]+|\b[\w./\\-]+\.(?:js|jsx|ts|tsx|mjs|cjs|css|html?|json|py|rb|php|java|kt|swift|cs|go|rs|vue|svelte|md|yml|yaml|toml)\b/i;
const RECORDED_STATUS_PATTERN = /\b(?:what (?:has )?changed|what did you (?:change|do)|what happened|last (?:run|mission)|previous (?:run|mission))\b/i;
const EXPLICIT_FOLLOW_ON_MUTATION_PATTERN = /(?:\b(?:then|and|also|now)\s+|[.!?;]\s*)(?:(?:can|could|would)\s+you\s+|please\s+)?(?:implement|apply|make|change|edit|create|add|fix|update)\b/i;
const PROJECT_BEHAVIOR_QUESTION_PATTERN = /^(?:where|which|what|why|how|is|are|was|were|does|do|did|can|could|would|will|has|have)\b[^?\n]{0,240}\??(?:\s|$)/i;
const PROJECT_BEHAVIOR_SUBJECT_PATTERN = /\b(?:data|record|item|state|value|file|database|storage|cache|session|setting|report|page|screen|form|button|control|route|navigation|request|response|api|server|app|application|project|feature|result|output|save|saved|store|stored|persist|display|show|shown|appear|visible|find|found|location|path|account|email|inbox|verification|password|login|log[ -]?in|sign[ -]?in|sign[ -]?up|signup|authentication|auth)\b/i;

// Change verbs are ordinary English words. "How does the data move around?", "where does the update
// happen?", "what happens when I remove an expense?" each carry one, yet none asks for a change —
// matching the verb alone let a question silently rewrite the user's source. Enumerating safe phrasings
// one at a time never converges, so this reads sentence *form* instead.
const INTERROGATIVE_OPENER =
  /^(?:so\s+|and\s+|but\s+|ok(?:ay)?[,\s]+|hey[,\s]+|just\s+)*(?:how|what|what'?s|why|where|when|which|who|whose|whom|does|do|did|is|are|am|was|were|can|could|will|would|should|shall|has|have|had|any|explain|describe|summari[sz]e|clarify|walk me through|tell me|show me|help me understand|curious|wondering|i'?m curious|i wonder)\b/i;

// Polite and connector-led commands. These *look* interrogative ("can you add…", "how about you add…")
// but are real change requests, so they must keep their imperative reading.
const IMPERATIVE_COMMAND =
  /^(?:please\s+|just\s+|go ahead and\s+|now\s+|then\s+|also\s+|kindly\s+)*(?:(?:can|could|would|will)\s+(?:you|we)\s+(?:please\s+|now\s+|just\s+)?|(?:how|what)\s+about\s+(?:you\s+)?|why\s+(?:don'?t\s+you|not)\s+|i(?:'d| would)\s+like\s+(?:you\s+)?to\s+|i\s+(?:want|need)\s+(?:you\s+)?to\s+|let'?s\s+)?(?:add|create|make|build|generate|implement|edit|change|update|modify|fix|repair|separate|split|extract|move|delete|remove|rename|refactor|install|enable|disable|wire|hook up|replace|switch|convert|redesign|restyle|migrate|rewrite)\b|\b(?:then|and then|and also|also|after that)\s+(?:please\s+)?(?:add|create|make|build|implement|edit|change|update|modify|fix|move|delete|remove|rename|refactor|install|enable|wire|replace|switch|apply)\b/i;

// A trailing qualifier such as "steps only" or "just curious" is neither question nor command, so it must
// not disqualify the message around it. Verbless and short is the test: it cannot carry an instruction or
// a claim. "The button is broken" holds a copula and so still counts as a real statement — a bug report
// bundled with a question keeps its debug reading.
const FINITE_VERB = /\b(?:is|are|was|were|be|been|being|am|has|have|had|do|does|did|will|would|can|could|should|shall|must|may|might|isn'?t|aren'?t|wasn'?t|doesn'?t|don'?t|won'?t|can'?t|broke|broken|fails?|failed|crashe?[sd]?|wrong|works?|worked)\b/i;

function isNeutralQualifier(sentence: string): boolean {
  const words = sentence.replace(/[^\w\s'-]/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 4 && !FINITE_VERB.test(sentence);
}

/**
 * True when the message reads as a question and never as a command — a question no matter which change
 * verbs it happens to contain. Deliberately strict: one imperative clause anywhere ("explain the flow,
 * then add a comment") disqualifies the whole message, so a bundled request still acts.
 */
export function looksLikeReadOnlyQuestionForm(message: string): boolean {
  const sentences = (message.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (!sentences.length) return false;
  if (sentences.some((sentence) => IMPERATIVE_COMMAND.test(sentence))) return false;

  const isQuestion = (sentence: string) => {
    if (/\?\s*$/.test(sentence)) return true;
    // A sentence with no question mark that states a current runtime failure is a bug report, not a
    // read-only question — even when a temporal "When I click …, it closes." opener makes it look
    // interrogative. Without this, a crash report was swallowed as inspection instead of repair.
    if (CURRENT_RUNTIME_FAILURE_PATTERN.test(sentence)) return false;
    return INTERROGATIVE_OPENER.test(sentence);
  };
  return sentences.some(isQuestion) && sentences.every((sentence) => isQuestion(sentence) || isNeutralQualifier(sentence));
}

/** Client-safe guard for a complete new change request. This prevents a semantic follow-up model
 * from folding a self-contained task into an older failed execution merely because both concern the
 * same project. It deliberately reuses the broad mutation family rather than matching release-gate
 * sentences or one exact continuation phrase. */
export function standaloneMutationIntent(message: string): "edit" | "debug" | null {
  const text = message.trim();
  if (!text || explicitReadOnlyProjectIntent(text)) return null;
  if (/\b(?:fix|repair|bug|error|crash(?:es|ed|ing)?|broken|failing|failed|clos(?:e|es|ed|ing)|exit(?:s|ed|ing)?|shuts?\s+down|stops?\s+working|freezes?|hangs?|disappears?)\b/i.test(text)) return "debug";
  return MUTATING_PATTERN.test(text) && !looksLikeReadOnlyQuestionForm(text) ? "edit" : null;
}

/** A question plus a current product symptom requires evidence from the active project, not generic advice. */
export function projectBehaviorDiagnosisIntent(message: string): boolean {
  const text = message.trim();
  if (!text || !CURRENT_RUNTIME_FAILURE_PATTERN.test(text) || !PROJECT_BEHAVIOR_SUBJECT_PATTERN.test(text)) return false;
  const asksForEvidence = /\?|\b(?:why|how|what|where|did|does|is|are|was|were|really|actually)\b/i.test(text);
  return asksForEvidence && !IMPERATIVE_COMMAND.test(text) && !EXPLICIT_FOLLOW_ON_MUTATION_PATTERN.test(text);
}

/**
 * Recognizes questions about the reasoning behind Foundry's prior work. This is an intent family,
 * not a release-gate sentence: the online model remains the primary semantic resolver, while this
 * guard keeps natural rationale/decision wording working when classification is unavailable or
 * returns a generic read-only question.
 */
export function isRetrospectiveRequest(message: string): boolean {
  const text = message.trim();
  if (!text || EXPLICIT_FOLLOW_ON_MUTATION_PATTERN.test(text)) return false;

  const directPriorWhy =
    /\bwhy\s+(?:(?:did|do|does|would|have)\s+(?:you|foundry)|(?:was|were|is|are)\s+(?:that|this|it)|(?:choose|chose|pick|picked|use|used|implement|implemented|change|changed|add|added|remove|removed|make|made)\b)/i.test(text)
    || /\bhow\s+come\s+(?:you|foundry|that|this|it)\b/i.test(text)
    || /\bhow\s+(?:did|do|have)\s+(?:you|foundry)\s+(?:fix|solve|implement|build|change|add|remove|make|write|handle|approach)\b/i.test(text);
  if (directPriorWhy) return true;

  const asksForReason =
    /\b(?:reason|rationale|reasoning|justification|motivation|thinking|logic|basis|trade-?offs?)\b/i.test(text)
    || /\bwhat\s+(?:led|prompted|made|caused)\b/i.test(text)
    || /\bwhat\s+was\s+behind\b/i.test(text)
    || /\b(?:explain|describe|walk me through|tell me about)\b[^.!?\n]{0,80}\b(?:decision|choice|approach)\b/i.test(text);
  const referencesPriorWork =
    /\b(?:you|your|foundry)\b/i.test(text)
    || /\b(?:that|this|it)\s+(?:was|were|got|being|had\s+been)\s+(?:done|changed|chosen|picked|used|implemented|added|removed|made|built|fixed|written)\b/i.test(text)
    || /\b(?:decision|choice|approach|change|implementation|fix)\s+(?:you|foundry)\s+(?:made|chose|picked|used|implemented|applied)\b/i.test(text)
    || /\b(?:behind|for)\s+(?:that|this|the)\s+(?:decision|choice|approach|change|implementation|fix)\b/i.test(text)
    || /\bbehind\s+(?:that|this|it)\b/i.test(text);

  return asksForReason && referencesPriorWork;
}

/**
 * Deterministic safety boundary for advice/explanation turns. A model may notice an embedded verb
 * such as "add" or "change" and over-index on it, but manual how-to language and explicit no-write
 * constraints describe who will act. These turns may inspect relevant project evidence, but they
 * must never enter mutation execution or clarification merely because a hypothetical step has a
 * change verb in it.
 */
export function explicitReadOnlyProjectIntent(message: string): "question" | "inspection" | null {
  const text = message.trim();
  if (!text || RECORDED_STATUS_PATTERN.test(text) || EXPLICIT_FOLLOW_ON_MUTATION_PATTERN.test(text)) return null;
  const manualGuidance = MANUAL_GUIDANCE_PATTERN.test(text);
  const explicitNoMutation = EXPLICIT_NO_MUTATION_PATTERN.test(text) && READ_ONLY_REQUEST_PATTERN.test(text);
  // Two ways to qualify as a read-only evidence question. The subject-noun route needs the message to
  // be free of change verbs; the sentence-form route does not, because an all-interrogative message with
  // no imperative clause is a question whatever verbs it contains. Without the second route, asking
  // "how does the data move around in here?" started an edit mission and rewrote the user's page.
  const evidenceQuestion = !EXPLICIT_FOLLOW_ON_MUTATION_PATTERN.test(text)
    && (looksLikeReadOnlyQuestionForm(text)
      || (PROJECT_BEHAVIOR_QUESTION_PATTERN.test(text)
        && PROJECT_BEHAVIOR_SUBJECT_PATTERN.test(text)
        && !MUTATING_PATTERN.test(text)));
  if (!manualGuidance && !explicitNoMutation && !evidenceQuestion) return null;
  if (evidenceQuestion) return "inspection";
  return PROJECT_EVIDENCE_PATTERN.test(text) ? "inspection" : "question";
}

export function isApprovalReplyMessage(message: string): boolean {
  return APPROVAL_REPLY_PATTERN.test(message.trim());
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
  const explicitReadOnlyIntent = explicitReadOnlyProjectIntent(text);

  if (explicitReadOnlyIntent) {
    return readOnlyRecord(explicitReadOnlyIntent, explicitFiles, MANUAL_GUIDANCE_PATTERN.test(text));
  }

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

  if (isRetrospectiveRequest(text)) {
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

  if (MUTATING_PATTERN.test(text) || CURRENT_RUNTIME_FAILURE_PATTERN.test(text)) {
    const referential = hasReferentialTarget(text);
    if (referential && !referencedPriorAction && explicitFiles.length === 0) {
      return clarifyRecord("edit", "Which prior change, file, or component are you referring to?", 0.25, DESTRUCTIVE_PATTERN.test(text));
    }
    const files = explicitFiles.length ? explicitFiles : referential ? recentFiles : [];
    return record({
      currentIntent: CURRENT_RUNTIME_FAILURE_PATTERN.test(text) || /\b(?:bug|broken|error|failing|crash)\b/i.test(text) ? "debug" : "edit",
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
      referencedPriorAction: hasReferentialTarget(text) ? referencedPriorAction : null,
      relevantFiles: hasReferentialTarget(text) ? recentFiles : explicitFiles,
      expectedScope: "Answer read-only from persisted state and real project evidence.",
      destructive: false,
      referenceConfidence: hasReferentialTarget(text) ? (referencedPriorAction ? 0.78 : 0.25) : 0.9,
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
  // Explicit manual/no-mutation language is authoritative even when the model returned edit or
  // clarify. This is the last UI-side gate before WorkspaceShell decides whether to invoke the
  // mutation runtime, so returning the deterministic read-only record here prevents a bad model
  // classification from becoming filesystem authority.
  if (explicitReadOnlyProjectIntent(message)) return fallback;
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
  const referentialMutation = hasReferentialTarget(message) && isMutatingIntent(value.currentIntent);
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

function readOnlyRecord(intent: "question" | "inspection", relevantFiles: string[], manualGuidance: boolean): FollowUpResolutionRecord {
  const projectSpecific = intent === "inspection";
  return record({
    currentIntent: intent,
    referencedPriorAction: null,
    relevantFiles,
    expectedScope: projectSpecific
      ? "Inspect only the project evidence needed to answer; do not modify files or execute project commands."
      : "Answer directly without inspecting or modifying project files.",
    destructive: false,
    referenceConfidence: 1,
    plannedAction: manualGuidance
      ? "Explain clear manual steps the user can perform themselves; do not execute them."
      : "Explain the requested project information from relevant evidence without changing anything.",
    continuity: "not_applicable",
    rationale: manualGuidance
      ? "The user asked how to perform the task manually, so this is guidance rather than authorization to act."
      : "The user explicitly prohibited changes, so the request is read-only.",
  });
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

/**
 * Detects a pronoun used as the target of an action/reference, not merely the same token used as
 * grammar (for example, the conjunction in "so that the dashboard opens").
 */
function hasReferentialTarget(message: string): boolean {
  const text = message.trim();
  return /^(?:that|this|it|those|them)\b/i.test(text)
    || /\b(?:do|undo|revert|remove|delete|drop|erase|clear|reset|change|make|move|rename|fix|repair|update|edit|modify|replace|style|darken|lighten|use|open|close|run|retry|continue|click|select|submit)(?:s|ed|ing)?\s+(?:that|this|it|those|them)\b/i.test(text)
    || /\b(?:after|before|with|without|from|to|on|in|inside|around|under|over)\s+(?:that|this|it|those|them)\b/i.test(text)
    || /\b(?:that|this|it|those|them)\s+(?:back|again)\b/i.test(text)
    || /\b(?:do|try|run|build|continue)\s+(?:it\s+)?again\b/i.test(text);
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
