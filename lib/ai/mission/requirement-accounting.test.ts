import { rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/mission/requirement-extraction", () => ({
  extractRequirements: vi.fn(),
}));
vi.mock("@/lib/ai/mission/requirement-reconciliation", () => ({
  reconcileRequirements: vi.fn(),
}));

import { closeRequirementLedger, openRequirementLedger, unbuiltRequirements } from "./requirement-accounting";
import { extractRequirements, type OpenQuestion } from "./requirement-extraction";
import { reconcileRequirements } from "./requirement-reconciliation";
import { activeRequirements, recordOutcome, type RequirementLedger } from "./requirement-ledger";
import { loadStagePlan } from "./mission-stages";
import { appendJournalEntry } from "@/lib/factory/execution-journal";
import type { FactoryExecutionEvent } from "@/lib/factory/types";

const extractMock = vi.mocked(extractRequirements);
const reconcileMock = vi.mocked(reconcileRequirements);

const missionId = "accounting-test-thread";
const projectId = "accounting-test-project";

function extraction(
  texts: string[],
  source: "model" | "deterministic-fallback" = "model",
  openQuestions: OpenQuestion[] = [],
) {
  return {
    requirements: texts.map((text) => ({ text, sourceQuote: text, kind: "deliverable" as const })),
    source,
    coverageConfidence: 0.9,
    openQuestions,
  };
}

/** A reconciliation that finds every requirement done and proven. */
function reconcileAllVerified() {
  reconcileMock.mockImplementation(async ({ ledger }) => {
    let updated: RequirementLedger = ledger;
    for (const requirement of activeRequirements(ledger)) {
      const applied = recordOutcome(updated, requirement.id, "verified", "recovered from the journal", [
        { kind: "file-change", detail: "file written in an earlier window", recordedAt: new Date().toISOString() },
      ]);
      if (applied.ok) updated = applied.ledger;
    }
    return { ledger: updated, source: "model" as const, unattempted: [], unverified: [], unrequested: [] };
  });
}

async function journalFileWrite(executionId: string, filePath: string) {
  const event: FactoryExecutionEvent = {
    id: `event-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    kind: "edit",
    status: "completed",
    title: `Updated ${filePath}`,
    filePath,
    rationale: "Implemented the first requirement.",
  };
  await appendJournalEntry(projectId, event, executionId);
}

async function cleanup() {
  await Promise.all([
    rm(path.join(process.cwd(), ".foundry-data", "requirement-ledgers", `${missionId}.json`), { force: true }),
    rm(path.join(process.cwd(), ".foundry-data", "mission-stages", `${missionId}.json`), { force: true }),
    rm(path.join(process.cwd(), ".foundry-data", "journals", projectId), { recursive: true, force: true }),
  ]);
}

beforeEach(cleanup);
afterEach(async () => {
  vi.resetAllMocks();
  await cleanup();
});

const open = (overrides: Partial<Parameters<typeof openRequirementLedger>[0]> = {}) => openRequirementLedger({
  missionId,
  executionId: "execution-1",
  projectId,
  request: "Build a booking tool with a calendar and an admin editor.",
  apiKey: "test-key",
  ...overrides,
});

describe("opening a ledger", () => {
  it("records the specification, the stages and this execution", async () => {
    extractMock.mockResolvedValue(extraction(["add a calendar", "add an admin editor"]));
    const opened = await open();

    expect(opened?.requirementCount).toBe(2);
    expect(opened?.gating).toBe(true);
    expect(opened?.plan.executionIds).toEqual(["execution-1"]);

    const persisted = await loadStagePlan(missionId);
    expect(persisted?.specification).toBe("Build a booking tool with a calendar and an admin editor.");
  });

  it("refuses to gate a mission on a mechanically split request", async () => {
    extractMock.mockResolvedValue(extraction(["add a calendar"], "deterministic-fallback"));
    expect((await open())?.gating).toBe(false);
  });

  it("returns nothing when no requirement could be identified", async () => {
    extractMock.mockResolvedValue(extraction([]));
    expect(await open()).toBeUndefined();
  });
});

describe("resume policy", () => {
  it("does not inherit a stored specification for a request that is not a continuation", async () => {
    extractMock.mockResolvedValue(extraction(["add a calendar"]));
    await open();

    extractMock.mockResolvedValue(extraction(["make the header darker"]));
    const second = await open({ executionId: "execution-2", request: "make the header darker", continuation: false });

    // A fresh request must be tracked on its own terms, never against the previous contract.
    expect(second?.plan.specification).toBe("make the header darker");
    expect(activeRequirements(second!.ledger).map((item) => item.text)).toEqual(["make the header darker"]);
  });

  it("resumes the stored specification rather than the continuation turn's wording", async () => {
    extractMock.mockResolvedValue(extraction(["add a calendar", "add an admin editor"]));
    await open();

    extractMock.mockClear();
    const resumed = await open({ executionId: "execution-2", request: "keep going", continuation: true });

    expect(resumed?.plan.specification).toBe("Build a booking tool with a calendar and an admin editor.");
    expect(resumed?.requirementCount).toBe(2);
    // Re-extracting would replace the approved contract with the word "keep going".
    expect(extractMock).not.toHaveBeenCalled();
    expect(resumed?.plan.executionIds).toEqual(["execution-1", "execution-2"]);
  });

  it("starts a new contract when the stored one is already settled", async () => {
    extractMock.mockResolvedValue(extraction(["add a calendar"]));
    const first = await open();
    reconcileAllVerified();
    // Settle the stored ledger the way a completed mission would.
    const { saveRequirementLedger } = await import("./requirement-ledger-store");
    const settled = await reconcileMock({ ledger: first!.ledger } as never);
    await saveRequirementLedger(settled.ledger);

    extractMock.mockResolvedValue(extraction(["now add invoices"]));
    const second = await open({ executionId: "execution-2", request: "now add invoices", continuation: true });

    expect(second?.plan.specification).toBe("now add invoices");
    expect(extractMock).toHaveBeenCalled();
  });
});

describe("recovering progress from a lost window", () => {
  it("reads the journal so finished work is not started over", async () => {
    extractMock.mockResolvedValue(extraction(["add a calendar", "add an admin editor"]));
    await open();
    // Execution 1 wrote real files, then died before its ledger statuses were written.
    await journalFileWrite("execution-1", "app/calendar.tsx");

    reconcileAllVerified();
    const resumed = await open({ executionId: "execution-2", request: "continue", continuation: true });

    expect(reconcileMock).toHaveBeenCalledTimes(1);
    // The recovered evidence comes from the journal, scoped to this specification's own executions.
    const passed = reconcileMock.mock.calls[0][0];
    expect(passed.evidence.changedFiles).toContain("app/calendar.tsx");
    expect(passed.request).toBe("Build a booking tool with a calendar and an admin editor.");
    expect(resumed?.note).toContain("Recovered progress from 1 earlier window(s)");
    expect(resumed?.missionContext).toContain("Every stage is finished");
  });

  it("does not pay for reconciliation when no earlier window recorded anything", async () => {
    extractMock.mockResolvedValue(extraction(["add a calendar"]));
    await open();

    reconcileAllVerified();
    // Same execution id: there is no earlier window to recover from.
    await open({ executionId: "execution-1", request: "continue", continuation: true });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("keeps the stored statuses when reconciliation is unavailable", async () => {
    extractMock.mockResolvedValue(extraction(["add a calendar", "add an admin editor"]));
    await open();
    await journalFileWrite("execution-1", "app/calendar.tsx");

    reconcileMock.mockResolvedValue({ ledger: {} as RequirementLedger, source: "unavailable", unattempted: [], unverified: [], unrequested: [] });
    const resumed = await open({ executionId: "execution-2", request: "continue", continuation: true });

    // An unavailable audit must not overwrite the ledger with an empty one.
    expect(resumed?.requirementCount).toBe(2);
    expect(resumed?.note).not.toContain("Recovered progress");
  });
});

describe("ambiguity that is worth stopping for", () => {
  it("raises a contradiction as a blocking question", async () => {
    extractMock.mockResolvedValue(extraction(
      ["store bookings in Postgres"],
      "model",
      [{ question: "You asked for both Postgres and no database. Which should I use?", kind: "contradiction" }],
    ));
    const opened = await open();
    expect(opened?.blockingQuestions).toEqual(["You asked for both Postgres and no database. Which should I use?"]);
  });

  it("does not stop for an ordinary undecided detail", async () => {
    extractMock.mockResolvedValue(extraction(
      ["add a settings page"],
      "model",
      [{ question: "Which visual style should the settings page use?", kind: "undecided-detail" }],
    ));
    const opened = await open();
    // Recorded so it is visible, but never turned into a prompt — asking about every missing detail is
    // how the product becomes exhausting to use.
    expect(opened?.openQuestions).toHaveLength(1);
    expect(opened?.blockingQuestions).toEqual([]);
  });

  it("does not re-ask a question on a resumed specification", async () => {
    extractMock.mockResolvedValue(extraction(
      ["store bookings in Postgres"],
      "model",
      [{ question: "Postgres or no database?", kind: "contradiction" }],
    ));
    await open();

    const resumed = await open({ executionId: "execution-2", request: "continue", continuation: true });
    expect(resumed?.blockingQuestions).toEqual([]);
  });
});

describe("scope creep", () => {
  it("reports changes no requirement accounts for alongside a complete verdict", async () => {
    extractMock.mockResolvedValue(extraction(["add a calendar"]));
    const opened = await open();

    reconcileMock.mockImplementation(async ({ ledger }) => {
      let updated: RequirementLedger = ledger;
      for (const requirement of activeRequirements(ledger)) {
        const applied = recordOutcome(updated, requirement.id, "verified", "checked in the browser", [
          { kind: "browser", detail: "calendar renders", recordedAt: new Date().toISOString() },
        ]);
        if (applied.ok) updated = applied.ledger;
      }
      return {
        ledger: updated,
        source: "model" as const,
        unattempted: [],
        unverified: [],
        unrequested: ["Replaced the site theme with a new colour scheme (app/globals.css)"],
      };
    });

    const gate = await closeRequirementLedger({
      opened: opened!,
      request: "add a calendar",
      apiKey: "test-key",
      evidence: { changedFiles: ["app/calendar.tsx", "app/globals.css"], commands: [], verification: [], checklist: [] },
    });

    expect(gate.outcome).toBe("satisfied");
    // Delivering everything asked for does not excuse also doing something nobody asked for.
    if (gate.outcome === "unchecked") return;
    expect(gate.unrequested).toEqual(["Replaced the site theme with a new colour scheme (app/globals.css)"]);
  });
});

describe("under-reading a large request", () => {
  it("re-reads a product brief that came back as one requirement", async () => {
    // The live failure: a full ordering-application brief produced a single requirement, so the
    // completion gate had one thing to check and reported satisfaction over a broken build.
    const brief = [
      "Build a complete customer ordering web app.",
      "- customers browse a product catalogue",
      "- customers add items to a cart",
      "- customers check out and pay",
      "- customers sign up and log in",
      "- admins manage products and see orders",
    ].join("\n");

    extractMock
      .mockResolvedValueOnce(extraction(["build a complete customer ordering web app"]))
      .mockResolvedValueOnce(extraction(["browse the catalogue", "add items to a cart", "check out", "sign up and log in", "manage products"]));

    const opened = await open({ request: brief });

    expect(extractMock).toHaveBeenCalledTimes(2);
    // The second pass runs on a stronger tier than the fastest one.
    expect(extractMock.mock.calls[1][0].tier).toBe("builder");
    expect(opened?.requirementCount).toBe(5);
  });

  it("re-reads when the model itself reports low coverage", async () => {
    const low = { ...extraction(["do the thing"]), coverageConfidence: 0.2 };
    extractMock
      .mockResolvedValueOnce(low)
      .mockResolvedValueOnce(extraction(["do the thing", "and the other thing"]));

    expect((await open())?.requirementCount).toBe(2);
    expect(extractMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the first reading when a second pass sees no more", async () => {
    const low = { ...extraction(["do the thing"]), coverageConfidence: 0.2 };
    extractMock.mockResolvedValueOnce(low).mockResolvedValueOnce(extraction([]));
    // A weaker second result is not an improvement.
    expect((await open())?.requirementCount).toBe(1);
  });

  it("does not pay for a second pass on an ordinary small request", async () => {
    extractMock.mockResolvedValue(extraction(["make the header darker"]));
    await open({ request: "make the header darker" });
    expect(extractMock).toHaveBeenCalledTimes(1);
  });

  it("does not escalate a mechanically split reading", async () => {
    // The deterministic fallback cannot be improved by re-running it at a higher tier.
    extractMock.mockResolvedValue(extraction(["a"], "deterministic-fallback"));
    await open({ request: "x".repeat(1_000) });
    expect(extractMock).toHaveBeenCalledTimes(1);
  });
});

describe("asking what is unbuilt, while there is still time to build it", () => {
  const evidence = { changedFiles: ["package.json", "src/app/page.tsx"], commands: [], verification: [] };

  async function opened(texts: string[]) {
    extractMock.mockResolvedValue(extraction(texts));
    return (await open({ request: texts.join(". ") }))!;
  }

  it("names features the evidence shows were never started", async () => {
    // The live failure: typecheck, build and tests all passed on a scaffold that implemented nothing,
    // and eight of eleven requirements were untouched with no one asking until the very end.
    const ledger = await opened(["add a product catalogue", "add a cart", "add checkout"]);
    reconcileMock.mockResolvedValue({
      ledger: ledger.ledger,
      source: "model",
      unattempted: [
        { text: "add a cart", kind: "deliverable" },
        { text: "add checkout", kind: "deliverable" },
      ] as never,
      unverified: [],
      unrequested: [],
    });

    expect(await unbuiltRequirements({ opened: ledger, request: "spec", result: evidence, apiKey: "test" }))
      .toEqual(["add a cart", "add checkout"]);
  });

  it("ignores an unapproved recommendation", async () => {
    const ledger = await opened(["add a cart"]);
    reconcileMock.mockResolvedValue({
      ledger: ledger.ledger,
      source: "model",
      unattempted: [{ text: "also add analytics", kind: "optional-suggestion" }] as never,
      unverified: [],
      unrequested: [],
    });
    // Building something the user never asked for is the opposite of the problem being solved.
    expect(await unbuiltRequirements({ opened: ledger, request: "spec", result: evidence, apiKey: "test" })).toEqual([]);
  });

  it("says nothing is unbuilt when the audit cannot run", async () => {
    const ledger = await opened(["add a cart"]);
    reconcileMock.mockResolvedValue({ ledger: ledger.ledger, source: "unavailable", unattempted: [], unverified: [], unrequested: [] });
    // A mission must never keep building because its auditor was unavailable.
    expect(await unbuiltRequirements({ opened: ledger, request: "spec", result: evidence, apiKey: "test" })).toEqual([]);
  });

  it("does not act on a mechanically split reading", async () => {
    extractMock.mockResolvedValue(extraction(["add a cart"], "deterministic-fallback"));
    const ledger = (await open())!;
    expect(await unbuiltRequirements({ opened: ledger, request: "spec", result: evidence, apiKey: "test" })).toEqual([]);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("keeps the reconciled statuses for the next batch", async () => {
    const ledger = await opened(["add a cart"]);
    const advanced = { ...ledger.ledger, revision: 99 };
    reconcileMock.mockResolvedValue({ ledger: advanced, source: "model", unattempted: [], unverified: [], unrequested: [] });

    await unbuiltRequirements({ opened: ledger, request: "spec", result: evidence, apiKey: "test" });
    // The following batch should see what is already done rather than rediscovering it.
    expect(ledger.ledger.revision).toBe(99);
  });

  it("keeps every product requirement open when only framework scaffolding exists", async () => {
    const ledger = await opened(["add authentication", "add a catalogue", "add checkout"]);
    reconcileAllVerified();
    const scaffold = {
      changedFiles: [
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "next-env.d.ts",
        "src/app/layout.tsx",
        "src/app/globals.css",
      ],
      commands: [{ command: "npm.cmd run build", exitCode: 0 }],
      verification: [{ check_type: "build", result: "pass", evidence: "Build exited 0." }],
    };

    expect(await unbuiltRequirements({
      opened: ledger,
      request: "build the product",
      result: scaffold,
      apiKey: "test",
      requireProductImplementation: true,
    })).toEqual(["add authentication", "add a catalogue", "add checkout"]);
    expect(reconcileMock).not.toHaveBeenCalled();

    const gate = await closeRequirementLedger({
      opened: ledger,
      request: "build the product",
      evidence: {
        ...scaffold,
        checklist: [],
        verification: scaffold.verification.map(({ check_type, ...entry }) => ({
          ...entry,
          checkType: check_type,
        })),
      },
      apiKey: "test",
      requireProductImplementation: true,
    });
    expect(gate.outcome).toBe("unmet");
    if (gate.outcome === "unmet") expect(gate.blocker).toContain("No application source was created");
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});
