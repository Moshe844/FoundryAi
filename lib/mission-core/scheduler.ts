import type { MissionRecord, OperationResult, PlannedOperation } from "./model";
import { allOperationsSettled, readyOperations, validateOperationPlan } from "./operation-plan";

export type OperationExecutionResult = {
  status: "succeeded" | "failed" | "awaiting_approval" | "skipped";
  summary: string;
  evidence?: string[];
  output?: string;
  error?: string;
  exitCode?: number | null;
  durationMs?: number;
  contentHash?: string;
  changed?: boolean;
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

    if (next.attempt >= next.maxAttempts) {
      const exhausted = replaceOperation(mission, next.id, {
        ...next,
        status: "failed",
        updatedAt: new Date().toISOString(),
        result: {
          summary: `Retry budget exhausted before another attempt (${next.attempt}/${next.maxAttempts}).`,
          evidence: [],
          error: "retry-budget-exhausted",
          completedAt: new Date().toISOString(),
        },
      });
      return { mission: increment(exhausted, next, "failed", "Retry budget exhausted."), progressed: true, waiting: false };
    }

    const now = new Date().toISOString();
    let working = replaceOperation(mission, next.id, {
      ...next,
      status: "running",
      attempt: next.attempt + 1,
      updatedAt: now,
    });

    let result: OperationExecutionResult;
    try {
      result = await this.executor.execute(working.operations.find((operation) => operation.id === next.id)!, working, signal);
    } catch (error) {
      result = {
        status: "failed",
        summary: error instanceof Error ? error.message : "Operation executor threw an unknown error.",
        error: error instanceof Error ? error.stack || error.message : String(error),
      };
    }

    const completedAt = new Date().toISOString();
    const durableResult: OperationResult = {
      summary: result.summary,
      evidence: result.evidence ?? [],
      output: result.output,
      error: result.error,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      contentHash: result.contentHash,
      changed: result.changed,
      completedAt,
    };
    working = replaceOperation(working, next.id, {
      ...working.operations.find((operation) => operation.id === next.id)!,
      status: result.status,
      result: durableResult,
      updatedAt: completedAt,
    });

    return {
      mission: increment(working, next, result.status, result.summary),
      progressed: true,
      waiting: result.status === "awaiting_approval",
    };
  }
}

function increment(mission: MissionRecord, operation: PlannedOperation, status: string, summary: string): MissionRecord {
  const completedAt = new Date().toISOString();
  return {
    ...mission,
    revision: mission.revision + 1,
    updatedAt: completedAt,
    journal: [
      ...mission.journal,
      {
        id: `${mission.id}:operation:${operation.id}:${mission.revision + 1}`,
        missionId: mission.id,
        at: completedAt,
        type: "operation",
        message: `${operation.title}: ${status} — ${summary}`,
        data: { operationId: operation.id, attempt: operation.attempt + 1 },
      },
    ],
  };
}

function replaceOperation(mission: MissionRecord, id: string, replacement: PlannedOperation): MissionRecord {
  return { ...mission, operations: mission.operations.map((operation) => operation.id === id ? replacement : operation) };
}
