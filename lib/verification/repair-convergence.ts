export type RepairAttempt = {
  /** Stable identity of the failure this attempt was made against. */
  fingerprint: string;
  /** Files the attempt actually changed on disk. */
  changedFiles: number;
};

export type RepairVerdict = {
  proceed: boolean;
  /** User-readable explanation of what Foundry will do next. */
  reason: string;
};

/**
 * Decide whether deterministic repair should continue.
 *
 * A no-write attempt proves only that one strategy failed; it does not prove that the compiler,
 * test, or browser defect is external. Foundry therefore keeps going with a different strategy
 * until the bounded repair allowance is genuinely used. The caller remains responsible for
 * changing the repair instruction/model strategy and for preserving the shared cost ceiling.
 */
export function shouldContinueRepair(input: {
  attempts: RepairAttempt[];
  currentFingerprint: string;
  maxAttempts: number;
}): RepairVerdict {
  const { attempts, currentFingerprint, maxAttempts } = input;

  if (!attempts.length) {
    return { proceed: true, reason: "The check found a concrete problem. Foundry is opening the relevant source and applying the first repair." };
  }

  if (attempts.length >= maxAttempts) {
    return {
      proceed: false,
      reason: `Foundry tried ${attempts.length} different bounded repairs and the project check is still failing. The exact diagnostic is preserved for continuation.`,
    };
  }

  const last = attempts[attempts.length - 1];
  if (last.changedFiles === 0) {
    return {
      proceed: true,
      reason: "The previous strategy did not modify the source. Foundry is switching approaches, opening the file named by the diagnostic, and trying a targeted repair.",
    };
  }

  if (last.fingerprint === currentFingerprint) {
    return {
      proceed: true,
      reason: "The previous edit did not remove the same error. Foundry is re-reading the diagnostic and changing the repair strategy instead of repeating the edit.",
    };
  }

  return {
    proceed: true,
    reason: "The previous repair moved the project to a new diagnostic. Foundry is continuing from that progress until the checks pass.",
  };
}

/** A concise, user-readable account of the bounded repair sequence. */
export function describeRepairSequence(attempts: RepairAttempt[]): string {
  if (!attempts.length) return "No repair was needed yet.";
  const distinct = new Set(attempts.map((attempt) => attempt.fingerprint)).size;
  const wrote = attempts.filter((attempt) => attempt.changedFiles > 0).length;
  if (attempts.length === 1) {
    return wrote ? "Foundry applied one source repair and checked the project again." : "The first strategy made no source change, so Foundry switched approaches.";
  }
  return `Foundry tried ${attempts.length} bounded repair approaches; ${wrote} changed source and the checks exposed ${distinct} different diagnostic${distinct === 1 ? "" : "s"}.`;
}
