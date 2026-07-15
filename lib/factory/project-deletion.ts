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
