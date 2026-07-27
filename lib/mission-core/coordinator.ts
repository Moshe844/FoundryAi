import { createMissionRecord, type ApprovalScope, type MissionRecord, type PlannedOperation } from "./model";
import type { MissionRepository } from "./repository";
import { ExecutionScheduler } from "./scheduler";
import { transitionMission } from "./state-machine";
import { allOperationsSettled, validateOperationPlan } from "./operation-plan";
import type { PermissionCoordinator } from "./permission-coordinator";

export class MissionCoordinator {
  constructor(
    private readonly repository: MissionRepository,
    private readonly scheduler: ExecutionScheduler,
    private readonly permissions?: PermissionCoordinator,
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
    let next = result.waiting
      ? transitionMission(result.mission, "awaiting_approval")
      : result.mission;

    if (!result.waiting && allOperationsSettled(next.operations)) {
      const failed = next.operations.some((operation) => operation.status === "failed");
      if (failed) next = transitionMission(next, "failed", { reason: "One or more planned operations failed." });
      else {
        next = transitionMission(next, "verifying");
        next = transitionMission(next, "completed");
      }
    }
    return this.repository.save(next, mission.revision);
  }

  async runUntilPause(id: string, input: { signal?: AbortSignal; maxOperations?: number } = {}): Promise<MissionRecord> {
    const maxOperations = Math.max(1, Math.min(input.maxOperations ?? 100, 1_000));
    let mission = await this.required(id);
    for (let index = 0; index < maxOperations; index += 1) {
      if (["awaiting_approval", "completed", "completed_with_warnings", "failed", "canceled"].includes(mission.status)) return mission;
      const beforeRevision = mission.revision;
      mission = await this.runNext(id, input.signal);
      if (mission.revision === beforeRevision || input.signal?.aborted) return mission;
    }
    return this.mutate(id, (current) => transitionMission(current, "blocked", { reason: `Execution paused after ${maxOperations} operations to prevent an unbounded scheduler loop.` }));
  }

  async decideApproval(id: string, approvalId: string, decision: "approve" | "deny", scope: ApprovalScope = "once"): Promise<MissionRecord> {
    if (!this.permissions) throw new Error("Mission coordinator has no permission coordinator.");
    return this.mutate(id, asyncMissionMutation(async (mission) => {
      const request = mission.approvals.find((candidate) => candidate.id === approvalId);
      if (!request) throw new Error(`Approval not found: ${approvalId}`);
      if (request.status !== "pending") return mission;
      const decided = await this.permissions!.decide(request, decision, scope);
      const operation = mission.operations.find((candidate) => candidate.id === request.operationId);
      const operations = mission.operations.map((candidate) => candidate.id !== request.operationId
        ? candidate
        : { ...candidate, status: decision === "approve" ? "pending" as const : "skipped" as const, updatedAt: decided.decidedAt ?? new Date().toISOString() });
      let updated: MissionRecord = {
        ...mission,
        approvals: mission.approvals.map((candidate) => candidate.id === approvalId ? decided : candidate),
        operations,
        revision: mission.revision + 1,
        updatedAt: decided.decidedAt ?? new Date().toISOString(),
        journal: [...mission.journal, {
          id: `${mission.id}:approval:${approvalId}:${mission.revision + 1}`,
          missionId: mission.id,
          at: decided.decidedAt ?? new Date().toISOString(),
          type: "approval",
          message: `${decision === "approve" ? "Approved" : "Denied"}: ${operation?.title ?? request.exactAction} (${decision === "approve" ? scope : "deny"})`,
          data: { approvalId, operationId: request.operationId, scope: decision === "approve" ? scope : undefined },
        }],
      };
      updated = transitionMission(updated, decision === "approve" ? "executing" : "blocked", decision === "deny" ? { reason: `User denied ${request.exactAction}.` } : {});
      return updated;
    }));
  }

  async get(id: string): Promise<MissionRecord> {
    return this.required(id);
  }

  private async mutate(id: string, update: (mission: MissionRecord) => MissionRecord | Promise<MissionRecord>): Promise<MissionRecord> {
    const current = await this.required(id);
    return this.repository.save(await update(current), current.revision);
  }

  private async required(id: string): Promise<MissionRecord> {
    const mission = await this.repository.get(id);
    if (!mission) throw new Error(`Mission not found: ${id}`);
    return mission;
  }
}

function asyncMissionMutation(update: (mission: MissionRecord) => Promise<MissionRecord>) {
  return update;
}
