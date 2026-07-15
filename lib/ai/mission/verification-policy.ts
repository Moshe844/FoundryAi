export const VERIFIED_CONFIDENCE = 80;
export const LOW_CONFIDENCE = 60;

export type VerificationAction = "accept" | "repair";

export function verificationAction(confidence: number): VerificationAction {
  return normalizeConfidence(confidence) >= VERIFIED_CONFIDENCE ? "accept" : "repair";
}

export function verificationRisk(confidence: number): "low" | "material" {
  return normalizeConfidence(confidence) < LOW_CONFIDENCE ? "material" : "low";
}

export function verificationImproved(before: number, after: number): boolean {
  return normalizeConfidence(after) > normalizeConfidence(before);
}

function normalizeConfidence(confidence: number) {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(100, Math.round(confidence)));
}
