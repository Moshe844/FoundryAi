"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DurableMissionClient } from "@/lib/mission-core/browser-client";
import type { MissionRecord } from "@/lib/mission-core/model";
import {
  applyAuthoritativeMission,
  bindWorkspaceMission,
  durableMissionForWorkspace,
  durableWorkspaceStorageKey,
  emptyDurableWorkspaceSnapshot,
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
  missionForWorkspace(workspaceMissionId: string): MissionRecord | undefined;
  refresh(durableMissionId: string): Promise<MissionRecord>;
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
    missionForWorkspace: (workspaceMissionId) => durableMissionForWorkspace(snapshot, workspaceMissionId),
    refresh: async (durableMissionId) => {
      const mission = await clientRef.current.get(durableMissionId);
      setSnapshot((current) => applyAuthoritativeMission(current, mission));
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
