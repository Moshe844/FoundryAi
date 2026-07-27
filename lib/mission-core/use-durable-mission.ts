"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DurableMissionClient, shouldApplyDurableMission } from "./browser-client";
import type { ApprovalScope, MissionRecord } from "./model";

export function useDurableMission(missionId?: string) {
  const client = useMemo(() => new DurableMissionClient(), []);
  const [mission, setMission] = useState<MissionRecord>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(Boolean(missionId));

  useEffect(() => {
    if (!missionId) {
      setMission(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const apply = (incoming: MissionRecord) => {
      setMission((current) => shouldApplyDurableMission(current, incoming) ? incoming : current);
      setError(undefined);
      setLoading(false);
    };
    void client.get(missionId, controller.signal).then(apply).catch((reason) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    });
    const unsubscribe = client.subscribe(missionId, apply, {
      signal: controller.signal,
      onError: (reason) => setError(reason.message),
    });
    return () => {
      unsubscribe();
      controller.abort();
    };
  }, [client, missionId]);

  const decideApproval = useCallback(async (approvalId: string, decision: "approve" | "deny", scope: ApprovalScope = "once") => {
    if (!missionId) throw new Error("No durable mission is active.");
    const updated = await client.decideApproval({ missionId, approvalId, decision, scope });
    setMission((current) => shouldApplyDurableMission(current, updated) ? updated : current);
    return updated;
  }, [client, missionId]);

  return { mission, loading, error, decideApproval };
}
