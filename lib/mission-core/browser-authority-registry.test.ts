import { describe, expect, it } from "vitest";
import { authoritativeMissionForWorkspace, clearAuthoritativeWorkspaceMission, registerAuthoritativeWorkspaceMission } from "./browser-authority-registry";
import { createMissionRecord } from "./model";

describe("durable canvas authority registry", () => {
  it("rejects stale mission revisions", () => {
    const workspaceMissionId = "workspace-registry-test";
    clearAuthoritativeWorkspaceMission(workspaceMissionId);
    const current = { ...createMissionRecord({ id: "durable-registry-test", projectId: "project", objective: "test" }), revision: 4 };
    const stale = { ...current, revision: 3, status: "failed" as const };

    expect(registerAuthoritativeWorkspaceMission(workspaceMissionId, current)).toBe(true);
    expect(registerAuthoritativeWorkspaceMission(workspaceMissionId, stale)).toBe(false);
    expect(authoritativeMissionForWorkspace(workspaceMissionId)?.revision).toBe(4);
    expect(authoritativeMissionForWorkspace(workspaceMissionId)?.status).toBe("draft");

    clearAuthoritativeWorkspaceMission(workspaceMissionId);
  });
});
