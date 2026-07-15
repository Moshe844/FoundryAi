import type { FactoryCommandEvent, FactoryObjectiveChecklistItem } from "./types";

/**
 * Settle only command-shaped checklist work from facts owned by the runtime. A successful test is
 * never allowed to complete an unrelated implementation item, and an explicit preservation claim
 * must still be true of the actual write set.
 */
export function reconcileBlockedCommandChecklist(
  checklist: FactoryObjectiveChecklistItem[],
  commands: FactoryCommandEvent[],
  changedFiles: string[],
) {
  for (const item of checklist) {
    if (item.status !== "blocked") continue;
    const command = successfulCommandForChecklistItem(item.label, commands);
    if (!command || !preservationClaimsHold(item.label, changedFiles)) continue;
    item.status = "completed";
    item.evidence = `${command.command} exited with code 0${preservationEvidence(item.label, changedFiles)}.`;
  }
}

function successfulCommandForChecklistItem(label: string, commands: FactoryCommandEvent[]) {
  const normalized = label.toLowerCase();
  const expectsCommand = /\b(?:run|execute|verify|test|build|lint|type\s*check|typecheck|check)\b/.test(normalized);
  if (!expectsCommand) return undefined;
  const expectedKinds = [
    /\btype\s*check|\btypecheck/.test(normalized) ? /\btypecheck\b|\btsc\b/i : null,
    /\blint/.test(normalized) ? /\blint\b/i : null,
    /\btest/.test(normalized) ? /\btest\b/i : null,
    /\bbuild/.test(normalized) ? /\bbuild\b/i : null,
  ].filter((pattern): pattern is RegExp => Boolean(pattern));
  return commands.find((command) => command.exitCode === 0 && (expectedKinds.length === 0 || expectedKinds.some((pattern) => pattern.test(command.command))));
}

function preservationClaimsHold(label: string, changedFiles: string[]) {
  if (!hasPreservationClaim(label)) return true;
  const namedFiles = namedFileClaims(label);
  if (!namedFiles.length) return false;
  const changedNames = new Set(changedFiles.map(fileName));
  return namedFiles.every((file) => !changedNames.has(file.toLowerCase()));
}

function preservationEvidence(label: string, changedFiles: string[]) {
  if (!hasPreservationClaim(label)) return "";
  const changedNames = new Set(changedFiles.map(fileName));
  const preserved = namedFileClaims(label).filter((file) => !changedNames.has(file.toLowerCase()));
  return preserved.length ? `; ${preserved.join(", ")} remained unchanged` : "";
}

function hasPreservationClaim(label: string) {
  return /\b(?:keep|leave|preserve|remain|unchanged|without (?:changing|editing|modifying|touching)|do not (?:change|edit|modify|touch))\b/i.test(label);
}

function namedFileClaims(label: string) {
  return Array.from(label.matchAll(/\b[\w.-]+\.[a-z0-9]+\b/gi), (match) => match[0]);
}

function fileName(file: string) {
  return file.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase() ?? "";
}
