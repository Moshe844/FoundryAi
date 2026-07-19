export type AcceptanceFailureOrigin = "none" | "product" | "validator" | "infrastructure" | "environment" | "unknown";

export type AcceptanceEvidenceInput = {
  verified: boolean;
  available?: boolean;
  explicitRepairEligible?: boolean;
  failureKind?: string;
  infrastructureFailure?: boolean;
};

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
