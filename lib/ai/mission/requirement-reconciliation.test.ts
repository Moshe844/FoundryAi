import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/providers/dispatch", () => ({ callManagedModel: vi.fn() }));
vi.mock("@/lib/ai/model-router", () => ({ resolveModelForTier: vi.fn() }));

import { RECONCILE_PROMPT_TEXT, reconcileRequirements } from "./requirement-reconciliation";
import { createLedger } from "./requirement-ledger";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier } from "@/lib/ai/model-router";

const callMock = vi.mocked(callManagedModel);
const resolveMock = vi.mocked(resolveModelForTier);

beforeEach(() => {
  callMock.mockReset();
  resolveMock.mockReset();
  resolveMock.mockReturnValue({ tier: "builder", provider: "openai", model: "test-model", effort: "low" });
});

const ledger = () => createLedger("m1", [
  { text: "customers can browse a product catalogue", sourceQuote: "browse a catalogue", kind: "deliverable" },
  { text: "customers can check out", sourceQuote: "check out", kind: "deliverable" },
]);

function auditorSays(outcomes: Array<Record<string, unknown>>) {
  callMock.mockResolvedValue({
    toolCalls: [{ name: "reconcile_requirements", arguments: JSON.stringify({ outcomes, unrequested_changes: [] }) }],
  } as never);
}

const reconcile = (base = ledger()) => reconcileRequirements({
  ledger: base,
  request: "build an ordering app",
  evidence: { changedFiles: ["src/lib/types.ts"], commands: [], verification: [], checklist: [] },
  apiKey: "test",
});

describe("an unfounded blocker cannot finalize unbuilt work", () => {
  it("ignores a blocked claim that cites nothing", async () => {
    // The live failure: eight features nothing was written for came back "blocked" because the pages
    // 404'd. Blocked is a final status, so that settled the ledger and stopped the mission building them.
    const base = ledger();
    auditorSays(base.requirements.map((requirement) => ({ id: requirement.id, outcome: "blocked", evidence_detail: "" })));

    const result = await reconcile(base);
    expect(result.unattempted).toHaveLength(2);
    expect(result.ledger.requirements.every((requirement) => requirement.status === "identified")).toBe(true);
  });

  it("accepts a blocked claim that names the obstacle", async () => {
    const base = ledger();
    auditorSays([{ id: base.requirements[0].id, outcome: "blocked", evidence_detail: "The payment provider API key is not configured." }]);

    const result = await reconcile(base);
    expect(result.ledger.requirements[0].status).toBe("blocked");
    // The second was not reported at all, so it stays outstanding rather than inheriting the first's fate.
    expect(result.unattempted.map((item) => item.text)).toEqual(["customers can check out"]);
  });
});

describe("what the auditor did not say", () => {
  it("treats an omitted requirement as never attempted", async () => {
    const base = ledger();
    auditorSays([{ id: base.requirements[0].id, outcome: "verified", evidence_detail: "the catalogue renders in the browser" }]);

    const result = await reconcile(base);
    expect(result.unattempted.map((item) => item.text)).toEqual(["customers can check out"]);
  });

  it("still refuses a verified claim with no evidence", async () => {
    const base = ledger();
    auditorSays([{ id: base.requirements[0].id, outcome: "verified", evidence_detail: "" }]);

    const result = await reconcile(base);
    // Downgraded to implemented, so it stays unresolved rather than being counted as proven.
    expect(result.ledger.requirements[0].status).toBe("implemented");
    expect(result.unverified.map((item) => item.text)).toContain("customers can browse a product catalogue");
  });
});

describe("degrading safely", () => {
  it("reports unavailable rather than guessing when the audit returns nothing", async () => {
    callMock.mockResolvedValue({ toolCalls: [] } as never);
    const result = await reconcile();
    expect(result.source).toBe("unavailable");
    expect(result.unattempted).toEqual([]);
  });
});

describe("groundwork is not a feature", () => {
  it("instructs the auditor that a user-facing feature needs a reachable entry point", () => {
    // Observed live: three batches built lib/cart.ts, lib/checkout.ts and tests, the auditor credited
    // them as the features, and the loop stopped with zero routes in existence and every page 404ing.
    expect(RECONCILE_PROMPT_TEXT).toContain("entry point they can actually reach");
    expect(RECONCILE_PROMPT_TEXT).toContain("groundwork for the feature, not the feature");
    expect(RECONCILE_PROMPT_TEXT).toContain("a feature nobody can reach has not been built");
  });
});
