import type { MissionRecord, PlannedOperation } from "./model";
import { allOperationsSettled, readyOperations, validateOperationPlan } from "./operation-plan";

export type OperationExecutionResult = {
  status: "succeeded" | "failed" | "awaiting_approval" | "skipped";
  summary: string;
  evidence?: string[];
};

export interface OperationExecutor {
  execute(operation: PlannedOperation, mission: MissionRecord, signal?: AbortSignal): Promise<OperationExecutionResult>;
}

export type SchedulerTickResult = {
  mission: MissionRecord;
  progressed: boolean;
  waiting: boolean;
};

export class ExecutionScheduler {
  constructor(private readonly executor: OperationExecutor) {}

  async tick(mission: MissionRecord, signal?: AbortSignal): Promise<SchedulerTickResult> {
    validateOperationPlan(mission.operations);
    const next = readyOperations(mission.operations)[0];
    if (!next) return { mission, progressed: false, waiting: !allOperationsSettled(mission.operations) };

    const now = new Date().toISOString();
    let working = replaceOperation(mission, next.id, {
      ...next,
      status: "running",
      attempt: next.attempt + 1,
      updatedAt: now,
    });

    const result = await this.executor.execute(working.operations.find((operation) => operation.id === next.id)!, working, signal);
    const completedAt = new Date().toISOString();
    const status = result.status;
    working = replaceOperation(working, next.id, {
      ...working.operations.find((operation) => operation.id === next.id)!,
      status,
      updatedAt: completedAt,
    });

    return {
      mission: {
        ...working,
        revision: working.revision + 1,
        updatedAt: completedAt,
        journal: [
          ...working.journal,
          {
            id: `${working.id}:operation:${next.id}:${working.revision + 1}`,
            missionId: working.id,
            at: completedAt,
            type: "operation",
            message: `${next.title}: ${status} — ${result.summary}`,
            data: result.evidence?.length ? { evidence: result.evidence } : undefined,
          },
        ],
      },
      progressed: true,
      waiting: status === "awaiting_approval",
    };
  }
}

function replaceOperation(mission: MissionRecord, id: string, replacement: PlannedOperation): MissionRecord {
  return { ...mission, operations: mission.operations.map((operation) => operation.id === id ? replacement : operation) };
}
