import { describe, expect, it } from "vitest";

import { ARCHITECT_SCALE_REQUIREMENTS, tierForRequirementScale } from "./requirement-scale";

describe("correcting the routing estimate with the counted scope", () => {
  it("raises an ordinary build to architect once the ledger shows an application", () => {
    // The live failure: eleven requirements written by the balanced tier, then repaired until the budget ran out.
    const routing = tierForRequirementScale({ estimatedTier: "builder", requirementCount: 11 });
    expect(routing.tier).toBe("architect");
    expect(routing.raised).toBe(true);
    expect(routing.reason).toContain("11 separate requirements");
  });

  it("leaves a small build where the router put it", () => {
    const routing = tierForRequirementScale({ estimatedTier: "builder", requirementCount: 3 });
    expect(routing.tier).toBe("builder");
    expect(routing.raised).toBe(false);
  });

  it("never lowers a tier that was already chosen for difficulty", () => {
    // A count says how much work there is, never how hard it is — so it may only ever raise.
    for (const tier of ["architect", "enterprise-architect", "super-reasoning"] as const) {
      const routing = tierForRequirementScale({ estimatedTier: tier, requirementCount: 40 });
      expect(routing.tier).toBe(tier);
      expect(routing.raised).toBe(false);
    }
    expect(tierForRequirementScale({ estimatedTier: "super-reasoning", requirementCount: 1 }).tier).toBe("super-reasoning");
  });

  it("treats the threshold itself as application scale", () => {
    expect(tierForRequirementScale({ estimatedTier: "fast", requirementCount: ARCHITECT_SCALE_REQUIREMENTS }).raised).toBe(true);
    expect(tierForRequirementScale({ estimatedTier: "fast", requirementCount: ARCHITECT_SCALE_REQUIREMENTS - 1 }).raised).toBe(false);
  });

  it("survives a mission with no ledger reading", () => {
    expect(tierForRequirementScale({ estimatedTier: "builder", requirementCount: 0 }).tier).toBe("builder");
  });
});
