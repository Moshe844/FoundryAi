const WHOLE_PROJECT_PATTERNS = [
  /\b(?:delete|remove|erase|wipe)\s+(?:this|the|current|entire|whole)\s+(?:project|workspace)(?:\s+(?:folder|directory))?\b(?=\s*(?:[?.!]|$)|\s+(?:please|now|and|including)\b)/i,
  /\b(?:delete|remove|erase|wipe)\b[\s\S]{0,80}\b(?:entire|whole|all|everything\s+in\s+(?:this|the|current))\b[\s\S]{0,40}\b(?:project|workspace|project files?|project contents?)\b/i,
  /\b(?:delete|remove|erase|wipe)\s+(?:project|workspace)\b(?=\s*(?:[?.!]|$)|\s+(?:please|now|and|including)\b)/i,
];

/** Deterministic safety routing for an explicit request to remove the connected project itself. */
export function isWholeProjectDeletionRequest(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  return WHOLE_PROJECT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Opaque exact-action identity carried from the prompt into the approval continuation. */
export function projectDeletionApprovalCommand(projectPath: string) {
  return `foundry:delete-project-root:${projectPath}`;
}

export function projectDeletionLockApprovalCommand(projectPath: string, processIds: number[]) {
  const ids = [...new Set(processIds.filter((pid) => Number.isInteger(pid) && pid > 0))].sort((left, right) => left - right);
  return `foundry:stop-project-locks-and-delete:${ids.join(",")}:${projectPath}`;
}

export function parseProjectDeletionLockApprovalCommand(command: string, projectPath: string) {
  const prefix = "foundry:stop-project-locks-and-delete:";
  if (!command.startsWith(prefix)) return undefined;
  const remainder = command.slice(prefix.length);
  const separator = remainder.indexOf(":");
  if (separator < 1 || remainder.slice(separator + 1) !== projectPath) return undefined;
  const processIds = remainder.slice(0, separator).split(",").map(Number);
  if (!processIds.length || processIds.some((pid) => !Number.isInteger(pid) || pid <= 0)) return undefined;
  return [...new Set(processIds)].sort((left, right) => left - right);
}
