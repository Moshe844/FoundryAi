import { rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/providers/dispatch", () => ({ callManagedModel: vi.fn() }));
vi.mock("@/lib/ai/model-router", () => ({ resolveModelForTier: vi.fn() }));

import { summarizeFromJournal } from "./mission-summary";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier } from "@/lib/ai/model-router";
import { appendJournalEntry } from "@/lib/factory/execution-journal";
import type { FactoryExecutionEvent } from "@/lib/factory/types";

const callMock = vi.mocked(callManagedModel);
const resolveMock = vi.mocked(resolveModelForTier);

const projectId = "summary-test-project";

function modelSays(outcome: string) {
  callMock.mockResolvedValue({
    toolCalls: [{ name: "report_outcome", arguments: JSON.stringify({ outcome }) }],
  } as never);
}

async function journal(executionId: string, event: Partial<FactoryExecutionEvent>) {
  await appendJournalEntry(projectId, {
    id: `event-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    kind: "edit",
    status: "completed",
    title: "Updated a file",
    ...event,
  } as FactoryExecutionEvent, executionId);
}

async function cleanup() {
  await rm(path.join(process.cwd(), ".foundry-data", "journals", projectId), { recursive: true, force: true });
}

beforeEach(async () => {
  callMock.mockReset();
  resolveMock.mockReset();
  resolveMock.mockReturnValue({ tier: "fast", provider: "openai", model: "test-model", effort: "low" });
  await cleanup();
});
afterEach(cleanup);

const summarize = (overrides: Partial<Parameters<typeof summarizeFromJournal>[0]> = {}) => summarizeFromJournal({
  projectId,
  request: "add a calendar",
  status: "passed",
  apiKey: "test",
  ...overrides,
});

describe("grounding the report in the record", () => {
  it("sends the recorded evidence, not the live timeline", async () => {
    await journal("execution-1", { filePath: "app/calendar.tsx", title: "Created app/calendar.tsx", rationale: "Added the month grid." });
    await journal("execution-1", { kind: "command", command: "npm run build", exitCode: 0, title: "Ran npm run build" });
    modelSays("Added a calendar to the app and the production build passed.");

    const summary = await summarize({ missionIds: ["execution-1"] });
    expect(summary?.outcome).toContain("calendar");

    const sent = String((callMock.mock.calls[0][0].messages[0].content as Array<{ text?: string }>)[0].text);
    expect(sent).toContain("app/calendar.tsx");
    expect(sent).toContain("Added the month grid.");
    expect(sent).toContain("npm run build → exit 0");
  });

  it("reports across every window of a continued mission", async () => {
    // The timeline-derived summary can only see the current window; the journal sees the whole mission.
    await journal("execution-1", { filePath: "app/calendar.tsx", title: "Created app/calendar.tsx", rationale: "First window." });
    await journal("execution-2", { filePath: "app/admin.tsx", title: "Created app/admin.tsx", rationale: "Second window." });
    modelSays("Built the calendar and the admin editor.");

    await summarize({ missionIds: ["execution-1", "execution-2"] });
    const sent = String((callMock.mock.calls[0][0].messages[0].content as Array<{ text?: string }>)[0].text);
    expect(sent).toContain("app/calendar.tsx");
    expect(sent).toContain("app/admin.tsx");
  });

  it("passes requirement accounting so an incomplete mission is not reported as finished", async () => {
    await journal("execution-1", { filePath: "app/calendar.tsx", title: "Created app/calendar.tsx", rationale: "Added it." });
    modelSays("Added the calendar; the admin editor is still outstanding.");

    await summarize({ missionIds: ["execution-1"], requirements: { finalized: 1, total: 2 } });
    const sent = String((callMock.mock.calls[0][0].messages[0].content as Array<{ text?: string }>)[0].text);
    expect(sent).toContain("1 of 2 requested item(s) finalized");
  });

  it("runs on the cheapest tier", async () => {
    await journal("execution-1", { filePath: "a.ts", rationale: "did a thing" });
    modelSays("Done.");
    await summarize({ missionIds: ["execution-1"] });
    expect(resolveMock).toHaveBeenCalledWith("fast", { provider: "openai" });
  });
});

describe("refusing to narrate what was not recorded", () => {
  it("returns nothing when the journal has no record of this mission", async () => {
    const summary = await summarize({ missionIds: ["never-ran"] });
    expect(summary).toBeUndefined();
    // Inventing a narrative to fill the gap is exactly what journal grounding prevents.
    expect(callMock).not.toHaveBeenCalled();
  });

  it("returns nothing with no provider available", async () => {
    await journal("execution-1", { filePath: "a.ts", rationale: "did a thing" });
    expect(await summarize({ missionIds: ["execution-1"], apiKey: undefined })).toBeUndefined();
  });

  it("returns nothing when the summary call cannot run", async () => {
    await journal("execution-1", { filePath: "a.ts", rationale: "did a thing" });
    resolveMock.mockImplementation(() => { throw new Error("no routable model"); });
    expect(await summarize({ missionIds: ["execution-1"] })).toBeUndefined();
  });

  it("returns nothing when the model produces an empty outcome", async () => {
    await journal("execution-1", { filePath: "a.ts", rationale: "did a thing" });
    modelSays("   ");
    expect(await summarize({ missionIds: ["execution-1"] })).toBeUndefined();
  });
});
