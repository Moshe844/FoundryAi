import { describe, expect, it } from "vitest";

import { assessAutonomousBlocker, buildBlockedExplanation } from "./autonomy-contract";

describe("blocked explanation", () => {
  it("states what succeeded, what is blocked, and what is needed", () => {
    const explanation = buildBlockedExplanation({
      reason: "Missing API key for the payment provider.",
      changedFiles: ["app/checkout.tsx", "lib/payments.ts"],
      passedChecks: ["typecheck", "build"],
      requirements: { finalized: 3, total: 5 },
    });

    expect(explanation).toContain("3 of 5 requested item(s) are complete");
    expect(explanation).toContain("2 file(s) were changed and kept");
    expect(explanation).toContain("app/checkout.tsx");
    expect(explanation).toContain("these checks passed: typecheck, build");
    expect(explanation).toContain("Missing API key for the payment provider.");
  });

  it("asks for the specific input an external blocker needs", () => {
    const reason = "Missing API key for the payment provider.";
    expect(assessAutonomousBlocker(reason).disposition).toBe("external-dependency");
    // The required input comes from the autonomy contract's own next action, not a generic prompt.
    expect(buildBlockedExplanation({ reason })).toContain("Provide or refresh the named credential");
  });

  it("asks for direction rather than a credential when recovery simply ran out", () => {
    const explanation = buildBlockedExplanation({ reason: "The layout change could not be located in the source." });
    expect(explanation).toContain("Tell me how you would like to proceed");
    // Never invent a credential or permission requirement for an engineering dead end.
    expect(explanation).not.toContain("credential");
  });

  it("says plainly when nothing was completed instead of implying progress", () => {
    const explanation = buildBlockedExplanation({ reason: "Approval is required before deleting the project." });
    expect(explanation).toContain("no change was completed");
  });

  it("omits sections it has no real facts for", () => {
    const explanation = buildBlockedExplanation({ reason: "Provider unavailable.", changedFiles: ["a.ts"] });
    expect(explanation).toContain("1 file(s) were changed and kept");
    expect(explanation).not.toContain("checks passed");
    expect(explanation).not.toContain("requested item(s)");
  });

  it("summarizes rather than listing a long set of changed files", () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"];
    const explanation = buildBlockedExplanation({ reason: "Provider unavailable.", changedFiles: files });
    expect(explanation).toContain("6 file(s) were changed and kept");
    expect(explanation).not.toContain("a.ts, b.ts");
  });

  it("does not duplicate the next action when the reason already carries it", () => {
    const reason = "Approval is required before deleting the project.";
    const explanation = buildBlockedExplanation({ reason });
    expect(explanation.match(/Approve the specifically identified action/g)).toHaveLength(1);
  });
});
