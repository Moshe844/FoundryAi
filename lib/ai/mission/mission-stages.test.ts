import { describe, expect, it } from "vitest";

import {
  buildStagePlan,
  formatStagePlanForModel,
  stagePlanProgress,
} from "./mission-stages";
import {
  createLedger,
  recordOutcome,
  requirementId,
  setRequirementStatus,
  type ExtractedRequirement,
  type RequirementEvidence,
  type RequirementLedger,
} from "./requirement-ledger";

const evidence: RequirementEvidence = { kind: "browser", detail: "checked in the preview", recordedAt: "2026-07-26T00:00:00.000Z" };

function req(text: string, extra: Partial<ExtractedRequirement> = {}): ExtractedRequirement {
  return { text, sourceQuote: text, kind: "deliverable", ...extra };
}

function verified(ledger: RequirementLedger, text: string): RequirementLedger {
  const applied = recordOutcome(ledger, requirementId(text), "verified", "proved in the browser", [evidence]);
  if (!applied.ok) throw new Error(applied.reason);
  return applied.ledger;
}

describe("building the implementation sequence", () => {
  it("puts independent requirements in one stage", () => {
    const ledger = createLedger("m1", [req("add a header"), req("add a footer")]);
    const plan = buildStagePlan({ missionId: "m1", specification: "add a header and a footer", ledger });
    expect(plan.stages).toHaveLength(1);
    expect(plan.stages[0].requirementIds).toHaveLength(2);
  });

  it("orders stages by declared dependencies", () => {
    const ledger = createLedger("m1", [
      req("add a dark mode toggle", { dependsOnQuotes: ["create the settings page"] }),
      req("create the settings page"),
      req("remember the theme choice", { dependsOnQuotes: ["add a dark mode toggle"] }),
    ]);
    const plan = buildStagePlan({ missionId: "m1", specification: "spec", ledger });

    expect(plan.stages.map((stage) => stage.title)).toEqual([
      "create the settings page",
      "add a dark mode toggle",
      "remember the theme choice",
    ]);
    expect(plan.stages.map((stage) => stage.ordinal)).toEqual([1, 2, 3]);
  });

  it("divides a specification too large for one window into several stages", () => {
    const ledger = createLedger("m1", Array.from({ length: 18 }, (_, index) => req(`requirement number ${index + 1}`)));
    const plan = buildStagePlan({ missionId: "m1", specification: "an 18-part specification", ledger, maxRequirementsPerStage: 5 });

    expect(plan.stages).toHaveLength(4);
    // Every one of the eighteen must survive the division — losing one here is the exact failure
    // that makes a user resend their specification.
    expect(plan.stages.flatMap((stage) => stage.requirementIds)).toHaveLength(18);
  });

  it("keeps every requirement when dependencies form a cycle", () => {
    const ledger = createLedger("m1", [
      req("build the API", { dependsOnQuotes: ["build the client"] }),
      req("build the client", { dependsOnQuotes: ["build the API"] }),
    ]);
    const plan = buildStagePlan({ missionId: "m1", specification: "spec", ledger });
    expect(plan.stages.flatMap((stage) => stage.requirementIds)).toHaveLength(2);
  });

  it("ignores a dependency on a requirement that was never extracted", () => {
    const ledger = createLedger("m1", [req("add a footer", { dependsOnQuotes: ["something that does not exist"] })]);
    const plan = buildStagePlan({ missionId: "m1", specification: "spec", ledger });
    expect(plan.stages).toHaveLength(1);
  });

  it("carries each requirement's verification check into its stage plan", () => {
    const ledger = createLedger("m1", [req("add a dark mode toggle", { verification: "the toggle flips the theme and survives a reload" })]);
    const plan = buildStagePlan({ missionId: "m1", specification: "spec", ledger });
    expect(plan.stages[0].verificationPlan).toEqual(["the toggle flips the theme and survives a reload"]);
  });

  it("stores the specification verbatim", () => {
    const specification = "Build it exactly like this:\n  1. a header\n  2. a footer";
    const plan = buildStagePlan({ missionId: "m1", specification, ledger: createLedger("m1", [req("add a header")]) });
    expect(plan.specification).toBe(specification);
  });
});

describe("where the mission stands", () => {
  const ledger = createLedger("m1", [
    req("create the settings page"),
    req("add a dark mode toggle", { dependsOnQuotes: ["create the settings page"] }),
  ]);
  const plan = buildStagePlan({ missionId: "m1", specification: "spec", ledger });

  it("starts on the first stage with nothing completed", () => {
    const progress = stagePlanProgress(plan, ledger);
    expect(progress.completed).toHaveLength(0);
    expect(progress.current?.stage.ordinal).toBe(1);
    expect(progress.pending).toHaveLength(1);
  });

  it("advances to the next stage once the first is finalized", () => {
    const advanced = verified(ledger, "create the settings page");
    const progress = stagePlanProgress(plan, advanced);
    expect(progress.completed.map((entry) => entry.stage.ordinal)).toEqual([1]);
    expect(progress.current?.stage.ordinal).toBe(2);
  });

  it("does not treat a written-but-unproven stage as complete", () => {
    const applied = recordOutcome(ledger, requirementId("create the settings page"), "implemented", "wrote the page");
    const progress = stagePlanProgress(plan, applied.ok ? applied.ledger : ledger);
    expect(progress.current?.stage.ordinal).toBe(1);
    expect(progress.current?.status).toBe("in-progress");
  });

  it("reports a blocked stage as blocked rather than pending", () => {
    const blocked = setRequirementStatus(ledger, requirementId("create the settings page"), "blocked", "needs a product decision");
    const progress = stagePlanProgress(plan, blocked.ok ? blocked.ledger : ledger);
    expect(progress.current?.status).toBe("blocked");
    expect(progress.nextExactAction).toContain("blocked on");
  });

  it("does not count a stage containing a blocked requirement as completed", () => {
    // "blocked" is a final status, so the ledger stops waiting on it — but a stage carrying one has not
    // been completed, and reporting it as such would present a wall as a finish line.
    const blocked = setRequirementStatus(ledger, requirementId("create the settings page"), "blocked", "needs a product decision");
    const progress = stagePlanProgress(plan, blocked.ok ? blocked.ledger : ledger);
    expect(progress.completed).toHaveLength(0);
    expect(progress.current?.stage.ordinal).toBe(1);
  });

  it("says the work is finished when every stage is complete", () => {
    let complete = verified(ledger, "create the settings page");
    complete = verified(complete, "add a dark mode toggle");
    const progress = stagePlanProgress(plan, complete);
    expect(progress.current).toBeUndefined();
    expect(progress.nextExactAction).toContain("do not start new work");
  });
});

describe("next exact action", () => {
  it("names the stage, the requirement, and the proof required", () => {
    const ledger = createLedger("m1", [req("add a dark mode toggle", { verification: "the toggle flips the theme" })]);
    const plan = buildStagePlan({ missionId: "m1", specification: "spec", ledger });
    const action = stagePlanProgress(plan, ledger).nextExactAction;
    expect(action).toContain("stage 1 of 1");
    expect(action).toContain('implement "add a dark mode toggle"');
    expect(action).toContain("the toggle flips the theme");
  });

  it("asks for verification when the work is already implemented", () => {
    const ledger = createLedger("m1", [req("add a dark mode toggle", { verification: "the toggle flips the theme" })]);
    const plan = buildStagePlan({ missionId: "m1", specification: "spec", ledger });
    const applied = recordOutcome(ledger, requirementId("add a dark mode toggle"), "implemented", "wrote the toggle");
    const action = stagePlanProgress(plan, applied.ok ? applied.ledger : ledger).nextExactAction;
    expect(action).toContain('verify "add a dark mode toggle"');
  });
});

describe("durable mission context", () => {
  it("leads with the verbatim specification so a continuation never rebuilds it", () => {
    const specification = "Build a booking tool with a calendar, an admin editor, and email confirmations.";
    const ledger = createLedger("m1", [req("add a calendar"), req("add an admin editor")]);
    const plan = buildStagePlan({ missionId: "m1", specification, ledger });

    const rendered = formatStagePlanForModel(plan, ledger);
    expect(rendered).toContain(specification);
    expect(rendered).toContain("never work from a summary of it");
    expect(rendered).toContain("Next exact action:");
  });

  it("marks the current stage and the completed ones", () => {
    const ledger = createLedger("m1", [
      req("create the settings page"),
      req("add a dark mode toggle", { dependsOnQuotes: ["create the settings page"] }),
    ]);
    const plan = buildStagePlan({ missionId: "m1", specification: "spec", ledger });
    const rendered = formatStagePlanForModel(plan, verified(ledger, "create the settings page"));

    expect(rendered).toContain("✓ Stage 1/2 [complete]");
    expect(rendered).toContain("→ Stage 2/2");
  });
});
