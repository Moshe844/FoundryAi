import { describe, expect, it } from "vitest";

import { continuationPrompt, decideContinuation, type ContinuationSignals } from "./continuation-authority";

const signals = (overrides: Partial<ContinuationSignals> = {}): ContinuationSignals => ({
  reason: "The browser gate still reports unresolved product defects.",
  nextAction: "Build the missing checkout route",
  spentUsd: 0.4,
  ceilingUsd: 2,
  nextAttemptUsd: 0.25,
  madeProgress: true,
  ...overrides,
});

describe("continuing is the default", () => {
  it("continues when budget and a next action both remain", () => {
    const decision = decideContinuation(signals());
    expect(decision.action).toBe("continue");
    // The user should never be asked to authorise something already within the authorised budget.
    if (decision.action !== "continue") return;
    expect(decision.rationale).toContain("Build the missing checkout route");
    expect(decision.rationale).toContain("still authorised");
  });

  it("continues even after many failed attempts, while budget allows", () => {
    // Running out of repair passes is not one of the six reasons the contract permits a pause.
    expect(decideContinuation(signals({ madeProgress: false })).action).toBe("continue");
  });

  it("shows no prompt at all when continuing", () => {
    expect(continuationPrompt(decideContinuation(signals()))).toBe("");
  });
});

describe("asking only when it is genuinely the user's call", () => {
  it("asks when the next attempt costs more than remains", () => {
    const decision = decideContinuation(signals({ spentUsd: 1.95, nextAttemptUsd: 0.5 }));
    expect(decision.action).toBe("ask");
    if (decision.action !== "ask") return;
    // The question a user can actually answer: what happens next, and what it costs.
    expect(decision.question).toContain("build the missing checkout route");
    expect(decision.question).toContain("$0.50");
    expect(decision.options[0]).toContain("$0.50");
  });

  it("says progress is preserved so a stop does not read as loss", () => {
    const decision = decideContinuation(signals({ spentUsd: 2, nextAttemptUsd: 0.5, madeProgress: true }));
    if (decision.action !== "ask") return;
    expect(decision.question).toContain("preserved");
  });

  it("asks immediately when nothing external can be worked around", () => {
    const decision = decideContinuation(signals({ externallyBlocked: true, reason: "The payment provider key is missing." }));
    expect(decision.action).toBe("ask");
    if (decision.action !== "ask") return;
    // No amount of budget resolves a missing credential, so budget is not the question.
    expect(decision.question).toContain("cannot provide itself");
    expect(decision.question).not.toContain("$");
  });

  it("stops rather than repeating an attempt with nothing new to try", () => {
    const decision = decideContinuation(signals({ nextAction: undefined }));
    expect(decision.action).toBe("ask");
    if (decision.action !== "ask") return;
    expect(decision.question).toContain("no different approach left to try");
    expect(decision.question).toContain("preserved");
  });
});

describe("the question never reads as a blind retry", () => {
  it("never offers a bare continue with no explanation", () => {
    for (const overrides of [
      { spentUsd: 2, nextAttemptUsd: 1 },
      { nextAction: undefined },
      { externallyBlocked: true },
    ] as Array<Partial<ContinuationSignals>>) {
      const decision = decideContinuation(signals(overrides));
      if (decision.action !== "ask") continue;
      expect(decision.options).not.toContain("Continue recovery");
      expect(decision.question.length).toBeGreaterThan(60);
    }
  });

  it("always states what stopped as the recorded blocker", () => {
    const decision = decideContinuation(signals({ spentUsd: 2, nextAttemptUsd: 1 }));
    if (decision.action !== "ask") return;
    expect(decision.blocker).toBe("The browser gate still reports unresolved product defects.");
  });
});
