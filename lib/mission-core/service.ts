import path from "node:path";
import type { ProjectAccess } from "@/lib/ai/mission/project-access";
import { MissionCoordinator } from "./coordinator";
import { FileMissionRepository } from "./file-repository";
import { FilePermissionGrantStore } from "./file-permission-store";
import { PermissionCoordinator } from "./permission-coordinator";
import { ProjectOperationExecutor } from "./project-operation-executor";
import { ExecutionScheduler } from "./scheduler";

export type MissionCoreServices = {
  coordinator: MissionCoordinator;
  repository: FileMissionRepository;
  permissions: PermissionCoordinator;
  scheduler: ExecutionScheduler;
  executor: ProjectOperationExecutor;
};

export function createMissionCoreServices(access: ProjectAccess, rootDirectory = process.cwd()): MissionCoreServices {
  const dataRoot = path.join(rootDirectory, ".foundry-data");
  const repository = new FileMissionRepository(path.join(dataRoot, "missions-v2"));
  const permissions = new PermissionCoordinator(new FilePermissionGrantStore(path.join(dataRoot, "permission-grants-v2.json")));
  const executor = new ProjectOperationExecutor(access);
  const scheduler = new ExecutionScheduler(executor, permissions);
  const coordinator = new MissionCoordinator(repository, scheduler, permissions);
  return { coordinator, repository, permissions, scheduler, executor };
}
