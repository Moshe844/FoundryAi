"use client";

import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import { missionReducer, type ExecutionMission, type MissionAction, type MissionsState, type MissionThread } from "@/lib/mission/reducer";

type MissionContextValue = {
  state: MissionsState;
  dispatch: (action: MissionAction) => void;
};

const MissionContext = createContext<MissionContextValue | null>(null);

export function MissionProvider({ children, initialState }: { children: ReactNode; initialState?: MissionsState }) {
  const [state, dispatch] = useReducer(missionReducer, initialState ?? {});
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

function useMissionContext(): MissionContextValue {
  const context = useContext(MissionContext);
  if (!context) throw new Error("useMission hooks must be used within a MissionProvider");
  return context;
}

export function useMissionDispatch(): (action: MissionAction) => void {
  return useMissionContext().dispatch;
}

export function useMissionThread(threadId: string): MissionThread {
  const { state } = useMissionContext();
  return state[threadId] ?? { executionMissions: [], activeExecutionMissionId: undefined };
}

export function useMission(threadId: string, missionId: string | undefined): ExecutionMission | undefined {
  const thread = useMissionThread(threadId);
  return useMemo(() => thread.executionMissions.find((mission) => mission.id === missionId), [thread, missionId]);
}

export function useActiveMission(threadId: string): ExecutionMission | undefined {
  const thread = useMissionThread(threadId);
  return useMemo(
    () => thread.executionMissions.find((mission) => mission.id === thread.activeExecutionMissionId) ?? thread.executionMissions.at(-1),
    [thread]
  );
}

export function useMissionHistory(threadId: string): ExecutionMission[] {
  const active = useActiveMission(threadId);
  const thread = useMissionThread(threadId);
  return useMemo(() => thread.executionMissions.filter((mission) => mission.id !== active?.id), [thread, active]);
}

/** Convenience for orchestration code that dispatches many actions for the same thread/mission pair. */
export function useMissionActions(threadId: string) {
  const dispatch = useMissionDispatch();
  return useMemo(
    () => ({
      created: (mission: ExecutionMission) => dispatch({ type: "MISSION_CREATED", threadId, mission }),
      statusSet: (missionId: string, status: ExecutionMission["state"], error?: string) =>
        dispatch({ type: "MISSION_STATUS_SET", threadId, missionId, status, error }),
      cancelled: (missionId: string) => dispatch({ type: "MISSION_CANCELLED", threadId, missionId }),
      suggestionsCleared: (missionId: string) => dispatch({ type: "SUGGESTIONS_CLEARED", threadId, missionId }),
      activeMissionSet: (missionId: string) => dispatch({ type: "ACTIVE_MISSION_SET", threadId, missionId }),
      hydrate: (thread: MissionThread) => dispatch({ type: "HYDRATE_THREAD", threadId, thread }),
    }),
    [dispatch, threadId]
  );
}
