import { describe, expect, it } from "vitest";
import { isVerificationOnlyOperation } from "./verification-intent";

describe("isVerificationOnlyOperation", () => {
  it("keeps the exact failed acceptance retry read-only even when capability names use mutation verbs", () => {
    expect(isVerificationOnlyOperation(
      "Retry the failed browser verification for the existing LiveProof Tasks project. Do not rebuild working source; rerun the real add, search, complete, persistence, and delete acceptance flow and continue until every applicable gate passes.",
    )).toBe(true);
  });

  it("provides one authoritative result for both routing and deterministic browser preflight", async () => {
    const runtime = await import("node:fs/promises").then(({ readFile }) => readFile(
      new URL("./runtime.ts", import.meta.url),
      "utf8",
    ));
    expect(runtime).toContain("namesBrowserAcceptanceSurface");
    expect(runtime).toContain("verificationOnlyRequest ||");
  });

  it.each([
    "Rerun browser acceptance for add, search, complete, and delete capabilities.",
    "Exercise the delete workflow in the live preview without changing source.",
    "Retest the build, browser flow, and persistence gate.",
  ])("routes verification-only wording without source mutation: %s", (request) => {
    expect(isVerificationOnlyOperation(request)).toBe(true);
  });

  it.each([
    "Fix the delete workflow and rerun browser acceptance.",
    "Repair search, then verify the preview.",
    "Delete this button and verify the browser.",
    "Add a completed filter and test it in the browser.",
  ])("preserves real implementation authority: %s", (request) => {
    expect(isVerificationOnlyOperation(request)).toBe(false);
  });
});
