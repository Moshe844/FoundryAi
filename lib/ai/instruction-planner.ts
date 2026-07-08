import type { AnswerPlan } from "@/lib/ai/answer-planning";
import type { ReasoningRequest } from "@/lib/ai/context";

export type InstructionPlan = {
  recommendedApproach: string;
  alternatives: string[];
  why: string;
  prerequisites: string[];
  exactSteps: string[];
  commandsRequired: string[];
  configurationRequired: string[];
  verification: string[];
  commonMistakes: string[];
  recoveryPath: string[];
};

export function buildInstructionPlan(request: ReasoningRequest, answerPlan: AnswerPlan): InstructionPlan {
  return {
    recommendedApproach: answerPlan.recommendedApproach,
    alternatives: splitInstructionItems(answerPlan.alternativeApproaches),
    why: whyFor(request, answerPlan),
    prerequisites: prerequisitesFor(request),
    exactSteps: exactStepsFor(request, answerPlan),
    commandsRequired: commandsRequiredFor(request),
    configurationRequired: configurationRequiredFor(request),
    verification: verificationFor(request, answerPlan),
    commonMistakes: commonMistakesFor(request),
    recoveryPath: recoveryPathFor(request),
  };
}

export function formatInstructionPlan(plan: InstructionPlan) {
  return [
    "Instruction intelligence plan:",
    `- Recommended approach: ${plan.recommendedApproach}`,
    `- Why: ${plan.why}`,
    "Alternatives:",
    formatList(plan.alternatives, "Only include alternatives if they change the user's next action."),
    "Prerequisites:",
    formatList(plan.prerequisites, "No special prerequisite beyond current evidence."),
    "Exact steps:",
    formatList(plan.exactSteps, "Answer the current request directly."),
    "Commands required:",
    formatList(plan.commandsRequired, "No command required unless the answer introduces one explicitly."),
    "Configuration required:",
    formatList(plan.configurationRequired, "No configuration edit identified."),
    "Verification:",
    formatList(plan.verification, "Give a concrete success check when the user can act."),
    "Common mistakes:",
    formatList(plan.commonMistakes, "Avoid generic repetition and unsupported claims."),
    "Recovery path:",
    formatList(plan.recoveryPath, "Ask for the smallest missing evidence only if the next action fails."),
  ].join("\n");
}

function whyFor(request: ReasoningRequest, answerPlan: AnswerPlan) {
  if (request.troubleshooting.active) return "The newest evidence is the current system state, so diagnosis must center the current blocker before older hypotheses.";
  if (request.conversationContext.workflowState.completedSteps.length) return "The user has already progressed in the workflow, so the answer should continue from the current step.";
  return answerPlan.intent.mostLikelyInterpretation || "This is the shortest path to answer the user's actual request.";
}

function prerequisitesFor(request: ReasoningRequest) {
  const relevantFiles = request.projectState.relevantFilesFound ?? [];
  const prereqs = [
    request.attachments.length ? "Use the available evidence before asking for more files." : "",
    relevantFiles.length ? `Relevant files: ${relevantFiles.slice(0, 5).join(", ")}` : "",
    request.conversationContext.workflowState.completedSteps.length ? "Treat previously completed steps as done." : "",
  ];

  return prereqs.filter(Boolean);
}

function exactStepsFor(request: ReasoningRequest, answerPlan: AnswerPlan) {
  if (request.troubleshooting.active) {
    return [
      "Name the current problem shown by the latest evidence.",
      "Explain why it happens using evidence-backed reasoning.",
      "Give the smallest safe fix.",
      "Give a concrete verification step and expected result.",
    ];
  }

  if (answerPlan.intent.requestedAction === "step-by-step instructions") {
    return [
      "Start with the recommended path.",
      "List prerequisites before commands or edits.",
      "Show every command or config value as its own semantic block.",
      "End with verification and recovery.",
    ];
  }

  if (request.desiredOutcome === "code") {
    return ["Identify the target file or behavior.", "Make or describe the smallest complete change.", "State how to verify the changed behavior."];
  }

  return ["Answer the explicit ask.", "Use current work item state.", "Include the next action only when useful."];
}

function commandsRequiredFor(request: ReasoningRequest) {
  const text = `${request.userMessage}\n${request.priorMessages.map((message) => message.body).join("\n")}`.toLowerCase();
  const commands = [];

  if (/\b(java|jdk|cacerts|certificate|keytool|truststore)\b/.test(text)) {
    commands.push("For Java certificate import, include separate copyable Windows PowerShell and macOS/Linux Bash command variants.");
  }
  if (/\b(npm|next|react|typescript|eslint|build|lint|test)\b/.test(text)) commands.push("Use the project package-manager command when verification requires a local check.");
  if (request.troubleshooting.active) commands.push("If saying run/check/verify with a command, show the actual command block directly below the sentence.");

  return commands;
}

function configurationRequiredFor(request: ReasoningRequest) {
  const text = `${request.userMessage}\n${request.attachments.map((attachment) => attachment.fileName).join("\n")}`.toLowerCase();

  return [
    /\b(json|package\.json|tsconfig|config|settings|xml|gradle)\b/.test(text) ? "Render config changes as config blocks, not prose-only instructions." : "",
    /\b(path|env|environment|%userprofile%|\$home|java_home)\b/i.test(text) ? "Render paths and env vars as copyable semantic values." : "",
  ].filter(Boolean);
}

function verificationFor(request: ReasoningRequest, answerPlan: AnswerPlan) {
  return [
    answerPlan.verification,
    request.troubleshooting.active ? "Verify the same failing step after the fix, not an unrelated happy path." : "",
    request.desiredOutcome === "code" ? "Prefer an existing lint, typecheck, build, or focused test command when available." : "",
  ].filter(Boolean);
}

function commonMistakesFor(request: ReasoningRequest) {
  return [
    "Do not say to run a command without showing the command.",
    "Do not inline long file paths as plain text.",
    "Do not ask for evidence already present.",
    request.troubleshooting.active ? "Do not restart the investigation from the first possible cause." : "",
    request.attachments.length ? "Do not ignore the latest attachment in favor of prior advice." : "",
  ].filter(Boolean);
}

function recoveryPathFor(request: ReasoningRequest) {
  if (request.troubleshooting.active) {
    return [
      "If verification fails, ask for the exact new output from the same command or action.",
      "Compare that output against the current blocker before changing diagnosis.",
    ];
  }

  return ["If the answer depends on missing local state, ask for the smallest specific file, command output, or screenshot needed."];
}

function splitInstructionItems(value: string) {
  return value
    .split(/(?<=[.!?])\s+|\s+\|\s+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function formatList(items: string[], empty: string) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}
