"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_MISSION_QUALITY, type MissionQualityLevel } from "@/lib/ai/mission/quality-level";

const MISSION_QUALITY_STORAGE_KEY = "foundry.missionQuality";

/** Plain (non-hook) reader for call sites that just need the current value once — e.g. building a
 * request body at send-time — without needing to subscribe to changes. Avoids the cross-component
 * stale-read problem a React hook would have if the setter and the fetch call live in different
 * component trees (composer vs. WorkspaceShell), since both just read the same localStorage key fresh. */
export function readStoredMissionQuality(): MissionQualityLevel {
  try {
    const stored = window.localStorage.getItem(MISSION_QUALITY_STORAGE_KEY);
    if (stored === "quick" || stored === "standard" || stored === "thorough" || stored === "production") return stored;
  } catch {
    // localStorage unavailable — fall back to the default below.
  }
  return DEFAULT_MISSION_QUALITY;
}

/** Independent of and complementary to useModelMode() (lib/ai/model-mode.ts) — this picks workflow depth (planning/review/verification), not which model handles any given call. Same localStorage try/catch pattern. */
export function useMissionQuality(): { quality: MissionQualityLevel; setQuality: (quality: MissionQualityLevel) => void } {
  const [quality, setQualityState] = useState<MissionQualityLevel>(DEFAULT_MISSION_QUALITY);

  useEffect(() => {
    setQualityState(readStoredMissionQuality());
  }, []);

  const setQuality = useCallback((next: MissionQualityLevel) => {
    setQualityState(next);
    try {
      window.localStorage.setItem(MISSION_QUALITY_STORAGE_KEY, next);
    } catch {
      // Best-effort persistence only.
    }
  }, []);

  return { quality, setQuality };
}
