import { describe, expect, it } from "vitest";
import { needsGreenfieldImplementationRecovery } from "./greenfield-recovery";

describe("greenfield implementation recovery", () => {
  it("continues a setup-only batch that stopped before runnable source", () => {
    expect(needsGreenfieldImplementationRecovery({
      status: "failed",
      blocker: "NO_PROGRESS_BEFORE_MUTATION: setup files were rejected",
      changedFileCount: 2,
      hasRunnableEntry: false,
    })).toBe(true);
  });

  it("recovers a compiler-clean source batch that still has no reachable product", () => {
    expect(needsGreenfieldImplementationRecovery({
      status: "passed",
      changedFileCount: 3,
      hasRunnableEntry: false,
    })).toBe(true);
  });

  it("does not buy another batch after runnable source exists for the same no-progress signal", () => {
    expect(needsGreenfieldImplementationRecovery({
      status: "failed",
      blocker: "NO_PROGRESS_BEFORE_MUTATION",
      changedFileCount: 5,
      hasRunnableEntry: true,
    })).toBe(false);
  });

  it("does not continue a successful runnable product or user-stopped work", () => {
    expect(needsGreenfieldImplementationRecovery({
      status: "passed",
      changedFileCount: 4,
      hasRunnableEntry: true,
    })).toBe(false);
    expect(needsGreenfieldImplementationRecovery({
      status: "stopped",
      changedFileCount: 0,
      hasRunnableEntry: false,
    })).toBe(false);
  });
});
