import { describe, expect, it } from "vitest";
import { MissionCoordinator } from "./coordinator";
import { createMissionRecord, type PlannedOperation } from "./model";
import { InMemoryPermissionGrantStore, PermissionCoordinator } from "./permission-coordinator";
import { InMemoryMissionRepository } from "./repository";
import { ExecutionScheduler } from "./scheduler";

function operation(): PlannedOperation {
  const now = "2026-07-27T12:00:00.000Z";
  return {
    id: "install",
    missionId: "m1",
    kind: "run_command",
    title: "Install dependency",
    command: "npm install dayjs",
    dependsOn: [],
    requirementIds: [],
    risk: "development",
    status: "pending",
    attempt: 0,
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe("mission approval flow", () => {
  it("pauses before execution and resumes after allow-once", async () => {
    const repository = new InMemoryMissionRepository();
    const permissions = new PermissionCoordinator(new InMemoryPermissionGrantStore());
    let executions = 0;
    const scheduler = new ExecutionScheduler({
      execute: async () => {
        executions += 1;
        return { status: "succeeded", summary: "installed" };
      },
    }, permissions);
    const coordinator = new MissionCoordinator(repository, scheduler, permissions);
    let mission = createMissionRecord({ id: "m1", projectId: "p1", objective: "install dependency" });
    await repository.create(mission);
    mission = await coordinator.understand("m1");
    mission = await coordinator.plan("m1", [operation()]);

    mission = await coordinator.runNext("m1");
    expect(mission.status).toBe("awaiting_approval");
    expect(executions).toBe(0);
    const approval = mission.approvals[0];
    expect(approval.status).toBe("pending");

    mission = await coordinator.decideApproval("m1", approval.id, "approve", "once");
    expect(mission.status).toBe("executing");
    mission = await coordinator.runUntilPause("m1");
    expect(executions).toBe(1);
    expect(mission.status).toBe("completed");
  });

  it("does not execute a denied operation", async () => {
    const repository = new InMemoryMissionRepository();
    const permissions = new PermissionCoordinator(new InMemoryPermissionGrantStore());
    let executions = 0;
    const scheduler = new ExecutionScheduler({ execute: async () => { executions += 1; return { status: "succeeded", summary: "unexpected" }; } }, permissions);
    const coordinator = new MissionCoordinator(repository, scheduler, permissions);
    await repository.create(createMissionRecord({ id: "m1", projectId: "p1", objective: "install dependency" }));
    await coordinator.understand("m1");
    await coordinator.plan("m1", [operation()]);
    let mission = await coordinator.runNext("m1");
    mission = await coordinator.decideApproval("m1", mission.approvals[0].id, "deny");
    expect(mission.status).toBe("blocked");
    expect(mission.operations[0].status).toBe("skipped");
    expect(executions).toBe(0);
  });
});
