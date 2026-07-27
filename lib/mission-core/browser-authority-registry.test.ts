import assert from "node:assert/strict";
import test from "node:test";
import { authoritativeMissionForWorkspace, clearAuthoritativeWorkspaceMission, registerAuthoritativeWorkspaceMission } from "./browser-authority-registry";
import { createMissionRecord } from "./model";

test("authoritative registry rejects stale mission revisions", () => {
  const workspaceMissionId = "workspace-registry-test";
  clearAuthoritativeWorkspaceMission(workspaceMissionId);
  const current = { ...createMissionRecord({ id: "durable-registry-test", projectId: "project", objective: "test" }), revision: 4 };
  const stale = { ...current, revision: 3, status: "failed" as const };

  assert.equal(registerAuthoritativeWorkspaceMission(workspaceMissionId, current), true);
  assert.equal(registerAuthoritativeWorkspaceMission(workspaceMissionId, stale), false);
  assert.equal(authoritativeMissionForWorkspace(workspaceMissionId)?.revision, 4);
  assert.equal(authoritativeMissionForWorkspace(workspaceMissionId)?.status, "draft");

  clearAuthoritativeWorkspaceMission(workspaceMissionId);
});
