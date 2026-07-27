import { describe, expect, it } from "vitest";

import { gateRepairBudget, MINIMUM_GATE_REPAIR_ATTEMPTS, nextGateAction, type GateAttempt } from "./gate-persistence";

const attempt = (overrides: Partial<GateAttempt> = {}): GateAttempt => ({ fingerprint: "missing-signup-route", changedFiles: 2, escalated: false, ...overrides });

describe("what a failing gate does next", () => {
  it("repairs the first failure", () => {
    expect(nextGateAction({ attempts: [], currentFingerprint: "a", maxAttempts: 5 }).action).toBe("repair");
  });

  it("keeps repairing while the findings keep changing", () => {
    // Different finding each pass means the repairs are landing.
    const action = nextGateAction({ attempts: [attempt({ fingerprint: "a" })], currentFingerprint: "b", maxAttempts: 5 });
    expect(action.action).toBe("repair");
    expect(action.reason).toContain("repairs are landing");
  });

  it("escalates rather than ending the mission when a finding survives", () => {
    // This is the case that used to end the run outright, after a single attempt.
    const action = nextGateAction({ attempts: [attempt({ fingerprint: "a" })], currentFingerprint: "a", maxAttempts: 5 });
    expect(action.action).toBe("escalate");
    expect(action.reason).toContain("stronger model");
  });

  it("escalates when a repair wrote nothing at all", () => {
    const action = nextGateAction({ attempts: [attempt({ changedFiles: 0 })], currentFingerprint: "a", maxAttempts: 5 });
    expect(action.action).toBe("escalate");
    expect(action.reason).toContain("changed no files");
  });

  it("stops only once escalation has also failed to move the finding", () => {
    const action = nextGateAction({
      attempts: [attempt({ fingerprint: "a" }), attempt({ fingerprint: "a", escalated: true })],
      currentFingerprint: "a",
      maxAttempts: 5,
    });
    expect(action.action).toBe("stop");
    expect(action.reason).toContain("run out of approaches");
  });

  it("does not escalate twice", () => {
    const attempts = [attempt({ fingerprint: "a", escalated: true }), attempt({ fingerprint: "b" })];
    expect(nextGateAction({ attempts, currentFingerprint: "b", maxAttempts: 5 }).action).toBe("stop");
  });

  it("still ends at the budget so a gate cannot run forever", () => {
    const attempts = Array.from({ length: 5 }, (_, index) => attempt({ fingerprint: `f${index}` }));
    const action = nextGateAction({ attempts, currentFingerprint: "f5", maxAttempts: 5 });
    expect(action.action).toBe("stop");
    expect(action.reason).toContain("5 repair attempts");
  });
});

describe("the budget a gate is given", () => {
  it("lifts a shallow depth to the floor", () => {
    // Live: standard depth allowed 2 stages, and a repeated finding cut that to one real attempt.
    expect(gateRepairBudget(1)).toBe(MINIMUM_GATE_REPAIR_ATTEMPTS);
    expect(gateRepairBudget(2)).toBe(MINIMUM_GATE_REPAIR_ATTEMPTS);
  });

  it("leaves a deeper depth alone", () => {
    expect(gateRepairBudget(6)).toBe(6);
  });
});
