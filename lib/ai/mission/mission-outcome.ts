import type { BlockerDisposition } from "@/lib/ai/mission/autonomy-contract";

/**
 * What actually happened, stated precisely.
 *
 * A mission had two reportable shapes — passed or failed — and that is far too coarse to be truthful.
 * "Failed" was carrying a mission that delivered four of five requirements, a mission waiting on a
 * credential the user has to supply, and a mission asking for a platform this machine does not have.
 * Those are three entirely different situations with three different next steps, and collapsing them
 * teaches the user to distrust the verdict.
 *
 * The eight states below are the ones the reliability contract distinguishes. Deriving them is
 * deliberately deterministic: the signals are already established by the time a mission ends, and
 * asking a model to characterise its own outcome is exactly how "completed with warnings" becomes
 * "completed".
 */
export type MissionOutcomeState =
  /** Something failed, Foundry fixed it without help, and the work finished. */
  | "recovered-automatically"
  /** Everything asked for was delivered and proven. */
  | "completed-and-verified"
  /** Everything was delivered, but something is unproven or carries a caveat. */
  | "completed-with-warnings"
  /** Real work landed and is preserved, but some requested items were not reached. */
  | "partially-completed"
  /** Stopped needing something external: a credential, a service, an access grant. */
  | "blocked-by-missing-access"
  /** Stopped needing the user to approve or decide something. */
  | "blocked-by-user-decision"
  /** The work cannot be done on this machine as configured. */
  | "unsupported-environment"
  /** Genuinely failed after bounded recovery, with nothing external to blame. */
  | "failed-after-recovery";

export type MissionOutcomeSignals = {
  /** Whether the mission's own verification reached a passing verdict. */
  passed: boolean;
  /** The autonomy contract's reading of why it stopped, when it stopped. */
  blockerDisposition?: BlockerDisposition;
  /** Whether the stated blocker is an environment/platform limit rather than a missing credential. */
  environmentLimited?: boolean;
  /** The requirement ledger's verdict, when requirement accounting ran. */
  requirementGate?: "satisfied" | "unproven" | "unmet" | "unchecked";
  /** Whether Foundry hit a failure during the mission and repaired it without asking. */
  recovered?: boolean;
  /** Anything that qualifies an otherwise-complete result. */
  warnings?: string[];
};

export type MissionOutcome = {
  state: MissionOutcomeState;
  /** One sentence the user reads first. */
  headline: string;
  /** Whether this outcome means the requested work is finished. */
  delivered: boolean;
  /** Whether the user has to do something before Foundry can continue. */
  needsUser: boolean;
};

/**
 * Derives the outcome from signals the mission already established.
 *
 * Order matters and runs most-specific first. A mission that stopped for a user decision is reported
 * that way even if requirements are also outstanding, because the decision is what unblocks it — the
 * outstanding requirements are a consequence, not the thing to act on.
 */
export function deriveMissionOutcome(signals: MissionOutcomeSignals): MissionOutcome {
  const warnings = signals.warnings?.filter(Boolean) ?? [];

  if (!signals.passed) {
    if (signals.blockerDisposition === "user-stopped" || signals.blockerDisposition === "authority-required") {
      return {
        state: "blocked-by-user-decision",
        headline: "Stopped and waiting on your decision. Everything completed so far is preserved.",
        delivered: false,
        needsUser: true,
      };
    }
    if (signals.blockerDisposition === "external-dependency") {
      return signals.environmentLimited
        ? {
          state: "unsupported-environment",
          headline: "This work cannot run on this machine as configured. Nothing was left half-applied.",
          delivered: false,
          needsUser: true,
        }
        : {
          state: "blocked-by-missing-access",
          headline: "Stopped because something outside the project is needed before the work can continue.",
          delivered: false,
          needsUser: true,
        };
    }
    // Real work that landed is worth reporting as progress even though the mission did not finish —
    // "failed" over four of five delivered requirements is what makes a verdict untrustworthy.
    if (signals.requirementGate === "unmet") {
      return {
        state: "partially-completed",
        headline: "Part of the request is done and preserved; the rest was not reached.",
        delivered: false,
        needsUser: false,
      };
    }
    // "Exhausting its recovery attempts" was the headline on a run that had made exactly one repair
    // attempt, which read as Foundry shrugging. Say what was actually done and what is still wrong —
    // the detail line carries the defect, so the headline's job is to be accurate about the effort.
    return {
      state: "failed-after-recovery",
      headline: "The requested product is incomplete. Foundry preserved the verified work and listed every unresolved requirement below.",
      delivered: false,
      needsUser: false,
    };
  }

  // A passing verdict still has to survive requirement accounting: reaching the end of the checklist is
  // not the same as having delivered what was asked for.
  if (signals.requirementGate === "unmet") {
    return {
      state: "partially-completed",
      headline: "Part of the request is done and preserved; the rest was not reached.",
      delivered: false,
      needsUser: false,
    };
  }

  if (signals.requirementGate === "unproven" || signals.requirementGate === "unchecked" || warnings.length) {
    return {
      state: "completed-with-warnings",
      headline: "The requested work is done, with something worth your attention.",
      delivered: true,
      needsUser: false,
    };
  }

  if (signals.recovered) {
    return {
      state: "recovered-automatically",
      headline: "Something failed along the way, Foundry fixed it, and the requested work is done and verified.",
      delivered: true,
      needsUser: false,
    };
  }

  return {
    state: "completed-and-verified",
    headline: "The requested work is done and verified.",
    delivered: true,
    needsUser: false,
  };
}

/**
 * The coarse status this outcome maps to.
 *
 * The client contract still speaks passed/failed, so the precise state travels *alongside* it rather
 * than replacing it. Partially completed maps to failed on purpose: it is not done, and reporting it as
 * passed would be the invented completion this whole design exists to prevent — but it is now reported
 * with a headline that says what survived, instead of a bare failure.
 */
export function missionOutcomeStatus(state: MissionOutcomeState): "passed" | "failed" {
  return state === "completed-and-verified" || state === "completed-with-warnings" || state === "recovered-automatically"
    ? "passed"
    : "failed";
}

/** The outcome as a line for the mission record, with its qualifying detail attached. */
export function formatMissionOutcome(outcome: MissionOutcome, detail?: string): string {
  return detail?.trim() ? `${outcome.headline} ${detail.trim()}` : outcome.headline;
}
