import { createMissionRecord, type MissionRecord, type PlannedOperation } from "./model";
import type { MissionRepository } from "./repository";
import { ExecutionScheduler } from "./scheduler";
import { transitionMission } from "./state-machine";
import { validateOperationPlan } from "./operation-plan";

export class MissionCoordinator {
  constructor(
    private readonly repository: MissionRepository,
    private readonly scheduler: ExecutionScheduler,
  ) {}

  async create(input: { id: string; projectId: string; objective: string }): Promise<MissionRecord> {
    return this.repository.create(createMissionRecord(input));
  }

  async understand(id: string): Promise<MissionRecord> {
    return this.mutate(id, (mission) => transitionMission(mission, "understanding"));
  }

  async plan(id: string, operations: PlannedOperation[]): Promise<MissionRecord> {
    validateOperationPlan(operations);
    return this.mutate(id, (mission) => {
      const planned = transitionMission(mission, "planned");
      return {
        ...planned,
        operations,
        revision: planned.revision + 1,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async runNext(id: string, signal?: AbortSignal): Promise<MissionRecord> {
    const mission = await this.required(id);
    const executable = mission.status === "planned" || mission.status === "blocked"
      ? transitionMission(mission, "executing")
      : mission;
    const result = await this.scheduler.tick(executable, signal);
    const next = result.waiting
      ? transitionMission(result.mission, "awaiting_approval")
      : result.mission;
    return this.repository.save(next, mission.revision);
  }

  async get(id: string): Promise<MissionRecord> {
    return this.required(id);
  }

  private async mutate(id: string, update: (mission: MissionRecord) => MissionRecord): Promise<MissionRecord> {
    const current = await this.required(id);
    return this.repository.save(update(current), current.revision);
  }

  private async required(id: string): Promise<MissionRecord> {
    const mission = await this.repository.get(id);
    if (!mission) throw new Error(`Mission not found: ${id}`);
    return mission;
  }
}
