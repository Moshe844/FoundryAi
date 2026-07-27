import { randomUUID } from "node:crypto";
import { createServerProjectAccess, createUploadedProjectAccess } from "@/lib/ai/mission/project-access";
import type { FactoryUploadedFile } from "@/lib/factory/types";
import { createMissionCoreServices } from "./service";
import type { MissionRecord, OperationInput, OperationKind, PlannedOperation } from "./model";

export type DirectOperationRequest = {
  id?: string;
  kind: OperationKind;
  title: string;
  target?: string;
  command?: string;
  input?: OperationInput;
  dependsOn?: string[];
  requirementIds?: string[];
  risk?: PlannedOperation["risk"];
  maxAttempts?: number;
};

export type DirectMissionRequest = {
  missionId?: string;
  projectId?: string;
  objective: string;
  localPath?: string;
  uploadedFiles?: FactoryUploadedFile[];
  operations: DirectOperationRequest[];
};

export async function executeDirectMission(
  request: DirectMissionRequest,
  signal?: AbortSignal,
  onUpdate?: (mission: MissionRecord) => void | Promise<void>,
): Promise<MissionRecord> {
  validateRequest(request);
  const missionId = request.missionId || `mission-${randomUUID()}`;
  const projectId = request.projectId || request.localPath || `uploaded:${missionId}`;
  const access = request.localPath
    ? createServerProjectAccess(request.localPath, "local-folder", signal)
    : createUploadedProjectAccess(request.uploadedFiles ?? [], projectId);
  const services = createMissionCoreServices(access);
  const existing = await services.repository.get(missionId);
  if (existing) throw new Error(`Mission already exists: ${missionId}`);

  await services.coordinator.create({ id: missionId, projectId, objective: request.objective });
  await services.coordinator.understand(missionId);
  const now = new Date().toISOString();
  const operations = request.operations.map((operation, index): PlannedOperation => ({
    id: operation.id || `${missionId}:operation:${index + 1}`,
    missionId,
    kind: operation.kind,
    title: operation.title,
    target: operation.target,
    command: operation.command,
    input: operation.input,
    dependsOn: operation.dependsOn ?? [],
    requirementIds: operation.requirementIds ?? [],
    risk: operation.risk ?? defaultRisk(operation.kind),
    status: "pending",
    attempt: 0,
    maxAttempts: Math.max(1, Math.min(operation.maxAttempts ?? 1, 10)),
    createdAt: now,
    updatedAt: now,
  }));
  await services.coordinator.plan(missionId, operations);
  return services.coordinator.runUntilPause(missionId, { signal, onUpdate });
}

function validateRequest(request: DirectMissionRequest) {
  if (!request.objective?.trim()) throw new Error("A mission objective is required.");
  if (!Array.isArray(request.operations) || request.operations.length === 0) throw new Error("At least one typed operation is required.");
  if (!request.localPath && !request.uploadedFiles?.length) throw new Error("A local path or uploaded project files are required.");
  if (request.operations.length > 500) throw new Error("A direct mission may contain at most 500 operations.");
  const explicitIds = request.operations.map((operation) => operation.id).filter((id): id is string => Boolean(id));
  if (new Set(explicitIds).size !== explicitIds.length) throw new Error("Operation ids must be unique.");
}

function defaultRisk(kind: OperationKind): PlannedOperation["risk"] {
  if (kind === "read_file" || kind === "verify" || kind === "browser_action") return "safe";
  if (kind === "run_command" || kind === "start_process" || kind === "stop_process") return "development";
  if (kind === "delete_file") return "high_risk";
  return "modification";
}
