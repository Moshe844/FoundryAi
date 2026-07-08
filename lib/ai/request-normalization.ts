import type { ReasoningRequest } from "@/lib/ai/context";
import { buildEngineeringState } from "@/lib/ai/engineering-state";
import { buildProjectState } from "@/lib/ai/project-state";
import { buildTroubleshootingSnapshot } from "@/lib/ai/troubleshooting";

export function normalizeReasoningRequest(body: Partial<ReasoningRequest>): ReasoningRequest {
  const attachments = body.attachments ?? [];
  const priorMessages = body.priorMessages ?? [];
  const hasExplicitNewAttachmentIds = Array.isArray(body.investigation?.newAttachmentIds);
  const inferredNewAttachmentIds =
    hasExplicitNewAttachmentIds ? body.investigation?.newAttachmentIds ?? [] : attachments.map((attachment) => attachment.fileId).filter(Boolean);
  const investigation = body.investigation
    ? {
        ...body.investigation,
        newAttachmentIds: inferredNewAttachmentIds,
        evidenceReviewed: body.investigation.evidenceReviewed?.length
          ? body.investigation.evidenceReviewed
          : attachments.map((attachment) => ({
              fileId: attachment.fileId,
              fileName: attachment.fileName,
              fileType: attachment.fileType,
              evidenceKind: attachment.evidenceKind,
              size: attachment.size,
              role: inferredNewAttachmentIds.includes(attachment.fileId) ? ("new" as const) : ("previous" as const),
              messageId: attachment.messageId,
              relation: inferredNewAttachmentIds.includes(attachment.fileId) ? ("new this turn" as const) : ("already reviewed" as const),
              status: attachment.uploadStatus,
              createdAt: attachment.createdAt,
            })),
      }
    : {
        evidenceReviewed: attachments.map((attachment) => ({
          fileId: attachment.fileId,
          fileName: attachment.fileName,
          fileType: attachment.fileType,
          evidenceKind: attachment.evidenceKind,
          size: attachment.size,
          role: "new" as const,
          messageId: attachment.messageId,
          relation: "new this turn" as const,
          status: attachment.uploadStatus,
          createdAt: attachment.createdAt,
        })),
        newAttachmentIds: inferredNewAttachmentIds,
        previousAttachmentIds: [],
        previousAssistantNotes: priorMessages
          .filter((message) => /\b(foundry|assistant|system)\b/i.test(message.author))
          .slice(-5)
          .map((message) => message.body.replace(/\s+/g, " ").slice(0, 1400)),
        evidenceTypes: {
          hasImages: attachments.some((attachment) => attachment.uploadStatus === "image"),
          hasReadableFiles: attachments.some((attachment) => attachment.uploadStatus === "readable"),
          fileTypeSummary: summarizeAttachmentTypes(attachments),
        },
        continuityInstruction: attachments.length
          ? "Treat the provided attachments as current-turn evidence and continue from the current work item."
          : "Continue from the current request.",
      };
  const troubleshooting =
    body.troubleshooting ??
    buildTroubleshootingSnapshot({
      userMessage: body.userMessage ?? "",
      attachments,
      newAttachmentIds: new Set(investigation.newAttachmentIds ?? []),
      priorMessages,
    });
  const conversationContext = body.conversationContext ?? {
    currentWorkItem: {
      missionId: "unknown",
      title: body.missionTitle ?? "Current Work Item",
      objective: body.userMessage ?? "",
      outcome: body.desiredOutcome ?? "answer",
      stage: "ready",
    },
    currentRequest: {
      text: body.userMessage ?? "",
      likelyReference: attachments.length ? "attached evidence" : "current request",
      newEvidenceCount: inferredNewAttachmentIds.length,
      hasNewEvidence: inferredNewAttachmentIds.length > 0,
      containsDiagnosticEvidence: looksDiagnosticLike(body.userMessage ?? ""),
    },
    evidenceTimeline: attachments.map((attachment) => ({
      fileId: attachment.fileId,
      fileName: attachment.fileName,
      evidenceKind: attachment.evidenceKind,
      fileType: attachment.fileType,
      messageId: attachment.messageId,
      role: inferredNewAttachmentIds.includes(attachment.fileId) ? ("new this turn" as const) : ("already reviewed" as const),
      status: attachment.uploadStatus,
      createdAt: attachment.createdAt,
    })),
    investigationState: {
      currentDiagnosis: "Not established yet.",
      confirmedFindings: [],
      rejectedFindings: [],
      pendingQuestions: [],
      recommendedNextStep: "Answer from the current request.",
    },
    workflowState: {
      goal: body.userMessage ?? "",
      completedSteps: [],
      currentStep: body.userMessage ?? "Continue the current request.",
      blockedStep: "",
      nextStep: "Answer the current request.",
      futureSteps: [],
      alreadyTold: [],
      alreadyVerified: [],
      alreadyFailed: [],
      guidanceRule: "Use current evidence and avoid repeating completed steps.",
    },
    priorQuestions: [],
    artifacts: [],
  };
  const engineeringState =
    body.engineeringState ??
    buildEngineeringState({
      missionTitle: body.missionTitle ?? "Current Work Item",
      desiredOutcome: body.desiredOutcome ?? "answer",
      userMessage: body.userMessage ?? "",
      investigation,
      troubleshooting,
      conversationContext,
    });
  const projectState =
    body.projectState ??
    buildProjectState({
      missionTitle: body.missionTitle ?? "Current Work Item",
      desiredOutcome: body.desiredOutcome ?? "answer",
      userMessage: body.userMessage ?? "",
      priorMessages,
      attachments,
      investigation,
      troubleshooting,
      conversationContext,
      workMemory: body.workMemory,
    });
  const workMemory = body.workMemory ?? {
    currentGoal: conversationContext.workflowState.goal,
    currentBlocker: engineeringState.currentBlocker,
    completedWork: engineeringState.completedWork,
    resolvedErrors: engineeringState.resolvedThisTurn,
    rejectedHypotheses: engineeringState.rejectedHypotheses,
    latestEvidence: engineeringState.evidenceNewThisTurn.map((item) => `${item.fileName} (${item.evidenceKind}, ${item.status})`),
    relevantFiles: attachments.map((attachment) => attachment.fileName),
    recommendedNextAction: engineeringState.recommendedNextAction,
    summary: "No stored progressive memory was supplied with this request.",
    updatedAt: new Date().toISOString(),
  };

  return {
    missionTitle: body.missionTitle ?? "Current Work Item",
    userMessage: body.userMessage ?? "",
    priorMessages,
    desiredOutcome: body.desiredOutcome ?? "answer",
    targetVariants: body.targetVariants ?? [],
    attachments,
    comparisonEvidence: body.comparisonEvidence ?? [],
    investigation,
    troubleshooting,
    engineeringState,
    projectState,
    conversationContext,
    workMemory,
    sources: body.sources ?? [],
    lastResult: body.lastResult,
  };
}

function summarizeAttachmentTypes(attachments: ReasoningRequest["attachments"]) {
  if (!attachments.length) return "none";
  const counts = new Map<string, number>();
  for (const attachment of attachments) {
    const key = `${attachment.evidenceKind}/${attachment.uploadStatus}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => `${key}:${count}`)
    .join(", ");
}

function looksDiagnosticLike(value: string) {
  return /\b(error|failed|failure|exception|fatal|cannot|unable|unresolved reference|not found|missing|duplicate|conflict|build failed|traceback|still fails|still failing)\b/i.test(
    value,
  );
}
