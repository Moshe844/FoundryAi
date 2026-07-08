import type { AnswerPlan } from "@/lib/ai/answer-planning";
import { formatAnswerPlan } from "@/lib/ai/answer-planning";
import type { ReasoningRequest } from "@/lib/ai/context";
import { buildFoundryV2ArchitectureState, formatFoundryV2ArchitectureState, type FoundryV2ArchitectureState } from "@/lib/ai/core-architecture";
import { buildDurableWorkState, formatDurableWorkState, type DurableWorkState } from "@/lib/ai/durable-state";
import type { EngineeringEvidenceRecord } from "@/lib/ai/engineering-state";
import { formatEngineeringState } from "@/lib/ai/engineering-state";
import { buildInstructionPlan, formatInstructionPlan, type InstructionPlan } from "@/lib/ai/instruction-planner";
import { buildPresentationStrategy, formatPresentationStrategy, type PresentationStrategy } from "@/lib/ai/presentation-strategy";
import { formatProjectState } from "@/lib/ai/project-state";
import { formatTroubleshootingSnapshot } from "@/lib/ai/troubleshooting";
import { buildWorkingMemoryContext } from "@/lib/ai/working-memory";

export type ReasoningPacket = {
  workItem: {
    title: string;
    goal: string;
    stage: string;
    userRequest: string;
    inferredIntent: string;
  };
  state: {
    currentBlocker: string;
    currentHypothesis: string;
    recommendedNextAction: string;
    completedWork: string[];
    resolvedIssues: string[];
    rejectedHypotheses: string[];
    pendingQuestions: string[];
    whatChangedThisTurn: string[];
  };
  evidence: {
    latest: string;
    newThisTurn: string[];
    previouslyReviewed: string[];
    selectedContext: string;
  };
  responseStrategy: {
    focus: string;
    presentation: PresentationStrategy;
    validationRules: string[];
  };
  durableState: DurableWorkState;
  instructionPlan: InstructionPlan;
  architecture: FoundryV2ArchitectureState;
  diagnostics: {
    engineeringState: string;
    troubleshootingState: string;
    projectState: string;
    answerPlan: string;
  };
};

export function buildReasoningPacket(request: ReasoningRequest, answerPlan: AnswerPlan): ReasoningPacket {
  const state = request.engineeringState;
  const workItem = request.conversationContext.currentWorkItem;
  const architecture = buildFoundryV2ArchitectureState(request, answerPlan);
  const durableState = buildDurableWorkState(request);
  const instructionPlan = buildInstructionPlan(request, answerPlan);
  const presentation = buildPresentationStrategy(request);

  return {
    workItem: {
      title: workItem.title || request.missionTitle,
      goal: state.currentGoal || workItem.objective || request.userMessage,
      stage: inferStage(request),
      userRequest: request.userMessage,
      inferredIntent: formatIntent(answerPlan),
    },
    state: {
      currentBlocker: state.currentBlocker,
      currentHypothesis: state.currentHypothesis,
      recommendedNextAction: state.recommendedNextAction,
      completedWork: state.completedWork,
      resolvedIssues: state.resolvedThisTurn,
      rejectedHypotheses: state.rejectedHypotheses,
      pendingQuestions: state.pendingQuestions,
      whatChangedThisTurn: state.whatChangedThisTurn,
    },
    evidence: {
      latest: latestEvidenceLabel(request),
      newThisTurn: state.evidenceNewThisTurn.map(formatEvidenceLabel),
      previouslyReviewed: state.evidencePreviouslyReviewed.map(formatEvidenceLabel).slice(-8),
      selectedContext: buildWorkingMemoryContext(request),
    },
    responseStrategy: {
      focus: state.responseFocus,
      presentation,
      validationRules: validationRulesFor(request),
    },
    durableState,
    instructionPlan,
    architecture,
    diagnostics: {
      engineeringState: formatEngineeringState(state),
      troubleshootingState: formatTroubleshootingSnapshot(request.troubleshooting),
      projectState: formatProjectState(request.projectState),
      answerPlan: formatAnswerPlan(answerPlan),
    },
  };
}

export function formatReasoningPacket(packet: ReasoningPacket) {
  return [
    "Reasoning packet v2:",
    "Use this packet as the working state for the answer. Do not reconstruct the task from raw chat history.",
    "",
    "Work item:",
    `- Title: ${packet.workItem.title}`,
    `- Goal: ${packet.workItem.goal}`,
    `- Stage: ${packet.workItem.stage}`,
    `- Current request: ${packet.workItem.userRequest}`,
    `- Inferred intent: ${packet.workItem.inferredIntent}`,
    "",
    "Live engineering state:",
    `- Current blocker: ${packet.state.currentBlocker}`,
    `- Current hypothesis: ${packet.state.currentHypothesis}`,
    `- Recommended next action: ${packet.state.recommendedNextAction}`,
    "Completed work:",
    formatList(packet.state.completedWork, "None confirmed."),
    "Resolved or no longer current:",
    formatList(packet.state.resolvedIssues, "None proven resolved."),
    "Rejected hypotheses:",
    formatList(packet.state.rejectedHypotheses, "None."),
    "Pending questions:",
    formatList(packet.state.pendingQuestions, "None."),
    "What changed this turn:",
    formatList(packet.state.whatChangedThisTurn, "No explicit change detected."),
    "",
    formatDurableWorkState(packet.durableState),
    "",
    "Evidence packet:",
    `- Latest evidence: ${packet.evidence.latest}`,
    "New this turn:",
    formatList(packet.evidence.newThisTurn, "None."),
    "Previously reviewed:",
    formatList(packet.evidence.previouslyReviewed, "None."),
    packet.evidence.selectedContext,
    "",
    "Response strategy:",
    `- Focus: ${packet.responseStrategy.focus}`,
    formatPresentationStrategy(packet.responseStrategy.presentation),
    "Validation rules:",
    formatList(packet.responseStrategy.validationRules, "Use engineering judgment."),
    "",
    formatInstructionPlan(packet.instructionPlan),
    "",
    formatFoundryV2ArchitectureState(packet.architecture),
    "",
    "Diagnostics for reasoning only:",
    packet.diagnostics.engineeringState,
    packet.diagnostics.troubleshootingState,
    packet.diagnostics.projectState,
    "Answer plan:",
    packet.diagnostics.answerPlan,
  ].join("\n");
}

function inferStage(request: ReasoningRequest) {
  if (request.troubleshooting.active) return "investigation";
  if (request.desiredOutcome === "code") return "implementation";
  if (request.conversationContext.currentRequest.hasNewEvidence) return "evidence review";
  return request.conversationContext.currentWorkItem.stage || "response";
}

function formatIntent(answerPlan: AnswerPlan) {
  return [
    answerPlan.intent.requestedAction,
    answerPlan.intent.relationship,
    answerPlan.intent.mostLikelyInterpretation,
  ]
    .filter(Boolean)
    .join(" / ");
}

function latestEvidenceLabel(request: ReasoningRequest) {
  if (request.troubleshooting.latestEvidenceName && request.troubleshooting.latestEvidenceName !== "none") {
    return `${request.troubleshooting.latestEvidenceName} (${request.troubleshooting.latestEvidenceKind})`;
  }

  const newest = request.engineeringState.evidenceNewThisTurn[0] ?? request.engineeringState.evidenceReviewed.at(-1);
  return newest ? formatEvidenceLabel(newest) : "current user request";
}

function formatEvidenceLabel(item: EngineeringEvidenceRecord) {
  return `${item.fileName} (${item.evidenceKind}, ${item.fileType}, ${item.status}, ${item.role})`;
}

function validationRulesFor(request: ReasoningRequest) {
  return [
    "Use the latest evidence before prior advice.",
    "Discuss resolved issues only when they change the next action.",
    "Do not ask for files or logs already present in selected evidence.",
    "Never put explanatory prose inside command, code, config, log, or diff blocks.",
    "If a command is introduced, show an actual fenced command block directly after it.",
    request.desiredOutcome === "code" ? "Generated code must be structurally complete for the promised scope." : "",
    request.troubleshooting.active ? "Only one current blocker should be centered." : "",
  ].filter(Boolean);
}

function formatList(items: string[], empty: string) {
  const cleaned = items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
  return cleaned.length ? cleaned.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}
