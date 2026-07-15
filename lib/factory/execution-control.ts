const globalExecutionState = globalThis as typeof globalThis & {
  __foundryActiveExecutions?: Map<string, AbortController>;
  __foundryExecutionSnapshots?: Map<string, ExecutionSnapshot>;
};
const activeExecutions = globalExecutionState.__foundryActiveExecutions ??= new Map<string, AbortController>();
const executionSnapshots = globalExecutionState.__foundryExecutionSnapshots ??= new Map<string, ExecutionSnapshot>();

export type ExecutionSnapshot = {
  state: "running" | "completed" | "failed" | "stopped";
  events: unknown[];
  result?: unknown;
  error?: string;
  updatedAt: string;
};

function idFor(controlId: string | undefined) {
  return controlId?.trim() || undefined;
}

export function registerExecution(controlId: string | undefined, controller: AbortController) {
  const id = idFor(controlId);
  if (!id) return () => undefined;
  activeExecutions.get(id)?.abort();
  activeExecutions.set(id, controller);
  executionSnapshots.set(id, { state: "running", events: [], updatedAt: new Date().toISOString() });
  return () => {
    if (activeExecutions.get(id) === controller) activeExecutions.delete(id);
  };
}

export function recordExecutionEvent(controlId: string | undefined, event: unknown) {
  const id = idFor(controlId);
  if (!id) return;
  const current = executionSnapshots.get(id) ?? { state: "running" as const, events: [], updatedAt: new Date().toISOString() };
  executionSnapshots.set(id, { ...current, events: [...current.events, event].slice(-1000), updatedAt: new Date().toISOString() });
}

export function completeExecution(controlId: string | undefined, result: unknown) {
  const id = idFor(controlId);
  if (!id) return;
  const current = executionSnapshots.get(id) ?? { state: "running" as const, events: [], updatedAt: new Date().toISOString() };
  executionSnapshots.set(id, { ...current, state: "completed", result, updatedAt: new Date().toISOString() });
}

export function failExecution(controlId: string | undefined, error: string) {
  const id = idFor(controlId);
  if (!id) return;
  const current = executionSnapshots.get(id) ?? { state: "running" as const, events: [], updatedAt: new Date().toISOString() };
  executionSnapshots.set(id, { ...current, state: "failed", error, updatedAt: new Date().toISOString() });
}

export function getExecutionSnapshot(controlId: string) {
  return executionSnapshots.get(controlId.trim());
}

export function stopExecution(controlId: string) {
  const id = controlId.trim();
  const controller = activeExecutions.get(id);
  if (!controller) return false;
  controller.abort();
  activeExecutions.delete(id);
  const current = executionSnapshots.get(id);
  if (current) executionSnapshots.set(id, { ...current, state: "stopped", updatedAt: new Date().toISOString() });
  return true;
}
