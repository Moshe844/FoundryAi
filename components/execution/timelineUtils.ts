import type { FactoryExecutionEvent } from "@/lib/factory/types";

/**
 * Small shared helpers used by both ExecutionTimeline.tsx and ApprovalPrompt.tsx — kept dependency-free
 * (no imports from either) so those two files can import from here without a circular import, since
 * ExecutionTimeline renders blocked events via ApprovalPrompt's BlockedCommandLine.
 */
export type ExecutionLevel = "summary" | "details" | "code" | "command";

export type BlockedCommandAction = "approve-once" | "approve-category" | "approve-command" | "skip";

export function executionTier(event: FactoryExecutionEvent) {
  return event.tier ?? "trace";
}

export function isNarrativeEvent(event: FactoryExecutionEvent) {
  const tier = executionTier(event);
  return tier === "finding" || tier === "decision" || tier === "flag";
}

export function eventVisibleAtLevel(event: FactoryExecutionEvent, level: ExecutionLevel) {
  if (level === "details") return true;
  if (level === "summary") return isNarrativeEvent(event) || event.kind === "summary" || event.kind === "build" || event.kind === "preview" || event.kind === "blocked" || event.kind === "planning";
  if (level === "code") return event.kind === "edit" || event.kind === "file";
  if (level === "command") return event.kind === "command" || event.kind === "build" || event.kind === "blocked";
  return true;
}

export function formatClockTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function compactChangeText(event: FactoryExecutionEvent) {
  const linesAdded = event.details?.linesAdded;
  if (typeof linesAdded === "number" && linesAdded > 0) return `+${linesAdded}`;
  const changed = typeof event.details?.changed === "string" ? event.details.changed : "";
  const delta = changed.match(/(-?\d+)\s+line delta/i)?.[1];
  if (delta) {
    const value = Number(delta);
    if (Number.isFinite(value) && value !== 0) return value > 0 ? `+${value}` : String(value);
  }
  return "";
}

export function humanizeKey(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}
