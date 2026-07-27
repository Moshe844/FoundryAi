import path from "node:path";
import { FileMissionRepository } from "./file-repository";
import { FilePermissionGrantStore } from "./file-permission-store";
import { PermissionCoordinator } from "./permission-coordinator";

const dataRoot = path.join(process.cwd(), ".foundry-data");

export const durableMissionRepository = new FileMissionRepository(path.join(dataRoot, "missions-v2"));
export const durablePermissionStore = new FilePermissionGrantStore(path.join(dataRoot, "permission-grants-v2.json"));
export const durablePermissionCoordinator = new PermissionCoordinator(durablePermissionStore);
