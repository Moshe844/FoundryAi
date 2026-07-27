import { describe, expect, it } from "vitest";

import { getExecutionSnapshot, recordExecutionEvent, registerExecution } from "./execution-control";

describe("execution-control transient progress", () => {
  it("replaces repeated transient progress instead of accumulating duplicate rows", () => {
    const id = `transient-${crypto.randomUUID()}`;
    const unregister = registerExecution(id, new AbortController());

    recordExecutionEvent(id, {
      id: "creation-live-heartbeat",
      transient: true,
      title: "Waiting · 30s",
      details: { transientKey: "creation-live-heartbeat" },
    });
    recordExecutionEvent(id, {
      id: "creation-live-heartbeat",
      transient: true,
      title: "Waiting · 60s",
      details: { transientKey: "creation-live-heartbeat" },
    });

    expect(getExecutionSnapshot(id)?.events).toEqual([
      expect.objectContaining({ title: "Waiting · 60s" }),
    ]);
    unregister();
  });

  it("preserves distinct non-transient evidence", () => {
    const id = `evidence-${crypto.randomUUID()}`;
    const unregister = registerExecution(id, new AbortController());

    recordExecutionEvent(id, { id: "file-a", title: "Saved a.ts" });
    recordExecutionEvent(id, { id: "file-b", title: "Saved b.ts" });

    expect(getExecutionSnapshot(id)?.events).toHaveLength(2);
    unregister();
  });
});
