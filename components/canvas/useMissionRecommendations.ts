"use client";

import { useEffect, useRef, useState } from "react";
import type { MissionRecommendation } from "@/lib/ai/mission/recommendations";
import type { FactoryProjectResult } from "@/lib/factory/types";
import type { ModelMode, TierResolution } from "@/lib/ai/model-router";

/**
 * Real post-mission suggestions from /api/factory/recommendations. Relocated verbatim
 * from components/BuildDashboard.tsx with the Mission Canvas rebuild — the canvas is now
 * its only consumer. Zero rows is a valid, common result (spec §10): nothing renders
 * until the model has actually proposed something concrete.
 */
export function useMissionRecommendations(
  execution: FactoryProjectResult | null,
  projectBrief: string,
  dedupeKey: string,
  mode: ModelMode,
): { recommendations: MissionRecommendation[]; loading: boolean; modelSelection: (TierResolution & { autoSelected: boolean; reason?: string }) | null } {
  const [recommendations, setRecommendations] = useState<MissionRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [modelSelection, setModelSelection] = useState<(TierResolution & { autoSelected: boolean; reason?: string }) | null>(null);
  const fetchedForRef = useRef<string>("");

  useEffect(() => {
    // dedupeKey resets to "" the instant a new turn starts. Clear immediately rather than
    // leaving the previous turn's suggestions on screen until a future refetch overwrites them.
    if (!execution || !dedupeKey) {
      fetchedForRef.current = "";
      setRecommendations([]);
      return;
    }
    if (fetchedForRef.current === dedupeKey) return;
    fetchedForRef.current = dedupeKey;

    const changedFiles = execution.files.filter((file) => file.status === "created" || file.status === "edited").map((file) => file.path);
    setRecommendations([]);
    setLoading(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    fetch("/api/factory/recommendations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        mode,
        context: {
          brief: projectBrief,
          objective: execution.objective || "",
          stack: execution.stack,
          changedFiles,
          checklistLabels: (execution.checklist ?? []).map((item) => item.label),
        },
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data?.ok && Array.isArray(data.recommendations) && data.recommendations.length) {
          setRecommendations(data.recommendations);
        }
        if (data?.modelSelection) setModelSelection(data.modelSelection);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => clearTimeout(timeout);
    // mode is intentionally excluded — a mode flip alone should not refetch finished suggestions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execution, projectBrief, dedupeKey]);

  return { recommendations, loading, modelSelection };
}
