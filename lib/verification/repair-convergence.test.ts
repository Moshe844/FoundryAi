import { describe, expect, it } from "vitest";

import { describeRepairSequence, shouldContinueRepair, type RepairAttempt } from "./repair-convergence";

const attempt = (fingerprint: string, changedFiles = 2): RepairAttempt => ({ fingerprint, changedFiles });

const verdict = (attempts: RepairAttempt[], currentFingerprint: string, maxAttempts = 4) =>
  shouldContinueRepair({ attempts, currentFingerprint, maxAttempts });

describe("keep going while repairs are landing", () => {
  it("attempts a repair the first time the build fails", () => {
    const result = verdict([], "type-error-a");
    expect(result.proceed).toBe(true);
    expect(result.reason).toContain("no repair has been attempted yet");
  });

  it("continues when the failure moved on", () => {
    // A different error each pass means the edits are reaching real causes. One attempt per batch was
    // never enough — every live run died on a different type error, none of them retried.
    const result = verdict([attempt("type-error-a")], "type-error-b");
    expect(result.proceed).toBe(true);
    expect(result.reason).toContain("repairs are landing");
  });

  it("keeps going across several distinct failures", () => {
    const attempts = [attempt("a"), attempt("b"), attempt("c")];
    expect(verdict(attempts, "d", 6).proceed).toBe(true);
  });
});

describe("stop when another attempt would repeat the last", () => {
  it("stops when the repair wrote nothing", () => {
    const result = verdict([attempt("type-error-a", 0)], "type-error-a");
    expect(result.proceed).toBe(false);
    expect(result.reason).toContain("changed no files");
  });

  it("stops when files changed but the failure is identical", () => {
    // The edit missed the cause. Buying the same evidence again is the retry loop being avoided.
    const result = verdict([attempt("type-error-a", 3)], "type-error-a");
    expect(result.proceed).toBe(false);
    expect(result.reason).toContain("left the identical failure");
  });

  it("stops at the attempt ceiling even while progress continues", () => {
    const attempts = [attempt("a"), attempt("b"), attempt("c"), attempt("d")];
    const result = verdict(attempts, "e", 4);
    expect(result.proceed).toBe(false);
    expect(result.reason).toContain("4 repair attempts");
  });

  it("prefers the ceiling over the sameness reason when both apply", () => {
    // The clearest reason wins: a mission that used its whole allowance should say so.
    const attempts = [attempt("a"), attempt("a")];
    expect(verdict(attempts, "a", 2).reason).toContain("2 repair attempts");
  });
});

describe("accounting for the record", () => {
  it("distinguishes real headway from spinning", () => {
    expect(describeRepairSequence([attempt("a"), attempt("b"), attempt("c")]))
      .toBe("3 repair attempts, 3 of which changed files, against 3 distinct failures.");
    expect(describeRepairSequence([attempt("a"), attempt("a"), attempt("a", 0)]))
      .toBe("3 repair attempts, 2 of which changed files, against 1 distinct failure.");
  });

  it("says plainly when nothing was tried", () => {
    expect(describeRepairSequence([])).toBe("No repair was attempted.");
  });
});
