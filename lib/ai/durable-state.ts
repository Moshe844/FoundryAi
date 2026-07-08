import type { ReasoningRequest } from "@/lib/ai/context";
import type { MissionState } from "@/lib/mission-engine";

export type DurableWorkState = MissionState["workMemory"] & {
  stateVersion: 2;
  pendingQuestions: string[];
  whatChangedThisTurn: string[];
};

export function buildDurableWorkState(request: ReasoningRequest, previous?: MissionState["workMemory"]): DurableWorkState {
  const state = request.engineeringState;
  const prior = previous ?? request.workMemory;
  const latestEvidence = [
    ...state.evidenceNewThisTurn.map((item) => `${item.fileName} (${item.evidenceKind}, ${item.status})`),
    ...(prior?.latestEvidence ?? []),
  ];

  return {
    stateVersion: 2,
    currentGoal: firstUseful(state.currentGoal, prior?.currentGoal, request.conversationContext.workflowState.goal, request.userMessage),
    currentBlocker: firstUseful(state.currentBlocker, prior?.currentBlocker),
    completedWork: mergeStableItems(prior?.completedWork ?? [], state.completedWork),
    resolvedErrors: mergeStableItems(prior?.resolvedErrors ?? [], state.resolvedThisTurn),
    rejectedHypotheses: mergeStableItems(prior?.rejectedHypotheses ?? [], state.rejectedHypotheses),
    latestEvidence: mergeStableItems(latestEvidence, []).slice(0, 12),
    relevantFiles: mergeStableItems(prior?.relevantFiles ?? [], state.evidenceReviewed.map((item) => item.fileName)).slice(0, 16),
    recommendedNextAction: firstUseful(state.recommendedNextAction, prior?.recommendedNextAction),
    pendingQuestions: mergeStableItems(state.pendingQuestions, []),
    whatChangedThisTurn: mergeStableItems(state.whatChangedThisTurn, []),
    summary: summarizeDurableState({
      goal: firstUseful(state.currentGoal, prior?.currentGoal, request.userMessage),
      blocker: firstUseful(state.currentBlocker, prior?.currentBlocker),
      completed: mergeStableItems(prior?.completedWork ?? [], state.completedWork),
      resolved: mergeStableItems(prior?.resolvedErrors ?? [], state.resolvedThisTurn),
      rejected: mergeStableItems(prior?.rejectedHypotheses ?? [], state.rejectedHypotheses),
      evidence: mergeStableItems(latestEvidence, []),
      next: firstUseful(state.recommendedNextAction, prior?.recommendedNextAction),
    }),
    updatedAt: new Date().toISOString(),
  };
}

export function formatDurableWorkState(state: DurableWorkState) {
  return [
    "Durable work state v2:",
    `- Current goal: ${state.currentGoal || "Not established."}`,
    `- Current blocker: ${state.currentBlocker || "None proven."}`,
    `- Recommended next action: ${state.recommendedNextAction || "Answer the current request."}`,
    "Completed work:",
    formatList(state.completedWork, "None confirmed."),
    "Resolved issues:",
    formatList(state.resolvedErrors, "None."),
    "Rejected hypotheses:",
    formatList(state.rejectedHypotheses, "None."),
    "Latest evidence:",
    formatList(state.latestEvidence, "None."),
    "Pending questions:",
    formatList(state.pendingQuestions, "None."),
    "What changed this turn:",
    formatList(state.whatChangedThisTurn, "No explicit change detected."),
  ].join("\n");
}

function summarizeDurableState(input: {
  goal: string;
  blocker: string;
  completed: string[];
  resolved: string[];
  rejected: string[];
  evidence: string[];
  next: string;
}) {
  return [
    `Goal: ${input.goal || "Not set"}`,
    `Current blocker: ${input.blocker || "None proven"}`,
    `Completed: ${input.completed.slice(-4).join(" | ") || "None confirmed"}`,
    `Resolved: ${input.resolved.slice(-4).join(" | ") || "None"}`,
    `Rejected: ${input.rejected.slice(-3).join(" | ") || "None"}`,
    `Latest evidence: ${input.evidence.slice(0, 6).join(" | ") || "None"}`,
    `Next action: ${input.next || "Answer the current request"}`,
  ].join("\n");
}

function firstUseful(...values: Array<string | undefined>) {
  return values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").find(Boolean) ?? "";
}

function mergeStableItems(primary: string[], secondary: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  [...primary, ...secondary]
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .forEach((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });

  return result;
}

function formatList(items: string[], empty: string) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}
