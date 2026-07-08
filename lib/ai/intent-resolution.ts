import type { ReasoningRequest } from "@/lib/ai/context";
import { looksLikeDiagnosticPaste } from "@/lib/mission-engine";

export type RequestedAction =
  | "recommendation"
  | "explanation"
  | "step-by-step instructions"
  | "comparison"
  | "correction"
  | "continuation"
  | "implementation"
  | "verification"
  | "direct answer";

export type IntentResolution = {
  literalAsk: string;
  plausibleInterpretations: string[];
  mostLikelyInterpretation: string;
  canAnswerMultipleSafely: boolean;
  clarificationRequired: boolean;
  clarificationReason: string;
  relationship: "new objective" | "follow-up";
  referenceType:
    | "previous answer"
    | "pasted prior answer snippet"
    | "previous option"
    | "new evidence"
    | "attached evidence"
    | "generated artifact"
    | "previous command"
    | "previous error"
    | "previous recommendation"
    | "current request";
  referenceConfidence: "high" | "medium" | "low";
  referenceDetail: string;
  requestedAction: RequestedAction;
  resolvedOption?: string;
  focusedQuestion: string;
  evidenceInstruction: string;
};

export function resolveIntent(request: ReasoningRequest): IntentResolution {
  const hasPriorContext = request.priorMessages.length > 0 || Boolean(request.lastResult);
  const hasNewEvidence = request.investigation.newAttachmentIds.length > 0;
  const focusedQuestion = extractFinalQuestion(request.userMessage);
  const excerpt = extractBackgroundExcerpt(request.userMessage, focusedQuestion);
  const matchedPrior = excerpt ? findQuotedPriorAnswerReference(excerpt, request.priorMessages) : undefined;
  const priorOptions = extractPriorOptions(request.priorMessages);
  const currentMessageOptions = extractOptionsFromText(request.userMessage);
  const resolvedOption = resolvePriorOptionReference(request.userMessage, [...currentMessageOptions, ...priorOptions]);
  const requestedAction = classifyRequestedAction(request.userMessage);
  const evidenceInstruction = evidenceHandlingInstruction(request);
  const artifact = request.conversationContext.artifacts.at(0);
  const plausibleInterpretations = inferPlausibleInterpretations(request, focusedQuestion, resolvedOption);

  let referenceType: IntentResolution["referenceType"] = "current request";
  let referenceConfidence: IntentResolution["referenceConfidence"] = hasPriorContext ? "medium" : "high";
  let referenceDetail = "Answer the current user message directly.";

  if (hasNewEvidence) {
    const newEvidence = request.investigation.evidenceReviewed.filter((item) => item.role === "new");
    referenceType = "new evidence";
    referenceConfidence = "high";
    referenceDetail = newEvidence.length
      ? newEvidence.map((item) => `${item.fileName} (${item.evidenceKind}, ${item.fileType})`).join("; ")
      : "New evidence was attached in this turn.";
  } else if (resolvedOption) {
    referenceType = "previous option";
    referenceConfidence = "high";
    referenceDetail = "The user is asking about one of the options from the prior answer.";
  } else if (matchedPrior) {
    referenceType = "pasted prior answer snippet";
    referenceConfidence = "high";
    referenceDetail = matchedPrior;
  } else if (looksLikeQuestionAboutPriorRecommendation(request.userMessage)) {
    referenceType = "previous recommendation";
    referenceConfidence = hasPriorContext ? "high" : "low";
    referenceDetail = hasPriorContext ? summarizeLatestAssistantAnswer(request) : "No prior recommendation is available in the supplied context.";
  } else if (looksLikeQuestionAboutPreviousCommand(request.userMessage)) {
    referenceType = "previous command";
    referenceConfidence = hasPriorContext ? "high" : "low";
    referenceDetail = hasPriorContext ? summarizeLatestAssistantAnswer(request) : "No prior command is available in the supplied context.";
  } else if (looksLikeDiagnosticPaste(request.userMessage)) {
    referenceType = "previous error";
    referenceConfidence = "high";
    referenceDetail = "The latest user message contains command output, logs, or diagnostic text. Diagnose this latest evidence first.";
  } else if (hasPriorContext && request.troubleshooting.active) {
    referenceType = "previous error";
    referenceConfidence = "high";
    referenceDetail =
      request.troubleshooting.currentBlocker?.excerpt ??
      request.troubleshooting.previousIssues[0]?.excerpt ??
      "Continue the active troubleshooting investigation from the current thread state.";
  } else if (artifact && looksLikeArtifactReference(request.userMessage)) {
    referenceType = "generated artifact";
    referenceConfidence = "high";
    referenceDetail = `${artifact.title} (${artifact.kind}): ${artifact.description}`;
  } else if (hasPriorContext && isLikelyFollowUpMessage(request.userMessage)) {
    referenceType = "previous answer";
    referenceConfidence = "high";
    referenceDetail = summarizeLatestAssistantAnswer(request);
  } else if (!hasPriorContext) {
    referenceConfidence = "high";
  }

  const relationship: IntentResolution["relationship"] =
    hasPriorContext && (referenceType !== "current request" || isLikelyFollowUpMessage(request.userMessage) || hasNewEvidence || request.troubleshooting.active)
      ? "follow-up"
      : "new objective";
  const canAnswerMultipleSafely = plausibleInterpretations.length > 1 && canSafelyCoverMultiple(request, requestedAction);
  const clarificationRequired = referenceConfidence === "low" && !canAnswerMultipleSafely;

  return {
    literalAsk: clipOneLine(request.userMessage, 700),
    plausibleInterpretations,
    mostLikelyInterpretation: plausibleInterpretations[0] ?? focusedQuestion,
    canAnswerMultipleSafely,
    clarificationRequired,
    clarificationReason: clarificationRequired
      ? "The referenced prior item cannot be resolved from the available context and choosing one path would materially change the answer."
      : "Enough context is available to answer without interrupting the user.",
    relationship,
    referenceType,
    referenceConfidence,
    referenceDetail,
    requestedAction,
    resolvedOption,
    focusedQuestion,
    evidenceInstruction,
  };
}

export function isInstructionalRequest(message: string) {
  return /\b(how do i|how to|step by step|steps?|instructions?|walkthrough|guide|setup|set up|install|configure|integrate|migrate|repair|reinstall|uninstall|what to do next|what should i do|what do i do|what now|next|recommend|which would you recommend)\b/i.test(
    message,
  ) || isOperationalTroubleshootingRequest(message);
}

export function isOperationalTroubleshootingRequest(message: string) {
  return /\b(error|failed|failure|cannot|can't|unable|problem|conflict|modified|validate|patch cannot be applied|update|updater|install|installation|reinstall|uninstall|repair|restore|backup|certificate|cacerts|jbr|android studio|gradle)\b/i.test(message);
}

export function isLikelyFollowUpMessage(message: string) {
  const text = message.trim().toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (hasFollowUpIntentShape(message)) return true;
  if (wordCount <= 8 && /[?]$/.test(text)) return true;
  if (/\b(this|that|it|these|those|above|previous|earlier|same|option|recommend|elaborate|what about|how about|why|can i|should i|does this|is this)\b/.test(text)) return true;
  if (/^(yes|yes please|ok|okay|sure|go ahead|do that|continue|nice|thanks|thank you|wow|looks good)\b/.test(text)) return true;

  return false;
}

export function hasFollowUpIntentShape(message: string) {
  return (
    hasResultUpdateShape(message) ||
    hasEvidenceUpdateShape(message) ||
    hasPlacementQuestionShape(message) ||
    hasCompleteArtifactRequestShape(message) ||
    hasRecommendationFollowUpShape(message)
  );
}

export function hasResultUpdateShape(message: string) {
  const text = normalizeIntentText(message);
  const changeOrAttempt = /\b(after|since|now|still|again|same|unchanged|different|changed|updated|added|removed|replaced|moved|synced|syncing|rebuilt|reran|ran|retried|tried|applied|installed|restarted|refreshed)\b/i;
  const resultOrFailure = /\b(error|issue|problem|failure|failed|fails|failing|blocked|stuck|build|sync|run|test|install|compile|log|output|result|trace|exception)\b/i;

  return (
    boundedPair(text, changeOrAttempt, resultOrFailure) ||
    boundedPair(text, resultOrFailure, changeOrAttempt)
  );
}

export function hasSuccessfulProgressUpdate(message: string) {
  const text = normalizeIntentText(message);
  if (!text) return false;
  if (/\b(still|again|same|unchanged|failed|fails|failing|error|exception|blocked|stuck|cannot|can't|unable|not working|didn'?t work|doesn'?t work)\b/i.test(text)) {
    return false;
  }

  const successAction =
    /\b(imported|installed|added|configured|set up|setup|connected|fixed|resolved|worked|working|passed|successful|successfully|done|completed|verified|confirmed|ran|synced|built|started|launched|opened)\b/i;
  const continuationAsk = /\b(what\s*(?:now|next)|next\s*(?:steps?|thing)?|now what|what should i do|what do i do|anything else|continue|go on|after that)\b/i;

  return successAction.test(text) || (continuationAsk.test(text) && /\b(ok|okay|great|nice|cool|that worked|it worked|done)\b/i.test(text));
}

export function hasEvidenceUpdateShape(message: string) {
  const text = normalizeIntentText(message);
  const evidenceVerb = /\b(attached|uploaded|pasted|sent|sending|sharing|included|provided|added|here(?:'s| is)|new|latest|current|updated)\b/i;
  const evidenceNoun = /\b(logs?|trace|stack|output|error|result|file|files|screenshot|image|config|source|code|snippet|diff|report|artifact)\b/i;

  return boundedPair(text, evidenceVerb, evidenceNoun) || boundedPair(text, evidenceNoun, evidenceVerb);
}

export function hasPlacementQuestionShape(message: string) {
  const text = normalizeIntentText(message);
  const placeQuestion = /\b(where|which|what)\b.{0,50}\b(file|folder|section|block|place|location|path)\b/i;
  const editAction = /\b(add|put|paste|place|insert|merge|replace|edit|move|go|goes|belong|belongs)\b/i;

  return boundedPair(text, placeQuestion, editAction) || /\b(where|which file|what file)\b.{0,90}\b(add|put|paste|insert|merge|replace|edit|goes?|belongs?)\b/i.test(text);
}

export function hasCompleteArtifactRequestShape(message: string) {
  const text = normalizeIntentText(message);
  const deliveryVerb = /\b(send|show|give|provide|paste|write|return|generate)\b/i;
  const completeScope = /\b(full|complete|entire|whole|single|one|copyable|valid)\b/i;
  const artifact = /\b(file|snippet|block|code|config|replacement|version|example)\b/i;
  const avoidSplit = /\b(?:do not|don't|dont|no|not)\b.{0,50}\b(split|separate|break|multiple|partial|fake)\b.{0,50}\b(blocks?|snippets?|sections?|parts?)\b/i;

  return (boundedPair(text, deliveryVerb, completeScope) && artifact.test(text)) || avoidSplit.test(text);
}

export function hasRecommendationFollowUpShape(message: string) {
  const text = normalizeIntentText(message);
  const asksRecommendation = /\b(recommend|suggest|advise|choose|pick|prefer|best|better|which|what would you|what should i|would you)\b/i;
  const threadReference = /\b(this|that|these|those|option|approach|one|above|previous|earlier|given|between|from)\b/i;

  return asksRecommendation.test(text) && (threadReference.test(text) || text.split(/\s+/).filter(Boolean).length <= 18);
}

function boundedPair(text: string, first: RegExp, second: RegExp, distance = 120) {
  return new RegExp(`${first.source}.{0,${distance}}${second.source}`, "i").test(text);
}

function normalizeIntentText(message: string) {
  return message.replace(/\s+/g, " ").trim();
}

export function extractFinalQuestion(message: string) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const finalQuestionLine = [...lines].reverse().find((line) => line.includes("?"));

  return finalQuestionLine ?? message.trim();
}

export function extractBackgroundExcerpt(message: string, finalQuestion: string) {
  const text = message.trim();
  if (!text || text === finalQuestion) return "";

  const index = text.lastIndexOf(finalQuestion);
  const excerpt = index >= 0 ? text.slice(0, index).trim() : text;

  return clipOneLine(excerpt, 1200);
}

export function summarizeAssistantForFollowUp(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  const firstUsefulSentence = normalized
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => sentence.length > 20 && !/^here'?s\b/i.test(sentence.trim()));

  return clipOneLine(firstUsefulSentence ?? normalized, 420);
}

export function findQuotedPriorAnswerReference(excerpt: string, priorMessages: ReasoningRequest["priorMessages"]) {
  const assistantMessages = [...priorMessages].reverse().filter((message) => /\b(foundry|assistant|system)\b/i.test(message.author));
  let bestMatch = "";
  let bestScore = 0;

  assistantMessages.forEach((message) => {
    const score = textOverlapScore(excerpt, message.body);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = message.body;
    }
  });

  if (bestScore < 0.42) return undefined;

  return summarizeAssistantForFollowUp(bestMatch);
}

export function clipOneLine(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized;
}

function inferPlausibleInterpretations(request: ReasoningRequest, focusedQuestion: string, resolvedOption?: string) {
  const interpretations = new Set<string>();
  const text = request.userMessage.toLowerCase();

  if (resolvedOption) interpretations.add(`They are asking about this referenced option: ${resolvedOption}`);
  if (request.investigation.newAttachmentIds.length) interpretations.add("They want the newest attached evidence interpreted in the current work item.");
  if (looksLikeDiagnosticPaste(request.userMessage)) interpretations.add("They want the latest pasted command output or error diagnosed.");
  if (isLikelyFollowUpMessage(request.userMessage)) interpretations.add("They are continuing the previous answer rather than starting a new topic.");
  if (/\b(how do i|how to|flush|install|configure|run|deploy|setup|set up|fix)\b/i.test(request.userMessage)) {
    interpretations.add("They want practical instructions, including commands and verification.");
  }
  if (/\b(windows|powershell|cmd)\b/.test(text)) interpretations.add("They likely need the Windows/PowerShell path first.");
  if (/\b(mac|macos|linux|bash|terminal)\b/.test(text)) interpretations.add("They likely need a macOS/Linux terminal path.");
  interpretations.add(focusedQuestion);

  return Array.from(interpretations).slice(0, 5);
}

function canSafelyCoverMultiple(request: ReasoningRequest, requestedAction: RequestedAction) {
  if (requestedAction === "implementation") return false;
  if (request.desiredOutcome === "code" && /\b(delete|remove|replace|migrate|reset|drop)\b/i.test(request.userMessage)) return false;
  return true;
}

function evidenceHandlingInstruction(request: ReasoningRequest) {
  const newEvidence = request.investigation.evidenceReviewed.filter((item) => item.role === "new");
  const previousEvidence = request.investigation.evidenceReviewed.filter((item) => item.role === "previous");

  if (newEvidence.length) {
    return [
      `New evidence this turn: ${newEvidence.map((item) => `${item.fileName} (${item.evidenceKind})`).join(", ")}.`,
      previousEvidence.length ? "Compare it with previous evidence before answering." : "Analyze it as the first evidence in this work item.",
      "Name the evidence by its actual type. Do not call logs, text, configs, or pasted snippets screenshots.",
    ].join(" ");
  }

  if (request.attachments.length) {
    return [
      `Existing evidence available: ${request.attachments.map((item) => `${item.fileName} (${item.evidenceKind})`).join(", ")}.`,
      "Use it only when it is relevant to the current reference or question.",
    ].join(" ");
  }

  return "No file evidence is attached. Answer from the conversation context and clearly state any unknowns.";
}

function classifyRequestedAction(message: string): RequestedAction {
  const text = message.toLowerCase();

  if (/\b(recommend|advise|suggest|which|better|best|should i|would you use|would you choose)\b/.test(text)) return "recommendation";
  if (/\b(step by step|instructions?|walkthrough|guide|how do i|how to|show me how|what to do next)\b/.test(text)) return "step-by-step instructions";
  if (/\b(compare|difference|different|versus| vs |what changed|changed|same)\b/.test(text)) return "comparison";
  if (/\b(is this correct|correct|wrong|fix|instead|actually|change|edit)\b/.test(text)) return "correction";
  if (/\b(does this fix|verify|check|confirm|test|worked|working)\b/.test(text)) return "verification";
  if (/\b(continue|go ahead|yes please|yes|do that|do it|sounds good)\b/.test(text)) return "continuation";
  if (/\b(implement|create file|write code|build this|build it|apply|patch)\b/.test(text)) return "implementation";
  if (/\b(why|explain|elaborate|what does|what is|mean|means)\b/.test(text)) return "explanation";

  return "direct answer";
}

function extractPriorOptions(priorMessages: ReasoningRequest["priorMessages"]) {
  const latestAssistant = [...priorMessages].reverse().find((message) => /\b(foundry|assistant|system)\b/i.test(message.author));
  if (!latestAssistant) return [] as Array<{ label: string; text: string }>;

  return extractOptionsFromText(latestAssistant.body);
}

function extractOptionsFromText(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const options: Array<{ label: string; text: string }> = [];

  lines.forEach((line, index) => {
    const match = line.match(/^(?:[-*]\s*)?(?:(option\s+[a-z0-9]+)|([a-z])\)|(\d+)[.)])\s*[:.-]?\s*(.+)$/i);
    if (!match) return;

    const label = (match[1] ?? match[2] ?? match[3] ?? `${index + 1}`).toLowerCase().replace(/\s+/g, " ");
    options.push({
      label,
      text: clipOneLine(line, 500),
    });
  });

  return options;
}

function resolvePriorOptionReference(message: string, options: Array<{ label: string; text: string }>) {
  if (!options.length) return undefined;
  const text = message.toLowerCase();
  const ordinalMap: Record<string, number> = {
    first: 0,
    second: 1,
    third: 2,
    fourth: 3,
    fifth: 4,
  };

  for (const option of options) {
    const rawLabel = option.label.replace(/^option\s+/, "");
    if (text.includes(option.label) || text.includes(`option ${rawLabel}`)) return option.text;
  }

  for (const [word, index] of Object.entries(ordinalMap)) {
    if (text.includes(`${word} option`) || text.includes(`option ${index + 1}`) || text.includes(`#${index + 1}`)) {
      return options[index]?.text;
    }
  }

  if (hasRecommendationFollowUpShape(message)) {
    return options.map((option) => option.text).join(" | ");
  }

  return undefined;
}

function looksLikeQuestionAboutPriorRecommendation(message: string) {
  return /\b(recommend|advise|suggest|which|better|best|should i|would you choose|what would you)\b/i.test(message);
}

function looksLikeQuestionAboutPreviousCommand(message: string) {
  return /\b(command|run|ran|output|terminal|powershell|cmd|bash|shell|result)\b/i.test(message);
}

function looksLikeArtifactReference(message: string) {
  return /\b(this|that|it|artifact|sketch|mockup|diagram|image|visual|version|build this|customize|regenerate)\b/i.test(message);
}

function summarizeLatestAssistantAnswer(request: ReasoningRequest) {
  const latestAssistant = [...request.priorMessages].reverse().find((message) => /\b(foundry|assistant|system)\b/i.test(message.author));
  if (!latestAssistant) return request.lastResult ? clipOneLine(request.lastResult, 500) : "No prior assistant answer is available in the supplied context.";

  return summarizeAssistantForFollowUp(latestAssistant.body);
}

function textOverlapScore(a: string, b: string) {
  const aTerms = meaningfulTerms(a);
  const bTerms = new Set(meaningfulTerms(b));
  if (aTerms.length === 0 || bTerms.size === 0) return 0;

  return aTerms.filter((term) => bTerms.has(term)).length / aTerms.length;
}

function meaningfulTerms(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .filter((term) => !["the", "and", "for", "from", "that", "this", "with", "you", "your", "into", "would", "what", "which"].includes(term));
}
