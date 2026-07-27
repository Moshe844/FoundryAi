import { CapabilityRegistry } from "@/lib/ai/routing/capability-registry";

// Next.js may bundle API routes into separate module graphs. Module-local state therefore made the
// model catalogue visible to implementation routing but empty in the planner/resume route running
// in the same server process. Keep one process-wide registry so every route sees the same validated
// candidates and a successful build cannot become "no validated model" on resume.
type RegistryState = { registry: CapabilityRegistry; refreshedAt: number };
const registryStateKey = Symbol.for("foundry.ai.live-model-registry");
const processGlobal = globalThis as typeof globalThis & { [registryStateKey]?: RegistryState };
const state = processGlobal[registryStateKey] ??= { registry: new CapabilityRegistry(), refreshedAt: 0 };

export function getLiveRegistry() { return state.registry; }
export function setLiveRegistry(next: CapabilityRegistry) { state.registry = next; state.refreshedAt = Date.now(); }
export function liveRegistryRefreshedAt() { return state.refreshedAt; }
export function liveRegistrySnapshot() { return { refreshedAt: state.refreshedAt ? new Date(state.refreshedAt).toISOString() : undefined, models: state.registry.list() }; }
