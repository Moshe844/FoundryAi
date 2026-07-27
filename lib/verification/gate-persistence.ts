export type GateAttempt = {
  /** Stable identity of the finding this attempt was made against. */
  fingerprint: string;
  /** Files the attempt actually changed on disk. */
  changedFiles: number;
  /** Whether this attempt already used the escalated repair path. */
  escalated: boolean;
};

export type GateAction = {
  action: "repair" | "escalate" | "stop";
  reason: string;
};

/**
 * Choose the next bounded response to a failing build, test, or browser check.
 * A repeated finding changes strategy; it does not automatically end the mission.
 */
export function nextGateAction(input: {
  attempts: GateAttempt[];
  currentFingerprint: string;
  maxAttempts: number;
}): GateAction {
  const { attempts, maxAttempts } = input;

  if (!attempts.length) {
    return { action: "repair", reason: "The check found a concrete problem. Foundry is opening the relevant source and applying a targeted fix." };
  }

  if (attempts.length >= maxAttempts) {
    return {
      action: "stop",
      reason: `Foundry tried ${attempts.length} bounded repair approaches and the check still fails. The exact evidence is preserved so work can continue without repeating completed changes.`,
    };
  }

  const last = attempts[attempts.length - 1];
  const escalationSpent = attempts.some((attempt) => attempt.escalated);
  const stalled = last.changedFiles === 0;

  if (!stalled) {
    return {
      action: "repair",
      reason: "The previous repair changed the project. Foundry is running the check again and continuing from the new result.",
    };
  }

  if (!escalationSpent) {
    return {
      action: "escalate",
      reason: "The previous strategy made no source change. Foundry is switching to a stronger, evidence-driven repair approach instead of repeating it.",
    };
  }

  return {
    action: "stop",
    reason: "Two different evidence-driven strategies could not produce a safe source change. The exact failing check and project state are preserved for continuation.",
  };
}

/** Every real product defect receives a meaningful bounded repair allowance. */
export const MINIMUM_GATE_REPAIR_ATTEMPTS = 5;

export function gateRepairBudget(depthAttempts: number): number {
  return Math.max(MINIMUM_GATE_REPAIR_ATTEMPTS, depthAttempts);
}
