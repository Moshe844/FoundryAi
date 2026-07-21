export type AcceptanceFailureOrigin = "none" | "product" | "validator" | "infrastructure" | "environment" | "unknown";

export type AcceptanceEvidenceInput = {
  verified: boolean;
  available?: boolean;
  explicitRepairEligible?: boolean;
  failureKind?: string;
  infrastructureFailure?: boolean;
};

const EXECUTION_BOUNDARY_PATTERN = /Estimated request cost would exceed|Model-call limit reached|Premium-model call limit reached|configured execution limit/i;
const NO_PROGRESS_AFTER_MUTATION_PATTERN = /NO_PROGRESS_AFTER_MUTATION/i;

export function nativeAcceptanceBoundaryPolicy(input: {
  status: "passed" | "failed" | "stopped" | "awaiting-approval" | "awaiting-mock-approval" | "needs-clarification";
  changedFileCount: number;
  blocker?: string;
  behaviorAcceptanceRequired: boolean;
}): {
  shouldValidate: boolean;
  maySpendRepairCall: boolean;
  budgetBoundaryAfterVerifiedEdit: boolean;
  noProgressBoundaryAfterVerifiedEdit: boolean;
} {
  const hasVerifiedEdit = input.changedFileCount > 0;
  const budgetBoundaryAfterVerifiedEdit = input.status === "failed"
    && hasVerifiedEdit
    && EXECUTION_BOUNDARY_PATTERN.test(input.blocker ?? "");
  const noProgressBoundaryAfterVerifiedEdit = input.status === "failed"
    && hasVerifiedEdit
    && NO_PROGRESS_AFTER_MUTATION_PATTERN.test(input.blocker ?? "");
  const reconcilableStatus = input.status === "passed" || budgetBoundaryAfterVerifiedEdit || noProgressBoundaryAfterVerifiedEdit;
  return {
    shouldValidate: hasVerifiedEdit && input.behaviorAcceptanceRequired && reconcilableStatus,
    maySpendRepairCall: !budgetBoundaryAfterVerifiedEdit && !noProgressBoundaryAfterVerifiedEdit,
    budgetBoundaryAfterVerifiedEdit,
    noProgressBoundaryAfterVerifiedEdit,
  };
}

/** Source repair is fail-closed: only explicit product/runtime evidence may authorize code changes.
 * Validator lookup limitations, missing drivers, stale preview infrastructure, and unavailable hosts
 * must be repaired in their own layer or surfaced without spending a product-repair model call. */
export function classifyAcceptanceEvidence(input: AcceptanceEvidenceInput): {
  origin: AcceptanceFailureOrigin;
  repairEligible: boolean;
} {
  if (input.verified) return { origin: "none", repairEligible: false };
  const failureKind = (input.failureKind ?? "").toLowerCase();
  if (input.explicitRepairEligible || /(?:^|-)application(?:-|$)|product-runtime|process-exited-after-action/.test(failureKind)) {
    return { origin: "product", repairEligible: true };
  }
  if (/validator|driver|control-not-found|control-not-actionable|unsupported-action|no-evidence/.test(failureKind)) {
    return { origin: "validator", repairEligible: false };
  }
  if (input.infrastructureFailure || /infrastructure|stale-asset|preview-runtime/.test(failureKind)) {
    return { origin: "infrastructure", repairEligible: false };
  }
  if (input.available === false || /environment|unavailable|missing-sdk|missing-host/.test(failureKind)) {
    return { origin: "environment", repairEligible: false };
  }
  return { origin: "unknown", repairEligible: false };
}
