import { createHash } from "node:crypto";

/**
 * The Requirement Ledger.
 *
 * Every substantial request is decomposed into requirements, and each one carries a status until the
 * mission ends. The rule this file exists to enforce is that a mission cannot be reported complete
 * merely because its headline feature works: a request with eighteen requirements must account for
 * all eighteen, and no requirement may quietly disappear between planning and completion.
 *
 * Everything here is pure and deterministic. Deciding *what* the requirements are is a language
 * problem handled by the model (see requirement-extraction.ts); deciding whether the mission may
 * claim completion is a bookkeeping problem, and bookkeeping must never be left to a model that has
 * an incentive to say yes.
 */

export type RequirementStatus =
  | "identified"
  | "planned"
  | "in-progress"
  | "implemented"
  | "verified"
  | "blocked"
  | "excluded";

/**
 * Requests carry more than a list of things to build. "Keep desktop exactly the same" is a
 * constraint that can be violated, "don't add a dependency" is an exclusion that can be breached,
 * and Foundry's own suggestions are neither — they must stay out of the implementation until the
 * user approves them.
 */
export type RequirementKind = "deliverable" | "constraint" | "exclusion" | "optional-suggestion";

export type RequirementOrigin = "request" | "specification" | "attachment" | "correction" | "approval";

export type RequirementEvidenceKind =
  | "file-change"
  | "command"
  | "compiler"
  | "test"
  | "browser"
  | "screenshot"
  | "user-confirmation";

export type RequirementEvidence = {
  kind: RequirementEvidenceKind;
  detail: string;
  /** File path, command line, or artifact id the evidence points at. */
  reference?: string;
  recordedAt: string;
};

export type RequirementStatusChange = {
  from: RequirementStatus | "none";
  to: RequirementStatus;
  detail: string;
  at: string;
};

export type LedgerRequirement = {
  id: string;
  /** The requirement as Foundry understands it. */
  text: string;
  /** The user's own words. Preserved verbatim so exact-wording requests survive paraphrasing. */
  sourceQuote: string;
  kind: RequirementKind;
  status: RequirementStatus;
  statusDetail: string;
  origin: RequirementOrigin;
  /** Attachment file name, specification section, or correction turn this came from. */
  originRef?: string;
  /** Ids of requirements that must land before this one can start. */
  dependsOn: string[];
  /**
   * How this requirement is to be proven, decided when it was understood rather than after the work.
   * Writing the check up front is what stops verification from being retro-fitted to whatever the
   * mission happened to produce.
   */
  verification?: string;
  evidence: RequirementEvidence[];
  history: RequirementStatusChange[];
  /**
   * Set when a later user correction replaces this requirement. The entry stays in the ledger —
   * superseded is a recorded outcome, not a deletion — but it no longer gates completion.
   */
  supersededBy?: string;
};

export type RequirementLedger = {
  missionId: string;
  requirements: LedgerRequirement[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** What extraction produces before the ledger assigns identity and status. */
export type ExtractedRequirement = {
  text: string;
  sourceQuote: string;
  kind: RequirementKind;
  /** Source quotes of requirements this one depends on; resolved to ids during merge. */
  dependsOnQuotes?: string[];
  /** How this requirement should be proven once built. */
  verification?: string;
};

/**
 * A requirement in one of these states has a final answer — built and proven, genuinely blocked, or
 * deliberately not done. "implemented" is deliberately absent: code that was written but never
 * checked is exactly the state that produces a confident "Done" over broken software.
 */
const FINAL_STATUSES: readonly RequirementStatus[] = ["verified", "blocked", "excluded"];

export function isFinalStatus(status: RequirementStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

export function createLedger(missionId: string, extracted: ExtractedRequirement[], origin: RequirementOrigin = "request"): RequirementLedger {
  const now = new Date().toISOString();
  const ledger: RequirementLedger = { missionId, requirements: [], revision: 0, createdAt: now, updatedAt: now };
  return mergeRequirements(ledger, extracted, origin);
}

/**
 * Fold newly extracted requirements into the ledger.
 *
 * Merge is additive by identity: re-running extraction over the same request is idempotent, and a
 * requirement already being worked on keeps its status and evidence rather than being reset to
 * "identified" by a later pass. Nothing is ever removed here — the spec's guarantee that no
 * requirement disappears during implementation only holds if the merge itself cannot drop one.
 */
export function mergeRequirements(
  ledger: RequirementLedger,
  extracted: ExtractedRequirement[],
  origin: RequirementOrigin = "request",
  originRef?: string,
): RequirementLedger {
  const now = new Date().toISOString();
  const requirements = [...ledger.requirements];
  const indexById = new Map(requirements.map((requirement, index) => [requirement.id, index] as const));
  let added = 0;

  for (const item of extracted) {
    const text = normalizeWhitespace(item.text);
    if (!text) continue;
    const id = requirementId(text);
    const existingIndex = indexById.get(id);

    if (existingIndex !== undefined) {
      // Seeing the same requirement again is not new information about its progress. The only thing
      // worth taking from the repeat is a dependency the earlier pass had not spotted yet.
      const existing = requirements[existingIndex];
      const dependsOn = unique([...existing.dependsOn, ...resolveDependencies(item.dependsOnQuotes)]);
      const verification = existing.verification ?? (normalizeWhitespace(item.verification) || undefined);
      if (dependsOn.length !== existing.dependsOn.length || verification !== existing.verification) {
        requirements[existingIndex] = { ...existing, dependsOn, verification };
      }
      continue;
    }

    // An unapproved recommendation must not become work. It is recorded so the user can still see
    // what Foundry would suggest, but it starts excluded and only an explicit approval activates it.
    const suggestion = item.kind === "optional-suggestion";
    requirements.push({
      id,
      text,
      sourceQuote: normalizeWhitespace(item.sourceQuote) || text,
      kind: item.kind,
      status: suggestion ? "excluded" : "identified",
      statusDetail: suggestion
        ? "Recommendation recorded but not applied — optional improvements need explicit user approval."
        : "Identified from the request.",
      origin,
      originRef,
      dependsOn: resolveDependencies(item.dependsOnQuotes),
      verification: normalizeWhitespace(item.verification) || undefined,
      evidence: [],
      history: [{
        from: "none",
        to: suggestion ? "excluded" : "identified",
        detail: suggestion ? "Recorded as an unapproved recommendation." : "Extracted from the request.",
        at: now,
      }],
    });
    indexById.set(id, requirements.length - 1);
    added += 1;
  }

  if (!added && requirements.length === ledger.requirements.length) return ledger;
  return { ...ledger, requirements, revision: ledger.revision + 1, updatedAt: now };
}

export type TransitionResult =
  | { ok: true; ledger: RequirementLedger; requirement: LedgerRequirement }
  | { ok: false; ledger: RequirementLedger; reason: string };

/**
 * Move one requirement to a new status.
 *
 * The guards below are the anti-fake-completion rules. A requirement cannot be called implemented
 * unless work actually started on it, cannot be called verified unless it was implemented first, and
 * cannot be called verified at all without a piece of evidence attached. Those three checks are the
 * difference between a ledger that proves completion and a ledger that just agrees with the model.
 */
export function setRequirementStatus(
  ledger: RequirementLedger,
  requirementId: string,
  status: RequirementStatus,
  detail: string,
  evidence?: RequirementEvidence[],
): TransitionResult {
  const index = ledger.requirements.findIndex((requirement) => requirement.id === requirementId);
  if (index < 0) return { ok: false, ledger, reason: `No requirement ${requirementId} exists in this ledger.` };

  const existing = ledger.requirements[index];
  if (existing.supersededBy) {
    return { ok: false, ledger, reason: `Requirement ${requirementId} was superseded by a later correction and can no longer change status.` };
  }

  const reached = new Set<RequirementStatus>([existing.status, ...existing.history.map((change) => change.to)]);
  const mergedEvidence = [...existing.evidence, ...(evidence ?? [])];

  if (status === "implemented" && !reached.has("in-progress")) {
    return { ok: false, ledger, reason: `Requirement ${requirementId} cannot be reported implemented before it was started.` };
  }
  if (status === "verified" && !reached.has("implemented")) {
    return { ok: false, ledger, reason: `Requirement ${requirementId} cannot be reported verified before it was implemented.` };
  }
  if (status === "verified" && !mergedEvidence.length) {
    return { ok: false, ledger, reason: `Requirement ${requirementId} cannot be reported verified without evidence.` };
  }

  const now = new Date().toISOString();
  const requirement: LedgerRequirement = {
    ...existing,
    status,
    statusDetail: normalizeWhitespace(detail) || existing.statusDetail,
    evidence: mergedEvidence,
    history: [...existing.history, { from: existing.status, to: status, detail: normalizeWhitespace(detail), at: now }],
  };
  const requirements = [...ledger.requirements];
  requirements[index] = requirement;
  return { ok: true, ledger: { ...ledger, requirements, revision: ledger.revision + 1, updatedAt: now }, requirement };
}

export type ReconciledOutcome = "implemented" | "verified" | "blocked" | "excluded";

/**
 * Record what a mission's real evidence shows about one requirement.
 *
 * Statuses are normally set as the work happens, but reconciliation runs at the end and has to place a
 * requirement at its true outcome without having narrated every step. The intermediate transitions are
 * inserted explicitly rather than bypassed, so the history still reads honestly and the guards in
 * setRequirementStatus still apply.
 *
 * The one thing this will not do is let "verified" through without evidence. A reconciler that claims
 * proof it cannot cite is downgraded to "implemented", which keeps the requirement unresolved and the
 * mission short of completion — the correct outcome for work nobody checked.
 */
export function recordOutcome(
  ledger: RequirementLedger,
  requirementId: string,
  outcome: ReconciledOutcome,
  detail: string,
  evidence: RequirementEvidence[] = [],
): TransitionResult {
  const existing = ledger.requirements.find((requirement) => requirement.id === requirementId);
  if (!existing) return { ok: false, ledger, reason: `No requirement ${requirementId} exists in this ledger.` };

  const effective: ReconciledOutcome = outcome === "verified" && !evidence.length && !existing.evidence.length ? "implemented" : outcome;
  const effectiveDetail = effective === outcome
    ? detail
    : `${detail} (recorded as implemented rather than verified: no evidence was cited for this requirement).`;

  const reached = new Set<RequirementStatus>([existing.status, ...existing.history.map((change) => change.to)]);
  const path: RequirementStatus[] = [];
  if (effective === "implemented" || effective === "verified") {
    if (!reached.has("in-progress")) path.push("in-progress");
    if (!reached.has("implemented")) path.push("implemented");
  }
  if (path[path.length - 1] !== effective) path.push(effective);

  let current = ledger;
  let last: TransitionResult = { ok: false, ledger, reason: "No transition was applied." };
  for (const status of path) {
    const isFinalStep = status === effective;
    last = setRequirementStatus(
      current,
      requirementId,
      status,
      isFinalStep ? effectiveDetail : "Recorded from the mission's own evidence during reconciliation.",
      isFinalStep ? evidence : undefined,
    );
    if (!last.ok) return last;
    current = last.ledger;
  }
  return last;
}

export function attachEvidence(ledger: RequirementLedger, requirementId: string, evidence: RequirementEvidence): RequirementLedger {
  const index = ledger.requirements.findIndex((requirement) => requirement.id === requirementId);
  if (index < 0) return ledger;
  const requirements = [...ledger.requirements];
  requirements[index] = { ...requirements[index], evidence: [...requirements[index].evidence, evidence] };
  return { ...ledger, requirements, revision: ledger.revision + 1, updatedAt: new Date().toISOString() };
}

/**
 * A user correction is authoritative and takes effect immediately. The old requirement is retained
 * and marked superseded rather than deleted, so the mission can still explain what it was doing
 * before the correction and why that work stopped.
 */
export function applyCorrection(
  ledger: RequirementLedger,
  supersededId: string,
  replacement: ExtractedRequirement,
): RequirementLedger {
  const index = ledger.requirements.findIndex((requirement) => requirement.id === supersededId);
  const text = normalizeWhitespace(replacement.text);
  if (index < 0 || !text) return ledger;

  const now = new Date().toISOString();
  const newId = requirementId(text);
  if (newId === supersededId) return ledger;

  const previous = ledger.requirements[index];
  const requirements = [...ledger.requirements];
  requirements[index] = {
    ...previous,
    supersededBy: newId,
    statusDetail: "Superseded by a later user correction.",
    history: [...previous.history, { from: previous.status, to: previous.status, detail: `Superseded by ${newId}.`, at: now }],
  };

  const existingReplacement = requirements.findIndex((requirement) => requirement.id === newId);
  if (existingReplacement >= 0) {
    return { ...ledger, requirements, revision: ledger.revision + 1, updatedAt: now };
  }

  requirements.push({
    id: newId,
    text,
    sourceQuote: normalizeWhitespace(replacement.sourceQuote) || text,
    kind: replacement.kind,
    status: "identified",
    statusDetail: "Identified from a user correction, which overrides the earlier understanding.",
    origin: "correction",
    // Inherit the superseded requirement's dependencies: a correction rewords what to build, it does
    // not usually reorder the work around it.
    dependsOn: previous.dependsOn,
    evidence: [],
    history: [{ from: "none", to: "identified", detail: `Replaces ${supersededId} after a user correction.`, at: now }],
  });
  return { ...ledger, requirements, revision: ledger.revision + 1, updatedAt: now };
}

/** Promote a recommendation into real work after the user approves it. */
export function approveSuggestion(ledger: RequirementLedger, requirementId: string, detail: string): RequirementLedger {
  const index = ledger.requirements.findIndex((requirement) => requirement.id === requirementId);
  if (index < 0 || ledger.requirements[index].kind !== "optional-suggestion") return ledger;

  const now = new Date().toISOString();
  const previous = ledger.requirements[index];
  const requirements = [...ledger.requirements];
  requirements[index] = {
    ...previous,
    kind: "deliverable",
    status: "identified",
    statusDetail: normalizeWhitespace(detail) || "Approved by the user; now part of the mission.",
    origin: "approval",
    history: [...previous.history, { from: previous.status, to: "identified", detail: "User approved this recommendation.", at: now }],
  };
  return { ...ledger, requirements, revision: ledger.revision + 1, updatedAt: now };
}

/** Requirements that still gate this mission: not superseded, and not an unapproved recommendation. */
export function activeRequirements(ledger: RequirementLedger): LedgerRequirement[] {
  return ledger.requirements.filter((requirement) => !requirement.supersededBy && requirement.kind !== "optional-suggestion");
}

export type LedgerCompletion = {
  /** True only when every active requirement carries a final status. */
  complete: boolean;
  total: number;
  finalized: number;
  unresolved: LedgerRequirement[];
  byStatus: Record<RequirementStatus, number>;
  /** Plain sentences naming what is still open, for the user-facing completion report. */
  blockers: string[];
};

/**
 * The completion gate. A mission asks this before it may report "Done", and the answer does not
 * depend on whether the primary feature works — it depends on whether every requirement has an
 * honest final answer.
 */
export function assessCompletion(ledger: RequirementLedger): LedgerCompletion {
  const active = activeRequirements(ledger);
  const unresolved = active.filter((requirement) => !isFinalStatus(requirement.status));
  const byStatus = ledger.requirements.reduce((counts, requirement) => {
    counts[requirement.status] += 1;
    return counts;
  }, emptyStatusCounts());

  return {
    complete: unresolved.length === 0 && active.length > 0,
    total: active.length,
    finalized: active.length - unresolved.length,
    unresolved,
    byStatus,
    blockers: unresolved.map((requirement) => `${requirement.text} — still ${readableStatus(requirement.status)}.`),
  };
}

/** Requirements whose dependencies are all finalized, so they are safe to start now. */
export function readyRequirements(ledger: RequirementLedger): LedgerRequirement[] {
  const statusById = new Map(ledger.requirements.map((requirement) => [requirement.id, requirement.status] as const));
  return activeRequirements(ledger)
    .filter((requirement) => requirement.status === "identified" || requirement.status === "planned")
    .filter((requirement) => requirement.dependsOn.every((id) => {
      const status = statusById.get(id);
      return !status || isFinalStatus(status) || status === "implemented";
    }));
}

/**
 * The ledger as the model sees it. Kept short on purpose — this is injected into mission context on
 * every turn, so it reports state and never replays the full history of how each item got there.
 */
export function formatLedgerForModel(ledger: RequirementLedger): string {
  const active = activeRequirements(ledger);
  if (!active.length) return "Requirement ledger: no requirements recorded yet.";

  const lines = active.map((requirement) => {
    const kind = requirement.kind === "deliverable" ? "" : ` [${requirement.kind}]`;
    const detail = requirement.statusDetail ? ` — ${requirement.statusDetail}` : "";
    return `- (${requirement.id}) ${readableStatus(requirement.status)}${kind}: ${requirement.text}${detail}`;
  });

  const completion = assessCompletion(ledger);
  return [
    `Requirement ledger (${completion.finalized}/${completion.total} finalized, revision ${ledger.revision}):`,
    ...lines,
    completion.complete
      ? "Every requirement has a final status. Completion may be reported."
      : `Not complete: ${completion.unresolved.length} requirement(s) still open. Do not report this mission as done.`,
  ].join("\n");
}

function readableStatus(status: RequirementStatus): string {
  return status === "in-progress" ? "in progress" : status === "excluded" ? "intentionally excluded" : status;
}

function emptyStatusCounts(): Record<RequirementStatus, number> {
  return { identified: 0, planned: 0, "in-progress": 0, implemented: 0, verified: 0, blocked: 0, excluded: 0 };
}

/**
 * Identity is derived from the requirement's own wording so that re-extracting the same request
 * produces the same ids. Case and punctuation are ignored — a model that returns "Add a dark mode
 * toggle" on one pass and "add a dark mode toggle." on the next is describing one requirement, and
 * counting it twice would leave a permanently unfinishable mission.
 */
export function requirementId(text: string): string {
  const key = normalizeWhitespace(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return `req-${createHash("sha1").update(key).digest("hex").slice(0, 10)}`;
}

function resolveDependencies(quotes: string[] | undefined): string[] {
  return unique((quotes ?? []).map((quote) => requirementId(quote)).filter(Boolean));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
