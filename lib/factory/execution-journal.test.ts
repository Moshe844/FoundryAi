import { rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendJournalEntry,
  explainFileChanges,
  formatJournalDigest,
  journalDigest,
  latestJournaledMissionId,
  recordedDecisions,
  shouldJournalEvent,
} from "./execution-journal";
import type { FactoryExecutionEvent } from "./types";

const projectId = "journal-test-project";

function event(overrides: Partial<FactoryExecutionEvent> = {}): FactoryExecutionEvent {
  return {
    id: `event-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    kind: "edit",
    status: "completed",
    title: "Updated app/page.tsx",
    ...overrides,
  };
}

afterEach(async () => {
  await rm(path.join(process.cwd(), ".foundry-data", "journals", projectId), { recursive: true, force: true });
});

describe("what the journal keeps", () => {
  it("keeps ordinary user-visible work", () => {
    expect(shouldJournalEvent(event())).toBe(true);
  });

  it("drops live placeholders", () => {
    expect(shouldJournalEvent(event({ transient: true }))).toBe(false);
  });

  it("drops internal bookkeeping that explains nothing", () => {
    expect(shouldJournalEvent(event({ internal: true, kind: "inspection", title: "Listed 12 entries" }))).toBe(false);
  });

  it("keeps an internal event that carries a reason", () => {
    // `internal` means never-render, not never-remember: this is how a routing or recovery decision
    // stays answerable later without appearing on the user's timeline.
    expect(shouldJournalEvent(event({ internal: true, tier: "decision", rationale: "Routed implement to the builder tier." }))).toBe(true);
  });

  it("keeps an internal finding or flag", () => {
    expect(shouldJournalEvent(event({ internal: true, tier: "flag", rationale: "Requirement accounting unavailable." }))).toBe(true);
  });
});

describe("answering why a file changed", () => {
  it("returns the recorded reason rather than nothing", async () => {
    await appendJournalEntry(projectId, event({ filePath: "app/page.tsx", rationale: "Moved the total above the filter bar as requested." }), "mission-1");

    const changes = await explainFileChanges(projectId, "app/page.tsx");
    expect(changes).toHaveLength(1);
    expect(changes[0].rationale).toBe("Moved the total above the filter bar as requested.");
    expect(changes[0].missionId).toBe("mission-1");
  });

  it("matches the same file across absolute and project-relative records", async () => {
    await appendJournalEntry(projectId, event({ filePath: "C:/work/site/app/page.tsx", rationale: "First pass." }), "mission-1");
    const changes = await explainFileChanges(projectId, "app/page.tsx");
    expect(changes).toHaveLength(1);
  });

  it("reports nothing for a file it never touched, instead of guessing", async () => {
    await appendJournalEntry(projectId, event({ filePath: "app/page.tsx", rationale: "Edited the page." }), "mission-1");
    expect(await explainFileChanges(projectId, "app/other.tsx")).toEqual([]);
  });

  it("returns every recorded change to a file in order", async () => {
    await appendJournalEntry(projectId, event({ kind: "file", filePath: "app/page.tsx", title: "Created app/page.tsx", rationale: "Scaffolded the page." }), "mission-1");
    await appendJournalEntry(projectId, event({ filePath: "app/page.tsx", title: "Updated app/page.tsx", rationale: "Applied the requested colour change." }), "mission-2");

    const changes = await explainFileChanges(projectId, "app/page.tsx");
    expect(changes.map((change) => change.kind)).toEqual(["file", "edit"]);
    expect(changes.map((change) => change.missionId)).toEqual(["mission-1", "mission-2"]);
  });
});

describe("recorded decisions", () => {
  it("surfaces only entries that carry a reason", async () => {
    await appendJournalEntry(projectId, event({ filePath: "a.ts", rationale: "Because the user asked for it." }), "mission-1");
    await appendJournalEntry(projectId, event({ filePath: "b.ts", title: "Updated b.ts" }), "mission-1");

    const decisions = await recordedDecisions(projectId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].rationale).toBe("Because the user asked for it.");
  });

  it("narrows to a single mission", async () => {
    await appendJournalEntry(projectId, event({ rationale: "First mission choice." }), "mission-1");
    await appendJournalEntry(projectId, event({ rationale: "Second mission choice." }), "mission-2");

    expect(await recordedDecisions(projectId, { missionId: "mission-2" })).toHaveLength(1);
    expect(await latestJournaledMissionId(projectId)).toBe("mission-2");
  });

  it("reads a narrative rationale when the event carries one instead", async () => {
    await appendJournalEntry(projectId, event({
      narrative: { id: "n1", tier: "decision", rationale: "Chose the wrapper build command.", evidence: ["gradlew exists"], source: "confidence-map" },
    }), "mission-1");

    const decisions = await recordedDecisions(projectId);
    expect(decisions[0].rationale).toBe("Chose the wrapper build command.");
    expect(decisions[0].evidence).toEqual(["gradlew exists"]);
  });
});

describe("digest for grounding a summary", () => {
  it("reports the facts on the record", async () => {
    await appendJournalEntry(projectId, event({ kind: "file", filePath: "app/page.tsx", title: "Created app/page.tsx", rationale: "Scaffolded the page." }), "mission-1");
    await appendJournalEntry(projectId, event({ kind: "command", command: "npm run build", exitCode: 0, title: "Ran npm run build" }), "mission-1");
    await appendJournalEntry(projectId, event({ kind: "blocked", status: "error", title: "Missing API credentials" }), "mission-1");

    const digest = await journalDigest(projectId, { missionId: "mission-1" });
    expect(digest.empty).toBe(false);
    expect(digest.filesChanged).toHaveLength(1);
    expect(digest.commands).toEqual([{ command: "npm run build", exitCode: 0 }]);
    expect(digest.blockers).toEqual(["Missing API credentials"]);

    const rendered = formatJournalDigest(digest);
    expect(rendered).toContain("Scaffolded the page.");
    expect(rendered).toContain("npm run build → exit 0");
  });

  it("reports each changed file once, at its latest state", async () => {
    await appendJournalEntry(projectId, event({ filePath: "app/page.tsx", title: "First edit", rationale: "First." }), "mission-1");
    await appendJournalEntry(projectId, event({ filePath: "app/page.tsx", title: "Second edit", rationale: "Second." }), "mission-1");

    const digest = await journalDigest(projectId, { missionId: "mission-1" });
    expect(digest.filesChanged).toHaveLength(1);
    expect(digest.filesChanged[0].rationale).toBe("Second.");
  });

  it("says plainly when there is nothing recorded", async () => {
    const digest = await journalDigest(projectId, { missionId: "never-ran" });
    expect(digest.empty).toBe(true);
    expect(formatJournalDigest(digest)).toContain("no entries recorded");
  });
});
