import type { ApprovalRequest, MissionRecord, OperationResult, PlannedOperation } from "./model";
import { allOperationsSettled, readyOperations, validateOperationPlan } from "./operation-plan";
import type { PermissionCoordinator } from "./permission-coordinator";

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
  constructor(
    private readonly executor: OperationExecutor,
    private readonly permissions?: PermissionCoordinator,
  ) {}

  async tick(mission: MissionRecord, signal?: AbortSignal): Promise<SchedulerTickResult> {
    validateOperationPlan(mission.operations);
    const next = readyOperations(mission.operations)[0];
    if (!next) return { mission, progressed: false, waiting: !allOperationsSettled(mission.operations) };

    const onceApproved = mission.approvals.some((request) => request.operationId === next.id && request.status === "approved" && request.selectedScope === "once");
    if (this.permissions && !onceApproved) {
      const authorization = await this.permissions.authorize(mission, next, categoryForOperation(next));
      if (!authorization.allowed) {
        const now = new Date().toISOString();
        const alreadyPending = mission.approvals.some((request) => request.id === authorization.request.id && request.status === "pending");
        const waitingMission = replaceOperation(mission, next.id, { ...next, status: "awaiting_approval", updatedAt: now });
        const withApproval = {
          ...waitingMission,
          approvals: alreadyPending ? waitingMission.approvals : [...waitingMission.approvals, authorization.request],
        };
        return {
          mission: increment(withApproval, next, "awaiting_approval", authorization.request.reason),
          progressed: !alreadyPending,
          waiting: true,
        };
      }
    }

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
    if (result.status === "awaiting_approval" && !working.approvals.some((request) => request.operationId === next.id && request.status === "pending")) {
      const request = approvalRequestForExecutorPause(working, next, result.summary, completedAt);
      working = { ...working, approvals: [...working.approvals, request] };
    }

    return {
      mission: increment(working, next, result.status, result.summary),
      progressed: true,
      waiting: result.status === "awaiting_approval",
    };
  }
}

/** The project-access adapter can discover a permission boundary only when it attempts the command.
 * That late pause must still produce the same durable approval object as preflight authorization;
 * an awaiting_approval status without a request leaves the UI in an impossible, buttonless state. */
function approvalRequestForExecutorPause(
  mission: MissionRecord,
  operation: PlannedOperation,
  reason: string,
  createdAt: string,
): ApprovalRequest {
  const exactAction = operation.command ?? `${operation.kind}:${operation.target ?? operation.title}`;
  return {
    id: `approval-${operation.id}-${operation.attempt + 1}-runtime`,
    missionId: mission.id,
    operationId: operation.id,
    projectId: mission.projectId,
    category: categoryForOperation(operation),
    exactAction,
    reason,
    impact: operation.target ? `Affects ${operation.target}` : "May modify the connected project or environment.",
    affectedFiles: operation.target ? [operation.target] : [],
    allowedScopes: operation.risk === "high_risk" ? ["once"] : ["once", "mission", "project", "exact_action"],
    status: "pending",
    createdAt,
  };
}

export function categoryForOperation(operation: PlannedOperation): string {
  if (operation.kind === "delete_file") return "deletes";
  if (operation.kind === "write_file" || operation.kind === "patch_file") return operation.target?.match(/(^|\/)\.env(\.|$)/i) ? "environment-changes" : "writes";
  if (operation.kind === "run_command" || operation.kind === "start_process" || operation.kind === "stop_process") {
    if (/\b(?:npm|pnpm|yarn|bun|pip|poetry|cargo|dotnet)\s+(?:install|add|i|restore)\b/i.test(operation.command ?? "")) return "dependencies";
    return "commands";
  }
  if (operation.kind === "browser_action") return "browser";
  return "safe";
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
