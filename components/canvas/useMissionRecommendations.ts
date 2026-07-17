"use client";

import type { MissionRecommendation } from "@/lib/ai/mission/recommendations";
import type { FactoryProjectResult } from "@/lib/factory/types";
import type { ModelMode, TierResolution } from "@/lib/ai/model-router";

/** Passive post-mission rendering must not spend model budget. Suggestions can be restored
 * behind an explicit user action; until then, an empty list is the truthful zero-cost state. */
export function useMissionRecommendations(
  _execution: FactoryProjectResult | null,
  _projectBrief: string,
  _dedupeKey: string,
  _mode: ModelMode,
): { recommendations: MissionRecommendation[]; loading: boolean; modelSelection: (TierResolution & { autoSelected: boolean; reason?: string }) | null } {
  void [_execution, _projectBrief, _dedupeKey, _mode];
  return { recommendations: [], loading: false, modelSelection: null };
}
