import { CapabilityRegistry } from "@/lib/ai/routing/capability-registry";

let registry = new CapabilityRegistry([]);
let refreshedAt = 0;

export function getLiveRegistry() { return registry; }
export function setLiveRegistry(next: CapabilityRegistry) { registry = next; refreshedAt = Date.now(); }
export function liveRegistryRefreshedAt() { return refreshedAt; }
export function liveRegistrySnapshot() { return { refreshedAt: refreshedAt ? new Date(refreshedAt).toISOString() : undefined, models: registry.list() }; }
