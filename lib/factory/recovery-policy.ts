export type GeneratedRecoveryDecision = {
  isFoundryGeneratedProject: boolean;
  hasPreModelBrowserEvidence: boolean;
  isUndo: boolean;
  hasRunnableEntry: boolean;
  isControlContinuation: boolean;
  hasOpenPlanItems: boolean;
  commandOnly: boolean;
  deletesProject: boolean;
};

/** Recovery exists to continue unfinished work, never to convert an old green checklist into proof
 * for a new change. A runnable project with no open plan items goes through normal implementation
 * unless an independently fingerprinted retry was already returned before this policy is reached. */
export function shouldResumeIncompleteGeneratedProject(input: GeneratedRecoveryDecision) {
  return input.isFoundryGeneratedProject
    && !input.hasPreModelBrowserEvidence
    && !input.isUndo
    && (!input.hasRunnableEntry || (input.isControlContinuation && input.hasOpenPlanItems))
    && !input.commandOnly
    && !input.deletesProject;
}

export function buildOnlyRecoveryCanComplete(input: {
  buildPassed: boolean;
  hasRunnableEntry: boolean;
  hasPreModelBrowserEvidence: boolean;
  hasOpenPlanItems: boolean;
  mutatingOutcomeRequired: boolean;
}) {
  return input.buildPassed
    && input.hasRunnableEntry
    && !input.hasPreModelBrowserEvidence
    && !input.hasOpenPlanItems
    && !input.mutatingOutcomeRequired;
}

export type ExactFailedRetryDecision = {
  exactRetry: boolean;
  retryIdMatchesParent: boolean;
  parentState?: "failed" | "cancelled" | string;
  hasApprovalResponse: boolean;
  attachmentCount: number;
};

/** The dedicated Retry control is the user's authoritative instruction to resume that exact run.
 * Intent classification and conversational continuity are deliberately excluded: either can be
 * stale or lossy, and neither may turn an exact retry back into a newly planned paid mission. */
export function shouldResumeExactFailedRetry(input: ExactFailedRetryDecision) {
  return input.exactRetry
    && input.retryIdMatchesParent
    && (input.parentState === "failed" || input.parentState === "cancelled")
    && !input.hasApprovalResponse
    && input.attachmentCount === 0;
}

/** Removes volatile run data while retaining the actual failed capability and error text. This
 * lets autonomous verification recognize the same semantic finding across fresh ports, generated
 * record ids, timestamps, durations, and browser sessions. */
export function normalizeVerificationEvidence(evidence: string) {
  return evidence
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/g, "<timestamp>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/g, "<uuid>")
    .replace(/(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}\b/g, "<loopback>")
    .replace(/\b(?:live[\s_-]+)?acceptance[\s_:#-]*\d{6,}\b/g, "<acceptance-record>")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?)\b/g, "<duration>")
    .replace(/\b\d{10,}\b/g, "<generated-number>")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Autonomous recovery is bounded against runaway cost, but its default is intentionally larger
 * than the old three-shot loop and can be configured per deployment. Progress and repeated-evidence
 * guards remain the primary stop conditions. */
export function autonomousRepairStageLimit(configuredValue: string | undefined, fallback = 6) {
  const parsed = Number.parseInt(configuredValue ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(20, Math.max(1, parsed)) : fallback;
}

/** A Retry on an unfinished generated project is one bounded repair mission, never an escalation to
 * the enterprise routing tier. Deterministic build/browser passes remain outside this paid budget. */
export const GENERATED_RECOVERY_ROUTING_BUDGET = Object.freeze({
  maximumModelCalls: 8,
  estimatedCostUsd: 0.75,
});

/**
 * Finishing an unfinished *generated project* is real build work, not a small repair. The flat $0.75
 * cap above starved genuine multi-file apps — a SwiftUI wellness app with Core Data and several views
 * wrote its files, then died mid-generation. A build is bounded on TWO axes, cost AND model-call count,
 * and both must match the tier or the mission just dies on whichever is tighter. The first version of
 * this fix raised the cost to the tier ceiling but derived the call count from cost (×6), which
 * silently halved Builder's real allowance to 12 calls — so the build then died on calls instead of
 * dollars. Pass the tier's ACTUAL budget through on both axes.
 *
 * Capped at the Architect tier so a resume still can't run away to enterprise, but a small project
 * resume stays cheap and a substantial one gets the room the tier was already sized to give.
 *
 * @param tierBudget the mission tier's own budget (e.g. Builder = 24 calls / $2, Architect = 32 / $4).
 */
export function generatedRecoveryBudgetForTier(tierBudget: { maximumModelCalls: number; estimatedCostUsd: number }) {
  return {
    maximumModelCalls: Math.max(8, Math.min(32, tierBudget.maximumModelCalls)),
    estimatedCostUsd: Math.max(0.75, Math.min(4, tierBudget.estimatedCostUsd)),
  };
}

/**
 * A recovery lane retries work the primary route already failed to do — it is strictly narrower than the
 * mission that spawned it, so it must not inherit that mission's full ceiling. Left unbounded, the
 * action-recovery lane ran under the architect budget ($4) to redo a one-line reposition.
 *
 * Scaling from the mission's own cost ceiling keeps the relationship honest as tier budgets change,
 * rather than pinning another flat number that silently drifts out of proportion.
 */
export function recoveryRoutingBudget(missionCostCeilingUsd: number) {
  return {
    maximumModelCalls: 8,
    estimatedCostUsd: Math.max(0.15, Math.min(0.75, missionCostCeilingUsd * 0.25)),
  };
}

export function generatedRecoveryContinuationLimit(configuredValue: string | undefined) {
  const parsed = Number.parseInt(configuredValue ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(2, Math.max(1, parsed)) : 2;
}
