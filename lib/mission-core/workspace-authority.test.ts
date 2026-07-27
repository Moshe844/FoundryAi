import { describe, expect, it } from "vitest";
import { createMissionRecord } from "./model";
import {
  applyAuthoritativeMission,
  bindWorkspaceMission,
  discoverDurableBindingsFromWorkspace,
  durableMissionForWorkspace,
  emptyDurableWorkspaceSnapshot,
  extractDurableBindingFromFactoryResult,
} from "./workspace-authority";

describe("durable workspace authority", () => {
  it("extracts durable ids from factory results", () => {
    expect(extractDurableBindingFromFactoryResult({ durableMissionId: "m1", durableMissionRevision: 7 })).toEqual({
      durableMissionId: "m1",
      durableMissionRevision: 7,
    });
  });

  it("discovers the newest project execution binding from persisted workspace state", () => {
    const bindings = discoverDurableBindingsFromWorkspace({
      missions: [{
        missionId: "workspace-1",
        updatedAt: "2026-07-27T12:00:00.000Z",
        createdArtifacts: [
          { title: "Project Execution", body: JSON.stringify({ status: "passed" }) },
          { title: "Project Execution", body: JSON.stringify({ durableMissionId: "durable-1", durableMissionRevision: 4 }) },
        ],
      }],
    });
    expect(bindings).toEqual([{
      workspaceMissionId: "workspace-1",
      durableMissionId: "durable-1",
      revision: 4,
      updatedAt: "2026-07-27T12:00:00.000Z",
    }]);
  });

  it("keeps the newest server revision authoritative", () => {
    const first = { ...createMissionRecord({ id: "durable-1", projectId: "p1", objective: "test" }), revision: 3 };
    const newer = { ...first, revision: 4, status: "executing" as const };
    const stale = { ...first, revision: 2, status: "failed" as const };
    let snapshot = bindWorkspaceMission(emptyDurableWorkspaceSnapshot(), "workspace-1", first);
    snapshot = applyAuthoritativeMission(snapshot, newer);
    snapshot = applyAuthoritativeMission(snapshot, stale);
    expect(durableMissionForWorkspace(snapshot, "workspace-1")?.revision).toBe(4);
    expect(durableMissionForWorkspace(snapshot, "workspace-1")?.status).toBe("executing");
  });
});
