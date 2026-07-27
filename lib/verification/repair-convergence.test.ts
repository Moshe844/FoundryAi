import { describe, expect, it } from "vitest";

import { describeRepairSequence, shouldContinueRepair, type RepairAttempt } from "./repair-convergence";

const attempt = (fingerprint: string, changedFiles = 2): RepairAttempt => ({ fingerprint, changedFiles });
const verdict = (attempts: RepairAttempt[], currentFingerprint: string, maxAttempts = 4) =>
  shouldContinueRepair({ attempts, currentFingerprint, maxAttempts });

describe("autonomous deterministic repair", () => {
  it("starts a repair when a concrete check first fails", () => {
    const result = verdict([], "type-error-a");
    expect(result.proceed).toBe(true);
    expect(result.reason).toContain("concrete problem");
  });

  it("continues when the diagnostic moves", () => {
    const result = verdict([attempt("type-error-a")], "type-error-b");
    expect(result.proceed).toBe(true);
    expect(result.reason).toContain("new diagnostic");
  });

  it("switches approach when the prior strategy wrote nothing", () => {
    const result = verdict([attempt("type-error-a", 0)], "type-error-a");
    expect(result.proceed).toBe(true);
    expect(result.reason).toContain("switching approaches");
    expect(result.reason).toContain("file named by the diagnostic");
  });

  it("changes strategy when an edit leaves the identical failure", () => {
    const result = verdict([attempt("type-error-a", 3)], "type-error-a");
    expect(result.proceed).toBe(true);
    expect(result.reason).toContain("changing the repair strategy");
  });

  it("stops only at the bounded attempt ceiling", () => {
    const attempts = [attempt("a"), attempt("b"), attempt("c"), attempt("d")];
    const result = verdict(attempts, "e", 4);
    expect(result.proceed).toBe(false);
    expect(result.reason).toContain("4 different bounded repairs");
    expect(result.reason).toContain("diagnostic is preserved");
  });
});

describe("user-readable repair accounting", () => {
  it("describes progress without internal retry jargon", () => {
    expect(describeRepairSequence([attempt("a"), attempt("b"), attempt("c")]))
      .toBe("Foundry tried 3 bounded repair approaches; 3 changed source and the checks exposed 3 different diagnostics.");
    expect(describeRepairSequence([attempt("a", 0)]))
      .toBe("The first strategy made no source change, so Foundry switched approaches.");
  });

  it("says plainly when no repair was needed", () => {
    expect(describeRepairSequence([])).toBe("No repair was needed yet.");
  });
});
