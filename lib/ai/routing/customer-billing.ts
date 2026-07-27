import type { ExecutionMission } from "@/lib/mission/model";

/**
 * Provider usage remains visible for operational transparency. An incomplete
 * mission is not a Foundry-billable deliverable, so Foundry records no customer
 * charge for it. A separately owned provider account may still bill its API key.
 */
export function customerChargeForMission(
  state: ExecutionMission["state"],
  providerUsageUsd: number,
): number {
  if (state !== "complete") return 0;
  return Math.max(0, providerUsageUsd);
}
