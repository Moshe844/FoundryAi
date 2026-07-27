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
    expect(action.reason).toContain("previous repair changed the project");
  });

  it("keeps the same tier while real source progress is landing", () => {
    const action = nextGateAction({ attempts: [attempt({ fingerprint: "a" })], currentFingerprint: "a", maxAttempts: 5 });
    expect(action.action).toBe("repair");
    expect(action.reason).toContain("previous repair changed the project");
  });

  it("escalates when a repair wrote nothing at all", () => {
    const action = nextGateAction({ attempts: [attempt({ changedFiles: 0 })], currentFingerprint: "a", maxAttempts: 5 });
    expect(action.action).toBe("escalate");
    expect(action.reason).toContain("made no source change");
  });

  it("stops only once escalation has also failed to write source", () => {
    const action = nextGateAction({
      attempts: [attempt({ fingerprint: "a", changedFiles: 0 }), attempt({ fingerprint: "a", changedFiles: 0, escalated: true })],
      currentFingerprint: "a",
      maxAttempts: 5,
    });
    expect(action.action).toBe("stop");
    expect(action.reason).toContain("could not produce a safe source change");
  });

  it("does not escalate twice", () => {
    const attempts = [attempt({ fingerprint: "a", changedFiles: 0, escalated: true }), attempt({ fingerprint: "b", changedFiles: 0 })];
    expect(nextGateAction({ attempts, currentFingerprint: "b", maxAttempts: 5 }).action).toBe("stop");
  });

  it("still ends at the budget so a gate cannot run forever", () => {
    const attempts = Array.from({ length: 5 }, (_, index) => attempt({ fingerprint: `f${index}` }));
    const action = nextGateAction({ attempts, currentFingerprint: "f5", maxAttempts: 5 });
    expect(action.action).toBe("stop");
    expect(action.reason).toContain("5 bounded repair approaches");
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
