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

/**
 * An unfinished generated project remains the same active mission even after its first runnable
 * source slice exists. The old policy required a separate user continuation once a runnable entry
 * had been written, which converted an internal batch boundary into a user-visible stop and caused
 * large requests to finish with most requirements still open.
 *
 * A runnable entry is progress, not completion. Resume whenever the authoritative requirement plan
 * still has open items. Browser-evidenced repair, undo, command-only work, and deletion remain on
 * their dedicated paths.
 */
export function shouldResumeIncompleteGeneratedProject(input: GeneratedRecoveryDecision) {
  return input.isFoundryGeneratedProject
    && !input.hasPreModelBrowserEvidence
    && !input.isUndo
    && (!input.hasRunnableEntry || input.hasOpenPlanItems)
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
 * Finishing an unfinished generated project is real build work. Keep both the model-call and dollar
 * ceilings bounded by the mission tier; deterministic builds, tests, and browser checks do not spend
 * this budget. Duplicate-plan and repeated-evidence guards remain responsible for stopping waste.
 */
export function generatedRecoveryBudgetForTier(tierBudget: { maximumModelCalls: number; estimatedCostUsd: number }) {
  return {
    maximumModelCalls: Math.max(8, Math.min(32, tierBudget.maximumModelCalls)),
    estimatedCostUsd: Math.max(0.75, Math.min(4, tierBudget.estimatedCostUsd)),
  };
}

/**
 * A recovery lane retries work the primary route already failed to do — it is strictly narrower than the
 * mission that spawned it, so it must not inherit that mission's full ceiling.
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
