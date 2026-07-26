import { describe, expect, it } from "vitest";

import {
  deriveMissionOutcome,
  formatMissionOutcome,
  missionOutcomeStatus,
  type MissionOutcomeSignals,
  type MissionOutcomeState,
} from "./mission-outcome";

const outcome = (signals: Partial<MissionOutcomeSignals> = {}) => deriveMissionOutcome({ passed: true, ...signals });

const ALL_STATES: MissionOutcomeState[] = [
  "recovered-automatically",
  "completed-and-verified",
  "completed-with-warnings",
  "partially-completed",
  "blocked-by-missing-access",
  "blocked-by-user-decision",
  "unsupported-environment",
  "failed-after-recovery",
];

describe("the eight states are all reachable", () => {
  const reached = new Set<MissionOutcomeState>([
    outcome({ requirementGate: "satisfied", recovered: true }).state,
    outcome({ requirementGate: "satisfied" }).state,
    outcome({ requirementGate: "unproven" }).state,
    outcome({ requirementGate: "unmet" }).state,
    outcome({ passed: false, blockerDisposition: "external-dependency" }).state,
    outcome({ passed: false, blockerDisposition: "authority-required" }).state,
    outcome({ passed: false, blockerDisposition: "external-dependency", environmentLimited: true }).state,
    outcome({ passed: false, blockerDisposition: "recoverable-engineering" }).state,
  ]);

  it("produces every distinct state", () => {
    // A state nothing can reach is a state that does not exist, whatever the type says.
    expect([...reached].sort()).toEqual([...ALL_STATES].sort());
  });
});

describe("a passing verdict is not the whole story", () => {
  it("reports completed and verified when everything is proven", () => {
    const result = outcome({ requirementGate: "satisfied" });
    expect(result.state).toBe("completed-and-verified");
    expect(result.delivered).toBe(true);
  });

  it("distinguishes work that had to be repaired along the way", () => {
    expect(outcome({ requirementGate: "satisfied", recovered: true }).state).toBe("recovered-automatically");
  });

  it("does not call unproven work verified", () => {
    expect(outcome({ requirementGate: "unproven" }).state).toBe("completed-with-warnings");
  });

  it("does not call unchecked work verified either", () => {
    // Requirement accounting that could not run is not evidence that everything was fine.
    expect(outcome({ requirementGate: "unchecked" }).state).toBe("completed-with-warnings");
  });

  it("treats any recorded warning as worth surfacing", () => {
    expect(outcome({ requirementGate: "satisfied", warnings: ["a dependency was added"] }).state).toBe("completed-with-warnings");
  });

  it("refuses to report a passing checklist as done when requirements were missed", () => {
    // Reaching the end of the plan is not the same as having delivered what was asked for.
    const result = outcome({ requirementGate: "unmet" });
    expect(result.state).toBe("partially-completed");
    expect(result.delivered).toBe(false);
  });
});

describe("a failure says which kind of failure", () => {
  it("separates a missing credential from an engineering dead end", () => {
    expect(outcome({ passed: false, blockerDisposition: "external-dependency" }).state).toBe("blocked-by-missing-access");
    expect(outcome({ passed: false, blockerDisposition: "recoverable-engineering" }).state).toBe("failed-after-recovery");
  });

  it("separates a machine that cannot run the work from a credential the user can supply", () => {
    // The user's next step is completely different, so collapsing these is what makes a verdict useless.
    expect(outcome({ passed: false, blockerDisposition: "external-dependency", environmentLimited: true }).state).toBe("unsupported-environment");
  });

  it("reports a user decision and a user stop the same way", () => {
    expect(outcome({ passed: false, blockerDisposition: "authority-required" }).state).toBe("blocked-by-user-decision");
    expect(outcome({ passed: false, blockerDisposition: "user-stopped" }).state).toBe("blocked-by-user-decision");
  });

  it("credits real progress on a mission that did not finish", () => {
    const result = outcome({ passed: false, blockerDisposition: "recoverable-engineering", requirementGate: "unmet" });
    expect(result.state).toBe("partially-completed");
    expect(result.headline).toContain("preserved");
  });

  it("leads with the decision when the mission is waiting on the user", () => {
    // Outstanding requirements are a consequence of the pause, not the thing for the user to act on.
    const result = outcome({ passed: false, blockerDisposition: "authority-required", requirementGate: "unmet" });
    expect(result.state).toBe("blocked-by-user-decision");
    expect(result.needsUser).toBe(true);
  });
});

describe("what each state asks of the user", () => {
  it("marks only the blocked states as needing the user", () => {
    const needsUser = ALL_STATES.filter((state) => {
      const signals: Record<string, MissionOutcomeSignals> = {
        "recovered-automatically": { passed: true, requirementGate: "satisfied", recovered: true },
        "completed-and-verified": { passed: true, requirementGate: "satisfied" },
        "completed-with-warnings": { passed: true, requirementGate: "unproven" },
        "partially-completed": { passed: true, requirementGate: "unmet" },
        "blocked-by-missing-access": { passed: false, blockerDisposition: "external-dependency" },
        "blocked-by-user-decision": { passed: false, blockerDisposition: "authority-required" },
        "unsupported-environment": { passed: false, blockerDisposition: "external-dependency", environmentLimited: true },
        "failed-after-recovery": { passed: false, blockerDisposition: "recoverable-engineering" },
      };
      return deriveMissionOutcome(signals[state]).needsUser;
    });
    expect(needsUser.sort()).toEqual(["blocked-by-missing-access", "blocked-by-user-decision", "unsupported-environment"]);
  });
});

describe("mapping onto the coarse verdict", () => {
  it("only the three delivered states report as passed", () => {
    expect(ALL_STATES.filter((state) => missionOutcomeStatus(state) === "passed").sort())
      .toEqual(["completed-and-verified", "completed-with-warnings", "recovered-automatically"]);
  });

  it("keeps partially completed out of passed", () => {
    // Reporting it as passed would be exactly the invented completion this design exists to prevent.
    expect(missionOutcomeStatus("partially-completed")).toBe("failed");
  });
});

describe("the reported line", () => {
  it("keeps the qualifying detail attached to the headline", () => {
    const rendered = formatMissionOutcome(outcome({ requirementGate: "unproven" }), "The dark mode toggle was not exercised in a browser.");
    expect(rendered).toContain("worth your attention");
    expect(rendered).toContain("dark mode toggle");
  });

  it("stands alone when there is no detail", () => {
    expect(formatMissionOutcome(outcome({ requirementGate: "satisfied" }), "   ")).toBe("The requested work is done and verified.");
  });
});
