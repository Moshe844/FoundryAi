/**
 * What a verification gate does when its repair did not work.
 *
 * The browser gate used to answer this with "give up". A finding seen twice ended the mission, and the
 * depth policy allowed one or two repair stages, so in practice a failing product got a single attempt
 * before the run reported that it had exhausted its recovery. Observed live on a login/signup site: four
 * minutes, one repair, then "Foundry could not complete this after exhausting its recovery attempts."
 * Nothing was exhausted. One thing had been tried.
 *
 * Quitting on a repeated finding was not unreasonable in itself — repeating an identical failed repair
 * is how a budget disappears with nothing to show. But "repeat the same attempt" and "stop the mission"
 * are not the only two options, and treating them as such is what made the product feel like it gives
 * up. A repeated finding means *this approach* is not working, which is a reason to change approach.
 *
 * So a repeated finding escalates: a stronger model, given the same evidence, gets a turn before anyone
 * concludes the defect is unfixable. Only when escalation also changes nothing has the gate genuinely
 * run out of things to try — and that is the only condition under which stopping is honest.
 */

export type GateAttempt = {
  /** Stable identity of the finding this attempt was made against. */
  fingerprint: string;
  /** Files the attempt actually changed on disk. */
  changedFiles: number;
  /** Whether this attempt was already the escalated one. */
  escalated: boolean;
};

export type GateAction = {
  action: "repair" | "escalate" | "stop";
  reason: string;
};

/**
 * The next thing to try at a gate that is still failing.
 *
 * Ordered so the loop stops for the clearest available reason rather than the first that matches, and
 * so every path to "stop" has an escalation behind it.
 */
export function nextGateAction(input: {
  /** Attempts already made, oldest first. */
  attempts: GateAttempt[];
  /** The finding still standing after the last attempt. */
  currentFingerprint: string;
  maxAttempts: number;
}): GateAction {
  const { attempts, maxAttempts } = input;

  if (!attempts.length) {
    return { action: "repair", reason: "The gate is failing and no repair has been attempted yet." };
  }

  if (attempts.length >= maxAttempts) {
    return { action: "stop", reason: `Stopped after ${attempts.length} repair attempts, the last of which still left the gate failing.` };
  }

  const last = attempts[attempts.length - 1];
  const escalationSpent = attempts.some((attempt) => attempt.escalated);
  // A broad browser finding can remain textually identical while a coordinated product
  // slice lands across several files. Real disk progress is convergence, not a reason
  // to buy a stronger model. Escalation is reserved for a no-write attempt.
  const stalled = last.changedFiles === 0;

  if (!stalled) {
    // The finding changed, so the last repair landed and the next one has something to build on.
    return { action: "repair", reason: "The last repair changed the failure, so the repairs are landing and the next one is worth making." };
  }

  const stallReason = "The last repair changed no files";

  if (!escalationSpent) {
    return { action: "escalate", reason: `${stallReason}, so a stronger model takes the same evidence rather than the mission ending here.` };
  }

  return { action: "stop", reason: `${stallReason}, and the escalated attempt did not change it either — the gate has genuinely run out of approaches.` };
}

/**
 * The floor under a gate's repair budget.
 *
 * Depth is a statement about how much reasoning to buy, not permission to ship something broken. A
 * quick mission may skip planning and review; it may not decide that a product failing in a real
 * browser gets one attempt and then a failure report. Whatever depth was chosen, a gate that has
 * evidence of a real defect gets enough attempts to converge on it.
 */
export const MINIMUM_GATE_REPAIR_ATTEMPTS = 5;

export function gateRepairBudget(depthAttempts: number): number {
  return Math.max(MINIMUM_GATE_REPAIR_ATTEMPTS, depthAttempts);
}
