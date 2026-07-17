const globalExecutionState = globalThis as typeof globalThis & {
  __foundryActiveExecutions?: Map<string, AbortController>;
  __foundryExecutionSnapshots?: Map<string, ExecutionSnapshot>;
  __foundryExecutionScopes?: Map<string, string>;
};
const activeExecutions = globalExecutionState.__foundryActiveExecutions ??= new Map<string, AbortController>();
const executionSnapshots = globalExecutionState.__foundryExecutionSnapshots ??= new Map<string, ExecutionSnapshot>();
const executionScopes = globalExecutionState.__foundryExecutionScopes ??= new Map<string, string>();

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

function scopeFor(id: string) {
  const separator = id.lastIndexOf(":");
  return separator > 0 ? id.slice(0, separator) : id;
}

export function registerExecution(controlId: string | undefined, controller: AbortController) {
  const id = idFor(controlId);
  if (!id) return () => undefined;
  const scope = scopeFor(id);
  const previousId = executionScopes.get(scope);
  if (previousId && previousId !== id) {
    activeExecutions.get(previousId)?.abort();
    activeExecutions.delete(previousId);
    const previous = executionSnapshots.get(previousId);
    if (previous?.state === "running") {
      executionSnapshots.set(previousId, {
        ...previous,
        state: "stopped",
        error: "Superseded by a newer execution for the same mission.",
        updatedAt: new Date().toISOString(),
      });
    }
  }
  activeExecutions.get(id)?.abort();
  activeExecutions.set(id, controller);
  executionScopes.set(scope, id);
  executionSnapshots.set(id, { state: "running", events: [], updatedAt: new Date().toISOString() });
  return () => {
    if (activeExecutions.get(id) === controller) activeExecutions.delete(id);
    if (executionScopes.get(scope) === id) executionScopes.delete(scope);
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
  const scope = scopeFor(id);
  if (executionScopes.get(scope) === id) executionScopes.delete(scope);
  const current = executionSnapshots.get(id);
  if (current) executionSnapshots.set(id, { ...current, state: "stopped", updatedAt: new Date().toISOString() });
  return true;
}

export function listActiveExecutionIds() {
  return Array.from(activeExecutions.keys());
}
