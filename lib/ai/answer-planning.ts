import type { ReasoningRequest } from "@/lib/ai/context";
import {
  clipOneLine,
  extractBackgroundExcerpt,
  extractFinalQuestion,
  findQuotedPriorAnswerReference,
  hasSuccessfulProgressUpdate,
  resolveIntent,
  summarizeAssistantForFollowUp,
  type IntentResolution,
} from "@/lib/ai/intent-resolution";
import { looksLikeDiagnosticPaste } from "@/lib/mission-engine";

export type AnswerPlan = {
  intent: IntentResolution;
  userObjective: string;
  likelyPlatform: string;
  likelyEnvironment: string;
  evidenceAvailable: string;
  previousConversation: string;
  attachedFiles: string;
  currentWorkItem: string;
  workflowProgress: string;
  completedSteps: string;
  alreadyExplainedSteps: string;
  currentStep: string;
  blockedStep: string;
  nextStep: string;
  memoryInstruction: string;
  recommendedApproach: string;
  alternativeApproaches: string;
  verification: string;
  likelyNextQuestion: string;
  answerScope: string;
  responseChecklist: string;
  depthPlanner: string;
  branchingPolicy: string;
};

export function createAnswerPlan(request: ReasoningRequest): AnswerPlan {
  const intent = resolveIntent(request);

  return {
    intent,
    userObjective: inferUserObjective(request, intent),
    likelyPlatform: inferPlatform(request),
    likelyEnvironment: inferEnvironment(request),
    evidenceAvailable: summarizeEvidenceAvailability(request),
    previousConversation: summarizePreviousConversation(request),
    attachedFiles: summarizeAttachedFiles(request),
    currentWorkItem: `${request.conversationContext.currentWorkItem.title}: ${request.conversationContext.currentWorkItem.objective || "objective not set"}`,
    workflowProgress: summarizeWorkflowProgress(request),
    completedSteps: summarizeList(request.conversationContext.workflowState.completedSteps, "None confirmed yet."),
    alreadyExplainedSteps: summarizeList(request.conversationContext.workflowState.alreadyTold, "None identified yet."),
    currentStep: request.conversationContext.workflowState.currentStep,
    blockedStep: request.conversationContext.workflowState.blockedStep || "No active blocker identified.",
    nextStep: request.conversationContext.workflowState.nextStep,
    memoryInstruction: request.conversationContext.workflowState.guidanceRule,
    recommendedApproach: recommendedApproachFor(request, intent),
    alternativeApproaches: alternativesFor(request, intent),
    verification: verificationFor(request, intent),
    likelyNextQuestion: likelyNextQuestionFor(intent),
    answerScope: answerScopeFor(intent),
    responseChecklist: universalResponseChecklist(intent),
    depthPlanner: depthPlannerFor(request, intent),
    branchingPolicy: branchingPolicyFor(request, intent),
  };
}

export function formatAnswerPlan(plan: AnswerPlan) {
  return [
    "Intent resolution:",
    `- Literal ask: ${plan.intent.literalAsk}`,
    `- Plausible interpretations: ${plan.intent.plausibleInterpretations.join(" | ") || "None"}`,
    `- Most likely interpretation: ${plan.intent.mostLikelyInterpretation}`,
    `- Can safely answer multiple interpretations: ${plan.intent.canAnswerMultipleSafely ? "yes" : "no"}`,
    `- Clarification required: ${plan.intent.clarificationRequired ? "yes" : "no"} (${plan.intent.clarificationReason})`,
    `- Relationship to current work item: ${plan.intent.relationship}`,
    `- Reference target: ${plan.intent.referenceType} (${plan.intent.referenceConfidence} confidence)`,
    `- Resolved reference: ${plan.intent.referenceDetail}`,
    plan.intent.resolvedOption ? `- Resolved option: ${plan.intent.resolvedOption}` : "",
    `- User wants: ${plan.intent.requestedAction}`,
    `- Exact question to answer: ${plan.intent.focusedQuestion}`,
    `- Evidence handling: ${plan.intent.evidenceInstruction}`,
    "",
    "Answer plan:",
    `- User objective: ${plan.userObjective}`,
    `- Likely platform: ${plan.likelyPlatform}`,
    `- Likely environment: ${plan.likelyEnvironment}`,
    `- Evidence available: ${plan.evidenceAvailable}`,
    `- Previous conversation: ${plan.previousConversation}`,
    `- Attached files: ${plan.attachedFiles}`,
    `- Current work item: ${plan.currentWorkItem}`,
    `- Workflow progress: ${plan.workflowProgress}`,
    `- Completed steps: ${plan.completedSteps}`,
    `- Already explained steps: ${plan.alreadyExplainedSteps}`,
    `- Current step: ${plan.currentStep}`,
    `- Blocked step: ${plan.blockedStep}`,
    `- Next step: ${plan.nextStep}`,
    `- Memory instruction: ${plan.memoryInstruction}`,
    `- Recommended approach: ${plan.recommendedApproach}`,
    `- Alternative approaches: ${plan.alternativeApproaches}`,
    `- Verification: ${plan.verification}`,
    `- Likely next question: ${plan.likelyNextQuestion}`,
    `- Answer scope: ${plan.answerScope}`,
    `- Response checklist: ${plan.responseChecklist}`,
    `- Depth planner: ${plan.depthPlanner}`,
    `- Branching policy: ${plan.branchingPolicy}`,
    "Keep this plan internal. Do not expose these labels, confidence terms, or planning mechanics in the user-facing answer.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function isTargetedFollowUp(request: ReasoningRequest, plan = createAnswerPlan(request)) {
  const hasPriorContext = request.priorMessages.length > 0 || Boolean(request.lastResult);
  if (!hasPriorContext) return false;
  if (request.attachments.some((attachment) => request.investigation.newAttachmentIds.includes(attachment.fileId))) return false;
  if (looksLikeDiagnosticPaste(request.userMessage)) return false;

  if (plan.intent.relationship === "follow-up" && plan.intent.referenceConfidence !== "low" && plan.intent.requestedAction !== "implementation") return true;

  const normalized = request.userMessage.replace(/\s+/g, " ").trim();
  const lines = request.userMessage.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const finalLine = lines.at(-1) ?? normalized;
  const hasQuestion = normalized.includes("?");
  const hasExcerptThenQuestion = lines.length >= 2 && finalLine.includes("?");
  const hasOptionStructure = lines.some((line) => /^option\s+\S+[:.)-]/i.test(line));
  const compactFollowUp = normalized.length <= 900 && hasQuestion;

  return hasExcerptThenQuestion || hasOptionStructure || compactFollowUp;
}

export function targetedFollowUpInstruction(request: ReasoningRequest, targeted = isTargetedFollowUp(request)) {
  const hasPriorContext = request.priorMessages.length > 0 || Boolean(request.lastResult);

  if (!hasPriorContext || !targeted) return "";

  return [
    "Follow-up handling: HARD CONSTRAINT",
    "This is a targeted follow-up inside the current work item.",
    "Answer only the specific decision, recommendation, comparison, or clarification being asked in the latest user message.",
    "If the latest user message contains an excerpt plus a final question, treat the excerpt as the focus and answer the final question.",
    "If a prior option is resolved, answer only the option decision. Do not restate the entire original instruction set.",
    "If the user asks to elaborate, elaborate on the immediately previous answer or referenced section, not the whole work item from the beginning.",
    "Do not restart, regenerate, summarize, or repeat the full prior guide unless the user explicitly asks for the full guide again.",
  ].join("\n");
}

export function formatTargetedFollowUpContext(request: ReasoningRequest, followUpResolution: string, plan = createAnswerPlan(request)) {
  const latestUserBeforeThis = [...request.priorMessages]
    .reverse()
    .find((message) => !/\b(foundry|assistant|system)\b/i.test(message.author));
  const latestAssistant = [...request.priorMessages]
    .reverse()
    .find((message) => /\b(foundry|assistant|system)\b/i.test(message.author));
  const question = extractFinalQuestion(request.userMessage);
  const excerpt = extractBackgroundExcerpt(request.userMessage, question);
  const quotedReference = excerpt ? findQuotedPriorAnswerReference(excerpt, request.priorMessages) : undefined;
  const successfulProgressUpdate = hasSuccessfulProgressUpdate(request.userMessage);

  return [
    `Thread title: ${request.missionTitle}`,
    `Expected work type: ${request.desiredOutcome}`,
    "Internal answer plan:",
    formatAnswerPlan(plan),
    targetedFollowUpInstruction(request, true),
    "Focused follow-up mode:",
    "The prior long answer is intentionally omitted from this request payload so it cannot be repeated.",
    "Use the prior context only to understand the work item. Do not continue or regenerate the previous guide.",
    "If a step appears in the already explained steps from the answer plan, treat it as known context. Do not paste those instructions again; move to the user's current check, blocker, decision, or next step.",
    successfulProgressUpdate
      ? [
          "Successful progress handoff:",
          "The latest user message says a prior or current step succeeded or was completed.",
          "Treat that step as complete and continue from the immediate prior handoff or the next workflow action.",
          "Do not claim an older error is still happening unless the latest user message or current-turn evidence explicitly says it still fails.",
          "Do not rewrite the user's casual success wording into awkward grammar; acknowledge progress naturally and then give the next useful action.",
          "Use old logs or attachments only as background for what the completed step was meant to unblock, not as current failure evidence.",
        ].join("\n")
      : "",
    latestUserBeforeThis ? `Previous user request, for work-item context only: ${clipOneLine(latestUserBeforeThis.body, 500)}` : "",
    latestAssistant ? `Previous Foundry answer summary, for context only: ${summarizeAssistantForFollowUp(latestAssistant.body)}` : "",
    quotedReference
      ? `Reference resolution: The user pasted or paraphrased part of a previous Foundry answer. Treat the pasted text as the referenced section, not as a new instruction to expand. Matched prior section: ${quotedReference}`
      : "",
    followUpResolution ? "Resolved follow-up intent:" : "",
    followUpResolution,
    excerpt ? "User-provided excerpt/background:" : "",
    excerpt,
    "Question to answer now:",
    question,
    looksLikeDiagnosticPaste(request.userMessage)
      ? "Latest message type: terminal/log diagnostic evidence. Diagnose the latest command and output first."
      : "",
    "Final constraint: answer only the question above. If the answer is a recommendation between options, pick the recommended option and explain why. If you name alternatives, include the concrete steps or decision criteria needed to use those alternatives; otherwise omit them. Do not repeat unrelated already explained instructions.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function resolveShortApprovalFollowUp(request: ReasoningRequest) {
  if (!isShortApproval(request.userMessage)) return "";

  const lastAssistant = [...request.priorMessages].reverse().find((message) => /\b(foundry|assistant|system)\b/i.test(message.author));
  if (!lastAssistant) return "";

  const offer = extractConcreteOffer(lastAssistant.body);
  if (!offer) return "";

  return [
    `The user's short reply "${request.userMessage}" accepts the previous offer/recommendation.`,
    `Continue this exact offer: ${offer}`,
    "If the offer mentioned compatible options with 'or' (for example responsive or more fields), include the reasonable combined continuation instead of choosing an unrelated alternative.",
  ].join("\n");
}

function answerScopeFor(intent: IntentResolution) {
  if (intent.referenceType === "previous option" && intent.requestedAction === "recommendation") {
    return "Recommend between the referenced prior options only. Give the recommended option and why. If alternatives are still useful, include the concrete steps or decision criteria for each named alternative; otherwise omit them. Do not repeat unrelated guide content.";
  }

  if (intent.referenceType === "pasted prior answer snippet") {
    return "Answer only about the pasted or paraphrased snippet and the final question. Do not expand the snippet into a full guide unless explicitly asked.";
  }

  if (intent.requestedAction === "step-by-step instructions") {
    return "Give instructions that include the recommended path, prerequisites, numbered steps, commands or config edits, expected result, common mistakes, verification, and next step. If you mention alternatives, provide usable mini-instructions for each named alternative.";
  }

  if (intent.relationship === "follow-up") {
    return "Continue from the exact referenced point in the current work item. Do not restart the whole explanation.";
  }

  return "Answer the current objective directly with the shortest useful senior-engineer response.";
}

function inferUserObjective(request: ReasoningRequest, intent: IntentResolution) {
  if (request.conversationContext.currentWorkItem.objective) return request.conversationContext.currentWorkItem.objective;
  if (intent.relationship === "follow-up") return `Continue the existing work item by answering: ${intent.focusedQuestion}`;
  return intent.focusedQuestion;
}

function inferPlatform(request: ReasoningRequest) {
  const text = `${request.userMessage}\n${request.priorMessages.map((message) => message.body).join("\n")}`.toLowerCase();

  if (/\bpowershell|windows|cmd\.exe|\bcmd\b|[a-z]:\\/.test(text)) return "Windows first, especially PowerShell when commands are needed.";
  if (/\bmacos|mac os|darwin|zsh\b/.test(text)) return "macOS Terminal first.";
  if (/\blinux|ubuntu|debian|fedora|bash\b/.test(text)) return "Linux Bash first.";
  if (/\bdocker|compose|container\b/.test(text)) return "Docker environment.";
  if (/\bkubectl|kubernetes|k8s\b/.test(text)) return "Kubernetes CLI environment.";
  if (/\baws\b/.test(text)) return "AWS CLI or console environment.";
  if (/\bazure\b/.test(text)) return "Azure CLI or portal environment.";
  return "Unspecified. Infer from available evidence; otherwise include compact platform branches when commands differ.";
}

function inferEnvironment(request: ReasoningRequest) {
  const text = `${request.userMessage}\n${request.priorMessages.map((message) => message.body).join("\n")}`.toLowerCase();

  if (/\bnext\.?js|react|npm|package\.json\b/.test(text)) return "Next.js/React/npm project.";
  if (/\bpnpm\b/.test(text)) return "pnpm JavaScript project.";
  if (/\byarn\b/.test(text)) return "Yarn JavaScript project.";
  if (/\bbun\b/.test(text)) return "Bun JavaScript project.";
  if (/\bpython|pip|venv|pyproject\b/.test(text)) return "Python environment.";
  if (/\bgradle|android studio|kotlin|androidmanifest\b/.test(text)) return "Android/Gradle environment.";
  if (/\bgit\b/.test(text)) return "Git workflow.";
  return request.desiredOutcome === "code" ? "Code/project workspace." : "General technical workspace.";
}

function summarizeEvidenceAvailability(request: ReasoningRequest) {
  const pieces = [
    request.conversationContext.evidenceTimeline.length ? `${request.conversationContext.evidenceTimeline.length} evidence item(s) in timeline` : "no file evidence",
    request.comparisonEvidence.length ? `${request.comparisonEvidence.length} cross-file comparison facts` : "",
    looksLikeDiagnosticPaste(request.userMessage) ? "current message contains diagnostic output" : "",
  ].filter(Boolean);

  return pieces.join("; ");
}

function summarizePreviousConversation(request: ReasoningRequest) {
  if (!request.priorMessages.length && !request.lastResult) return "No previous conversation supplied.";
  const latest = [...request.priorMessages].reverse().find((message) => /\b(foundry|assistant|system)\b/i.test(message.author));
  return latest ? summarizeAssistantForFollowUp(latest.body) : clipOneLine(request.lastResult ?? "", 420);
}

function summarizeAttachedFiles(request: ReasoningRequest) {
  if (!request.attachments.length) return "None.";
  return request.attachments.map((attachment) => `${attachment.fileName} (${attachment.evidenceKind}, ${attachment.uploadStatus})`).join("; ");
}

function recommendedApproachFor(request: ReasoningRequest, intent: IntentResolution) {
  const workflow = request.conversationContext.workflowState;
  const asksForWholeCodeExplanation = /\b(?:what|explain|describe)\b[\s\S]{0,80}\b(?:code|snippet|component|function|class|file)\b|\bwhat does this (?:code|snippet|component|function|class) do\b/i.test(request.userMessage);
  if (asksForWholeCodeExplanation) {
    return "Explain the selected or pasted code as one complete unit: its purpose, inputs and types, defaults, execution/data flow, returned or rendered output, and meaningful styling, accessibility, side effects, or framework behavior. Mention individual syntax only in service of that full explanation; do not answer one token while ignoring the rest of the snippet.";
  }
  if (intent.clarificationRequired) return "Ask one targeted clarification before giving operational steps.";
  if (request.conversationContext.currentRequest.hasNewEvidence && (request.conversationContext.currentRequest.containsDiagnosticEvidence || request.investigation.newAttachmentIds.length)) {
    return [
      "Troubleshoot from the newest evidence first as the current post-change state.",
      "Compare it to the previous diagnosis only enough to say whether the old error changed, disappeared, stayed, or was replaced.",
      "Do not repeat earlier instructions unless the latest evidence proves they were applied incorrectly.",
      "Give the exact current error, exact file/config block if known, one evidence-backed fix, a verification command or UI check, expected result, and what evidence to send if it still fails.",
      "If the latest evidence does not include the current file contents, do not invent a full replacement file. Provide only the smallest targeted edit supported by the log, or ask for the current file when a full replacement would be unsafe.",
      "Do not invent versions, dependency coordinates, plugin ids, paths, class names, method names, or commands. Mark hypotheses as hypotheses and include the check that would confirm or reject them.",
      "If the prior advice was incomplete or likely caused the new failure, acknowledge that plainly and correct course.",
    ].join(" ");
  }
  if (workflow.completedSteps.length || workflow.alreadyVerified.length || workflow.alreadyTold.length) {
    return [
      "Start by acknowledging where the user is in the workflow.",
      workflow.completedSteps.length ? "Treat completed steps as done and do not repeat their instructions." : "",
      workflow.alreadyTold.length ? "Treat already-told instructions as known. Do not restate them; reference them briefly and move to execution, verification, or the next decision." : "",
      workflow.blockedStep ? "Focus on unblocking the current failed step." : "Move exactly one meaningful step forward.",
      "Use a mentor style: current situation, do this now, expected result, after that.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (looksLikeRepairOrReinstall(request.userMessage)) {
    return [
      "Give a safe repair decision tree, not a single blunt reinstall path.",
      "Start with the least destructive fix that matches the evidence, then the recommended clean reinstall path if the updater explicitly says the patch cannot be applied.",
      "Separate project files, IDE settings, caches, plugins, custom certificates, and runtime files so the user knows what to preserve and what to reset.",
    ].join(" ");
  }
  if (intent.canAnswerMultipleSafely && intent.plausibleInterpretations.length > 1) {
    return "Answer the most likely interpretation first, then briefly cover other common interpretations.";
  }
  if (request.conversationContext.currentRequest.containsDiagnosticEvidence || looksLikeDiagnosticPaste(request.userMessage)) {
    return "Diagnose the newest output first, give the first fix, then verification and recovery.";
  }
  if (intent.requestedAction === "step-by-step instructions") {
    return "Give the recommended path with prerequisites, commands/config edits, expected result, verification, and recovery. If alternatives are named, make each alternative actionable too.";
  }
  return "Answer directly, using current work item context and only the detail needed to prevent an obvious follow-up.";
}

function alternativesFor(request: ReasoningRequest, intent: IntentResolution) {
  if (looksLikeRepairOrReinstall(request.userMessage)) {
    return [
      "Include meaningful branches: retry/repair if available, install a fresh copy over the broken runtime, full uninstall/reinstall only when necessary, and special handling for custom certificates.",
      "Do not recommend deleting unrelated project directories or broad build caches unless the evidence points to them.",
    ].join(" ");
  }
  if (request.conversationContext.currentRequest.containsDiagnosticEvidence || looksLikeDiagnosticPaste(request.userMessage)) {
    return "Do not include alternatives unless they change the immediate edit, command, or decision for the current error.";
  }
  if (intent.canAnswerMultipleSafely && intent.plausibleInterpretations.length > 1) return "Briefly cover the other plausible interpretations after the primary answer.";
  if (/platform branches|unspecified/i.test(inferPlatform(request))) return "Include compact platform branches when commands differ.";
  if (intent.requestedAction === "recommendation") return "If non-recommended options are named, include when to choose them and the concrete next steps to use them.";
  return "Include alternatives only when they materially change the user's next action. Any named alternative must include enough instructions to act on it; otherwise omit it.";
}

function verificationFor(request: ReasoningRequest, intent: IntentResolution) {
  if (looksLikeRepairOrReinstall(request.userMessage)) {
    return "Verify by launching the app, checking the updater no longer reports modified installation files, opening an existing project, and confirming required SDK/JDK/cert settings still work.";
  }
  if (request.desiredOutcome === "code") return "Include the command, UI check, or behavior that confirms the implementation works.";
  if (intent.requestedAction === "verification") return "Explain what the observed result proves and what it does not prove.";
  if (intent.requestedAction === "step-by-step instructions") return "End with a concrete success check and the evidence to collect if it fails.";
  return "Give a quick check the user can run or observe when useful.";
}

function likelyNextQuestionFor(intent: IntentResolution) {
  if (intent.requestedAction === "recommendation") return "How do I do the recommended option?";
  if (intent.requestedAction === "step-by-step instructions") return "What should I do if this step fails?";
  if (intent.requestedAction === "verification") return "What does the failed verification mean?";
  if (intent.relationship === "follow-up") return "What is the next concrete step from here?";
  return "What is the next action?";
}

function universalResponseChecklist(intent: IntentResolution) {
  return [
    "Answer the explicit ask.",
    "Answer the likely intended ask.",
    intent.canAnswerMultipleSafely ? "Cover safe alternate interpretations briefly." : "For nontrivial tasks, still include other plausible fixes or approaches when they exist.",
    intent.clarificationRequired ? "Ask one short clarification before operational steps." : "Do not ask unnecessary clarification.",
    "Include the obvious next step.",
    "Include verification or success criteria when the user may act on the answer.",
  ].join(" ");
}

function depthPlannerFor(request: ReasoningRequest, intent: IntentResolution) {
  const text = request.userMessage.toLowerCase();

  if (isHttpOrAccessControlQuestion(text)) {
    return [
      "Use the domain-specific troubleshooting planner for HTTP status, authentication, authorization, access-control, browser/network, or API failures.",
      "Cover the direct meaning, likely cause families, context-specific first checks, and the evidence that would distinguish server, client, identity, gateway, browser, network, policy, and environment causes.",
      "Include practical branches only when relevant, such as API client, browser page, server-to-server call, proxy/CDN/WAF, or deployment/config mismatch.",
    ].join(" ");
  }

  if (request.conversationContext.currentRequest.containsDiagnosticEvidence || looksLikeDiagnosticPaste(request.userMessage)) {
    return "Before answering, ask internally: common causes, likely causes in this context, first check, evidence that distinguishes causes, and next action. Surface the result as diagnosis, checks, fix, verification, and next evidence.";
  }

  if (intent.requestedAction === "explanation" || intent.requestedAction === "direct answer") {
    return "If the topic has common confusion or multiple plausible causes, include what it means, common causes or interpretations, first checks, and the next useful evidence instead of one generic sentence.";
  }

  return "Before answering, ask internally: What are the common causes or paths? What is likely in this context? What should be checked first? What evidence would distinguish possibilities? What should the user do next?";
}

function isHttpOrAccessControlQuestion(text: string) {
  return (
    /\b(?:http|status|status code|api|endpoint|request|response|browser|cors|csrf|auth|authentication|authorization|permission|access|token|session|cookie|gateway|proxy|cdn|waf)\b/.test(text) &&
    /\b(?:\d{3}|forbidden|unauthorized|denied|blocked|failed|error|reject|refused|not allowed|preflight)\b/.test(text)
  );
}

function summarizeWorkflowProgress(request: ReasoningRequest) {
  const workflow = request.conversationContext.workflowState;
  const parts = [
    workflow.completedSteps.length ? `${workflow.completedSteps.length} completed/confirmed step(s)` : "no confirmed completed steps",
    workflow.blockedStep ? `blocked on: ${workflow.blockedStep}` : `current: ${workflow.currentStep}`,
    `next: ${workflow.nextStep}`,
  ];

  return parts.join("; ");
}

function summarizeList(items: string[], empty: string) {
  return items.length ? items.join(" | ") : empty;
}

function branchingPolicyFor(request: ReasoningRequest, intent: IntentResolution) {
  if (looksLikeRepairOrReinstall(request.userMessage)) {
    return [
      "Must include a decision tree.",
      "Order remedies from least destructive to most destructive.",
      "For IDE/app update failures, do not delete build caches or project folders unless named by the error.",
      "Explain custom certificate/runtime preservation before replacing the app.",
    ].join(" ");
  }

  if (intent.requestedAction === "direct answer" && intent.relationship === "new objective") {
    return "Keep simple factual answers short, but if the topic has multiple plausible meanings, fixes, or paths, answer the likely one first and briefly cover the others.";
  }

  return "For any answer with multiple plausible explanations, fixes, interpretations, tools, platforms, or next steps, include the recommended path plus meaningful alternatives and verification.";
}

function looksLikeRepairOrReinstall(message: string) {
  return /\b(repair|reinstall|uninstall|install from scratch|patch cannot be applied|conflicts? were found|modified|validate|update|updater|installation area|cacerts|jbr|certificate|android studio)\b/i.test(message);
}

function isShortApproval(message: string) {
  const text = message.trim().toLowerCase().replace(/[.!?]+$/g, "");
  return /^(yes|yes please|yeah|yep|sure|please do|do it|do that|go ahead|sounds good|ok|okay|that works|let's do it|lets do it)$/.test(text);
}

function extractConcreteOffer(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  const sentences = normalized.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [normalized];
  const offerSentence =
    [...sentences]
      .reverse()
      .find((sentence) =>
        /\b(if you want|i can|i'll|i will|next steps?|would you like|want me to|I would|you can)\b/i.test(sentence),
      ) ?? sentences.at(-1);

  return offerSentence?.slice(0, 900) ?? "";
}
