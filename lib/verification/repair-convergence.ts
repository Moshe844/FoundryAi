/**
 * Deciding whether another repair attempt is worth making.
 *
 * Generated code fails its build on ordinary type errors, and one repair attempt per batch is not
 * enough: observed across several live runs, a batch broke the build, a single repair ran, the build
 * still failed, and the mission carried on stacking features on top of a project that could not
 * compile. It reached the browser gate broken every time, and never on the same error twice.
 *
 * Repeating blindly is the opposite failure — the retry loop that spends a budget rediscovering one
 * error. What separates the two is whether anything is *changing*. A different diagnostic each pass
 * means the repairs are landing and the next one is worth buying. The same diagnostic with no file
 * touched means the next attempt is the previous attempt.
 */

export type RepairAttempt = {
  /** Stable identity of the failure this attempt was made against. */
  fingerprint: string;
  /** Files the attempt actually changed on disk. */
  changedFiles: number;
};

export type RepairVerdict = {
  proceed: boolean;
  /** Why, in words fit for the mission record. */
  reason: string;
};

/**
 * Whether to attempt another repair.
 *
 * Ordered from cheapest signal to most forgiving, so a loop stops for the clearest reason available
 * rather than the first one that happens to match.
 */
export function shouldContinueRepair(input: {
  /** Attempts already made, oldest first. */
  attempts: RepairAttempt[];
  /** The failure still standing after the last attempt. */
  currentFingerprint: string;
  maxAttempts: number;
}): RepairVerdict {
  const { attempts, currentFingerprint, maxAttempts } = input;

  if (!attempts.length) {
    return { proceed: true, reason: "The build is failing and no repair has been attempted yet." };
  }

  if (attempts.length >= maxAttempts) {
    return { proceed: false, reason: `Stopped after ${attempts.length} repair attempts without a passing build.` };
  }

  const last = attempts[attempts.length - 1];

  // A repair that wrote nothing has no result to build on, so repeating it changes nothing.
  if (last.changedFiles === 0) {
    return { proceed: false, reason: "The last repair changed no files, so another attempt would repeat it exactly." };
  }

  // Files changed and the failure is identical: the edit did not touch the cause. Trying again with the
  // same evidence is the loop this exists to prevent.
  if (last.fingerprint === currentFingerprint) {
    return { proceed: false, reason: "The last repair changed files but left the identical failure, so the cause is not being reached." };
  }

  // The failure moved. That is progress, and the next attempt is worth making.
  return { proceed: true, reason: "The failure changed after the last repair, so the repairs are landing and the next one is worth making." };
}

/**
 * A short account of the whole sequence, for the mission record.
 *
 * Written so a user reading a stopped mission can see whether Foundry was making headway or spinning —
 * the difference between "it tried four things and each got further" and "it tried the same thing four
 * times", which the raw attempt count alone cannot convey.
 */
export function describeRepairSequence(attempts: RepairAttempt[]): string {
  if (!attempts.length) return "No repair was attempted.";
  const distinct = new Set(attempts.map((attempt) => attempt.fingerprint)).size;
  const wrote = attempts.filter((attempt) => attempt.changedFiles > 0).length;
  return `${attempts.length} repair attempt${attempts.length === 1 ? "" : "s"}, ${wrote} of which changed files, against ${distinct} distinct failure${distinct === 1 ? "" : "s"}.`;
}
