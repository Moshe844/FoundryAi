import type { PlannedOperation } from "./model";

export class OperationPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationPlanError";
  }
}

export function validateOperationPlan(operations: PlannedOperation[]): void {
  const ids = new Set<string>();
  for (const operation of operations) {
    if (ids.has(operation.id)) throw new OperationPlanError(`Duplicate operation id: ${operation.id}`);
    ids.add(operation.id);
  }
  for (const operation of operations) {
    for (const dependency of operation.dependsOn) {
      if (!ids.has(dependency)) throw new OperationPlanError(`Operation ${operation.id} depends on missing operation ${dependency}`);
      if (dependency === operation.id) throw new OperationPlanError(`Operation ${operation.id} cannot depend on itself`);
    }
  }
  topologicalOperations(operations);
}

export function topologicalOperations(operations: PlannedOperation[]): PlannedOperation[] {
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: PlannedOperation[] = [];

  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new OperationPlanError(`Operation dependency cycle detected at ${id}`);
    const operation = byId.get(id);
    if (!operation) throw new OperationPlanError(`Missing operation ${id}`);
    visiting.add(id);
    for (const dependency of operation.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(operation);
  };

  for (const operation of operations) visit(operation.id);
  return ordered;
}

export function readyOperations(operations: PlannedOperation[]): PlannedOperation[] {
  const succeeded = new Set(operations.filter((operation) => operation.status === "succeeded" || operation.status === "skipped").map((operation) => operation.id));
  return topologicalOperations(operations).filter((operation) => operation.status === "pending" && operation.dependsOn.every((id) => succeeded.has(id)));
}

export function allOperationsSettled(operations: PlannedOperation[]): boolean {
  return operations.every((operation) => ["succeeded", "skipped", "canceled"].includes(operation.status));
}
