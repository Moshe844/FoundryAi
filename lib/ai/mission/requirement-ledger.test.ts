import { describe, expect, it } from "vitest";

import {
  applyCorrection,
  approveSuggestion,
  assessCompletion,
  createLedger,
  formatLedgerForModel,
  mergeRequirements,
  readyRequirements,
  recordOutcome,
  requirementId,
  setRequirementStatus,
  type ExtractedRequirement,
  type RequirementEvidence,
  type RequirementLedger,
} from "./requirement-ledger";

const evidence: RequirementEvidence = { kind: "compiler", detail: "typecheck passed", recordedAt: "2026-07-26T00:00:00.000Z" };

function deliverable(text: string, extra: Partial<ExtractedRequirement> = {}): ExtractedRequirement {
  return { text, sourceQuote: text, kind: "deliverable", ...extra };
}

/** Drive a requirement all the way to verified through the legal path. */
function verify(ledger: RequirementLedger, id: string): RequirementLedger {
  let current = ledger;
  for (const status of ["planned", "in-progress", "implemented"] as const) {
    const step = setRequirementStatus(current, id, status, `moved to ${status}`);
    if (!step.ok) throw new Error(step.reason);
    current = step.ledger;
  }
  const done = setRequirementStatus(current, id, "verified", "checked in the browser", [evidence]);
  if (!done.ok) throw new Error(done.reason);
  return done.ledger;
}

describe("requirement ledger accounting", () => {
  it("accounts for every requirement in a multi-part request", () => {
    const ledger = createLedger("m1", [deliverable("add a dark mode toggle"), deliverable("add a settings page"), deliverable("persist the theme choice")]);
    expect(ledger.requirements).toHaveLength(3);
    expect(assessCompletion(ledger).total).toBe(3);
  });

  it("gives the same requirement a stable id across extraction passes", () => {
    expect(requirementId("Add a dark mode toggle")).toBe(requirementId("add a dark mode toggle."));
  });

  it("does not duplicate a requirement when extraction runs again", () => {
    const first = createLedger("m1", [deliverable("add a dark mode toggle")]);
    const started = setRequirementStatus(first, requirementId("add a dark mode toggle"), "planned", "planned");
    expect(started.ok).toBe(true);
    const second = mergeRequirements(started.ok ? started.ledger : first, [deliverable("Add a dark mode toggle.")]);
    expect(second.requirements).toHaveLength(1);
    expect(second.requirements[0].status).toBe("planned");
  });

  it("never drops a requirement when a later pass no longer mentions it", () => {
    const ledger = createLedger("m1", [deliverable("add a dark mode toggle"), deliverable("add a settings page")]);
    const narrowed = mergeRequirements(ledger, [deliverable("add a settings page")]);
    expect(narrowed.requirements).toHaveLength(2);
  });
});

describe("completion gate", () => {
  it("refuses completion while the primary feature works but other requirements are open", () => {
    const ledger = createLedger("m1", [deliverable("add a dark mode toggle"), deliverable("add a settings page")]);
    const partial = verify(ledger, requirementId("add a dark mode toggle"));
    const completion = assessCompletion(partial);
    expect(completion.complete).toBe(false);
    expect(completion.finalized).toBe(1);
    expect(completion.blockers).toEqual(["add a settings page — still identified."]);
  });

  it("allows completion once every requirement carries a final status", () => {
    let ledger = createLedger("m1", [deliverable("add a dark mode toggle"), deliverable("add a settings page")]);
    ledger = verify(ledger, requirementId("add a dark mode toggle"));
    const blocked = setRequirementStatus(ledger, requirementId("add a settings page"), "blocked", "needs a design decision from the user");
    expect(blocked.ok).toBe(true);
    expect(assessCompletion(blocked.ok ? blocked.ledger : ledger).complete).toBe(true);
  });

  it("treats implemented-but-unchecked as unresolved", () => {
    const ledger = createLedger("m1", [deliverable("add a dark mode toggle")]);
    let current = ledger;
    for (const status of ["in-progress", "implemented"] as const) {
      const step = setRequirementStatus(current, requirementId("add a dark mode toggle"), status, status);
      expect(step.ok).toBe(true);
      if (step.ok) current = step.ledger;
    }
    expect(assessCompletion(current).complete).toBe(false);
  });

  it("does not report an empty ledger as complete", () => {
    expect(assessCompletion(createLedger("m1", [])).complete).toBe(false);
  });
});

describe("anti-fake-completion guards", () => {
  it("rejects verified without evidence", () => {
    let ledger = createLedger("m1", [deliverable("add a dark mode toggle")]);
    for (const status of ["in-progress", "implemented"] as const) {
      const step = setRequirementStatus(ledger, requirementId("add a dark mode toggle"), status, status);
      if (step.ok) ledger = step.ledger;
    }
    const attempt = setRequirementStatus(ledger, requirementId("add a dark mode toggle"), "verified", "looks right");
    expect(attempt.ok).toBe(false);
    expect(attempt.ok === false && attempt.reason).toMatch(/without evidence/);
  });

  it("rejects verified before the requirement was implemented", () => {
    const ledger = createLedger("m1", [deliverable("add a dark mode toggle")]);
    const attempt = setRequirementStatus(ledger, requirementId("add a dark mode toggle"), "verified", "skipping ahead", [evidence]);
    expect(attempt.ok).toBe(false);
    expect(attempt.ok === false && attempt.reason).toMatch(/before it was implemented/);
  });

  it("rejects implemented before the requirement was started", () => {
    const ledger = createLedger("m1", [deliverable("add a dark mode toggle")]);
    const attempt = setRequirementStatus(ledger, requirementId("add a dark mode toggle"), "implemented", "skipping ahead");
    expect(attempt.ok).toBe(false);
    expect(attempt.ok === false && attempt.reason).toMatch(/before it was started/);
  });

  it("lets a reopened requirement return to verified without repeating the whole path", () => {
    let ledger = verify(createLedger("m1", [deliverable("add a dark mode toggle")]), requirementId("add a dark mode toggle"));
    const reopened = setRequirementStatus(ledger, requirementId("add a dark mode toggle"), "in-progress", "regressed after a later edit");
    expect(reopened.ok).toBe(true);
    if (reopened.ok) ledger = reopened.ledger;
    const reverified = setRequirementStatus(ledger, requirementId("add a dark mode toggle"), "verified", "checked again", [evidence]);
    expect(reverified.ok).toBe(true);
  });
});

describe("constraints, exclusions and recommendations", () => {
  it("gates completion on constraints and exclusions, not only deliverables", () => {
    const ledger = createLedger("m1", [
      deliverable("add a dark mode toggle"),
      { text: "keep the desktop layout exactly the same", sourceQuote: "keep desktop exactly the same", kind: "constraint" },
      { text: "do not add a new dependency", sourceQuote: "no new dependencies", kind: "exclusion" },
    ]);
    expect(assessCompletion(ledger).total).toBe(3);
  });

  it("keeps an unapproved recommendation out of the mission", () => {
    const ledger = createLedger("m1", [
      deliverable("add a dark mode toggle"),
      { text: "also migrate the styles to CSS variables", sourceQuote: "", kind: "optional-suggestion" },
    ]);
    expect(assessCompletion(ledger).total).toBe(1);
    expect(ledger.requirements.find((item) => item.kind === "optional-suggestion")?.status).toBe("excluded");
  });

  it("brings an approved recommendation into the mission", () => {
    const ledger = createLedger("m1", [{ text: "also migrate the styles to CSS variables", sourceQuote: "", kind: "optional-suggestion" }]);
    const approved = approveSuggestion(ledger, requirementId("also migrate the styles to CSS variables"), "user said yes");
    expect(assessCompletion(approved).total).toBe(1);
    expect(assessCompletion(approved).complete).toBe(false);
  });

  it("preserves the user's exact wording alongside the paraphrase", () => {
    const ledger = createLedger("m1", [{ text: "the heading must read Sam Carter", sourceQuote: 'the heading "Sam Carter"', kind: "deliverable" }]);
    expect(ledger.requirements[0].sourceQuote).toBe('the heading "Sam Carter"');
  });
});

describe("corrections", () => {
  it("makes a correction authoritative while retaining the superseded requirement", () => {
    const ledger = createLedger("m1", [deliverable("make the header blue")]);
    const corrected = applyCorrection(ledger, requirementId("make the header blue"), deliverable("make the header gray"));

    expect(corrected.requirements).toHaveLength(2);
    expect(corrected.requirements[0].supersededBy).toBe(requirementId("make the header gray"));
    // The superseded entry is retained but no longer gates the mission.
    const completion = assessCompletion(corrected);
    expect(completion.total).toBe(1);
    expect(completion.unresolved[0].text).toBe("make the header gray");
  });

  it("refuses to change the status of a superseded requirement", () => {
    const ledger = applyCorrection(createLedger("m1", [deliverable("make the header blue")]), requirementId("make the header blue"), deliverable("make the header gray"));
    const attempt = setRequirementStatus(ledger, requirementId("make the header blue"), "in-progress", "stale worker picked it up");
    expect(attempt.ok).toBe(false);
    expect(attempt.ok === false && attempt.reason).toMatch(/superseded/);
  });
});

describe("dependencies", () => {
  it("holds a dependent requirement back until its dependency lands", () => {
    const ledger = createLedger("m1", [
      deliverable("create the settings page"),
      deliverable("add a dark mode toggle to the settings page", { dependsOnQuotes: ["create the settings page"] }),
    ]);
    expect(readyRequirements(ledger).map((item) => item.text)).toEqual(["create the settings page"]);

    let current = ledger;
    for (const status of ["in-progress", "implemented"] as const) {
      const step = setRequirementStatus(current, requirementId("create the settings page"), status, status);
      if (step.ok) current = step.ledger;
    }
    expect(readyRequirements(current).map((item) => item.text)).toContain("add a dark mode toggle to the settings page");
  });
});

describe("recording outcomes from mission evidence", () => {
  it("places a requirement at verified through the legal path in one call", () => {
    const ledger = createLedger("m1", [deliverable("add a dark mode toggle")]);
    const applied = recordOutcome(ledger, requirementId("add a dark mode toggle"), "verified", "browser gate confirmed the toggle", [evidence]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.requirement.status).toBe("verified");
    // The intermediate states are recorded rather than skipped, so the history stays honest.
    expect(applied.requirement.history.map((change) => change.to)).toEqual(["identified", "in-progress", "implemented", "verified"]);
    expect(assessCompletion(applied.ledger).complete).toBe(true);
  });

  it("downgrades an uncited verified claim to implemented and leaves the mission incomplete", () => {
    const ledger = createLedger("m1", [deliverable("add a dark mode toggle")]);
    const applied = recordOutcome(ledger, requirementId("add a dark mode toggle"), "verified", "looks done");
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.requirement.status).toBe("implemented");
    expect(applied.requirement.statusDetail).toMatch(/no evidence was cited/);
    expect(assessCompletion(applied.ledger).complete).toBe(false);
  });

  it("records a blocked requirement as a final answer without inventing work", () => {
    const ledger = createLedger("m1", [deliverable("connect the payment provider")]);
    const applied = recordOutcome(ledger, requirementId("connect the payment provider"), "blocked", "no API credentials were available");
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.requirement.status).toBe("blocked");
    expect(applied.requirement.history.map((change) => change.to)).toEqual(["identified", "blocked"]);
    expect(assessCompletion(applied.ledger).complete).toBe(true);
  });

  it("leaves an unaddressed requirement open so a partial mission cannot report completion", () => {
    let ledger = createLedger("m1", [deliverable("add a dark mode toggle"), deliverable("add a settings page")]);
    // Only one requirement is reconciled — the other is what the mission never reached.
    const applied = recordOutcome(ledger, requirementId("add a dark mode toggle"), "verified", "browser gate confirmed the toggle", [evidence]);
    if (applied.ok) ledger = applied.ledger;
    const completion = assessCompletion(ledger);
    expect(completion.complete).toBe(false);
    expect(completion.unresolved.map((item) => item.text)).toEqual(["add a settings page"]);
  });
});

describe("model-facing view", () => {
  it("states plainly that the mission is not done while requirements are open", () => {
    const ledger = createLedger("m1", [deliverable("add a dark mode toggle"), deliverable("add a settings page")]);
    const rendered = formatLedgerForModel(ledger);
    expect(rendered).toContain("0/2 finalized");
    expect(rendered).toContain("Do not report this mission as done.");
  });

  it("reports completion once every requirement is finalized", () => {
    let ledger = createLedger("m1", [deliverable("add a dark mode toggle")]);
    ledger = verify(ledger, requirementId("add a dark mode toggle"));
    expect(formatLedgerForModel(ledger)).toContain("Completion may be reported.");
  });
});
