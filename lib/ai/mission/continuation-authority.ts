/**
 * Deciding whether Foundry may carry on by itself, or genuinely has to ask.
 *
 * Every autonomous stop in the product used to end the same way: a "Continue autonomous repair" button
 * over a sentence explaining that recovery had paused. Pressing it started another paid run which, if
 * nothing had changed, stopped in the same place. That is the failure mode the reliability contract
 * names outright — never show a retry prompt when Foundry can continue intelligently itself.
 *
 * The contract permits exactly six reasons to pause: approval, missing credentials, unavailable
 * external access, a product decision, destructive confirmation, and information that cannot be safely
 * inferred. "I used up my repair passes" is not on that list — unless continuing would spend beyond
 * what the user authorised, which makes it an approval question and therefore legitimate.
 *
 * So the rule is: continue while there is budget and something different left to try. Ask only when
 * continuing costs more than was authorised, or when nothing new can be attempted. And when asking,
 * say what will happen next and what it costs — a question the user can actually answer, rather than
 * an offer to repeat an unexplained attempt.
 */

export type ContinuationSignals = {
  /** What stopped the mission, in its own words. */
  reason: string;
  /** A concrete next action Foundry would take. Absent when nothing new is left to try. */
  nextAction?: string;
  /** Spend already committed by this mission. */
  spentUsd: number;
  /** The ceiling this mission was authorised to spend. */
  ceilingUsd: number;
  /** Estimated cost of the next attempt. */
  nextAttemptUsd: number;
  /** Whether the recent attempts changed anything durable. */
  madeProgress: boolean;
  /** Set when the stop is genuinely external — a credential, a service, a platform, a user decision. */
  externallyBlocked?: boolean;
};

export type ContinuationDecision =
  | { action: "continue"; rationale: string }
  | { action: "ask"; question: string; options: string[]; blocker: string }
  /** Nothing different is left to try. Foundry states the outcome; it does not ask to repeat itself. */
  | { action: "report"; summary: string; blocker: string };

/**
 * Continuing is the default; asking has to be earned.
 *
 * Note the ordering. An external block is asked about first because no amount of budget resolves it.
 * Then "nothing left to try", because spending more on a repeat is worse than stopping. Only then the
 * budget, which is the one question that is genuinely the user's to answer.
 */
export function decideContinuation(signals: ContinuationSignals): ContinuationDecision {
  const remaining = Math.max(0, signals.ceilingUsd - signals.spentUsd);

  if (signals.externallyBlocked) {
    return {
      action: "ask",
      question: `${signals.reason} This needs something Foundry cannot provide itself.`,
      options: ["I've resolved it — continue", "Leave it here"],
      blocker: signals.reason,
    };
  }

  if (!signals.nextAction) {
    // Nothing different is left to try, so there is no question here worth asking. Offering "try again
    // anyway" was still a retry prompt: it put the decision to repeat a known-failed attempt on the
    // user, dressed up as a choice, and pressing it bought exactly the run that had just failed. A
    // senior engineer out of approaches reports what they found; they do not ask permission to repeat
    // themselves. The user can always say something new — that is what the composer is for.
    return {
      action: "report",
      summary: `${signals.reason} Foundry tried every approach it has for this failure, including escalating to a stronger model, and none of them moved it. ${signals.madeProgress ? "Everything built so far is preserved on disk." : "Nothing was lost."}`,
      blocker: signals.reason,
    };
  }

  if (signals.nextAttemptUsd <= remaining) {
    return {
      action: "continue",
      rationale: `${signals.nextAction} (about $${signals.nextAttemptUsd.toFixed(2)} of the $${remaining.toFixed(2)} still authorised for this mission).`,
    };
  }

  // The only genuinely user-owned question here: spending beyond what was authorised.
  return {
    action: "ask",
    question: [
      `${signals.reason}`,
      signals.madeProgress ? "Real progress is on disk and preserved." : "Nothing has been lost.",
      `Foundry knows what to do next — ${lowerFirst(signals.nextAction)} — but that costs about $${signals.nextAttemptUsd.toFixed(2)} and this mission's $${signals.ceilingUsd.toFixed(2)} budget is spent.`,
      "Continue?",
    ].join(" "),
    options: [`Continue — about $${signals.nextAttemptUsd.toFixed(2)}`, "Leave it here"],
    blocker: signals.reason,
  };
}

/**
 * The sentence shown beside the control when Foundry does have to ask.
 *
 * Written so the user can decide without opening anything: what stopped, what happens if they say yes,
 * and what it costs. "Continue autonomous repair" answered none of those.
 */
export function continuationPrompt(decision: ContinuationDecision): string {
  if (decision.action === "continue") return "";
  return decision.action === "report" ? decision.summary : decision.question;
}

function lowerFirst(value: string): string {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}
