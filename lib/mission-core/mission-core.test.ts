import { describe, expect, it } from "vitest";
import { MissionCoordinator } from "./coordinator";
import { createMissionRecord, type PlannedOperation } from "./model";
import { validateOperationPlan } from "./operation-plan";
import { InMemoryMissionRepository, MissionRevisionConflictError } from "./repository";
import { ExecutionScheduler } from "./scheduler";
import { InvalidMissionTransitionError, transitionMission } from "./state-machine";

function operation(input: Partial<PlannedOperation> & Pick<PlannedOperation, "id" | "missionId" | "kind" | "title">): PlannedOperation {
  const now = "2026-07-27T12:00:00.000Z";
  return {
    target: undefined,
    command: undefined,
    dependsOn: [],
    requirementIds: [],
    risk: "safe",
    status: "pending",
    attempt: 0,
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

describe("mission core", () => {
  it("rejects invalid state transitions", () => {
    const mission = createMissionRecord({ id: "m1", projectId: "p1", objective: "test" });
    expect(() => transitionMission(mission, "completed")).toThrow(InvalidMissionTransitionError);
  });

  it("rejects operation dependency cycles", () => {
    const operations = [
      operation({ id: "a", missionId: "m1", kind: "read_file", title: "A", dependsOn: ["b"] }),
      operation({ id: "b", missionId: "m1", kind: "verify", title: "B", dependsOn: ["a"] }),
    ];
    expect(() => validateOperationPlan(operations)).toThrow(/cycle/i);
  });

  it("runs one ready operation at a time", async () => {
    const repository = new InMemoryMissionRepository();
    const scheduler = new ExecutionScheduler({ execute: async () => ({ status: "succeeded", summary: "done" }) });
    const coordinator = new MissionCoordinator(repository, scheduler);
    await coordinator.create({ id: "m1", projectId: "p1", objective: "change a file" });
    await coordinator.understand("m1");
    await coordinator.plan("m1", [
      operation({ id: "read", missionId: "m1", kind: "read_file", title: "Read" }),
      operation({ id: "write", missionId: "m1", kind: "write_file", title: "Write", dependsOn: ["read"] }),
    ]);

    const afterRead = await coordinator.runNext("m1");
    expect(afterRead.operations.find((item) => item.id === "read")?.status).toBe("succeeded");
    expect(afterRead.operations.find((item) => item.id === "write")?.status).toBe("pending");

    const afterWrite = await coordinator.runNext("m1");
    expect(afterWrite.operations.find((item) => item.id === "write")?.status).toBe("succeeded");
  });

  it("prevents stale writers from overwriting mission state", async () => {
    const repository = new InMemoryMissionRepository();
    const mission = await repository.create(createMissionRecord({ id: "m1", projectId: "p1", objective: "test" }));
    const updated = transitionMission(mission, "understanding");
    await repository.save(updated, mission.revision);
    await expect(repository.save({ ...updated, objective: "stale" }, mission.revision)).rejects.toBeInstanceOf(MissionRevisionConflictError);
  });
});
