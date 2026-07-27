import { describe, expect, it } from "vitest";

import { inBatchCorrectnessGate, inBatchRepairNote, shouldRepairInBatch, type InBatchCheck } from "./in-batch-typecheck";
import type { VerificationCommand, VerificationProfile } from "./types";

function command(overrides: Partial<VerificationCommand> & Pick<VerificationCommand, "stage" | "command">): VerificationCommand {
  return { id: overrides.stage, required: true, source: "test", ...overrides };
}

function profile(commands: VerificationCommand[]): VerificationProfile {
  return { adapterId: "next", ecosystem: "node", detectedFrom: [], commands, limitations: [] };
}

describe("choosing the gate to run mid-batch", () => {
  it("prefers typecheck, which fails on the same errors far sooner than a build", () => {
    const chosen = inBatchCorrectnessGate(profile([
      command({ stage: "build", command: "npm run build" }),
      command({ stage: "typecheck", command: "npm run typecheck" }),
      command({ stage: "unit-test", command: "npm test" }),
    ]));
    expect(chosen?.command).toBe("npm run typecheck");
  });

  it("falls back to compile, then build, when there is no typecheck", () => {
    expect(inBatchCorrectnessGate(profile([command({ stage: "build", command: "npm run build" }), command({ stage: "compile", command: "cargo check" })]))?.command).toBe("cargo check");
    expect(inBatchCorrectnessGate(profile([command({ stage: "build", command: "npm run build" })]))?.command).toBe("npm run build");
  });

  it("never picks a long-running command", () => {
    // This runs several times per batch; a dev server or watcher would hang it.
    expect(inBatchCorrectnessGate(profile([command({ stage: "typecheck", command: "tsc --watch", longRunning: true })]))).toBeUndefined();
  });

  it("returns nothing when the stack declares no usable check", () => {
    expect(inBatchCorrectnessGate(undefined)).toBeUndefined();
    expect(inBatchCorrectnessGate(profile([command({ stage: "lint", command: "eslint ." })]))).toBeUndefined();
  });
});

describe("when the batch should fix its own work", () => {
  const check = (fingerprint: string): InBatchCheck => ({ fingerprint, addressed: false });

  it("corrects the first failure inside the batch", () => {
    const verdict = shouldRepairInBatch({ checks: [], currentFingerprint: "type-error-a", maxChecks: 3 });
    expect(verdict.repairInBatch).toBe(true);
    expect(verdict.reason).toContain("cheapest place to correct it");
  });

  it("keeps correcting while the failures are different", () => {
    expect(shouldRepairInBatch({ checks: [check("a")], currentFingerprint: "b", maxChecks: 3 }).repairInBatch).toBe(true);
  });

  it("hands over when the same failure survived a correction", () => {
    // Handing an unaddressed failure back twice is the retry loop this design avoids.
    const verdict = shouldRepairInBatch({ checks: [check("a")], currentFingerprint: "a", maxChecks: 3 });
    expect(verdict.repairInBatch).toBe(false);
    expect(verdict.reason).toContain("stronger repair stage");
  });

  it("hands over once the batch has corrected its share", () => {
    const verdict = shouldRepairInBatch({ checks: [check("a"), check("b"), check("c")], currentFingerprint: "d", maxChecks: 3 });
    expect(verdict.repairInBatch).toBe(false);
    expect(verdict.reason).toContain("corrected 3 failures");
  });
});

describe("what the model is told", () => {
  const note = (attempt = 1) => inBatchRepairNote({ command: "npm run typecheck", diagnostic: "app/page.tsx(3,9): error TS2304: Cannot find name 'Product'.", attempt });

  it("frames it as its own work to finish, not a rejection", () => {
    expect(note()).toContain("The files you just wrote do not pass npm run typecheck");
    expect(note()).toContain("you have them in front of you");
  });

  it("says to fix it now rather than move on", () => {
    expect(note()).toContain("before writing anything else");
    expect(note()).toContain("do not rewrite working files or start the next feature yet");
  });

  it("carries the exact diagnostic", () => {
    expect(note()).toContain("error TS2304: Cannot find name 'Product'.");
  });

  it("counts corrections after the first", () => {
    expect(note(1)).not.toContain("correction 1");
    expect(note(2)).toContain("correction 2 in this batch");
  });
});
