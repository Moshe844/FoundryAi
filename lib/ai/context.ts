import type { MissionState, OutcomeType } from "@/lib/mission-engine";
import { classifyEvidenceKind } from "@/lib/files";
import type { EvidenceKind, FileEvidenceFact, WorkspaceAttachment } from "@/lib/files";
import type { SourceReference } from "@/lib/sources/types";
import { buildTroubleshootingSnapshot, type TroubleshootingEvidenceSnapshot } from "@/lib/ai/troubleshooting";
import { buildEngineeringState, type EngineeringState } from "@/lib/ai/engineering-state";
import { buildProjectState, type ProjectState } from "@/lib/ai/project-state";
import { hasCompleteArtifactRequestShape, hasEvidenceUpdateShape, hasFollowUpIntentShape, hasResultUpdateShape, hasSuccessfulProgressUpdate } from "@/lib/ai/intent-resolution";

export type ReasoningRequest = {
  missionTitle: string;
  userMessage: string;
  priorMessages: Array<{
    author: string;
    body: string;
  }>;
  desiredOutcome: OutcomeType;
  targetVariants: string[];
  attachments: ReasoningAttachment[];
  comparisonEvidence: ComparisonEvidenceFact[];
  investigation: InvestigationContext;
  troubleshooting: TroubleshootingEvidenceSnapshot;
  engineeringState: EngineeringState;
  projectState: ProjectState;
  conversationContext: ConversationContext;
  workMemory: MissionState["workMemory"];
  sources: SourceReference[];
  lastResult?: string;
};

export type ReasoningAttachment = Pick<
  WorkspaceAttachment,
  | "fileId"
  | "fileName"
  | "fileType"
  | "evidenceKind"
  | "size"
  | "messageId"
  | "missionId"
  | "rawText"
  | "parsedStructure"
  | "dataUrl"
  | "uploadStatus"
  | "createdAt"
> & {
  evidenceIndex: RankedEvidenceFact[];
};

export type RankedEvidenceFact = FileEvidenceFact & {
  score: number;
  matchedTargetVariants?: string[];
};

export type ComparisonEvidenceFact = {
  kind: "native-only" | "native-different" | "tlv-only" | "tlv-different";
  summary: string;
  fileName: string;
  otherFileName: string;
  path: string;
  otherPath?: string;
  key?: string;
  rawValue?: string;
  otherRawValue?: string;
  tlvTag?: string;
  tlvLength?: number;
  decodedValue?: string;
  otherDecodedValue?: string;
  decimalValue?: number;
  otherDecimalValue?: number;
  asciiValue?: string;
  otherAsciiValue?: string;
};

export type InvestigationContext = {
  evidenceReviewed: Array<{
    fileId: string;
    fileName: string;
    fileType: string;
    evidenceKind: EvidenceKind;
    size: number;
    role: "new" | "previous";
    messageId: string;
    relation: "already reviewed" | "new this turn" | "replaced" | "superseded";
    status: string;
    createdAt: string;
  }>;
  newAttachmentIds: string[];
  previousAttachmentIds: string[];
  previousAssistantNotes: string[];
  evidenceTypes: {
    hasImages: boolean;
    hasReadableFiles: boolean;
    fileTypeSummary: string;
  };
  latestRequestForEvidence?: string;
  continuityInstruction: string;
};

export type ConversationContext = {
  currentWorkItem: {
    missionId: string;
    title: string;
    objective: string;
    outcome: OutcomeType;
    stage: string;
  };
  currentRequest: {
    text: string;
    likelyReference: string;
    newEvidenceCount: number;
    hasNewEvidence: boolean;
    containsDiagnosticEvidence: boolean;
  };
  evidenceTimeline: Array<{
    fileId: string;
    fileName: string;
    evidenceKind: EvidenceKind;
    fileType: string;
    messageId: string;
    role: "new this turn" | "already reviewed";
    status: string;
    createdAt: string;
  }>;
  investigationState: {
    currentDiagnosis: string;
    confirmedFindings: string[];
    rejectedFindings: string[];
    pendingQuestions: string[];
    recommendedNextStep: string;
  };
  workflowState: {
    goal: string;
    completedSteps: string[];
    currentStep: string;
    blockedStep: string;
    nextStep: string;
    futureSteps: string[];
    alreadyTold: string[];
    alreadyVerified: string[];
    alreadyFailed: string[];
    guidanceRule: string;
  };
  priorQuestions: string[];
  artifacts: Array<{
    title: string;
    kind: string;
    description: string;
  }>;
};

export function createReasoningRequest(mission: MissionState, userMessage: string, currentMessageId?: string): ReasoningRequest {
  const currentMessageIndex = currentMessageId
    ? mission.messages.findIndex((message) => message.id === currentMessageId)
    : mission.messages.findLastIndex((message) => message.author === "You" && message.body === userMessage);
  const currentUserMessage = currentMessageIndex >= 0 ? mission.messages[currentMessageIndex] : undefined;
  const newAttachmentIds = new Set((currentUserMessage?.attachments ?? []).map((attachment) => attachment.fileId));
  const previousAttachmentIds = new Set(mission.attachments.filter((attachment) => !newAttachmentIds.has(attachment.fileId)).map((attachment) => attachment.fileId));
  const currentTurnUsesImageEvidence = shouldUseImageEvidenceForTurn(mission, userMessage, newAttachmentIds);
  const messagesBeforeCurrent = currentMessageIndex >= 0 ? mission.messages.slice(0, currentMessageIndex) : mission.messages;
  const priorMessages = messagesBeforeCurrent
    .slice(-10)
    .map((message) => ({
      author: message.author,
      body: message.visualArtifact ? `${message.body}\n\n${formatVisualArtifactContext(message.visualArtifact)}` : message.body,
    }));

  const attachments = mission.attachments.map((attachment) => ({
    fileId: attachment.fileId,
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    evidenceKind: attachment.evidenceKind ?? classifyEvidenceKind(attachment.fileName, attachment.fileType),
    size: attachment.size,
    messageId: attachment.messageId,
    missionId: attachment.missionId,
    rawText: trimForModel(attachment.rawText),
    parsedStructure: attachment.parsedStructure,
    evidenceIndex: rankEvidenceForObjective(attachment.evidenceIndex ?? [], userMessage),
    dataUrl: attachment.dataUrl,
    uploadStatus: attachment.uploadStatus,
    createdAt: attachment.createdAt,
  }));
  const troubleshooting = buildTroubleshootingSnapshot({
    userMessage,
    attachments,
    newAttachmentIds,
    priorMessages,
  });
  const investigation = buildInvestigationContext(mission, newAttachmentIds, previousAttachmentIds, currentTurnUsesImageEvidence);
  const conversationContext = buildConversationContext(mission, userMessage, newAttachmentIds, currentMessageIndex);
  const engineeringState = buildEngineeringState({
    missionTitle: mission.conversationTitle,
    desiredOutcome: mission.desiredOutcome,
    userMessage,
    investigation,
    troubleshooting,
    conversationContext,
  });
  const projectState = buildProjectState({
    missionTitle: mission.conversationTitle,
    desiredOutcome: mission.desiredOutcome,
    userMessage,
    priorMessages,
    attachments,
    investigation,
    troubleshooting,
    conversationContext,
    workMemory: mission.workMemory,
  });

  return {
    missionTitle: mission.conversationTitle,
    userMessage,
    priorMessages,
    desiredOutcome: mission.desiredOutcome,
    targetVariants: createTargetVariants(userMessage),
    attachments,
    comparisonEvidence: buildComparisonEvidence(mission.attachments, newAttachmentIds),
    investigation,
    troubleshooting,
    engineeringState,
    projectState,
    conversationContext,
    workMemory: mission.workMemory,
    sources: mission.sources ?? [],
    lastResult: mission.lastResult || undefined,
  };
}

function buildInvestigationContext(
  mission: MissionState,
  newAttachmentIds: Set<string>,
  previousAttachmentIds: Set<string>,
  currentTurnUsesImageEvidence: boolean,
): InvestigationContext {
  const hasImages = mission.attachments.some((attachment) => attachment.uploadStatus === "image");
  const hasReadableFiles = mission.attachments.some((attachment) => attachment.uploadStatus === "readable");
  const fileTypeSummary = summarizeEvidenceTypes(mission.attachments);
  const previousAssistantNotes = mission.messages
    .filter((message) => message.tone === "system" && message.body.trim())
    .slice(-5)
    .map((message) => message.body.replace(/\s+/g, " ").slice(0, 1400));
  const latestRequestForEvidenceRaw = [...mission.messages]
    .reverse()
    .find((message) => message.tone === "system" && /\b(send|share|attach|upload|provide|paste).{0,120}\b(file|log|output|screenshot|json|xml|csv|config|trace|error)\b/i.test(message.body))
    ?.body.replace(/\s+/g, " ")
    .slice(0, 800);
  const latestRequestForEvidence = currentTurnUsesImageEvidence ? latestRequestForEvidenceRaw : removeUnsupportedScreenshotClaims(latestRequestForEvidenceRaw ?? "");
  const hasNewEvidence = newAttachmentIds.size > 0;
  const hasPreviousEvidence = previousAttachmentIds.size > 0;

  return {
    evidenceReviewed: mission.attachments.map((attachment) => ({
      fileId: attachment.fileId,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      evidenceKind: attachment.evidenceKind ?? classifyEvidenceKind(attachment.fileName, attachment.fileType),
      size: attachment.size,
      role: newAttachmentIds.has(attachment.fileId) ? "new" : "previous",
      messageId: attachment.messageId,
      relation: newAttachmentIds.has(attachment.fileId) ? "new this turn" : "already reviewed",
      status: attachment.uploadStatus,
      createdAt: attachment.createdAt,
    })),
    newAttachmentIds: Array.from(newAttachmentIds),
    previousAttachmentIds: Array.from(previousAttachmentIds),
    previousAssistantNotes: currentTurnUsesImageEvidence ? previousAssistantNotes : previousAssistantNotes.map(removeUnsupportedScreenshotClaims),
    evidenceTypes: {
      hasImages,
      hasReadableFiles,
      fileTypeSummary,
    },
    latestRequestForEvidence,
    continuityInstruction: [
      "Continue the existing investigation. Do not restart from scratch.",
      hasNewEvidence ? "New evidence was just attached in the current user message." : "No new file was attached in the current user message; answer from the existing work item evidence.",
      hasNewEvidence && hasPreviousEvidence ? "Compare the new evidence against previous evidence before answering." : "",
      currentTurnUsesImageEvidence
        ? "Image attachments are relevant to this current request."
        : hasImages
          ? "Older image/screenshot attachments exist, but they are not relevant to this current request. Do not use or mention them."
          : "No image/screenshot attachment is present in the reviewed evidence. Do not say the user provided screenshots.",
      hasReadableFiles ? `Reviewed file types: ${fileTypeSummary}.` : "",
      "Never ask for evidence that already exists in the reviewed evidence list.",
      "Treat prior assistant replies as notes or hypotheses to verify against the actual files, not as evidence by themselves.",
      "Update the diagnosis: what is new, what stayed the same, what appears resolved, what is still unresolved, and the next recommended action.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function shouldUseImageEvidenceForTurn(mission: MissionState, userMessage: string, newAttachmentIds: Set<string>) {
  const currentHasImage = mission.attachments.some((attachment) => newAttachmentIds.has(attachment.fileId) && attachment.uploadStatus === "image");
  if (currentHasImage) return true;
  return /\b(screenshot|screen shot|image|photo|picture|visual|shown|see in the screenshot|that screenshot|previous screenshot)\b/i.test(userMessage);
}

function buildConversationContext(mission: MissionState, userMessage: string, newAttachmentIds: Set<string>, currentMessageIndex = -1): ConversationContext {
  const currentMessageHasDiagnosticEvidence = looksLikeDiagnosticContent(userMessage);
  const messagesBeforeCurrent = currentMessageIndex >= 0 ? mission.messages.slice(0, currentMessageIndex) : mission.messages;
  const priorHumanQuestions = mission.messages
    .slice(0, currentMessageIndex >= 0 ? currentMessageIndex : mission.messages.length)
    .filter((message) => message.tone === "human" && message.body.trim())
    .slice(-8)
    .map((message) => message.body.replace(/\s+/g, " ").slice(0, 260));
  const assistantNotes = messagesBeforeCurrent
    .filter((message) => message.tone === "system" && message.body.trim())
    .slice(-6)
    .map((message) => message.body.replace(/\s+/g, " ").slice(0, 900));
  const workflowState = buildWorkflowState(mission, userMessage, currentMessageIndex);

  return {
    currentWorkItem: {
      missionId: mission.missionId,
      title: mission.conversationTitle,
      objective: mission.objective,
      outcome: mission.desiredOutcome,
      stage: mission.currentStage,
    },
    currentRequest: {
      text: userMessage,
      likelyReference: inferReferenceTarget(userMessage, mission, newAttachmentIds),
      newEvidenceCount: newAttachmentIds.size + (currentMessageHasDiagnosticEvidence ? 1 : 0),
      hasNewEvidence: newAttachmentIds.size > 0 || currentMessageHasDiagnosticEvidence,
      containsDiagnosticEvidence: currentMessageHasDiagnosticEvidence,
    },
    evidenceTimeline: [
      ...mission.attachments.map((attachment) => ({
        fileId: attachment.fileId,
        fileName: attachment.fileName,
        evidenceKind: attachment.evidenceKind ?? classifyEvidenceKind(attachment.fileName, attachment.fileType),
        fileType: attachment.fileType,
        messageId: attachment.messageId,
        role: newAttachmentIds.has(attachment.fileId) ? ("new this turn" as const) : ("already reviewed" as const),
        status: attachment.uploadStatus,
        createdAt: attachment.createdAt,
      })),
      ...(currentMessageHasDiagnosticEvidence
        ? [
            {
              fileId: "current-message",
              fileName: "Current message diagnostic transcript",
              evidenceKind: "log" as const,
              fileType: "pasted terminal output",
              messageId: "current-message",
              role: "new this turn" as const,
              status: "readable",
              createdAt: new Date().toISOString(),
            },
          ]
        : []),
    ],
    investigationState: summarizeInvestigationState(assistantNotes),
    workflowState,
    priorQuestions: [
      ...priorHumanQuestions,
      assistantNotes.at(-1) ? `Most recent Foundry answer: ${assistantNotes.at(-1)}` : "",
    ].filter(Boolean),
    artifacts: mission.createdArtifacts.slice(0, 8).map((artifact) => ({
      title: artifact.title,
      kind: artifact.kind,
      description: artifact.description,
    })),
  };
}

function buildWorkflowState(mission: MissionState, userMessage: string, currentMessageIndex = -1) {
  const messagesBeforeCurrent = currentMessageIndex >= 0 ? mission.messages.slice(0, currentMessageIndex) : mission.messages;
  const humanMessages = messagesBeforeCurrent.filter((message) => message.tone === "human" && message.body.trim());
  const assistantMessages = messagesBeforeCurrent.filter((message) => message.tone === "system" && message.body.trim());
  const combinedAssistant = assistantMessages.map((message) => message.body).join("\n");
  const combinedHuman = humanMessages.map((message) => message.body).join("\n");
  const latestAssistant = assistantMessages.at(-1)?.body ?? "";
  const latestHumanBeforeCurrent = humanMessages.at(-1)?.body ?? "";
  const completedSteps = uniqueWorkflowItems([
    ...extractWorkflowItems(combinedHuman, /\b(done|working|works|worked|installed|set up|setup complete|configured|connected|running|shows up|opens|launched|fixed|resolved|passed|success|successful)\b/i),
    ...extractWorkflowItems(combinedAssistant, /\b(done|complete|completed|confirmed|verified|working|resolved|success|successfully|already set up|already installed)\b/i),
    ...(hasSuccessfulProgressUpdate(userMessage) ? [`Completed current step: ${cleanWorkflowItem(userMessage).slice(0, 140)}`] : []),
  ]);
  const alreadyVerified = uniqueWorkflowItems([
    ...extractWorkflowItems(combinedHuman, /\b(verified|confirmed|tested|works|working|passed|shows up|opens|runs|success)\b/i),
    ...extractWorkflowItems(combinedAssistant, /\b(verified|confirmed|tested|works|working|passed|success)\b/i),
    ...(hasSuccessfulProgressUpdate(userMessage) ? [`Verified current step: ${cleanWorkflowItem(userMessage).slice(0, 140)}`] : []),
  ]);
  const alreadyFailed = uniqueWorkflowItems([
    ...extractWorkflowItems(combinedHuman, /\b(failed|still failing|did not work|doesn't work|not working|error|blocked|stuck|cannot|can't|unable)\b/i),
    ...extractWorkflowItems(combinedAssistant, /\b(failed|still failing|blocked|unresolved|not working|error remains|cannot|can't|unable)\b/i),
  ]);
  const alreadyTold = uniqueWorkflowItems(extractPriorGuidance(combinedAssistant));
  const nextCandidates = uniqueWorkflowItems([
    ...extractWorkflowItems(latestAssistant, /\b(next|now|after that|then|do this|run|open|check|verify|install|configure|connect|build|test)\b/i),
    ...extractWorkflowItems(combinedAssistant, /\b(next|after that|then|finally|we'll|we will)\b/i),
  ]);
  const blockedStep = inferBlockedStep(userMessage, alreadyFailed);
  const currentStep =
    blockedStep ||
    inferCurrentStep(userMessage, latestHumanBeforeCurrent, nextCandidates, completedSteps, mission.objective) ||
    "Continue the current work item.";
  const nextStep =
    nextCandidates.find(
      (item) =>
        !completedSteps.some((completed) => similarWorkflowItem(completed, item)) &&
        !alreadyVerified.some((verified) => similarWorkflowItem(verified, item)) &&
        !alreadyTold.some((told) => similarWorkflowItem(told, item)),
    ) ??
    inferNextStep(userMessage, mission.objective);

  return {
    goal: mission.objective || userMessage || mission.conversationTitle,
    completedSteps: completedSteps.slice(0, 8),
    currentStep,
    blockedStep,
    nextStep,
    futureSteps: nextCandidates.filter((item) => item !== nextStep).slice(0, 5),
    alreadyTold: alreadyTold.slice(0, 8),
    alreadyVerified: alreadyVerified.slice(0, 8),
    alreadyFailed: alreadyFailed.slice(0, 8),
    guidanceRule: [
      "Assume every previously confirmed or verified step is complete.",
      "Do not repeat completed instructions unless the user asks.",
      "Do not restate instructions that were already told earlier; refer to them briefly and move to execution, verification, or the next decision.",
      "Move the user one meaningful step forward from the current or blocked step.",
      "Use already failed steps to avoid suggesting the same failed path as the only option.",
    ].join(" "),
  };
}

function extractWorkflowItems(text: string, pattern: RegExp) {
  return text
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((item) => cleanWorkflowItem(item))
    .filter((item) => item.length >= 8 && item.length <= 180 && pattern.test(item));
}

function extractPriorGuidance(text: string) {
  const lines = text
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((item) => cleanWorkflowItem(item))
    .filter((item) => item.length >= 8 && item.length <= 180)
    .filter((item) =>
      /\b(open|run|install|configure|copy|paste|download|verify|check|connect|build|create|replace|remove|update|use|try|add|sync|integrate|set up|set|initialize|import)\b/i.test(
        item,
      ) || looksLikeGuidanceHeading(item),
    );

  return lines;
}

function looksLikeGuidanceHeading(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) return false;
  if (/[.?!:]$/.test(value)) return false;

  const actionish = /^(add|after|backup|build|check|clean|configure|connect|copy|create|download|fix|install|integrate|open|remove|repair|replace|restore|run|set|sync|test|update|use|verify)\b/i;
  const titleCasedWords = words.filter((word) => /^[A-Z0-9][A-Za-z0-9./_-]*$/.test(word)).length;

  return actionish.test(value) || titleCasedWords >= Math.max(2, Math.ceil(words.length * 0.45));
}

function cleanWorkflowItem(value: string) {
  return value
    .replace(/^[\s>*#-]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueWorkflowItems(items: string[]) {
  const result: string[] = [];

  items.forEach((item) => {
    if (!result.some((existing) => similarWorkflowItem(existing, item))) {
      result.push(item);
    }
  });

  return result;
}

function similarWorkflowItem(a: string, b: string) {
  const aTerms = workflowTerms(a);
  const bTerms = new Set(workflowTerms(b));
  if (!aTerms.length || !bTerms.size) return false;

  const matches = aTerms.filter((term) => bTerms.has(term)).length;
  return matches / Math.max(aTerms.length, bTerms.size) >= 0.55;
}

function workflowTerms(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .filter((term) => !["the", "and", "for", "from", "that", "this", "with", "you", "your", "into", "would", "what", "which", "then"].includes(term));
}

function inferBlockedStep(userMessage: string, alreadyFailed: string[]) {
  if (hasSuccessfulProgressUpdate(userMessage)) return "";
  const explicitFailure = extractWorkflowItems(userMessage, /\b(failed|error|failure|blocked|stuck|cannot|can't|unable|not working|problem|issue|exception|denied|timeout|invalid|missing|unresolved|conflict)\b/i)[0];
  if (explicitFailure) return explicitFailure;
  if (hasResultUpdateShape(userMessage)) return cleanWorkflowItem(userMessage).slice(0, 180);
  return alreadyFailed.at(-1) ?? "";
}

function inferCurrentStep(userMessage: string, previousUserMessage: string, nextCandidates: string[], completedSteps: string[], objective: string) {
  if (hasSuccessfulProgressUpdate(userMessage) || /\b(done|working|works|worked|shows up|installed|set up|configured|connected|running|fixed|resolved)\b/i.test(userMessage)) {
    return nextCandidates.find((item) => !completedSteps.some((completed) => similarWorkflowItem(completed, item))) ?? "Advance to the next setup or verification step.";
  }

  if (isContinuationOrNarrowFollowUp(userMessage)) {
    return nextCandidates[0] ?? previousUserMessage ?? objective;
  }

  return userMessage || previousUserMessage || objective;
}

function inferNextStep(userMessage: string, objective: string) {
  if (hasSuccessfulProgressUpdate(userMessage) || /\b(done|working|works|worked|shows up|installed|set up|configured|connected|running|fixed|resolved)\b/i.test(userMessage)) {
    return "Move to the next uncompleted step and verify it before continuing.";
  }

  if (hasResultUpdateShape(userMessage) || /\b(error|failed|failure|blocked|stuck|not working|cannot|can't|unable|exception|missing|unresolved|conflict)\b/i.test(userMessage)) {
    return "Resolve the blocker with the least destructive fix, then verify the same step again.";
  }

  return objective ? "Continue the current goal with the next concrete action." : "Identify the goal, then give the next concrete action.";
}

function isContinuationOrNarrowFollowUp(userMessage: string) {
  return (
    hasFollowUpIntentShape(userMessage) ||
    hasCompleteArtifactRequestShape(userMessage) ||
    /\b(now what|what next|next|continue|go ahead|do that|yes|yes please)\b/i.test(userMessage)
  );
}

function looksLikeDiagnosticContent(value: string) {
  if (isPastedConfigInspectionTurn(value)) return false;

  return (
    /(^|\n)\s*(PS\s+[A-Za-z]:\\|[A-Za-z]:\\[^>]*>|\$ |# |>|error[:\s]|warning[:\s]|exception[:\s])|\b(error|failed|failure|exception|cannot|unable|not recognized|command not found|no installed|duplicate|conflict|redeclaration)\b/i.test(
      value,
    ) ||
    looksLikePastedCodeOrConfig(value)
  );
}

function looksLikePastedCodeOrConfig(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;

  const syntaxLines = lines.filter((line) =>
    /[{}()[\];=<>]|^\s*[A-Za-z_$][\w$.-]*\s*[:=]|^\s*(class|function|import|export|const|let|var|interface|type|enum|def|fn|func|package|namespace|module)\b/i.test(
      line,
    ),
  );
  return syntaxLines.length >= 3;
}

function isPastedConfigInspectionTurn(value: string) {
  const match = value.match(/```([^\n`]*)\n([\s\S]*?)```/);
  if (!match) return false;
  const language = match[1]?.trim() ?? "";
  const code = match[2]?.trim() ?? "";
  if (/^(?:shell|bash|zsh|powershell|pwsh|cmd|terminal|log|text|plaintext|console)$/i.test(language)) return false;
  if (/(^|\n)\s*(PS\s+[A-Za-z]:\\|[A-Za-z]:\\[^>]*>|\$ |# |>|error[:\s]|warning[:\s]|exception[:\s])|\b(error|failed|failure|exception|cannot|unable|not recognized|command not found|build failed|traceback)\b/i.test(code)) return false;

  const prose = value.replace(/```[\s\S]*?```/g, " ");
  return (
    /\b(?:how should|should look|look now|is this|does this|correct|right|wrong|fix|clean|remove|change|edit|file|config|snippet|block)\b/i.test(prose) &&
    /\b(?:plugins|buildscript|allprojects|subprojects|repositories|dependencies|android|pluginManagement|dependencyResolutionManagement)\s*\{/i.test(code)
  );
}

function inferReferenceTarget(userMessage: string, mission: MissionState, newAttachmentIds: Set<string>) {
  const text = userMessage.toLowerCase();
  const newAttachments = mission.attachments.filter((attachment) => newAttachmentIds.has(attachment.fileId));
  if (newAttachments.length > 0) {
    return `latest attached evidence: ${newAttachments.map((attachment) => `${attachment.fileName} (${attachment.evidenceKind ?? classifyEvidenceKind(attachment.fileName, attachment.fileType)})`).join(", ")}`;
  }

  if (/\b(this|that|it|these|those|latest|new|current|attached|uploaded|pasted|sent|provided)\b/.test(text) || hasEvidenceUpdateShape(userMessage)) {
    const latestAttachment = mission.attachments.at(-1);
    const latestArtifact = mission.createdArtifacts[0];
    if (/\b(file|files|log|logs|trace|output|json|xml|csv|screenshot|image|attachment|evidence|config|source|code|snippet)\b/.test(text) && latestAttachment) {
      return `most recent evidence: ${latestAttachment.fileName} (${latestAttachment.evidenceKind ?? classifyEvidenceKind(latestAttachment.fileName, latestAttachment.fileType)})`;
    }
    if (/\b(artifact|sketch|image|diagram|mockup|design|code|report)\b/.test(text) && latestArtifact) {
      return `most recent artifact: ${latestArtifact.title} (${latestArtifact.kind})`;
    }
    if (latestAttachment) return `most recent evidence: ${latestAttachment.fileName} (${latestAttachment.evidenceKind ?? classifyEvidenceKind(latestAttachment.fileName, latestAttachment.fileType)})`;
    if (latestArtifact) return `most recent artifact: ${latestArtifact.title} (${latestArtifact.kind})`;
    return "previous answer in this work item";
  }

  return "current user request";
}

function summarizeInvestigationState(notes: string[]) {
  const combined = notes.join(" ");
  return {
    currentDiagnosis: extractSentence(combined, /\b(failed|failure|error|conflict|missing|broken|root cause|caused by|because)\b/i) || "Not established yet.",
    confirmedFindings: extractSentences(combined, /\b(found|confirmed|still present|still failing|shows|indicates)\b/i, 4),
    rejectedFindings: extractSentences(combined, /\b(not present|not shown|does not|no longer|resolved|disappeared|removed)\b/i, 3),
    pendingQuestions: extractSentences(combined, /\b(need|missing|unknown|verify|check|if it still|send|share)\b/i, 4),
    recommendedNextStep: extractSentence(combined, /\b(next|fix this|first|run|verify|remove|update|replace|check)\b/i) || "Answer from the current request and available evidence.",
  };
}

function extractSentence(text: string, pattern: RegExp) {
  return extractSentences(text, pattern, 1)[0] ?? "";
}

function extractSentences(text: string, pattern: RegExp, limit: number) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12 && pattern.test(sentence))
    .slice(0, limit);
}

function removeUnsupportedScreenshotClaims(note: string) {
  return note
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\bscreenshots?\b/i.test(sentence))
    .join(" ")
    .trim();
}

function summarizeEvidenceTypes(attachments: WorkspaceAttachment[]) {
  const counts = new Map<string, number>();

  attachments.forEach((attachment) => {
    const label = attachment.uploadStatus === "image" ? "image" : attachment.fileType || "unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([type, count]) => `${count} ${type}`)
    .join(", ") || "none";
}

function formatVisualArtifactContext(visual: NonNullable<MissionState["messages"][number]["visualArtifact"]>) {
  const spec = visual.spec;
  const form = spec.form
    ? [
        `Form heading: ${spec.form.heading}`,
        `Fields: ${spec.form.fields.join(", ")}`,
        `Primary action: ${spec.form.action}`,
        `Secondary text: ${spec.form.secondary}`,
        `Footer: ${spec.form.footer}`,
      ].join("\n")
    : "";

  return [
    "Visual artifact context:",
    `Title: ${visual.title}`,
    `Kind: ${visual.kind}`,
    `Format: ${visual.format}`,
    `Purpose: ${spec.purpose}`,
    `Layout: ${spec.layout}`,
    `Style: ${spec.style}`,
    `Sections: ${spec.sections.join(", ")}`,
    `Components: ${spec.components.join(", ")}`,
    form,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildComparisonEvidence(attachments: WorkspaceAttachment[], newAttachmentIds = new Set<string>()): ComparisonEvidenceFact[] {
  if (attachments.length < 2) return [];

  const newest = attachments.filter((attachment) => newAttachmentIds.has(attachment.fileId));
  const previous = attachments.filter((attachment) => !newAttachmentIds.has(attachment.fileId));
  const pairs =
    newest.length && previous.length
      ? newest.flatMap((current) => previous.map((prior) => [current, prior] as const))
      : attachments.slice(-1).flatMap((current) => attachments.slice(0, -1).map((prior) => [current, prior] as const));

  return pairs
    .flatMap(([current, prior]) => {
      const currentFacts = current.evidenceIndex ?? [];
      const priorFacts = prior.evidenceIndex ?? [];

      return [
        ...compareTlvFacts(current.fileName, prior.fileName, currentFacts, priorFacts),
        ...compareTlvFacts(prior.fileName, current.fileName, priorFacts, currentFacts),
        ...compareNativeFacts(current.fileName, prior.fileName, currentFacts, priorFacts),
        ...compareNativeFacts(prior.fileName, current.fileName, priorFacts, currentFacts),
      ];
    })
    .slice(0, 420);
}

function compareNativeFacts(fileName: string, otherFileName: string, facts: FileEvidenceFact[], otherFacts: FileEvidenceFact[]): ComparisonEvidenceFact[] {
  const current = facts.filter((fact) => fact.kind === "native" && !fact.suppressed);
  const other = new Map(
    otherFacts
      .filter((fact) => fact.kind === "native" && !fact.suppressed)
      .map((fact) => [fact.path, fact]),
  );

  return current
    .flatMap<ComparisonEvidenceFact>((fact) => {
      const match = other.get(fact.path);

      if (!match) {
        return [
          {
            kind: "native-only" as const,
            summary: `${fileName} has native field ${fact.path} that is not present in ${otherFileName}.`,
            fileName,
            otherFileName,
            path: fact.path,
            key: fact.key,
            rawValue: fact.rawValue,
            decimalValue: fact.decimalValue,
            asciiValue: fact.asciiValue,
          },
        ];
      }

      if (fact.rawValue !== match.rawValue) {
        return [
          {
            kind: "native-different" as const,
            summary: `${fileName} has ${fact.path}=${fact.rawValue}; ${otherFileName} has ${match.rawValue}.`,
            fileName,
            otherFileName,
            path: fact.path,
            otherPath: match.path,
            key: fact.key,
            rawValue: fact.rawValue,
            otherRawValue: match.rawValue,
            decimalValue: fact.decimalValue,
            otherDecimalValue: match.decimalValue,
          },
        ];
      }

      return [];
    })
    .slice(0, 120);
}

function compareTlvFacts(fileName: string, otherFileName: string, facts: FileEvidenceFact[], otherFacts: FileEvidenceFact[]): ComparisonEvidenceFact[] {
  const current = facts.filter((fact) => fact.kind === "tlv" && fact.tlvTag && !fact.suppressed);
  const otherBySourceAndTag = new Map<string, FileEvidenceFact[]>();

  otherFacts
    .filter((fact) => fact.kind === "tlv" && fact.tlvTag && !fact.suppressed)
    .forEach((fact) => {
      const key = tlvCompareKey(fact);
      otherBySourceAndTag.set(key, [...(otherBySourceAndTag.get(key) ?? []), fact]);
    });

  return current
    .flatMap<ComparisonEvidenceFact>((fact) => {
      const key = tlvCompareKey(fact);
      const matches = otherBySourceAndTag.get(key) ?? [];
      const sameValue = matches.find((match) => match.decodedValue === fact.decodedValue && match.rawValue === fact.rawValue);

      if (sameValue) return [];

      const sameTagDifferentValue = matches[0];
      if (sameTagDifferentValue) {
        return [
          {
            kind: "tlv-different" as const,
            summary: `${fileName} has TLV tag ${fact.tlvTag} at ${sourcePathForTlv(fact)} with value ${fact.decodedValue}; ${otherFileName} has ${sameTagDifferentValue.decodedValue}.`,
            fileName,
            otherFileName,
            path: fact.path,
            otherPath: sameTagDifferentValue.path,
            tlvTag: fact.tlvTag,
            tlvLength: fact.tlvLength,
            rawValue: fact.rawValue,
            otherRawValue: sameTagDifferentValue.rawValue,
            decodedValue: fact.decodedValue,
            otherDecodedValue: sameTagDifferentValue.decodedValue,
            decimalValue: fact.decimalValue,
            otherDecimalValue: sameTagDifferentValue.decimalValue,
            asciiValue: fact.asciiValue,
            otherAsciiValue: sameTagDifferentValue.asciiValue,
          },
        ];
      }

      return [
        {
          kind: "tlv-only" as const,
          summary: `${fileName} has TLV tag ${fact.tlvTag} at ${sourcePathForTlv(fact)} that is not present in ${otherFileName}.`,
          fileName,
          otherFileName,
          path: fact.path,
          tlvTag: fact.tlvTag,
          tlvLength: fact.tlvLength,
          rawValue: fact.rawValue,
          decodedValue: fact.decodedValue,
          decimalValue: fact.decimalValue,
          asciiValue: fact.asciiValue,
        },
      ];
    })
    .slice(0, 180);
}

function tlvCompareKey(fact: FileEvidenceFact) {
  return `${sourcePathForTlv(fact)}::${fact.tlvTag}`;
}

function sourcePathForTlv(fact: FileEvidenceFact) {
  return fact.path.replace(/<tlv>\[\d+\]$/, "");
}

function trimForModel(value: string) {
  if (value.length <= 18000) return value;
  return `${value.slice(0, 18000)}\n\n[File content truncated for this request.]`;
}

function rankEvidenceForObjective(facts: FileEvidenceFact[], objective: string): RankedEvidenceFact[] {
  const terms = objectiveTerms(objective);
  const numbers = objectiveNumbers(objective);
  const targetVariants = createTargetVariants(objective);
  const securityQuestion = /\b(key|cert|certificate|rsa|hash|signature|modulus|capk|security|crypt|public key|private key)\b/i.test(objective);
  const asksLimit = /\b(limit|threshold|max|maxim|minimum|min|amount|over|under|greater|less|above|below)\b/i.test(objective);
  const asksFlag = /\b(enable|enabled|disable|disabled|flag|allow|allowed|available|availability|capability|support|supported|active|inactive|on|off|true|false)\b/i.test(objective);
  const asksBehavior = /\b(mode|behavior|behaviour|setting|config|option|policy|rule|control|feature|can|cannot|can't|writable|loaded)\b/i.test(objective);

  return facts
    .map((fact) => {
      if (fact.suppressed && !securityQuestion) {
        return { ...fact, score: -1000 };
      }

      const searchable = `${fact.path} ${fact.key ?? ""} ${fact.rawValue} ${fact.decodedValue ?? ""} ${fact.asciiValue ?? ""} ${fact.decimalValue ?? ""} ${fact.parentContext ?? ""}`.toLowerCase();
      const matchedTargetVariants = targetVariants.filter((variant) => searchable.includes(variant.toLowerCase()));
      let score = 0;

      terms.forEach((term) => {
        if (searchable.includes(term)) score += 8;
      });

      if (fact.kind === "tlv") score += 5;
      if (fact.kind === "native") score += 3;
      if (fact.kind === "nested-json" || fact.kind === "nested-xml") score += 2;

      if (fact.controlHint) score += 10;
      if (asksLimit && /\b(limit|threshold|max|min|amount|amt|floor|ceiling|cap|value|timeout|duration|interval|retry|count)\b/i.test(searchable)) score += 22;
      if (asksFlag && /\b(enable|enabled|disable|disabled|flag|allow|allowed|available|availability|capability|support|supported|active|inactive|on|off|true|false)\b/i.test(searchable)) score += 24;
      if (asksFlag && fact.controlHint?.includes("availability")) score += 34;
      if (asksFlag && fact.controlHint?.includes("boolean")) score += 24;
      if (asksBehavior && fact.controlHint) score += 18;
      if (asksLimit && fact.controlHint?.includes("limit")) score += 34;

      numbers.forEach((number) => {
        if (fact.decimalValue === number.value) score += 40;
        if (fact.decimalValue === number.value * 100) score += 26;
        if (fact.decimalValue === number.value * 1000) score += 18;
        if (fact.decimalValue === Math.round(number.value / 100)) score += 16;
        if (fact.decimalValue === Math.round(number.value / 1000)) score += 12;
        if (searchable.includes(String(number.value))) score += 24;
        if (number.hex && searchable.includes(number.hex.toLowerCase())) score += 24;
      });

      if (matchedTargetVariants.length > 0) score += 60 + matchedTargetVariants.length * 8;
      if (fact.suppressed && securityQuestion) score += 20;

      return { ...fact, score, matchedTargetVariants };
    })
    .filter((fact) => fact.score > -1000)
    .sort((a, b) => b.score - a.score)
    .slice(0, 240);
}

function createTargetVariants(objective: string) {
  const variants = new Set<string>();

  objectiveTerms(objective).forEach((term) => variants.add(term));

  objectiveNumbers(objective).forEach((number) => {
    const decimal = String(number.value);
    variants.add(decimal);
    variants.add(number.value.toLocaleString("en-US"));

    if (number.hex) {
      variants.add(number.hex);
      variants.add(`0x${number.hex}`);
      variants.add(number.hex.padStart(4, "0"));
      variants.add(number.hex.padStart(6, "0"));
      variants.add(number.hex.padStart(8, "0"));
    }

    [10, 100, 1000].forEach((multiplier) => {
      const minor = Math.round(number.value * multiplier);
      variants.add(String(minor));
      variants.add(minor.toString(16).toUpperCase());
      variants.add(minor.toString(16).toUpperCase().padStart(8, "0"));
    });

    if (number.value % 10 === 0) variants.add(String(number.value / 10));
    if (number.value % 100 === 0) variants.add(String(number.value / 100));
    if (number.value % 1000 === 0) variants.add(String(number.value / 1000));
  });

  Array.from(objective.matchAll(/\b[A-Z]{2,}\d+[A-Z0-9-]*\b/gi)).forEach((match) => {
    variants.add(match[0]);
    variants.add(match[0].replace(/-/g, ""));
  });

  return Array.from(variants).filter((variant) => variant.length > 0);
}

function objectiveTerms(objective: string) {
  const stopWords = new Set(["the", "this", "that", "with", "from", "over", "under", "what", "which", "where", "when", "does", "have", "into", "about", "file"]);

  return objective
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

function objectiveNumbers(objective: string) {
  return Array.from(objective.matchAll(/\b\d[\d,]*(?:\.\d+)?\s*k?\b/gi)).map((match) => {
    const raw = match[0].trim();
    const multiplier = /k$/i.test(raw) ? 1000 : 1;
    const value = Number(raw.replace(/k$/i, "").replace(/,/g, "")) * multiplier;
    const rounded = Math.round(value);

    return {
      value: rounded,
      hex: Number.isFinite(rounded) ? rounded.toString(16).toUpperCase() : "",
    };
  });
}
