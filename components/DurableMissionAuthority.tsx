"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DurableMissionClient } from "@/lib/mission-core/browser-client";
import type { ApprovalScope, MissionRecord } from "@/lib/mission-core/model";
import { latestDurableMission } from "@/lib/mission-core/browser-projection";
import {
  applyAuthoritativeMission,
  bindWorkspaceMission,
  discoverDurableBindingsFromWorkspace,
  durableMissionForWorkspace,
  durableWorkspaceStorageKey,
  emptyDurableWorkspaceSnapshot,
  legacyWorkspaceStorageKey,
  normalizeDurableWorkspaceSnapshot,
  type DurableWorkspaceSnapshot,
} from "@/lib/mission-core/workspace-authority";

export const durableMissionEventName = "foundry:durable-mission";
export const durableMissionBindingEventName = "foundry:durable-mission-binding";

export type DurableMissionBindingEvent = {
  workspaceMissionId: string;
  mission: MissionRecord;
};

export type DurableMissionAuthorityValue = {
  snapshot: DurableWorkspaceSnapshot;
  latestMission?: MissionRecord;
  missionForWorkspace(workspaceMissionId: string): MissionRecord | undefined;
  refresh(durableMissionId: string): Promise<MissionRecord>;
  decideApproval(input: {
    missionId: string;
    approvalId: string;
    decision: "approve" | "deny";
    scope?: ApprovalScope;
  }): Promise<MissionRecord>;
};

const DurableMissionAuthorityContext = createContext<DurableMissionAuthorityValue | undefined>(undefined);

export function DurableMissionAuthority({ children }: { children: ReactNode }) {
  const clientRef = useRef(new DurableMissionClient());
  const subscriptionsRef = useRef(new Map<string, () => void>());
  const [snapshot, setSnapshot] = useState<DurableWorkspaceSnapshot>(() => emptyDurableWorkspaceSnapshot());

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(durableWorkspaceStorageKey);
      if (stored) setSnapshot(normalizeDurableWorkspaceSnapshot(JSON.parse(stored)));
    } catch {
      // Start with an empty authority store when browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const handleBinding = (event: Event) => {
      const detail = (event as CustomEvent<DurableMissionBindingEvent>).detail;
      if (!detail?.workspaceMissionId || !detail.mission) return;
      setSnapshot((current) => bindWorkspaceMission(current, detail.workspaceMissionId, detail.mission));
    };
    window.addEventListener(durableMissionBindingEventName, handleBinding);
    return () => window.removeEventListener(durableMissionBindingEventName, handleBinding);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const discover = async () => {
      try {
        const stored = window.localStorage.getItem(legacyWorkspaceStorageKey);
        if (!stored) return;
        const bindings = discoverDurableBindingsFromWorkspace(JSON.parse(stored));
        for (const binding of bindings) {
          if (cancelled) return;
          const existing = snapshot.bindings[binding.workspaceMissionId];
          if (existing?.durableMissionId === binding.durableMissionId && existing.revision >= binding.revision) continue;
          try {
            const mission = await clientRef.current.get(binding.durableMissionId);
            if (!cancelled) setSnapshot((current) => bindWorkspaceMission(current, binding.workspaceMissionId, mission));
          } catch {
            // The mission may still be committing; the next discovery pass retries without changing UI state.
          }
        }
      } catch {
        // Ignore malformed legacy browser state. Durable bindings already stored remain active.
      }
    };
    void discover();
    const timer = window.setInterval(() => void discover(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [snapshot.bindings]);

  useEffect(() => {
    try {
      window.localStorage.setItem(durableWorkspaceStorageKey, JSON.stringify(snapshot));
    } catch {
      // The in-memory server projection remains authoritative for this browser session.
    }

    for (const binding of Object.values(snapshot.bindings)) {
      if (subscriptionsRef.current.has(binding.durableMissionId)) continue;
      const stop = clientRef.current.subscribe(binding.durableMissionId, (mission) => {
        setSnapshot((current) => applyAuthoritativeMission(current, mission));
        window.dispatchEvent(new CustomEvent(durableMissionEventName, { detail: mission }));
      });
      subscriptionsRef.current.set(binding.durableMissionId, stop);
    }
  }, [snapshot.bindings]);

  useEffect(() => () => {
    for (const stop of subscriptionsRef.current.values()) stop();
    subscriptionsRef.current.clear();
  }, []);

  const value = useMemo<DurableMissionAuthorityValue>(() => ({
    snapshot,
    latestMission: latestDurableMission(snapshot.missions),
    missionForWorkspace: (workspaceMissionId) => durableMissionForWorkspace(snapshot, workspaceMissionId),
    refresh: async (durableMissionId) => {
      const mission = await clientRef.current.get(durableMissionId);
      setSnapshot((current) => applyAuthoritativeMission(current, mission));
      return mission;
    },
    decideApproval: async (input) => {
      const mission = await clientRef.current.decideApproval(input);
      setSnapshot((current) => applyAuthoritativeMission(current, mission));
      window.dispatchEvent(new CustomEvent(durableMissionEventName, { detail: mission }));
      return mission;
    },
  }), [snapshot]);

  return <DurableMissionAuthorityContext.Provider value={value}>{children}</DurableMissionAuthorityContext.Provider>;
}

export function useDurableMissionAuthority() {
  const value = useContext(DurableMissionAuthorityContext);
  if (!value) throw new Error("useDurableMissionAuthority must be used inside DurableMissionAuthority.");
  return value;
}
