import type { ConversationContext, InvestigationContext } from "@/lib/ai/context";
import { hasSuccessfulProgressUpdate } from "@/lib/ai/intent-resolution";
import type { TroubleshootingEvidenceSnapshot, TroubleshootingIssue } from "@/lib/ai/troubleshooting";
import type { OutcomeType } from "@/lib/mission-engine";

export type EngineeringEvidenceRecord = {
  fileId: string;
  fileName: string;
  evidenceKind: string;
  fileType: string;
  status: string;
  role: "new this turn" | "previously reviewed";
  relation: "new" | "unchanged" | "resolved" | "superseded";
  messageId: string;
  createdAt: string;
};

export type EngineeringState = {
  project: string;
  currentGoal: string;
  currentObjective: string;
  currentBlocker: string;
  completedWork: string[];
  evidenceReviewed: EngineeringEvidenceRecord[];
  evidenceNewThisTurn: EngineeringEvidenceRecord[];
  evidencePreviouslyReviewed: EngineeringEvidenceRecord[];
  currentHypothesis: string;
  rejectedHypotheses: string[];
  pendingQuestions: string[];
  recommendedNextAction: string;
  whatChangedThisTurn: string[];
  resolvedThisTurn: string[];
  stillActive: string[];
  responseFocus: string;
  evidenceDiscipline: string;
};

export function buildEngineeringState(input: {
  missionTitle: string;
  desiredOutcome: OutcomeType;
  userMessage: string;
  investigation: InvestigationContext;
  troubleshooting: TroubleshootingEvidenceSnapshot;
  conversationContext: ConversationContext;
}): EngineeringState {
  const workflow = input.conversationContext.workflowState;
  const investigationState = input.conversationContext.investigationState;
  const successfulProgressUpdate = hasSuccessfulProgressUpdate(input.userMessage);
  const evidenceReviewed = input.investigation.evidenceReviewed.map((item): EngineeringEvidenceRecord => ({
    fileId: item.fileId,
    fileName: item.fileName,
    evidenceKind: item.evidenceKind,
    fileType: item.fileType,
    status: item.status,
    role: item.role === "new" ? "new this turn" : "previously reviewed",
    relation: item.role === "new" ? "new" : item.relation === "superseded" || item.relation === "replaced" ? "superseded" : "unchanged",
    messageId: item.messageId,
    createdAt: item.createdAt,
  }));
  const evidenceNewThisTurn = evidenceReviewed.filter((item) => item.role === "new this turn");
  const evidencePreviouslyReviewed = evidenceReviewed.filter((item) => item.role === "previously reviewed");
  const currentBlocker = chooseCurrentBlocker(input.troubleshooting, workflow.blockedStep, investigationState.currentDiagnosis);
  const resolvedThisTurn = successfulProgressUpdate
    ? uniquePlain([
        input.troubleshooting.resolvedIssues.length || input.troubleshooting.oldIssueStatus === "resolved-or-replaced"
          ? "Prior blocker marked resolved by the user's latest success update."
          : "",
        ...investigationState.rejectedFindings,
      ])
    : uniquePlain([
        ...input.troubleshooting.resolvedIssues.map(issueSummary),
        ...investigationState.rejectedFindings,
      ]);
  const stillActive = uniquePlain([
    ...(input.troubleshooting.currentBlocker ? [issueSummary(input.troubleshooting.currentBlocker)] : []),
    ...input.troubleshooting.persistentIssues.map(issueSummary),
    ...(workflow.blockedStep ? [workflow.blockedStep] : []),
  ]);
  const whatChangedThisTurn = describeTurnDelta(input.troubleshooting, evidenceNewThisTurn.length, input.conversationContext.currentRequest.hasNewEvidence);
  const completedWork = uniquePlain([
    ...workflow.completedSteps,
    ...workflow.alreadyVerified,
    ...(successfulProgressUpdate ? [`Completed/verified this turn: ${input.userMessage}`] : []),
    ...resolvedThisTurn.map((item) => `Resolved: ${item}`),
  ]).slice(0, 10);
  const pendingQuestions = uniquePlain([
    ...investigationState.pendingQuestions,
    ...(currentBlocker === "No exact current blocker is proven by the available evidence." ? ["Need the newest exact error/log/config section that proves the blocker."] : []),
  ]).slice(0, 8);
  const currentHypothesis = chooseCurrentHypothesis(input.troubleshooting, investigationState.currentDiagnosis, currentBlocker);
  const recommendedNextAction = chooseNextAction(input.troubleshooting, workflow.nextStep, investigationState.recommendedNextStep, currentBlocker, successfulProgressUpdate);

  return {
    project: input.conversationContext.currentWorkItem.title || input.missionTitle,
    currentGoal: workflow.goal || input.conversationContext.currentWorkItem.objective || input.userMessage,
    currentObjective: input.conversationContext.currentWorkItem.objective || input.userMessage,
    currentBlocker,
    completedWork,
    evidenceReviewed,
    evidenceNewThisTurn,
    evidencePreviouslyReviewed,
    currentHypothesis,
    rejectedHypotheses: resolvedThisTurn.slice(0, 8),
    pendingQuestions,
    recommendedNextAction,
    whatChangedThisTurn,
    resolvedThisTurn,
    stillActive: uniquePlain(stillActive).slice(0, 8),
    responseFocus: responseFocusFor(input.troubleshooting, input.conversationContext.currentRequest.hasNewEvidence, input.desiredOutcome, successfulProgressUpdate),
    evidenceDiscipline:
      "Use the latest evidence as the source of truth. Discuss prior issues only when they remain active, were resolved, or explain the next action. Do not repeat old fixes that the newest evidence no longer supports.",
  };
}

export function formatEngineeringState(state: EngineeringState) {
  return [
    "Engineering state is authoritative. Use it before deciding what to say.",
    `Project: ${state.project}`,
    `Current goal: ${state.currentGoal}`,
    `Current objective: ${state.currentObjective}`,
    `One current blocker: ${state.currentBlocker}`,
    `Current hypothesis: ${state.currentHypothesis}`,
    `Recommended next engineering action: ${state.recommendedNextAction}`,
    `Response focus: ${state.responseFocus}`,
    `Evidence discipline: ${state.evidenceDiscipline}`,
    "What changed this turn:",
    formatList(state.whatChangedThisTurn, "No explicit change detected this turn."),
    "Resolved or no longer current:",
    formatList(state.resolvedThisTurn, "Nothing proven resolved yet."),
    "Still active:",
    formatList(state.stillActive, state.currentBlocker),
    "Completed work:",
    formatList(state.completedWork, "No completed work has been confirmed yet."),
    "Rejected hypotheses:",
    formatList(state.rejectedHypotheses, "None rejected yet."),
    "Pending questions:",
    formatList(state.pendingQuestions, "None."),
    "Evidence new this turn:",
    formatEvidence(state.evidenceNewThisTurn),
    "Evidence previously reviewed:",
    formatEvidence(state.evidencePreviouslyReviewed),
    "Hard rule: the response is a rendering of this state, not a fresh answer generated from the latest prompt alone.",
  ].join("\n");
}

function chooseCurrentBlocker(troubleshooting: TroubleshootingEvidenceSnapshot, workflowBlockedStep: string, currentDiagnosis: string) {
  if (troubleshooting.currentBlocker) return issueSummary(troubleshooting.currentBlocker);
  if (workflowBlockedStep) return workflowBlockedStep;
  if (currentDiagnosis && currentDiagnosis !== "Not established yet.") return currentDiagnosis;
  return "No exact current blocker is proven by the available evidence.";
}

function chooseCurrentHypothesis(troubleshooting: TroubleshootingEvidenceSnapshot, currentDiagnosis: string, currentBlocker: string) {
  if (troubleshooting.currentBlocker) return `The latest evidence is blocked by: ${issueSummary(troubleshooting.currentBlocker)}`;
  if (currentDiagnosis && currentDiagnosis !== "Not established yet.") return currentDiagnosis;
  if (currentBlocker !== "No exact current blocker is proven by the available evidence.") return currentBlocker;
  return "No hypothesis should be treated as proven until the next evidence item identifies the active blocker.";
}

function chooseNextAction(troubleshooting: TroubleshootingEvidenceSnapshot, workflowNextStep: string, investigationNextStep: string, currentBlocker: string, successfulProgressUpdate = false) {
  if (successfulProgressUpdate) {
    return workflowNextStep && workflowNextStep !== "Answer the current request."
      ? workflowNextStep
      : "Move to the next uncompleted step and give the verification check for it.";
  }

  if (troubleshooting.currentBlocker) {
    return `Fix or verify the current blocker shown in the latest evidence: ${issueSummary(troubleshooting.currentBlocker)}`;
  }

  if (workflowNextStep && workflowNextStep !== "Answer the current request.") return workflowNextStep;
  if (investigationNextStep && investigationNextStep !== "Answer from the current request.") return investigationNextStep;
  if (currentBlocker === "No exact current blocker is proven by the available evidence.") {
    return "Ask for or inspect the smallest missing evidence needed to identify the active blocker.";
  }

  return "Move one concrete step forward from the current blocker.";
}

function describeTurnDelta(troubleshooting: TroubleshootingEvidenceSnapshot, newEvidenceCount: number, hasNewEvidence: boolean) {
  const lines: string[] = [];

  if (newEvidenceCount > 0) lines.push(`${newEvidenceCount} new evidence item(s) were added to the investigation.`);
  if (hasNewEvidence && newEvidenceCount === 0) lines.push("The current message itself contains new diagnostic evidence.");
  if (troubleshooting.oldIssueStatus === "resolved-or-replaced") lines.push("A previous issue is absent from the newest evidence or was replaced by a newer blocker.");
  if (troubleshooting.oldIssueStatus === "still-present") lines.push("The previous blocker is still present in the newest evidence.");
  if (troubleshooting.oldIssueStatus === "changed") lines.push("The previous issue changed shape in the newest evidence.");
  troubleshooting.newIssues.slice(0, 3).forEach((issue) => lines.push(`New blocker candidate: ${issueSummary(issue)}`));

  return uniquePlain(lines);
}

function responseFocusFor(troubleshooting: TroubleshootingEvidenceSnapshot, hasNewEvidence: boolean, desiredOutcome: OutcomeType, successfulProgressUpdate = false) {
  if (successfulProgressUpdate) return "Acknowledge the confirmed progress and move to the next concrete step. Do not resurrect prior errors without new failing evidence.";
  if (troubleshooting.active && hasNewEvidence) return "Explain what the newest evidence proves, what changed, the one current blocker, and the next fix.";
  if (troubleshooting.active) return "Continue the active investigation from the current blocker.";
  if (desiredOutcome === "code") return "Produce the smallest useful implementation answer from the current objective and state.";
  return "Answer the current objective from the accumulated state.";
}

function issueSummary(issue: TroubleshootingIssue) {
  return issue.line ? `${issue.excerpt} (${issue.sourceName}:${issue.line})` : `${issue.excerpt} (${issue.sourceName})`;
}

function uniquePlain(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  items
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

function formatEvidence(items: EngineeringEvidenceRecord[]) {
  if (!items.length) return "- None.";
  return items
    .map((item) => `- ${item.fileName} (${item.evidenceKind}, ${item.fileType}, ${item.status}) via message ${item.messageId}; relation=${item.relation}; created=${item.createdAt}`)
    .join("\n");
}
