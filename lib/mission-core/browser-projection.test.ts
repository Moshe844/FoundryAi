import { describe, expect, it } from "vitest";
import { createMissionRecord } from "./model";
import { latestDurableMission, projectDurableMission } from "./browser-projection";

function mission(id: string, status: ReturnType<typeof createMissionRecord>["status"], updatedAt: string, revision = 0) {
  return { ...createMissionRecord({ id, projectId: "project", objective: "test", now: updatedAt }), status, updatedAt, revision };
}

describe("durable browser projection", () => {
  it("prefers a pending approval over a stale local working label", () => {
    const record = mission("mission-1", "awaiting_approval", "2026-07-27T12:00:00.000Z");
    record.approvals.push({
      id: "approval-1",
      missionId: record.id,
      operationId: "operation-1",
      projectId: record.projectId,
      category: "command",
      exactAction: "npm install",
      reason: "Install dependencies",
      impact: "Changes project dependencies",
      affectedFiles: ["package.json"],
      allowedScopes: ["once", "mission"],
      status: "pending",
      createdAt: record.updatedAt,
    });
    const view = projectDurableMission(record);
    expect(view?.label).toBe("Waiting for approval");
    expect(view?.pendingApproval?.id).toBe("approval-1");
  });

  it("chooses the newest durable mission for global safety surfaces", () => {
    const older = mission("older", "executing", "2026-07-27T11:00:00.000Z", 3);
    const newer = mission("newer", "failed", "2026-07-27T12:00:00.000Z", 1);
    expect(latestDurableMission({ older, newer })?.id).toBe("newer");
  });
});
