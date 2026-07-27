import type { ApprovalRequest, ApprovalScope, MissionRecord, PlannedOperation } from "./model";

export type PermissionGrant = {
  projectId: string;
  missionId?: string;
  category?: string;
  exactAction?: string;
  scope: ApprovalScope;
  createdAt: string;
  expiresAt?: string;
};

export interface PermissionGrantStore {
  list(projectId: string): Promise<PermissionGrant[]>;
  add(grant: PermissionGrant): Promise<void>;
  revoke(predicate: (grant: PermissionGrant) => boolean): Promise<number>;
}

export class InMemoryPermissionGrantStore implements PermissionGrantStore {
  private grants: PermissionGrant[] = [];
  async list(projectId: string) { return structuredClone(this.grants.filter((grant) => grant.projectId === projectId)); }
  async add(grant: PermissionGrant) { this.grants.push(structuredClone(grant)); }
  async revoke(predicate: (grant: PermissionGrant) => boolean) {
    const before = this.grants.length;
    this.grants = this.grants.filter((grant) => !predicate(grant));
    return before - this.grants.length;
  }
}

export class PermissionCoordinator {
  constructor(private readonly grants: PermissionGrantStore) {}

  async authorize(mission: MissionRecord, operation: PlannedOperation, category: string): Promise<{ allowed: true; grant?: PermissionGrant } | { allowed: false; request: ApprovalRequest }> {
    if (operation.risk === "safe") return { allowed: true };
    const now = new Date().toISOString();
    const candidates = (await this.grants.list(mission.projectId)).filter((grant) => !grant.expiresAt || grant.expiresAt > now);
    const exactAction = operation.command ?? `${operation.kind}:${operation.target ?? operation.title}`;
    const matching = candidates.find((grant) => {
      if (grant.scope === "mission" && grant.missionId !== mission.id) return false;
      if (grant.scope === "exact_action") return grant.exactAction === exactAction;
      return !grant.category || grant.category === category;
    });
    if (matching) return { allowed: true, grant: matching };
    return {
      allowed: false,
      request: {
        id: `approval-${operation.id}-${operation.attempt}`,
        missionId: mission.id,
        operationId: operation.id,
        projectId: mission.projectId,
        category,
        exactAction,
        reason: `Foundry needs permission to perform ${operation.title}.`,
        impact: operation.target ? `Affects ${operation.target}` : "May modify the connected project or environment.",
        affectedFiles: operation.target ? [operation.target] : [],
        allowedScopes: operation.risk === "high_risk" ? ["once"] : ["once", "mission", "project", "exact_action"],
        status: "pending",
        createdAt: now,
      },
    };
  }

  async decide(request: ApprovalRequest, decision: "approve" | "deny", scope?: ApprovalScope): Promise<ApprovalRequest> {
    const decidedAt = new Date().toISOString();
    if (decision === "deny") return { ...request, status: "denied", decidedAt };
    const selectedScope = scope ?? "once";
    if (!request.allowedScopes.includes(selectedScope)) throw new Error(`Approval scope ${selectedScope} is not allowed for ${request.id}`);
    if (selectedScope !== "once") {
      await this.grants.add({
        projectId: request.projectId,
        missionId: selectedScope === "mission" ? request.missionId : undefined,
        category: selectedScope === "project" || selectedScope === "mission" ? request.category : undefined,
        exactAction: selectedScope === "exact_action" ? request.exactAction : undefined,
        scope: selectedScope,
        createdAt: decidedAt,
      });
    }
    return { ...request, status: "approved", selectedScope, decidedAt };
  }
}
