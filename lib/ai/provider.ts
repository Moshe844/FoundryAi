import type { ReasoningRequest } from "@/lib/ai/context";
import {
  createAnswerPlan,
  formatAnswerPlan,
  formatTargetedFollowUpContext,
  isTargetedFollowUp,
  resolveShortApprovalFollowUp,
  targetedFollowUpInstruction,
  type AnswerPlan,
} from "@/lib/ai/answer-planning";
import { hasCompleteArtifactRequestShape, isInstructionalRequest } from "@/lib/ai/intent-resolution";
import { answerQualityContract, fileEvidenceContract, instructionAnswerContract, technicalAnswerContract } from "@/lib/ai/answer-contract";
import { formatEngineeringState } from "@/lib/ai/engineering-state";
import { buildReasoningPacket, formatReasoningPacket } from "@/lib/ai/reasoning-packet";
import { formatResponseVerification, verifyFoundryResponse } from "@/lib/ai/response-verification";
import { callOpenAIResponsesManaged } from "@/lib/ai/foundry-runtime";
import { modelForReasoningRequest, modelForRepairTask } from "@/lib/ai/model-router";
import { formatTroubleshootingSnapshot } from "@/lib/ai/troubleshooting";
import { looksLikeDiagnosticPaste } from "@/lib/mission-engine";
import { refreshModelRegistry } from "@/lib/ai/routing/dynamic-router";

type OpenAIInputContent =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
    };

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    text?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

export async function generateReasonedAnswer(request: ReasoningRequest) {
  await refreshModelRegistry();
  const apiKey = process.env.OPENAI_API_KEY;
  const answerPlan = createAnswerPlan(request);
  const needsRoomToAnswer = needsExpandedAnswer(request, answerPlan);
  const shouldUsePriorImages = shouldUseImageEvidence(request);
  const currentHasImageAttachments = request.attachments.some(
    (attachment) => attachment.uploadStatus === "image" && request.investigation.newAttachmentIds.includes(attachment.fileId),
  );

  if (looksLikeSourceRequest(request.userMessage)) {
    return "I need verified source search for that request. I do not want to guess or invent documentation links.";
  }

  const directUnusedToolchainAnswer = createUnusedToolchainDirectAnswer(request);
  if (directUnusedToolchainAnswer) {
    return directUnusedToolchainAnswer;
  }

  const directGradleDslSyntaxAnswer = createGradlePluginSyntaxDirectAnswer(request);
  if (directGradleDslSyntaxAnswer) {
    return directGradleDslSyntaxAnswer;
  }

  if (!apiKey) {
    return "I can answer this once the OpenAI API key is configured on the server.";
  }

  try {
    const mainRequestBody = JSON.stringify({
      model: modelForReasoningRequest(request).model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                answerQualityContract,
                technicalAnswerContract,
                instructionAnswerContract,
                fileEvidenceContract,
                "Use the provided thread context for follow-ups.",
                "The structured engineering state is the authoritative reasoning product. Treat the response as a rendering of that state.",
                "Before answering any coding, build, package, dependency, plugin, compiler, runtime, or configuration error, use the structured project state first. It summarizes the user message, attached evidence, project files, previous memory, attempted fixes, detected languages/framework/build system/package manager, contradictions, ranked hypotheses, and confidence.",
                "Choose fixes by matching the error against the project state, not by literal error text alone. Prefer the highest-ranked evidence-backed hypothesis and the smallest safe change. If project evidence contradicts the named failing tool/plugin/dependency, explain the contradiction and remove or align the mismatch before adding tools or chasing downloads.",
                "Presentation boundary: answer in normal ChatGPT-style Markdown. Do not create custom response blocks, fake labels, status-card sections, JSON plans, or UI-specific block classifications.",
                "Fenced code blocks must remain exactly as authored: one fence equals one block. Never split one file or one requested full snippet into multiple fences unless the user explicitly asks for separate files.",
                "Do not put explanatory prose inside fenced code blocks. Do not invent labels such as Configuration, Snippet, DEFAULTCONFIG, DEPENDENCIES, ROOTPROJECT.NAME, or similar generated section names.",
                "Do not refer to pasted terminal output, logs, screenshots, or transcript text as a code block. Say output, log, transcript, screenshot, or evidence unless it is actual source/config code the user asked to edit.",
                "Use fenced blocks only for runnable commands, replacement source/config, diffs, structured data, or meaningful multi-line log excerpts. Do not fence a single path, placeholder, filename, short error, or value just for emphasis.",
                "Start reasoning from: what is actually happening, what changed, what evidence is new, what is resolved, what remains active, and what one blocker prevents success right now.",
                "The current blocker principle is mandatory: center exactly one current blocker. Mention older blockers only if the engineering state marks them still active, resolved, or relevant to the next action.",
                "Never restart an investigation when engineering state shows prior evidence or completed work. Advance from the state.",
                "Presentation may choose prose, bullets, snippets, or commands, but must not invent the diagnosis, objective, blocker, or next action.",
                "Apply the internal answer plan to every request, even if the user's wording is short, vague, casual, or missing expected keywords.",
                "Use workflow memory before answering: completed steps are done, verified steps are trusted, failed steps should not be repeated as the only path, and the next answer should move the user one meaningful step forward.",
                "Already-told instructions are known context. Do not repeat them unless the user asks to see them again. If they are still the current action, say that briefly and give only the verification or next decision needed now.",
                "Regex-like category hints are never enough by themselves. If the plan, context, evidence, or prior conversation implies a richer answer, provide the richer answer.",
                "For any answer, cover the explicit question, the likely intended question, the obvious next step, and verification when useful. Keep it compact when the task is simple.",
                "Branching rule: give the recommended path first. If you name alternatives/options, every named option must be actionable: when to choose it, exact steps or commands/UI actions, required config/env values, success check, and the main caveat. If you cannot give that, omit the alternative. For urgent pasted errors, build failures, or narrow follow-ups, do not enumerate alternatives unless they change the immediate next action.",
                "Only ask a clarification question when the answer would materially change. Otherwise answer with stated assumptions and safe branches.",
                "For short approvals such as yes, yes please, sure, do that, go ahead, or sounds good, resolve the request from the most recent concrete offer, recommendation, or next step in the prior assistant message. Perform that continuation. Do not invent unrelated variants or a new direction.",
                "When the expected work type is code, provide complete usable code directly. Do not say code support comes later.",
                "For code follow-ups, treat prior generated code blocks, prior pasted code blocks, and readable attached files as the current working copy. Apply the user's requested change to that working copy. Do not restart from a generic example unless no working copy exists.",
                "If the user asks for full code, full file, send it back, complete snippet, or similar, return the complete updated file/artifact for each requested file. Do not omit imports, setup, handlers, styles, closing tags/braces, unchanged sections, or surrounding code just because only one part changed.",
                "If the user asks to make CSS, XAML, HTML, UI, layout, or styling nicer, actually improve the visual design and structure in the code: spacing, hierarchy, colors, sizing, responsiveness, alignment, states, and polish. Do not merely reformat the old code or say it looks better.",
                "For hosting/deployment/options answers, be explicit and complete. Give one recommended option first and explain why in one sentence. Then, for every option you mention, include a clickable Markdown link, when to use it, concrete setup steps, build command, start command, env-var/config notes, success check, failure check, and how to verify the deployed URL. Do not list alternatives as vague one-line names. Do not write raw bracket syntax as prose; use valid Markdown links such as [Render](https://render.com).",
                "When converting a visual artifact to HTML/CSS, use the visual artifact context: fields, labels, action text, layout, and style.",
                "Do not lead with general domain knowledge when attached evidence is available.",
                "When multiple readable files are attached, inspect them together before answering. If the answer depends on one file, still check whether the other attached files already contain related settings, duplicate declarations, conflicts, or missing pieces. Do not say you checked only one file when multiple current readable files were part of the evidence.",
                "For build/plugin/dependency/toolchain failures, compare the failing declaration against actual attached project files. If the failing plugin/dependency/toolchain is not used by the current project evidence, the preferred fix is to remove that declaration rather than trying to make unused tooling resolve.",
                "This applies across all stacks: npm packages, Python modules, PHP Composer packages, Gradle/Maven plugins, Android SDKs, TypeScript tooling, copied boilerplate, API config, and framework-specific settings. Do not blindly fix the named thing; decide if it belongs in the project first.",
                "Troubleshooting continuity is mandatory: if the user attaches or pastes new diagnostic evidence after previous advice, treat it as the result after they tried the earlier fix. Diagnose the newest evidence first, determine whether the old issue changed or remains, and give only the next evidence-backed fix. Do not repeat the previous guide unless the new evidence shows it was done incorrectly.",
                "Use the structured live troubleshooting state when present. It is derived from the newest readable log/text/config evidence and prior issues. If it says an old issue is absent from the newest evidence, do not center that old issue unless the newest evidence still contains it.",
                "Never hallucinate a repair. If the latest evidence does not prove a file path, version, symbol, dependency, setting, or command, say what is unknown instead of inventing it.",
                "Evidence gate: every concrete repair claim must be supported by the user's evidence, provided project context, official/source context, or stable platform knowledge. If support is missing, state it as a hypothesis with a verification step, not as the fix.",
                "Do not produce a full replacement file when only a log excerpt is available. Give a targeted edit supported by the error, or request the current file if replacing the file would risk deleting unknown required settings.",
                "Response style: sound like a real engineer in an ongoing conversation. For normal asks, begin with a brief context-appropriate acknowledgement such as Sure, Certainly, Yes, or Got it, then answer directly. For short follow-ups, be direct but not abrupt. Do not echo the question, do not introduce 'your question', and do not use canned labels like 'direct answer'.",
                "If the user edits, resends, or repeats a similar request, do not copy-paste the previous response. Re-evaluate the current request and evidence; if the conclusion is the same, say it in fresh wording and move the work forward.",
                "When the current evidence is an error dialog, installer/updater failure, validation failure, or modified-file conflict, answer as operational repair guidance: what happened, safest recommended path, less destructive alternatives, what to preserve, what not to delete, verification, and what to do if the first path fails.",
                "For IDE or application update failures, never recommend deleting unrelated build caches, SDK folders, dependency caches, project folders, or user-wide configuration unless the evidence specifically names those folders. A modified application runtime file does not justify deleting Gradle caches.",
                "For file placement, use exact paths only from visible/project evidence: project tree screenshots, attached files, pasted directory listings, file metadata, logs, or confirmed prior context. If an absolute project root is visible or confirmed, combine that root with the target file and give the full absolute path first. Do not infer paths from framework conventions. If exact placement is not in evidence, say so and explain the smallest evidence needed.",
                "When a step says to locate, navigate, or find a file/value, include the concrete discovery action: where to open, what command/search to run when useful, what line/value to look for, and how to use that result. Do not stop at 'locate the file'.",
                "Do not end with 'ask me if you want step-by-step help' when step-by-step help is the obvious next need. Provide the useful steps now.",
                currentHasImageAttachments
                  ? "A screenshot/image was attached in the current request. Inspect it as current visual evidence. Read visible text, error messages, UI controls, project tree hierarchy, absolute root paths, folder/file nesting, layout, selected state, timestamps, and obvious visual clues before answering. If it shows a project navigator, use that visible hierarchy as the source of truth for file paths. If an absolute project root path is visible, combine that root with the target file name shown in evidence."
                  : request.investigation.evidenceTypes.hasImages
                    ? shouldUsePriorImages
                      ? "The user asked about prior screenshot/image evidence. Use only the relevant prior image evidence, and clearly say it is earlier evidence."
                      : "Older screenshot/image evidence exists in this work item, but the current request is not about screenshots/images. Do not use, center, infer from, or mention screenshot evidence in this answer."
                    : "No screenshot/image is attached in this work item. Do not mention screenshots or visual evidence.",
                "Do not claim to browse the web.",
                "If the user asks for current docs, live URLs, latest versions, prices, or other web-current facts, say that web search needs to be configured before you can verify that.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: createUserContent(request, answerPlan),
        },
      ],
      temperature: 0.35,
      max_output_tokens: mainAnswerOutputBudget(request, needsRoomToAnswer),
    });
    const { response, data } = await fetchOpenAIWithShortRetry(mainRequestBody, apiKey, request);

    if (!response.ok) return userSafeProviderError(response.status, data);

    const draftAnswer = extractText(data);
    if (!draftAnswer) return userSafeEmptyProviderAnswer(data);
    return finishReasonedAnswer(request, draftAnswer, apiKey);
  } catch (error) {
    return userSafeConnectionError(error);
  }
}

async function finishReasonedAnswer(request: ReasoningRequest, draftAnswer: string, apiKey: string) {
  // Response quality repair is bounded to one additional model call. Previously every detector ran
  // sequentially and verification could trigger yet another call, turning one answer into as many as
  // seven paid requests. Deterministic cleanup remains free and runs after the single prioritized repair.
  let paidRepairUsed = false;
  let repairedAnswer = draftAnswer;
  if (detectEvidenceContradiction(request, repairedAnswer)) {
    repairedAnswer = await repairEvidenceContradictionAnswerIfNeeded(request, repairedAnswer, apiKey);
    paidRepairUsed = true;
  } else if (needsTroubleshootingAnswerRepair(request, repairedAnswer)) {
    repairedAnswer = await repairTroubleshootingAnswerIfNeeded(request, repairedAnswer, apiKey);
    paidRepairUsed = true;
  } else if (needsFullSnippetRepair(request, repairedAnswer)) {
    repairedAnswer = await repairFullSnippetAnswerIfNeeded(request, repairedAnswer, apiKey);
    paidRepairUsed = true;
  } else if (needsCommandAnswerRepair(request, repairedAnswer)) {
    repairedAnswer = await repairCommandAnswerIfNeeded(request, repairedAnswer, apiKey);
    paidRepairUsed = true;
  }

  const structurallySafeAnswer = validateAnswerAgainstCurrentSnippet(request, validateGeneratedSnippets(repairedAnswer), repairedAnswer);
  const contractViolation = finalAnswerContractViolation(request, structurallySafeAnswer);
  const finalAnswer = contractViolation && !paidRepairUsed
    ? await repairContractViolationAnswer(request, structurallySafeAnswer, contractViolation, apiKey)
    : structurallySafeAnswer;
  paidRepairUsed ||= Boolean(contractViolation);
  const finalEvidenceSafeAnswer = createEvidenceContradictionFallback(request, finalAnswer) || finalAnswer;
  const internalSafeAnswer = repairInternalRuleLeak(finalEvidenceSafeAnswer);
  const elevationSafeAnswer = repairUnsupportedElevationClaim(request, internalSafeAnswer);
  const apiCorrectionSafeAnswer = createApiPayloadCorrectionFallback(request, elevationSafeAnswer) || elevationSafeAnswer;
  const renderSafeAnswer = fencePlainTextCommands(apiCorrectionSafeAnswer);
  const verification = verifyFoundryResponse(request, renderSafeAnswer);
  if (verification.ok) return verification.answer;

  if (!paidRepairUsed) {
    const repaired = await repairVerificationFailureAnswer(request, renderSafeAnswer, formatResponseVerification(verification), apiKey);
    const repairedVerification = verifyFoundryResponse(request, fencePlainTextCommands(validateGeneratedSnippets(repaired)));
    if (repairedVerification.ok) return repairedVerification.answer;
  }

  // Do not resubmit the user's full context because a stylistic validator remained dissatisfied.
  // Return the deterministically sanitized best answer and let the user decide whether to spend again.
  return renderSafeAnswer;
}

async function repairVerificationFailureAnswer(
  request: ReasoningRequest,
  answer: string,
  verificationIssues: string,
  apiKey: string,
) {
  const body = JSON.stringify({
    model: modelForRepairTask("verification").model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "Rewrite the answer for the user. The prior draft failed response verification and must not be shown.",
              "Do not mention verification, validators, guardrails, drafts, fallback, or internal checks.",
              "Answer the latest user message directly from the current pasted content and conversation context.",
              "Newest pasted code/config wins over older logs and older diagnoses unless the newest message explicitly says the old error still happens.",
              "If the user pasted a config/source file and asks how it should look, inspect that pasted file literally and give the smallest safe correction. Preserve visible unrelated content and do not imply unseen content should be deleted.",
              "If you show replacement code/config, use one coherent fenced block for the affected file or a clearly scoped removable/replacement block. Do not collapse multi-line code into one line.",
              "Do not resurrect SSL, access denied, certificates, or other prior blockers unless the latest user message itself contains that blocker.",
              "Keep the answer concise and useful.",
            ].join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Current user message:",
              request.userMessage,
              "",
              "Authoritative engineering state:",
              formatEngineeringState(request.engineeringState),
              "",
              "Live troubleshooting state:",
              formatTroubleshootingSnapshot(request.troubleshooting),
              "",
              "Verification issues with the rejected draft:",
              verificationIssues,
              "",
              "Rejected draft:",
              answer,
            ].join("\n"),
          },
        ],
      },
    ],
    temperature: 0.12,
    max_output_tokens: Math.max(900, Math.min(1800, answer.length + 600)),
  });

  const { response, data } = await fetchOpenAIWithShortRetry(body, apiKey, request);
  if (!response.ok) return "";
  return (extractText(data) ?? "").trim();
}

function mainAnswerOutputBudget(request: ReasoningRequest, needsRoomToAnswer: boolean) {
  if (request.desiredOutcome === "code") return 2400;
  if (request.troubleshooting.active) return 750;
  if (needsRoomToAnswer) return 1500;
  return 900;
}

async function fetchOpenAIWithShortRetry(body: string, apiKey: string, request?: ReasoningRequest) {
  const workspaceId = runtimeWorkspaceId(request);
  const { response, data } = await callOpenAIResponsesManaged<OpenAIResponse>({
    apiKey,
    body,
    workspaceId,
    userId: "default-user",
    priority: "active",
    maxAttempts: 1,
    requestId: `${workspaceId}:${stableRequestHash(request?.userMessage ?? body)}`,
    routingReason: "Fresh current-message classification at the direct answer provider boundary.",
  });

  return { response, data };
}

function stableRequestHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

function runtimeWorkspaceId(request?: ReasoningRequest) {
  return [
    request?.conversationContext.currentWorkItem?.missionId,
    request?.missionTitle,
    "default-workspace",
  ]
    .find((value) => typeof value === "string" && value.trim())
    ?.trim() ?? "default-workspace";
}

function userSafeProviderError(status: number, data: OpenAIResponse) {
  if (status === 429 || isRateLimitError(data)) {
    return "The answer is still queued. Foundry will keep trying.";
  }

  if (status >= 500) {
    return "The answer is still queued. Foundry will keep trying.";
  }

  if (status === 401 || status === 403) {
    return "The answer service is not authorized right now. Check the server API key configuration.";
  }

  return "Foundry could not complete that answer after the provider rejected the request. Your workspace context is preserved; try again in a moment, or check the configured model profile if this repeats.";
}

function isRateLimitError(data: OpenAIResponse) {
  const errorText = [data.error?.message, data.error?.type, data.error?.code].filter(Boolean).join(" ");
  return /\brate.?limit|tokens per min|\btpm\b|too many requests/i.test(errorText);
}

function userSafeConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/\brate.?limit|tokens per min|\btpm\b|too many requests/i.test(message)) {
    return "The answer is still queued. Foundry will keep trying.";
  }
  return "I could not reach the answer service.";
}

function userSafeEmptyProviderAnswer(data: OpenAIResponse) {
  if (data.status === "incomplete" || data.incomplete_details?.reason) {
    return "The provider returned an incomplete answer. Foundry preserved the context; try again and it will retry with the managed runtime.";
  }
  if (extractRefusal(data)) {
    return "The provider refused the draft response. Foundry preserved the context; revise the request or try again with more specific evidence.";
  }
  return "The provider returned an empty answer. Foundry preserved the context; try again in a moment.";
}

export function __testOnlyCreateDeterministicAnswer(request: ReasoningRequest) {
  return (
    createUnusedToolchainDirectAnswer(request) ||
    createGradlePluginSyntaxDirectAnswer(request) ||
    createEvidenceContradictionFallback(request) ||
    ""
  );
}

export function __testOnlyRepairUnsupportedElevationAnswer(request: ReasoningRequest, answer: string) {
  return repairUnsupportedElevationClaim(request, answer);
}

export function __testOnlyNeedsCommandAnswerRepair(request: ReasoningRequest, answer: string) {
  return needsCommandAnswerRepair(request, answer);
}

export function __testOnlyExtractOpenAIText(response: OpenAIResponse) {
  return extractText(response);
}

export function __testOnlyDetectEvidenceContradiction(request: ReasoningRequest, answer: string) {
  return detectEvidenceContradiction(request, answer);
}

export function __testOnlyProjectEvidenceSummary(request: ReasoningRequest) {
  return collectReadableProjectEvidence(request).map((item) => ({
    fileName: item.fileName,
    identifiers: extractGradlePluginIdentifiers(item.text),
    text: item.text.slice(0, 160),
  }));
}

export function __testOnlyExtractInlineProjectEvidence(message: string) {
  return extractInlineProjectEvidence(message);
}

export function __testOnlyValidateAnswerAgainstCurrentSnippet(request: ReasoningRequest, answer: string) {
  return validateAnswerAgainstCurrentSnippet(request, answer);
}

function repairUnsupportedElevationClaim(request: ReasoningRequest, answer: string) {
  if (!hasUnsupportedElevationClaim(request, answer)) return answer;

  const repairedLines = answer
    .split(/\r?\n/)
    .map((line) => repairElevationLine(line))
    .filter((line) => line !== "__DROP_LINE__");
  const repaired = repairedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  if (repaired) return repaired;
  return /\b(?:admin|administrator|elevated|permission|privilege)\b/i.test(request.userMessage)
    ? "The current evidence does not show that administrator privileges are required."
    : answer;
}

function hasUnsupportedElevationClaim(request: ReasoningRequest, answer: string) {
  if (!hasElevationRequirementClaim(answer)) return false;
  if (elevationRequirementSupportedByContext(request)) return false;
  return isCommandOrOpsAnswer(request, answer);
}

function hasElevationRequirementClaim(answer: string) {
  return (
    /\b(?:open|run|launch|start)\b.{0,80}\b(?:as administrator|as admin|elevated|with administrator privileges)\b/i.test(answer) ||
    /\b(?:must|need to|have to|required to|requires?|should)\b.{0,100}\b(?:administrator|admin|elevated|administrator privileges|elevation)\b/i.test(answer) ||
    /\bstandard users?\b.{0,120}\b(?:do not|don't|cannot|can't|won't|will not)\b.{0,80}\bpermission\b/i.test(answer)
  );
}

function elevationRequirementSupportedByContext(request: ReasoningRequest) {
  const context = [
    request.userMessage,
    request.lastResult ?? "",
    ...request.priorMessages.slice(-6).map((message) => message.body),
    ...request.troubleshooting.currentIssues.map((issue) => issue.excerpt),
    ...request.troubleshooting.previousIssues.map((issue) => issue.excerpt),
  ].join("\n");

  return /\b(access is denied|permission denied|requires elevation|elevated privileges required|administrator privileges required|run as administrator|group policy|company policy|school policy|managed device|remote computer|remote machine|another computer|service control manager|system32|program files|hkey_local_machine|hk lm|machine-wide|system-wide)\b/i.test(
    context,
  );
}

function isCommandOrOpsAnswer(request: ReasoningRequest, answer: string) {
  const context = `${request.userMessage}\n${answer}`;
  return (
    /```(?:cmd|powershell|shell|bash|terminal)?\n[\s\S]*?\b(?:shutdown|restart-computer|netsh|sc|reg|npm|pnpm|yarn|node|git|python|pip|powershell|cmd|copy|move|del|dir|ipconfig|tracert|gradle|gradlew)\b/i.test(
      context,
    ) ||
    /\b(?:cmd|command prompt|powershell|terminal|run this command|use this command|command to|how can i)\b/i.test(context)
  );
}

function repairElevationLine(line: string) {
  if (/\bstandard users?\b.{0,120}\b(?:do not|don't|cannot|can't|won't|will not)\b.{0,80}\bpermission\b/i.test(line)) return "__DROP_LINE__";
  if (/\b(?:must|need to|have to|required to|requires?|should)\b.{0,100}\b(?:administrator|admin|elevated|administrator privileges|elevation)\b/i.test(line)) {
    return line
      .replace(/\b(?:must|need to|have to|required to|requires?|should)\b.{0,100}\b(?:administrator|admin|elevated|administrator privileges|elevation)\b/gi, "can usually run normally")
      .replace(/\s+/g, " ")
      .trim();
  }

  return line
    .replace(/\b(?:as administrator|as admin|with administrator privileges|elevated)\b/gi, "")
    .replace(/\bOpen Command Prompt\s*\(\s*CMD\s*\)\s*,?\s*/i, "Open Command Prompt, ")
    .replace(/\bOpen CMD\s*,?\s*/i, "Open CMD, ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trimEnd();
}

function fencePlainTextCommands(answer: string) {
  const fencedRanges = extractFencedBlocks(answer).map((block) => [block.start, block.end] as const);

  return answer
    .split(/\n/)
    .map((line, index, lines) => {
      const offset = lines.slice(0, index).join("\n").length + (index > 0 ? 1 : 0);
      if (fencedRanges.some(([start, end]) => offset >= start && offset <= end)) return line;

      const prefixed = line.match(/^(\s*(?:run|use|try|execute|command)\s*:?\s*)(\.{0,2}[\\/][\w./\\-]+|(?:gradlew|npm|pnpm|yarn|bun|node|git|npx|curl|python|py|pip|powershell|pwsh|docker|kubectl)\b.*)$/i);
      const standalone = line.match(/^(\s*)(\.{0,2}[\\/][\w./\\-]+|(?:gradlew|npm|pnpm|yarn|bun|node|git|npx|curl|python|py|pip|powershell|pwsh|docker|kubectl)\b.*)$/i);
      const previousLineIntroducesCommand = /(?:^|\b)(?:run|use|try|execute|command)\s*:?\s*$/i.test(lines[index - 1]?.trim() ?? "");
      const command = prefixed?.[2]?.trim() ?? (previousLineIntroducesCommand ? standalone?.[2]?.trim() : "");
      if (!command) return line;
      if (!looksLikeRunnableCommand(command)) return line;
      const language = /^\s*(powershell|pwsh|Get-|Set-|New-|Remove-|Copy-|Move-)/i.test(command)
        ? "powershell"
        : /^\s*(cmd|dir|copy|xcopy|ipconfig|tracert)\b/i.test(command)
          ? "cmd"
          : "shell";

      return prefixed
        ? `${prefixed[1].trimEnd()}\n\`\`\`${language}\n${command}\n\`\`\``
        : `\`\`\`${language}\n${command}\n\`\`\``;
    })
    .join("\n");
}

function finalAnswerContractViolation(request: ReasoningRequest, answer: string) {
  const fences = extractFencedBlocks(answer);
  const renderableFences = fences.filter((block) => shouldTreatAsRenderableGeneratedBlock(block.language, block.code));
  const codeFences = renderableFences.filter((block) => shouldValidateGeneratedSnippet(block.language, block.code));
  const replacementFences = renderableFences.filter((block) => !isNonReplacementContextFence(answer, block));
  const configFragments = replacementFences.filter((block) => looksLikeConfigOrGradleFragment(block.language, block.code));
  const claimsCompleteFile = /\b(complete|full|entire|whole)\b.{0,40}\b(file|snippet|build\.gradle|settings\.gradle|config|configuration)\b/i.test(answer);
  const repeated = codeFences.filter((block) => snippetAlreadyExistsInAttachedEvidence(request, block.code) && !isNonReplacementContextFence(answer, block));

  if (leaksInternalRuleLanguage(answer)) return "leaked internal response rules";
  if (configFragments.length > 1) return "multiple config fragments for one file";
  if (claimsCompleteFile && replacementFences.length > 1) return "claimed complete file but emitted multiple blocks";
  if (repeated.length > 0) return "suggested code that is already present in attached files";
  if (hasImpureFencedBlocks(answer)) return "mixed prose or empty content inside fenced blocks";
  if (hasCommandIntroWithoutFollowingCommand(answer)) return "said to run a command without showing the command";
  if (hasThinAlternativesSection(answer)) return "alternatives/options were listed without actionable instructions";
  if (suggestsResolvingUnprovenToolchain(request, answer)) return "suggested changing versions/repositories for a toolchain that current evidence does not prove is needed";

  return "";
}

function hasCommandIntroWithoutFollowingCommand(answer: string) {
  const lines = answer.split(/\r?\n/);

  return lines.some((line, index) => {
    if (!/\b(?:run|use|try|execute)\b.{0,70}\b(?:following command|this command|the command|command below)\b/i.test(line)) return false;
    const nextChunk = lines.slice(index + 1, index + 5).join("\n").trim();
    if (/^```(?:cmd|powershell|shell|bash|sh|terminal)?\s*\n[\s\S]*?\n```/i.test(nextChunk)) return false;
    return true;
  });
}

function leaksInternalRuleLanguage(answer: string) {
  return /\b(?:one-file one-block|one file one block|answer contract|validator|guardrail|draft answer|internal rule|satisfy the .*rule)\b/i.test(answer);
}

function repairInternalRuleLeak(answer: string) {
  if (!leaksInternalRuleLanguage(answer)) return answer;

  return answer
    .split(/\r?\n/)
    .filter((line) => !leaksInternalRuleLanguage(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function suggestsResolvingUnprovenToolchain(request: ReasoningRequest, answer: string) {
  const failingIdentifier = extractFailingIdentifierFromRequest(request);
  if (!failingIdentifier) return false;
  const projectEvidence = collectReadableProjectEvidence(request);
  if (!projectEvidence.length) return false;
  const usage = analyzeIdentifierUsageInEvidence(failingIdentifier.id, projectEvidence);
  if (!usage.hasEnoughEvidence || usage.isUsed) return false;
  if (!answerMentionsIdentifier(answer, failingIdentifier.id)) return false;

  return /\b(change|set|use|try|upgrade|downgrade|bump|pin)\b.{0,90}\bversion\b|\bversion\s+[`'"]?\d+(?:[.\w-]+){1,}|\b(repository|repositories|plugin\s+portal|gradlePluginPortal|mavenCentral|google\(\)|network|proxy|firewall|internet|download|refresh(?:-dependencies)?|cache|wrapper|gradle\s+version)\b/i.test(
    answer,
  );
}

function hasThinAlternativesSection(answer: string) {
  const section = answer.match(/(?:^|\n)#{0,3}\s*(?:\*\*)?(?:alternatives|options|other options)(?:\*\*)?\s*:?\s*\n([\s\S]*?)(?=\n#{1,3}\s|\n\*\*[^*\n]+:\*\*|\n[A-Z][A-Za-z ]{2,30}:\s*\n|$)/i)?.[1];
  if (!section) return false;

  const optionLines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+|\d+[.)]\s+|^[A-Z][\w .+/&-]{1,40}:/.test(line));

  if (optionLines.length < 2) return false;

  const hasActionableDetail =
    /\b(step|click|open|create|connect|set|add|configure|deploy|run|verify|test|success|failure|env|environment|build command|start command|command)\b/i.test(section) ||
    /```/.test(section);

  return !hasActionableDetail;
}

async function repairContractViolationAnswer(request: ReasoningRequest, answer: string, violation: string, apiKey: string) {
  const body = JSON.stringify({
      model: modelForRepairTask("contract").model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Repair the answer for the user. Do not mention drafts, validators, contracts, gates, or blocked output.",
                "Answer like a senior engineer who inspected the current message and attached files.",
                "The previous answer violated this rule:",
                violation,
                "Use the attached readable file evidence as source of truth. You may quote exact broken lines from the files as evidence, but do not tell the user to add code already present in those files.",
                "If you provide a full file replacement, output exactly one complete fenced block for that file and no other code/config blocks.",
                "If a complete replacement is not safe, output no code block; give the exact file/line/section to fix in prose.",
                "Never split one file into separate plugins/repositories/dependencies/defaultConfig/rootProject snippets.",
                "Never say to run/use the following command unless the next block is an actual fenced command. If no exact command is safe, say what value is missing instead.",
                "If the answer names alternatives/options, every named option must include enough instructions to act on it: when to use it, concrete steps or commands/UI actions, required config/env values, success check, and the main caveat. If that would be too long, list fewer options.",
                "Keep the answer short, natural, and immediately useful.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Current user request:",
                request.userMessage,
                "",
                "Live troubleshooting state:",
                formatTroubleshootingSnapshot(request.troubleshooting),
                "",
                "Attached readable file evidence:",
                formatReadableAttachmentEvidenceForRepair(request),
                "",
                "Bad answer to repair:",
                answer,
              ].join("\n"),
            },
          ],
        },
      ],
      temperature: 0.08,
      max_output_tokens: 2200,
  });

  const { response, data } = await fetchOpenAIWithShortRetry(body, apiKey, request);
  if (!response.ok) return answer;

  return (extractText(data) ?? "").trim() || answer;
}

async function repairTroubleshootingAnswerIfNeeded(request: ReasoningRequest, answer: string, apiKey: string) {
  if (!needsTroubleshootingAnswerRepair(request, answer)) return answer;

  const body = JSON.stringify({
      model: modelForRepairTask("troubleshooting").model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Rewrite the draft as a live senior-engineer troubleshooting follow-up.",
                "Write like ChatGPT's best short debugging replies: concise, specific, conversational, and evidence-first.",
                "For one current build/runtime error, keep the answer short. Do not turn it into a report, checklist, repository/version essay, or broad troubleshooting guide.",
                "Start with what the error means and the exact edit to make.",
                "Do not force template headings. Include the substance naturally: current blocker, what changed from the prior issue, the exact fix, how to verify, and what to send if it still fails.",
                "Add a full corrected file/snippet only if the user explicitly asked for it or the draft already includes a code/config replacement, and then use one complete block per affected file.",
                "When attached file evidence is present, compare against the actual file contents. If proposed code is already present, say it is already present instead of telling the user to add it.",
                "If a failing plugin/dependency/toolchain is not used by the attached project evidence, remove it instead of trying to repair its repository or version.",
                "When the exact broken line or section is visible, name the file and quote only the minimal relevant snippet before the fix.",
                "If the draft or prior advice was unhelpful, say so briefly and move to the fix.",
                "Newest evidence wins. Mention older errors only as resolved/no longer current, still present, or relevant to the next action.",
                "If the live state says the latest evidence source is 'referenced previous error', treat the previous current blocker as the active blocker. Do not say there is no exact error unless no prior blocker exists.",
                "Do not restart a full guide. Do not include generic templates, confidence labels, or internal planning terms.",
                "Do not invent file paths, versions, dependencies, symbols, or full file contents. If evidence is missing, say the smallest missing item.",
                "Keep fenced blocks pure: commands contain only runnable commands; replacement code/config contains only the snippet. Prefer normal prose or inline code for short error messages instead of fencing them.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Current user request:",
                request.userMessage,
                "",
                "Authoritative engineering state:",
                formatEngineeringState(request.engineeringState),
                "",
                "Live troubleshooting state:",
                formatTroubleshootingSnapshot(request.troubleshooting),
                "",
                "Attached readable file evidence:",
                formatReadableAttachmentEvidenceForRepair(request),
                "",
                "Toolchain/dependency necessity check:",
                formatToolchainNecessityContext(request) || "None",
                "",
                "Draft answer:",
                answer,
              ].join("\n"),
            },
          ],
        },
      ],
      temperature: 0.15,
      max_output_tokens: Math.max(1400, Math.min(2200, answer.length + 700)),
  });

  const { response, data } = await fetchOpenAIWithShortRetry(body, apiKey, request);
  if (!response.ok) return answer;

  const repaired = (extractText(data) ?? "").trim();
  if (repaired && !detectEvidenceContradiction(request, repaired)) return repaired;

  return createEvidenceContradictionFallback(request) || repaired || answer;
}

function needsTroubleshootingAnswerRepair(request: ReasoningRequest, answer: string) {
  if (!request.troubleshooting.active || !request.troubleshooting.isFollowUp) return false;
  if (!request.troubleshooting.currentBlocker && !request.conversationContext.currentRequest.hasNewEvidence) return false;

  const lower = answer.toLowerCase();
  const restartsGuide = /\b(step\s*1|from scratch|first,?\s+set up|complete guide|full guide|start by creating)\b/i.test(answer);
  const centersOldResolvedIssue =
    request.troubleshooting.resolvedIssues.length > 0 &&
    request.troubleshooting.currentBlocker &&
    request.troubleshooting.resolvedIssues.some((issue) => lower.includes(issue.excerpt.toLowerCase())) &&
    !/\b(no longer|resolved|absent|not the current blocker|previous)\b/i.test(answer);
  const deniesKnownBlocker =
    Boolean(request.troubleshooting.currentBlocker) &&
    /\b(no exact error|no current blocker|unclear what the current blocker is|without the exact error|can't pinpoint|cannot pinpoint)\b/i.test(answer);
  const repeatsAlreadyAttachedCode = extractFencedBlocks(answer)
    .filter((block) => shouldValidateGeneratedSnippet(block.language, block.code))
    .some((block) => snippetAlreadyExistsInAttachedEvidence(request, block.code) && !isNonReplacementContextFence(answer, block));
  const splitsOneConfigFile =
    extractFencedBlocks(answer)
      .filter((block) => shouldValidateGeneratedSnippet(block.language, block.code))
      .filter((block) => !isNonReplacementContextFence(answer, block))
      .filter((block) => looksLikeConfigOrGradleFragment(block.language, block.code)).length > 1;

  return restartsGuide || centersOldResolvedIssue || deniesKnownBlocker || repeatsAlreadyAttachedCode || splitsOneConfigFile || hasImpureFencedBlocks(answer);
}

async function repairEvidenceContradictionAnswerIfNeeded(request: ReasoningRequest, answer: string, apiKey: string) {
  const issue = detectEvidenceContradiction(request, answer);
  if (!issue) return answer;

  const body = JSON.stringify({
      model: modelForRepairTask("evidence").model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Rewrite the answer as a concise ChatGPT-style debugging reply.",
                "The draft conflicts with current attached evidence.",
                "Do not mention validators, guards, drafts, contracts, or internal checks.",
                "Use the attached readable files and latest error as source of truth.",
                "If the latest error names a plugin, package, dependency, toolchain, or integration that current project evidence does not show as used, prefer removing that unused declaration over changing its version, repository, or download source.",
                "Only recommend a version change when the attached project evidence proves the named toolchain/dependency is actually needed by source files or config.",
                "If you show code/config, show the smallest safe replacement. One affected file equals one fenced block. Do not split one file into section blocks.",
                "Keep it short: what the error means, what to change, the snippet or removal, and how to verify.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Latest user request:",
                request.userMessage,
                "",
                "Detected contradiction:",
                issue,
                "",
                "Live troubleshooting state:",
                formatTroubleshootingSnapshot(request.troubleshooting),
                "",
                "Attached readable file evidence:",
                formatReadableAttachmentEvidenceForRepair(request),
                "",
                "Toolchain/dependency necessity check:",
                formatToolchainNecessityContext(request) || "None",
                "",
                "Draft answer to rewrite:",
                answer,
              ].join("\n"),
            },
          ],
        },
      ],
      temperature: 0.08,
      max_output_tokens: 1600,
  });

  const { response, data } = await fetchOpenAIWithShortRetry(body, apiKey, request);
  if (!response.ok) return answer;

  const repaired = (extractText(data) ?? "").trim();
  if (repaired && detectEvidenceContradiction(request, repaired)) return createEvidenceContradictionFallback(request) || repaired;
  return repaired || answer;
}

function detectEvidenceContradiction(request: ReasoningRequest, answer: string) {
  const alreadySatisfiedGradlePluginManagement = detectAlreadySatisfiedGradlePluginManagementAdvice(request, answer);
  if (alreadySatisfiedGradlePluginManagement) return alreadySatisfiedGradlePluginManagement;

  const failingIdentifier = extractFailingIdentifierFromRequest(request);
  if (!failingIdentifier) return "";

  const draftChasesResolution =
    answerMentionsIdentifier(answer, failingIdentifier.id) &&
    (/\b(change|set|use|try|upgrade|downgrade|bump|pin)\b.{0,90}\bversion\b/i.test(answer) ||
      /\bversion\s+[`'"]?\d+(?:[.\w-]+){1,}/i.test(answer) ||
      /\btoo\s+(?:new|old)\b|\bnot\s+(?:available|published)\b/i.test(answer) ||
      /\b(repository|repositories|plugin\s+portal|gradlePluginPortal|mavenCentral|google\(\)|network|proxy|firewall|internet|download|refresh(?:-dependencies)?|cache|wrapper|gradle\s+version)\b/i.test(
        answer,
      ));

  if (!draftChasesResolution) return "";

  const projectEvidence = collectReadableProjectEvidence(request);
  if (!projectEvidence.length) return "";

  const usage = analyzeIdentifierUsageInEvidence(failingIdentifier.id, projectEvidence);
  if (usage.isUsed) return "";
  if (!usage.hasEnoughEvidence) return "";

  return [
    `The latest error names ${failingIdentifier.id}${failingIdentifier.version ? ` version ${failingIdentifier.version}` : ""}.`,
    "The draft tries to fix this by making that unused toolchain/dependency resolve through versions, repositories, network, cache, or wrapper checks.",
    `Current attached project evidence does not show meaningful usage signals for that toolchain/dependency (${usage.signals.map((signal) => signal.value).join(", ")}).`,
    "A senior-engineer answer should first remove the unused declaration when it is visibly present, or ask for the missing source file that proves it is needed, instead of chasing resolution.",
  ].join(" ");
}

function detectAlreadySatisfiedGradlePluginManagementAdvice(request: ReasoningRequest, answer: string) {
  const adviceAddsPluginManagement =
    /\bsettings\.gradle(?:\.kts)?\b/i.test(answer) &&
    /\bpluginManagement\s*\{/.test(answer) &&
    /\bgradlePluginPortal\s*\(\s*\)/.test(answer) &&
    /\bgoogle\s*\(\s*\)/.test(answer) &&
    /\bmavenCentral\s*\(\s*\)/.test(answer);
  if (!adviceAddsPluginManagement) return "";

  const settings = currentGradleSettingsEvidence(request);
  if (!settings) return "";
  if (!settings.hasPluginManagement || !settings.hasGoogle || !settings.hasMavenCentral || !settings.hasGradlePluginPortal) return "";

  const failingIdentifier = extractFailingIdentifierFromRequest(request);
  const failingText = failingIdentifier ? ` for \`${failingIdentifier.id}\`` : "";

  return [
    `The draft recommends adding pluginManagement repositories to settings.gradle.kts${failingText}.`,
    `Current project evidence already shows settings.gradle.kts has pluginManagement with ${settings.presentRepositories.join(", ")}.`,
    "That advice repeats an already-satisfied prerequisite instead of moving to the next hypothesis.",
    "A senior-engineer answer should say the repository block is already present, then inspect whether the failing plugin/dependency is actually needed or whether the declaration should be removed/aligned.",
  ].join(" ");
}

function currentGradleSettingsEvidence(request: ReasoningRequest) {
  const settings = collectReadableProjectEvidence(request).find((item) => /(?:^|[/\\])settings\.gradle(?:\.kts)?$/i.test(item.fileName));
  if (!settings) return undefined;

  const text = settings.text;
  const hasPluginManagement = /\bpluginManagement\s*\{[\s\S]*?\brepositories\s*\{/i.test(text);
  const hasGoogle = /\bgoogle\s*\(\s*\)/i.test(text);
  const hasMavenCentral = /\bmavenCentral\s*\(\s*\)/i.test(text);
  const hasGradlePluginPortal = /\bgradlePluginPortal\s*\(\s*\)/i.test(text);
  const presentRepositories = [
    hasGoogle ? "google()" : "",
    hasMavenCentral ? "mavenCentral()" : "",
    hasGradlePluginPortal ? "gradlePluginPortal()" : "",
  ].filter(Boolean);

  return {
    fileName: settings.fileName,
    hasPluginManagement,
    hasGoogle,
    hasMavenCentral,
    hasGradlePluginPortal,
    presentRepositories,
  };
}

function formatToolchainNecessityContext(request: ReasoningRequest) {
  const failingIdentifier = extractFailingIdentifierFromRequest(request);
  if (!failingIdentifier) return "";

  const projectEvidence = collectReadableProjectEvidence(request);
  if (!projectEvidence.length) return "";

  const usage = analyzeIdentifierUsageInEvidence(failingIdentifier.id, projectEvidence);
  const removalSnippets = createIdentifierRemovalSnippets(request, failingIdentifier.id);
  const sourceShape = summarizeProjectEvidenceShape(projectEvidence);

  return [
    `Failing identifier: ${failingIdentifier.id}${failingIdentifier.version ? ` version ${failingIdentifier.version}` : ""}`,
    `Attached evidence shape: ${sourceShape}`,
    `Usage signals checked: ${usage.signals.map((signal) => signal.value).join(", ") || "none"}`,
    `Usage found outside the declaration: ${usage.isUsed ? "yes" : "no"}`,
    removalSnippets.length
      ? `Visible removable declaration in: ${removalSnippets.map((snippet) => snippet.fileName).join(", ")}`
      : "No exact removable declaration was safely extracted from attached files. If the same error persists, do not call it resolved; say the visible files are clean and the declaration must be in another module file, version catalog, included build, or unprovided config.",
    usage.hasEnoughEvidence && !usage.isUsed
      ? "Reasoning instruction: do not chase version, repository, proxy, cache, download, or wrapper fixes first. The preferred answer is to remove the unused failing declaration, then rerun the user's build/sync."
      : "Reasoning instruction: project evidence shows or may show usage, so diagnose the actual resolution/configuration issue instead of removing it blindly.",
  ].join("\n");
}

function createGradlePluginSyntaxDirectAnswer(request: ReasoningRequest) {
  if (!looksLikeGradlePluginDslReceiverMismatch(request)) return "";
  const projectEvidence = collectReadableProjectEvidence(request);

  const corrections = projectEvidence
    .filter((item) => /\.gradle(?:\.kts)?$/i.test(item.fileName))
    .map((item) => {
      const content = removeUnusedToolchainDeclarations(
        splitConcatenatedGradlePluginDeclarations(item.text),
        projectEvidence,
      );
      if (normalizeForEvidenceComparison(content) === normalizeForEvidenceComparison(item.text)) return undefined;
      return { fileName: item.fileName, content };
    })
    .filter((item): item is { fileName: string; content: string } => Boolean(item))
    .slice(0, 1);

  if (!corrections.length) return "";

  const correction = corrections[0];
  const removedToolchains = removedToolchainIdentifiers(projectEvidence, correction.fileName, correction.content);
  const projectShape = removedToolchains[0] ? describeProjectShapeForToolchain(projectEvidence, removedToolchains[0]) : "";
  const intro =
    removedToolchains.length && projectShape
      ? `I checked the attached project files. This is not a Kotlin version or repository problem: the build is tripping over Kotlin tooling, but the project evidence looks like ${projectShape}. Remove it: delete the Kotlin declaration instead of trying another version.`
      : `I checked the attached \`${correction.fileName}\`. The current error is a Gradle Kotlin DSL syntax/configuration problem, not something to solve by changing plugin versions.`;

  return [
    intro,
    "",
    `Use this full \`${correction.fileName}\`:`,
    "",
    `\`\`\`${languageForFileName(correction.fileName) || "kotlin"} ${correction.fileName}`,
    correction.content,
    "```",
    "",
    removedToolchains.length
      ? `Also remove ${removedToolchains.map((identifier) => `\`${identifier}\``).join(", ")} anywhere else it appears.`
      : "",
    ...removedToolchains.flatMap(modulePluginRemovalGuidance),
    "Then sync Gradle again. If another plugin error appears, send that latest first error line and the module Gradle file it points to.",
  ]
    .filter(Boolean)
    .join("\n");
}

function removedToolchainIdentifiers(projectEvidence: Array<{ fileName: string; text: string }>, correctedFileName: string, correctedContent: string) {
  const original = projectEvidence.find((item) => item.fileName === correctedFileName)?.text ?? "";
  if (!original) return [];

  return extractGradlePluginIdentifiers(original).filter((identifier) => {
    if (!isToolchainPluginIdentifier(identifier)) return false;
    if (normalizeForEvidenceComparison(correctedContent).includes(normalizeForEvidenceComparison(identifier))) return false;
    const usage = analyzeIdentifierUsageInEvidence(identifier, projectEvidence);
    return usage.hasEnoughEvidence && !usage.isUsed;
  });
}

function removeUnusedToolchainDeclarations(text: string, projectEvidence: Array<{ fileName: string; text: string }>) {
  return extractGradlePluginIdentifiers(text).reduce((current, identifier) => {
    if (!isToolchainPluginIdentifier(identifier)) return current;
    const usage = analyzeIdentifierUsageInEvidence(identifier, projectEvidence);
    if (!usage.hasEnoughEvidence || usage.isUsed) return current;
    return removeIdentifierDeclarationLines(current, identifier);
  }, text);
}

function extractGradlePluginIdentifiers(text: string) {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/\bid\s*\(\s*["']([^"']+)["']\s*\)|\bkotlin\s*\(\s*["']([^"']+)["']\s*\)/g), (match) => {
        if (match[1]) return match[1];
        if (match[2]) return `org.jetbrains.kotlin.${match[2]}`;
        return "";
      }).filter(Boolean),
    ),
  );
}

function isToolchainPluginIdentifier(identifier: string) {
  return /\bkotlin\b|org\.jetbrains\.kotlin|\bscala\b|\bgroovy\b|\btypescript\b|\bts-node\b/i.test(identifier);
}

function looksLikeGradlePluginDslReceiverMismatch(request: ReasoningRequest) {
  const text = [
    request.userMessage,
    request.troubleshooting.currentBlocker?.excerpt ?? "",
    request.engineeringState.currentBlocker,
    ...request.troubleshooting.currentIssues.map((issue) => issue.excerpt),
  ].join("\n");

  return (
    /\bUnresolved reference\b/i.test(text) &&
    /\bPluginDependenciesSpec\.\w+\s*\(/i.test(text) &&
    /\bbuild\.gradle(?:\.kts)?\b|\.gradle(?:\.kts)?:\d+:\d+/i.test(text)
  );
}

function splitConcatenatedGradlePluginDeclarations(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => splitConcatenatedGradlePluginLine(line))
    .join("\n")
    .trim();
}

function splitConcatenatedGradlePluginLine(line: string) {
  const pluginDeclaration = /(?:id|kotlin)\s*\([^)]*\)(?:\s+version\s+["'][^"']+["'])?(?:\s+apply\s+(?:false|true))?/g;
  const matches = Array.from(line.matchAll(pluginDeclaration));
  if (matches.length < 2) return line;

  const indent = line.match(/^\s*/)?.[0] ?? "";
  const before = line.slice(0, matches[0].index ?? 0).trimEnd();
  const after = line.slice((matches.at(-1)?.index ?? 0) + (matches.at(-1)?.[0].length ?? 0)).trim();
  const declarations = matches.map((match) => `${indent}${match[0].trim()}`);
  const parts = before.trim() ? [`${indent}${before.trim()}`, ...declarations] : declarations;
  if (after) parts.push(`${indent}${after}`);
  return parts.join("\n");
}

function createUnusedToolchainDirectAnswer(request: ReasoningRequest) {
  const projectEvidence = collectReadableProjectEvidence(request);
  const failingIdentifier = extractFailingIdentifierFromRequest(request) ?? inferUnusedToolchainIdentifierFromEvidence(request, projectEvidence);
  if (!failingIdentifier) return "";

  if (!projectEvidence.length) return "";

  const usage = analyzeIdentifierUsageInEvidence(failingIdentifier.id, projectEvidence);
  if (!usage.hasEnoughEvidence || usage.isUsed) return "";

  const removalSnippets = createIdentifierRemovalSnippets(request, failingIdentifier.id);
  const toolchain = readableToolchainName(failingIdentifier.id);
  const projectShape = describeProjectShapeForToolchain(projectEvidence, failingIdentifier.id);
  if (!removalSnippets.length) {
    return createNoVisibleUnusedToolchainDeclarationAnswer(request, failingIdentifier.id, toolchain, projectEvidence, projectShape);
  }

  const intro = projectShape
    ? `The loop is happening because the assistant is assuming you need ${toolchain}. The attached project evidence looks like ${projectShape}. Remove it: choose Java and remove that toolchain completely.`
    : `This is the important part: the current error is for ${toolchain}, but the attached project evidence does not show that toolchain being used. So do not chase versions or repositories. Remove it.`;
  const javaVsToolchainChoice = projectShape
    ? [
        "",
        `You have two paths: stay with ${projectShape} and remove ${toolchain}, or actually convert the project to use ${toolchain}. Based on the current evidence, stay Java and remove the extra toolchain.`,
      ].join("\n")
    : "";

  return [
    intro,
    javaVsToolchainChoice,
    "",
    ...removalSnippets.flatMap((snippet) => [
      `Use this for \`${snippet.fileName}\`:`,
      "",
      `\`\`\`${languageForFileName(snippet.fileName) || "text"} ${snippet.fileName}`,
      snippet.content,
      "```",
      "",
    ]),
    ...modulePluginRemovalGuidance(failingIdentifier.id),
    `Also remove \`${failingIdentifier.id}\` anywhere else it appears.`,
    "",
    "Then sync/build again. The log is failing on that plugin/declaration, not on the repositories.",
  ]
    .join("\n")
    .trim();
}

function createNoVisibleUnusedToolchainDeclarationAnswer(
  request: ReasoningRequest,
  identifier: string,
  toolchain: string,
  projectEvidence: Array<{ fileName: string; text: string }>,
  projectShape: string,
) {
  const visibleFiles = projectEvidence.map((item) => `\`${item.fileName}\``).join(", ");
  const likelyLocations = likelyRemainingDeclarationLocations(identifier, projectEvidence);
  const searchCommand = searchCommandForIdentifier(identifier);
  const shapeText = projectShape ? ` The attached project evidence looks like ${projectShape}.` : "";

  return [
    `You're right. The useful fix is to choose the project stack first, not keep defining the plugin error.${shapeText} Stay with that stack and remove ${toolchain} completely; do not try another version.`,
    "",
    `I checked the currently attached files: ${visibleFiles || "none"}. They no longer show the failing \`${identifier}\` declaration, so those visible files are not where the remaining problem is.`,
    "",
    ...modulePluginRemovalGuidance(identifier),
    "",
    "If the same error still appears, the declaration is still somewhere else in the project. Check these next:",
    "",
    likelyLocations.map((location) => `- ${location}`).join("\n"),
    "",
    "Search the project for the exact failing identifier:",
    "",
    "```powershell",
    searchCommand,
    "```",
    "",
    `Remove every remaining \`${identifier}\` declaration, then sync/build again. If the search finds it in a file, send that file and I can return the exact full corrected version.`,
  ].join("\n");
}

function modulePluginRemovalGuidance(identifier: string) {
  if (!/\bkotlin\b|org\.jetbrains\.kotlin/i.test(identifier)) return [];

  return [
    "In the module Gradle file, such as `app/build.gradle.kts`, the plugins block should not apply Kotlin either. For a Java Android app, keep it to:",
    "",
    "```kotlin app/build.gradle.kts",
    "plugins {",
    "    id(\"com.android.application\")",
    "}",
    "```",
    "",
    "Remove these everywhere they appear:",
    "",
    "```kotlin",
    "id(\"org.jetbrains.kotlin.android\")",
    "kotlin(\"android\")",
    "```",
  ];
}

function likelyRemainingDeclarationLocations(identifier: string, evidence: Array<{ fileName: string; text: string }>) {
  const names = new Set(evidence.map((item) => item.fileName.toLowerCase()));
  const locations = new Set<string>();

  if (/\bgradle|plugin|kotlin|android|jetbrains/i.test(identifier)) {
    if (!names.has("app/build.gradle.kts") && !names.has("app\\build.gradle.kts")) locations.add("`app/build.gradle.kts` or another module-level Gradle file");
    if (!names.has("gradle/libs.versions.toml") && !names.has("gradle\\libs.versions.toml")) locations.add("`gradle/libs.versions.toml` if the project uses version-catalog aliases like `libs.plugins...`");
    locations.add("any other `*.gradle.kts`, `*.gradle`, or included build file");
  }

  if (!locations.size) {
    locations.add("the module/package config file where that dependency or plugin is declared");
    locations.add("any shared version catalog, lockfile, workspace config, or included build file");
  }

  return Array.from(locations);
}

function searchCommandForIdentifier(identifier: string) {
  const escaped = identifier.replace(/'/g, "''");
  return `Get-ChildItem -Recurse -File | Select-String -SimpleMatch '${escaped}'`;
}

function createEvidenceContradictionFallback(request: ReasoningRequest, answer?: string) {
  const pluginManagementContradiction =
    answer && detectAlreadySatisfiedGradlePluginManagementAdvice(request, answer)
      ? detectAlreadySatisfiedGradlePluginManagementAdvice(request, answer)
      : "";
  if (pluginManagementContradiction) {
    const directToolchainAnswer = createUnusedToolchainDirectAnswer(request);
    if (directToolchainAnswer) return directToolchainAnswer;

    const settings = currentGradleSettingsEvidence(request);
    const failingIdentifier = extractFailingIdentifierFromRequest(request);
    const failingText = failingIdentifier ? ` for \`${failingIdentifier.id}\`` : "";

    return [
      `That repository advice does not match the project evidence. \`${settings?.fileName ?? "settings.gradle.kts"}\` already has \`pluginManagement\` with ${settings?.presentRepositories.join(", ") || "the required repositories"}.`,
      "",
      `So adding that block again will not fix the plugin-resolution error${failingText}. The next step is to inspect the declaration that names the failing plugin/dependency and decide whether it belongs in this project.`,
      "",
      failingIdentifier
        ? `Search for \`${failingIdentifier.id}\`, then either remove the declaration if the project does not actually use it, or fix the declaration/version only if source/config evidence proves it is required.`
        : "Search for the exact failing plugin/dependency identifier, then remove or align that declaration based on the files that actually use it.",
    ].join("\n");
  }

  const failingIdentifier = extractFailingIdentifierFromRequest(request);
  if (!failingIdentifier) return "";

  if (answer && !detectEvidenceContradiction(request, answer)) return "";

  const removalSnippets = createIdentifierRemovalSnippets(request, failingIdentifier.id);
  if (!removalSnippets.length) {
    return [
      `The current error is about \`${failingIdentifier.id}\`, but the attached project evidence does not show that toolchain/dependency being used.`,
      "",
      `Do not chase repositories, cache, proxy, or version changes yet. First remove the \`${failingIdentifier.id}\` declaration from the file where it appears, then sync/build again.`,
      "",
      "If the project really does use it, send the source file or config section that requires it so the fix is based on that evidence.",
    ].join("\n");
  }

  return [
    `The current error is about \`${failingIdentifier.id}\`, but the attached files do not show the project using it. So the next fix is to remove that declaration, not chase repositories or versions.`,
    "",
    ...removalSnippets.flatMap((snippet) => [
      `Use this for \`${snippet.fileName}\`:`,
      "",
      `\`\`\`${languageForFileName(snippet.fileName) || "text"} ${snippet.fileName}`,
      snippet.content,
      "```",
      "",
    ]),
    "Then sync/build again. If it still fails, send the new first error line plus the current file that contains it.",
  ]
    .join("\n")
    .trim();
}

function createIdentifierRemovalSnippets(request: ReasoningRequest, identifier: string) {
  return collectReadableProjectEvidence(request)
    .map((item) => {
      const source = safeProjectReplacementSource(item.fileName, item.text);
      if (!source) return undefined;
      const content = removeIdentifierDeclarationLines(source, identifier);
      if (!content || normalizeForEvidenceComparison(content) === normalizeForEvidenceComparison(source)) return undefined;
      return { fileName: item.fileName, content };
    })
    .filter((item): item is { fileName: string; content: string } => Boolean(item))
    .slice(0, 2);
}

function safeProjectReplacementSource(fileName: string, text: string) {
  const normalized = splitConcatenatedGradlePluginDeclarations(text.replace(/\r\n/g, "\n")).trim();
  if (!normalized) return "";

  if (/\.gradle(?:\.kts)?$/i.test(fileName)) {
    const start = findFirstIndex(normalized, [/\/\/\s*Top-level\s+build\.gradle\.kts/i, /(?:^|\n)\s*plugins\s*\{/i, /(?:^|\n)\s*(?:buildscript|allprojects|subprojects)\s*\{/i]);
    const candidate = (start >= 0 ? normalized.slice(start) : normalized).trim();
    if (/\b(?:Plugin\s+\[id:|file:\/\/\/|None of the following candidates|Unresolved reference|Searched in the following repositories)\b/i.test(candidate)) return "";
    if (!/\b(?:plugins|buildscript|allprojects|subprojects|repositories|dependencies|android)\s*\{/.test(candidate)) return "";
    return candidate;
  }

  return normalized;
}

function removeIdentifierDeclarationLines(text: string, identifier: string) {
  return stripIdentifierDeclarationLines(text, identifier).trim();
}

function stripIdentifierDeclarationLines(text: string, identifier: string) {
  const declarationSegment = declarationSegmentPatternForIdentifier(identifier);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let removed = false;
  const kept = lines
    .map((line) => {
      if (!declarationSegment.test(line)) return line;
      removed = true;
      const nextLine = line.replace(declarationSegment, "").trimEnd();
      return nextLine.trim() ? nextLine : undefined;
    })
    .filter((line): line is string => typeof line === "string");

  if (!removed) return text.replace(/\r\n/g, "\n");
  return kept.join("\n");
}

function declarationSegmentPatternForIdentifier(identifier: string) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const aliases = pluginDeclarationAliases(identifier).map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const aliasAlternation = aliases.length ? `|${aliases.join("|")}` : "";
  const dslDeclarations = toolchainProfileForIdentifier(identifier)?.dslDeclarationPatterns.join("|") ?? "";
  const dslDeclarationAlternative = dslDeclarations ? `|(?:${dslDeclarations})(?:\\s+version\\s+["'][^"']+["'])?(?:\\s+apply\\s+(?:false|true))?` : "";
  return new RegExp(
    `\\s*(?:id\\s*\\(\\s*["'](?:${escaped}${aliasAlternation})["']\\s*\\)(?:\\s+version\\s+["'][^"']+["'])?(?:\\s+apply\\s+(?:false|true))?${dslDeclarationAlternative}|plugin\\s+["'](?:${escaped}${aliasAlternation})["'][^\\n]*|alias\\s*\\([^\\n]*(?:${escaped}${aliasAlternation}|${identifierKeywordPattern(identifier)})[^\\n]*\\)(?:\\s+apply\\s+(?:false|true))?)`,
    "i",
  );
}

function pluginDeclarationAliases(identifier: string) {
  return toolchainProfileForIdentifier(identifier)?.declarationAliases(identifier) ?? [];
}

function identifierKeywordPattern(identifier: string) {
  const keywords = identifier
    .toLowerCase()
    .split(/[.:/_-]+/)
    .filter((part) => part.length > 3 && !COMMON_IDENTIFIER_PARTS.has(part))
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return keywords.length ? keywords.join("[^\\n]*") : identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeProjectEvidenceShape(evidence: Array<{ fileName: string; text: string }>) {
  const extensions = new Map<string, number>();
  const readableFiles = evidence.map((item) => item.fileName);

  for (const item of evidence) {
    const extension = fileExtensionForSummary(item.fileName);
    if (extension) extensions.set(extension, (extensions.get(extension) ?? 0) + 1);
  }

  const extensionSummary = Array.from(extensions.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([extension, count]) => `${extension}:${count}`)
    .join(", ");

  return `${readableFiles.join(", ") || "none"}${extensionSummary ? `; extensions ${extensionSummary}` : ""}`;
}

function fileExtensionForSummary(fileName: string) {
  const lower = fileName.toLowerCase();
  const multi = lower.match(/(\.gradle\.kts|\.gradle|\.config\.js|\.config\.ts)$/);
  if (multi?.[1]) return multi[1];
  const single = lower.match(/(\.[a-z0-9]+)$/);
  return single?.[1] ?? "";
}

function readableToolchainName(identifier: string) {
  const profile = toolchainProfileForIdentifier(identifier);
  if (profile) return profile.displayName;
  return `\`${identifier}\``;
}

function describeProjectShapeForToolchain(evidence: Array<{ fileName: string; text: string }>, identifier: string) {
  const counts = sourceExtensionCounts(evidence);
  const mismatch = toolchainProfileForIdentifier(identifier)?.mismatchDescription?.(counts);
  if (mismatch) {
    return mismatch;
  }

  const sourceSummary = Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([extension, count]) => `${count} ${extension} file${count === 1 ? "" : "s"}`)
    .join(", ");

  return sourceSummary || "";
}

function sourceExtensionCounts(evidence: Array<{ fileName: string; text: string }>) {
  const counts = new Map<string, number>();
  for (const item of evidence) {
    const lower = item.fileName.toLowerCase();
    const extension = lower.endsWith(".gradle.kts") ? "" : lower.match(/(\.[a-z0-9]+)$/)?.[1] ?? "";
    if (!extension || !SOURCE_FILE_EXTENSIONS.has(extension)) continue;
    if (extension === ".kt" && !looksLikeKotlinSource(item.text)) {
      if (looksLikeJavaSource(item.text)) counts.set(".java", (counts.get(".java") ?? 0) + 1);
      continue;
    }
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return counts;
}

function looksLikeJavaSource(text: string) {
  const source = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return /\bpublic\s+class\b|\bextends\s+\w+|\bimplements\s+\w+|\b@Override\b|\bnew\s+\w+\s*\(/.test(source);
}

const SOURCE_FILE_EXTENSIONS = new Set([".java", ".kt", ".js", ".jsx", ".ts", ".tsx", ".scala", ".groovy", ".py", ".rb", ".php", ".go", ".rs", ".swift", ".cs"]);

function extractFailingIdentifier(message: string) {
  const plugin = message.match(/Plugin\s+\[\s*id:\s*'([^']+)'(?:\s*,\s*version:\s*'([^']+)')?/i);
  if (plugin?.[1]) return { id: plugin[1], version: plugin[2] };

  const quotedPlugin = message.match(/\bplugin\s+['"`]([a-z0-9_.:-]+)['"`].{0,120}\b(?:not found|could not|cannot|failed)/i);
  if (quotedPlugin?.[1]) return { id: quotedPlugin[1], version: undefined };

  const unresolvedPackage = message.match(/\b(?:Could not find|Could not resolve|Cannot find module|module not found|package not found)\s+['"`]?(@?[\w.-]+(?:[/:][\w.-]+)+)['"`]?/i);
  if (unresolvedPackage?.[1]) return { id: unresolvedPackage[1], version: undefined };

  return undefined;
}

function extractFailingIdentifierFromRequest(request: ReasoningRequest) {
  const candidates = [
    request.userMessage,
    request.troubleshooting.currentBlocker?.excerpt ?? "",
    request.engineeringState.currentBlocker,
    request.engineeringState.currentHypothesis,
    request.engineeringState.recommendedNextAction,
    request.lastResult ?? "",
    ...request.troubleshooting.currentIssues.map((issue) => issue.excerpt),
    ...request.troubleshooting.persistentIssues.map((issue) => issue.excerpt),
    ...request.troubleshooting.summaryLines,
    ...request.priorMessages.slice(-6).map((message) => message.body),
  ];

  for (const candidate of candidates) {
    const identifier = extractFailingIdentifier(candidate ?? "");
    if (identifier) return identifier;
  }

  return undefined;
}

function inferUnusedToolchainIdentifierFromEvidence(request: ReasoningRequest, projectEvidence: Array<{ fileName: string; text: string }>) {
  if (!projectEvidence.length) return undefined;

  const shouldInspectDeclarations =
    request.troubleshooting.active ||
    request.conversationContext.currentRequest.containsDiagnosticEvidence ||
    /\b(build\.gradle|settings\.gradle|plugins?\s*\{|dependency|dependencies|toolchain|compiler|build|sync|gradle|maven|package\.json|tsconfig|config|fix|correct|is this|does this|why|error)\b/i.test(
      request.userMessage,
    );
  if (!shouldInspectDeclarations) return undefined;

  for (const item of projectEvidence) {
    if (!/\.(?:gradle|gradle\.kts|kts|toml|json)$/i.test(item.fileName)) continue;

    for (const identifier of extractGradlePluginIdentifiers(item.text)) {
      if (!isToolchainPluginIdentifier(identifier)) continue;

      const usage = analyzeIdentifierUsageInEvidence(identifier, projectEvidence);
      if (usage.hasEnoughEvidence && !usage.isUsed) {
        return { id: identifier, version: undefined };
      }
    }
  }

  return undefined;
}

function answerMentionsIdentifier(answer: string, identifier: string) {
  const normalizedAnswer = answer.toLowerCase();
  const normalizedIdentifier = identifier.toLowerCase();
  if (normalizedAnswer.includes(normalizedIdentifier)) return true;

  const parts = identifier
    .toLowerCase()
    .split(/[.:/_-]+/)
    .filter((part) => part.length > 3 && !COMMON_IDENTIFIER_PARTS.has(part));

  if (parts.some((part) => normalizedAnswer.includes(part))) return true;
  if (/\bkotlin\b|org\.jetbrains\.kotlin/i.test(identifier) && /\bkotlin(?:\s+android)?\s+plugin\b/i.test(answer)) return true;
  if (/\btypescript\b|\bts-node\b/i.test(identifier) && /\btypescript|ts-node\b/i.test(answer)) return true;
  if (/\bscala\b/i.test(identifier) && /\bscala\b/i.test(answer)) return true;
  if (/\bgroovy\b/i.test(identifier) && /\bgroovy\b/i.test(answer)) return true;

  return false;
}

function collectReadableProjectEvidence(request: ReasoningRequest) {
  const attachedEvidence = request.attachments
    .filter((attachment) => attachment.uploadStatus === "readable" && attachment.rawText.trim())
    .map((attachment) => ({
      fileName: attachment.fileName,
      text: attachment.rawText,
    }));

  const priorPastedEvidence = request.priorMessages
    .slice(-8)
    .filter((message) => message.author !== "Foundry")
    .flatMap((message) => extractInlineProjectEvidence(message.body));

  return mergeProjectEvidence([...attachedEvidence, ...priorPastedEvidence, ...extractInlineProjectEvidence(request.userMessage)]);
}

function mergeProjectEvidence(evidence: Array<{ fileName: string; text: string }>) {
  const merged = new Map<string, { fileName: string; text: string }>();

  for (const item of evidence) {
    const normalized = normalizeForEvidenceComparison(item.text) || item.text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized) continue;
    const key = `${item.fileName.toLowerCase()}:${normalized}`;
    if (!merged.has(key)) merged.set(key, item);
  }

  return Array.from(merged.values());
}

function extractInlineProjectEvidence(message: string) {
  const evidence: Array<{ fileName: string; text: string }> = [];
  const normalized = message.replace(/\r\n/g, "\n");

  const fencedFiles = Array.from(normalized.matchAll(/(?:^|\n)\s*(?:#+\s*)?([A-Za-z0-9_./\\-]+\.(?:gradle\.kts|gradle|kt|java|json|xml|ya?ml|toml|js|ts|tsx|jsx|css|html))\s*:?\s*\n```[^\n`]*\n([\s\S]*?)```/gi));
  fencedFiles.forEach((match) => {
    if (match[1] && match[2]?.trim()) evidence.push({ fileName: normalizeInlineFileName(match[1]), text: match[2].trim() });
  });

  if (!hasInlineEvidenceFile(evidence, "build.gradle.kts")) {
    const rootGradle = extractInlineGradleRootBuildFile(normalized);
    if (rootGradle) evidence.push({ fileName: "build.gradle.kts", text: rootGradle });
  }

  if (!hasInlineEvidenceFile(evidence, "build.gradle.kts")) {
    const compactGradle = extractCompactInlineGradleBuildFile(normalized);
    if (compactGradle) evidence.push({ fileName: "build.gradle.kts", text: compactGradle });
  }

  if (!hasInlineEvidenceFile(evidence, "settings.gradle.kts")) {
    const settings = extractInlineSettingsGradleFile(normalized);
    if (settings) evidence.push({ fileName: "settings.gradle.kts", text: settings });
  }

  return evidence;
}

function hasInlineEvidenceFile(evidence: Array<{ fileName: string; text: string }>, fileName: string) {
  return evidence.some((item) => item.fileName.toLowerCase() === fileName.toLowerCase());
}

function normalizeInlineFileName(fileName: string) {
  return fileName.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? fileName;
}

function extractInlineGradleRootBuildFile(message: string) {
  const start = findFirstIndex(message, [/\/\/\s*Top-level\s+build\.gradle\.kts/i, /(?:^|\n)\s*plugins\s*\{\s*\n[\s\S]{0,500}org\.jetbrains\.kotlin/i]);
  if (start < 0) return "";

  const end = findFirstFollowingIndex(message, start + 1, [/\n\s*pluginManagement\s*\{/i, /\n\s*dependencyResolutionManagement\s*\{/i, /\n\s*rootProject\.name\s*=/i]);
  const candidate = message.slice(start, end > start ? end : undefined).trim();
  if (!/\bplugins\s*\{/.test(candidate)) return "";
  return candidate;
}

function extractCompactInlineGradleBuildFile(message: string) {
  if (!/\bbuild\.gradle(?:\.kts)?\b/i.test(message)) return "";
  if (!/\bplugins\s*\{/.test(message)) return "";
  if (!/\bid\s*\(\s*["'][^"']+["']\s*\)|\bkotlin\s*\(\s*["'][^"']+["']\s*\)/.test(message)) return "";

  const start = findFirstIndex(message, [/\bplugins\s*\{/i]);
  if (start < 0) return "";

  const end = findFirstFollowingIndex(message, start + 1, [/\bsettings\.gradle(?:\.kts)?\b/i, /\bpluginManagement\s*\{/i, /\brootProject\.name\s*=/i]);
  const candidate = message.slice(start, end > start ? end : undefined).trim();
  if (!/\bplugins\s*\{/.test(candidate)) return "";
  return splitConcatenatedGradlePluginDeclarations(candidate);
}

function extractInlineSettingsGradleFile(message: string) {
  const start = findFirstIndex(message, [/(?:^|\n)\s*pluginManagement\s*\{/i]);
  if (start < 0) return "";

  const end = findFirstFollowingIndex(message, start + 1, [/\n\s*\/\/\s*Top-level\s+build\.gradle\.kts/i, /\n\s*plugins\s*\{/i]);
  const candidate = message.slice(start, end > start ? end : undefined).trim();
  if (!/\bpluginManagement\s*\{/.test(candidate)) return "";
  return candidate;
}

function findFirstIndex(value: string, patterns: RegExp[]) {
  return patterns.reduce((best, pattern) => {
    const match = pattern.exec(value);
    if (!match || typeof match.index !== "number") return best;
    return best < 0 ? match.index : Math.min(best, match.index);
  }, -1);
}

function findFirstFollowingIndex(value: string, start: number, patterns: RegExp[]) {
  return patterns.reduce((best, pattern) => {
    pattern.lastIndex = 0;
    const match = pattern.exec(value.slice(start));
    if (!match || typeof match.index !== "number") return best;
    const absolute = start + match.index;
    return best < 0 ? absolute : Math.min(best, absolute);
  }, -1);
}

function analyzeIdentifierUsageInEvidence(identifier: string, evidence: Array<{ fileName: string; text: string }>) {
  const signals = usageSignalsForIdentifier(identifier);
  const declarationPattern = declarationPatternForIdentifier(identifier);
  let hasRelevantProjectFiles = false;
  let isUsed = false;

  for (const item of evidence) {
    const lowerText = item.text.toLowerCase();
    const searchableText = stripIdentifierDeclarationLines(item.text, identifier).toLowerCase();
    if (isProjectSourceOrConfig(item.fileName)) hasRelevantProjectFiles = true;

    for (const signal of signals) {
      if (declarationPattern.test(item.text) && lowerText.includes(signal.value.toLowerCase()) && !searchableText.includes(signal.value.toLowerCase())) continue;
      if (signal.kind === "source-file") {
        if (sourceFileMatchesSignal(item.fileName, item.text, signal.value, identifier)) {
          isUsed = true;
        }
        continue;
      }
      if (searchableText.includes(signal.value.toLowerCase())) {
        isUsed = true;
      }
    }
  }

  return {
    signals,
    hasEnoughEvidence: hasRelevantProjectFiles,
    isUsed,
  };
}

function usageSignalsForIdentifier(identifier: string) {
  const parts = identifier
    .toLowerCase()
    .split(/[.:/_-]+/)
    .filter((part) => part.length > 2 && !COMMON_IDENTIFIER_PARTS.has(part));
  const signals = new Map<string, { value: string; kind: "text" | "source-file" }>();
  parts.forEach((part) => signals.set(`text:${part}`, { value: part, kind: "text" }));

  const profile = toolchainProfileForIdentifier(identifier);
  profile?.sourceExtensions.forEach((signal) => signals.set(`source-file:${signal}`, { value: signal, kind: "source-file" }));
  profile?.textSignals.forEach((signal) => signals.set(`text:${signal}`, { value: signal, kind: "text" }));
  if (/\bcompose\b/i.test(identifier)) ["compose", "@composable"].forEach((signal) => signals.set(`text:${signal}`, { value: signal, kind: "text" }));

  return Array.from(signals.values()).filter((signal) => signal.value.length > 2);
}

function sourceFileMatchesSignal(fileName: string, text: string, extension: string, identifier: string) {
  const lower = fileName.toLowerCase();
  const profile = toolchainProfileForIdentifier(identifier);
  if (profile?.sourceEvidence) return lower.endsWith(extension.toLowerCase()) && profile.sourceEvidence(text, identifier);
  return lower.endsWith(extension.toLowerCase());
}

function looksLikeKotlinSource(text: string, identifier = "") {
  const source = stripIdentifierDeclarationLines(text, identifier);
  const withoutComments = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const kotlinSignals = [
    /\bfun\s+\w+\s*\(/,
    /\b(?:val|var)\s+\w+\s*[:=]/,
    /\bobject\s+\w+/,
    /\bdata\s+class\b/,
    /\bcompanion\s+object\b/,
    /\boverride\s+fun\b/,
    /\bclass\s+\w+\s*:\s*[\w.]+/,
    /\bimport\s+kotlinx?\./,
  ].filter((pattern) => pattern.test(withoutComments)).length;
  const javaSignals = [
    /\bpublic\s+class\b/,
    /\bprivate\s+\w+[<\w,\s>]*\s+\w+\s*[;=]/,
    /\bextends\s+\w+/,
    /\bimplements\s+\w+/,
    /;\s*$/,
  ].filter((pattern) => pattern.test(withoutComments)).length;

  return kotlinSignals > 0 && kotlinSignals >= javaSignals;
}

function looksLikeTypeScriptSource(text: string) {
  const source = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return /\b(type|interface)\s+\w+|\b(?:const|let|var)\s+\w+\s*:\s*[\w[{]|\)\s*:\s*[\w[{]/.test(source);
}

const COMMON_IDENTIFIER_PARTS = new Set([
  "org",
  "com",
  "net",
  "io",
  "android",
  "application",
  "app",
  "plugin",
  "plugins",
  "gradle",
  "build",
  "core",
  "tools",
  "library",
  "dependencies",
  "dependency",
]);

function declarationPatternForIdentifier(identifier: string) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:id\\s*\\(\\s*["']${escaped}["']|plugin\\s+["']${escaped}["']|${escaped})`, "i");
}

type ToolchainProfile = {
  name: string;
  displayName: string;
  matches: RegExp;
  sourceExtensions: string[];
  textSignals: string[];
  sourceEvidence?: (text: string, identifier: string) => boolean;
  declarationAliases: (identifier: string) => string[];
  dslDeclarationPatterns: string[];
  mismatchDescription?: (counts: Map<string, number>) => string;
};

const TOOLCHAIN_PROFILES: ToolchainProfile[] = [
  {
    name: "kotlin",
    displayName: "Kotlin plugin",
    matches: /\bkotlin\b|org\.jetbrains\.kotlin/i,
    sourceExtensions: [".kt"],
    textSignals: ["kotlin(", "kotlin.", "kotlinx.", "org.jetbrains.kotlin", "id(\"org.jetbrains.kotlin"],
    sourceEvidence: looksLikeKotlinSource,
    declarationAliases: (identifier) => {
      if (/\borg\.jetbrains\.kotlin\.android\b/i.test(identifier)) return ["kotlin.android", "org.jetbrains.kotlin.android"];
      if (/\borg\.jetbrains\.kotlin\.jvm\b/i.test(identifier)) return ["kotlin.jvm", "org.jetbrains.kotlin.jvm"];
      return ["kotlin.android", "kotlin.jvm"];
    },
    dslDeclarationPatterns: ["kotlin\\s*\\(\\s*[\"'][^\"']+[\"']\\s*\\)"],
    mismatchDescription: (counts) => ((counts.get(".java") ?? 0) > 0 && (counts.get(".kt") ?? 0) === 0 ? "a Java Android app, not a Kotlin app" : ""),
  },
  {
    name: "typescript",
    displayName: "TypeScript toolchain",
    matches: /\btypescript\b|\bts-node\b|\btsx\b/i,
    sourceExtensions: [".ts", ".tsx"],
    textSignals: ["typescript", "ts-node", "tsx"],
    sourceEvidence: looksLikeTypeScriptSource,
    declarationAliases: () => [],
    dslDeclarationPatterns: [],
    mismatchDescription: (counts) =>
      (counts.get(".js") ?? 0) + (counts.get(".jsx") ?? 0) > 0 && (counts.get(".ts") ?? 0) + (counts.get(".tsx") ?? 0) === 0
        ? "JavaScript code, not TypeScript code"
        : "",
  },
  {
    name: "scala",
    displayName: "Scala toolchain",
    matches: /\bscala\b/i,
    sourceExtensions: [".scala"],
    textSignals: ["scala"],
    declarationAliases: () => [],
    dslDeclarationPatterns: [],
    mismatchDescription: (counts) => ((counts.get(".java") ?? 0) > 0 && (counts.get(".scala") ?? 0) === 0 ? "Java/JVM code, not Scala code" : ""),
  },
  {
    name: "groovy",
    displayName: "Groovy toolchain",
    matches: /\bgroovy\b/i,
    sourceExtensions: [".groovy"],
    textSignals: ["groovy"],
    declarationAliases: () => [],
    dslDeclarationPatterns: [],
    mismatchDescription: (counts) => ((counts.get(".java") ?? 0) > 0 && (counts.get(".groovy") ?? 0) === 0 ? "Java/JVM code, not Groovy code" : ""),
  },
];

function toolchainProfileForIdentifier(identifier: string) {
  return TOOLCHAIN_PROFILES.find((profile) => profile.matches.test(identifier));
}

function isProjectSourceOrConfig(fileName: string) {
  return /\.(?:kt|java|groovy|scala|gradle|kts|xml|json|toml|yaml|yml|properties|ts|tsx|js|jsx|mjs|cjs|cs|fs|vb|py|rb|php|go|rs|swift|m|mm|h|hpp|cpp|c|sql)$/i.test(
    fileName,
  );
}

async function repairFullSnippetAnswerIfNeeded(request: ReasoningRequest, answer: string, apiKey: string) {
  if (!needsFullSnippetRepair(request, answer)) return answer;

  const body = JSON.stringify({
      model: modelForRepairTask("snippet").model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Repair the answer for the user without mentioning internal response rules.",
                "If the user asked for a full file/snippet, provide exactly one complete fenced code/config block for that file, unless multiple different files are explicitly required.",
                "If the user did not ask for a full file and a tiny removal/replacement is enough, keep the answer tiny. Do not expand to a full file just to be comprehensive.",
                "Never split one file into fake section blocks such as DEFAULTCONFIG, DEPENDENCIES, ROOTPROJECT.NAME, plugins, android, or dependencies.",
                "Never collapse formatting. Preserve multi-line structure and include all needed braces/delimiters in the shown snippet.",
                "Use filename metadata on the fence when the file is known. Put placement/action context in prose immediately before the fence.",
                "No ordinary explanation inside code/config fences. No empty fences. Commands must be fenced with a shell language. Short error text should normally stay in prose, not a code fence.",
                "If the current full file is not known and a full replacement would be unsafe, say that plainly and provide only the smallest safe replacement block.",
                "If a draft snippet is already present in the attached file evidence, remove that snippet from the answer and say it is already present. Do not tell the user to add code they already have.",
                "If several config snippets are fragments of one file, do not show them as separate blocks. Either show one complete file from attached evidence with the exact needed edits merged, or give prose instructions naming the one missing section.",
                "For any configuration or build file, a standalone named section is not a full file unless the user explicitly asked for only that section. Never present multiple standalone sections from one file as separate replacement cards.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Current user request:",
                request.userMessage,
                "",
                "Attached evidence summary:",
                request.attachments.map((attachment) => `${attachment.fileName} (${attachment.evidenceKind}, ${attachment.fileType}, ${attachment.uploadStatus})`).join("; ") || "None",
                "",
                "Attached readable file evidence:",
                formatReadableAttachmentEvidenceForRepair(request),
                "",
                "Draft answer:",
                answer,
              ].join("\n"),
            },
          ],
        },
      ],
      temperature: 0.12,
      max_output_tokens: Math.max(1600, Math.min(2400, answer.length + 800)),
  });

  const { response, data } = await fetchOpenAIWithShortRetry(body, apiKey, request);
  if (!response.ok) return answer;

  const repaired = (extractText(data) ?? "").trim();
  return repaired || answer;
}

function needsFullSnippetRepair(request: ReasoningRequest, answer: string) {
  const asksForFullSnippet = hasCompleteArtifactRequestShape(request.userMessage);
  const codeFences = extractFencedBlocks(answer).filter((block) => shouldValidateGeneratedSnippet(block.language, block.code));
  const fakeSectionFences = codeFences.filter((block) => looksLikeFakeSectionFence(block.language, block.code));
  const configFragments = codeFences
    .filter((block) => !isNonReplacementContextFence(answer, block))
    .filter((block) => looksLikeConfigOrGradleFragment(block.language, block.code));
  const multipleCodeFences = codeFences.length > 1;
  const multipleConfigFragments = configFragments.length > 1;
  const repeatsAttachedEvidence = codeFences.some((block) => snippetAlreadyExistsInAttachedEvidence(request, block.code) && !isNonReplacementContextFence(answer, block));

  return (
    (asksForFullSnippet && multipleCodeFences) ||
    fakeSectionFences.length > 0 ||
    multipleConfigFragments ||
    repeatsAttachedEvidence ||
    hasImpureFencedBlocks(answer)
  );
}

function extractFencedBlocks(value: string) {
  return Array.from(value.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g), (match) => ({
    language: match[1]?.trim() ?? "",
    code: match[2]?.trim() ?? "",
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function isEvidenceQuoteFence(answer: string, block: ReturnType<typeof extractFencedBlocks>[number]) {
  const before = answer.slice(Math.max(0, block.start - 220), block.start).toLowerCase();
  const after = answer.slice(block.end, Math.min(answer.length, block.end + 120)).toLowerCase();
  const nearby = `${before} ${after}`;

  return /\b(broken|failing|exact|current|uploaded|attached|line|points to|diagnostic|error|issue|problem|shows|here)\b/.test(nearby) &&
    !/\b(add|paste|insert|put|replace|use this|copy this|change to|set to|should be)\b.{0,80}$/i.test(before);
}

function isRemovalQuoteFence(answer: string, block: ReturnType<typeof extractFencedBlocks>[number]) {
  const before = answer.slice(Math.max(0, block.start - 260), block.start).toLowerCase();
  const after = answer.slice(block.end, Math.min(answer.length, block.end + 120)).toLowerCase();
  const nearby = `${before} ${after}`;

  return /\b(remove|delete|drop|take out)\b.{0,120}\b(whole|entire|this|block|section|part|snippet)\b/.test(nearby) ||
    /\b(remove|delete|drop|take out)\s+this\b/.test(nearby);
}

function isNonReplacementContextFence(answer: string, block: ReturnType<typeof extractFencedBlocks>[number]) {
  return isEvidenceQuoteFence(answer, block) || isRemovalQuoteFence(answer, block);
}

function looksLikeFakeSectionFence(language: string, code: string) {
  const lang = language.trim();
  const trimmed = code.trim();
  if (/^(defaultconfig|dependencies|plugins|android|repositories|rootproject|rootproject\.name|settings|include)$/i.test(lang)) return true;
  if (/^[A-Z][A-Z0-9_.-]{2,40}$/.test(lang) && !languageForFileName(lang)) return true;
  if (/^[A-Z][A-Z0-9_.-]{2,40}$/.test(trimmed) && trimmed.split(/\r?\n/).length <= 2) return true;
  return false;
}

function looksLikeConfigOrGradleFragment(language: string, code: string) {
  const lang = language.trim().toLowerCase();
  const trimmed = code.trim();
  const lineCount = trimmed.split(/\r?\n/).filter((line) => line.trim()).length;
  const meta = extractMentionedFileName(language);
  const hasFileMetadata = Boolean(meta);
  const gradleDslBlock = /^\s*(?:plugins|pluginManagement|dependencyResolutionManagement|repositories|dependencies|android|defaultConfig|rootProject\.name|include)\b/im.test(trimmed);
  const genericConfigBlock = looksLikeConfigurationSnippetForRepair(trimmed, lang);

  if (hasFileMetadata && lineCount > 12) return false;
  if (gradleDslBlock) return true;
  if (genericConfigBlock && !hasFileMetadata) return true;
  return false;
}

function looksLikeConfigurationSnippetForRepair(code: string, language: string) {
  if (/^(json|yaml|yml|toml|ini|gradle)$/i.test(language)) return true;
  if (/^\s*[A-Za-z_$][\w$.-]*\s*\{/m.test(code) && !/\b(class|interface|function|if|for|while|switch|try|catch)\s*\(/.test(code)) return true;
  if (/^\s*[A-Za-z0-9_.-]+\s*:/m.test(code) && !/[{};]/.test(code)) return true;
  if (/^\s*[A-Za-z0-9_.-]+\s*=/.test(code)) return true;
  return false;
}

function snippetAlreadyExistsInAttachedEvidence(request: ReasoningRequest, snippet: string) {
  const normalizedSnippet = normalizeForEvidenceComparison(snippet);
  if (normalizedSnippet.length < 80) return false;

  return request.attachments.some((attachment) => {
    if (attachment.uploadStatus !== "readable" || !attachment.rawText) return false;
    return normalizeForEvidenceComparison(attachment.rawText).includes(normalizedSnippet);
  });
}

function normalizeForEvidenceComparison(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatReadableAttachmentEvidenceForRepair(request: ReasoningRequest) {
  const readable = request.attachments
    .filter((attachment) => attachment.uploadStatus === "readable" && attachment.rawText.trim())
    .sort((a, b) => {
      const aNew = request.investigation.newAttachmentIds.includes(a.fileId) ? 0 : 1;
      const bNew = request.investigation.newAttachmentIds.includes(b.fileId) ? 0 : 1;
      return aNew - bNew || Date.parse(b.createdAt) - Date.parse(a.createdAt);
    })
    .slice(0, 4);

  if (!readable.length) return "None";

  return readable
    .map((attachment) =>
      [
        `--- ${attachment.fileName} (${attachment.evidenceKind}, ${attachment.fileType}) ---`,
        attachment.rawText.slice(0, 5000),
        attachment.rawText.length > 5000 ? "[truncated for repair evidence budget]" : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function hasImpureFencedBlocks(answer: string) {
  return extractFencedBlocks(answer).some((block) => {
    if (!block.code.trim()) return true;
    const language = block.language.toLowerCase();
    if (/^(bash|shell|sh|zsh|powershell|cmd|terminal)$/.test(language)) {
      return block.code.split(/\r?\n/).some((line) => line.trim() && !looksLikeRunnableCommand(line) && !/^\s*#/.test(line));
    }
    return false;
  });
}

async function repairCommandAnswerIfNeeded(request: ReasoningRequest, answer: string, apiKey: string) {
  if (!needsCommandAnswerRepair(request, answer)) return answer;

  const body = JSON.stringify({
      model: modelForRepairTask("command").model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Rewrite the draft answer so it satisfies the command-answer contract.",
                "Use a natural ChatGPT-style answer. Do not force Windows/macOS/Linux sections unless the commands genuinely differ or the user asked for platform branches.",
                "If the same command works across common platforms, show one fenced command block and briefly say where it works.",
                "If commands differ by shell or operating system, branch compactly and only include the branches that matter.",
                "Do not put runnable commands in inline backticks.",
                "Do not put a leading language word such as bash, shell, cmd, or powershell inside the code block content.",
                "Do not include separate Example command blocks. Put example values in prose only when helpful.",
                "Include the important flags or arguments, useful supported variants such as delay, force, target, dry-run, undo, cancel, or status checks, and the safety note for commands that close apps, delete data, reboot, shut down, or change system state.",
                "Include compact success and failure examples or descriptions specific to the command's purpose. Do not render success/failure examples as runnable command blocks. Say what to send next if it fails.",
                "Do not add unrelated background, do not apologize, and do not ask whether the user wants steps.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [`Current user request:\n${request.userMessage}`, `Draft answer:\n${answer}`].join("\n\n"),
            },
          ],
        },
      ],
      temperature: 0.1,
      max_output_tokens: 1200,
  });

  const { response, data } = await fetchOpenAIWithShortRetry(body, apiKey, request);
  if (!response.ok) return answer;

  const repaired = stripDuplicateExampleCommandBlocks((extractText(data) ?? "").trim());
  return repaired || stripDuplicateExampleCommandBlocks(answer);
}

function needsCommandAnswerRepair(request: ReasoningRequest, answer: string) {
  if (!isCommandInstructionRequest(request.userMessage)) return false;

  return (
    hasRunnableInlineCommands(answer) ||
    hasExampleCommandBlocks(answer) ||
    (mentionsRunnableCommand(answer) && !hasFencedCommandBlock(answer)) ||
    hasThinCommandGuide(answer)
  );
}

function isCommandInstructionRequest(message: string) {
  const asksForAction =
    /\b(how|hwo|what|which|where|can|do i|command to|run|check|test|verify|install|configure|set up|setup|open|find|list|copy|move|delete)\b/i.test(
      message,
    );
  const namesShellTopic =
    /\b(command|terminal|cmd|powershell|shell|port|ping|ip address|network|firewall|process|service|file|folder|directory|install|npm|git|docker)\b/i.test(
      message,
    );

  return asksForAction && namesShellTopic;
}

function hasRunnableInlineCommands(answer: string) {
  return /`(?:bash|sh|shell|zsh|terminal|cmd|powershell|pwsh)?\s*(?:npm|pnpm|yarn|node|git|npx|curl|cd|mkdir|python|py|pip|ssh|ping|ipconfig|tracert|telnet|netstat|nslookup|Test-NetConnection|nmap|nc|netcat|docker|kubectl|shutdown|restart-computer|del|erase|rm|copy|xcopy|robocopy|move)\b[^`]*`/i.test(
    answer,
  );
}

function mentionsRunnableCommand(answer: string) {
  return /(?:^|\s)(?:npm|pnpm|yarn|node|git|npx|curl|cd|mkdir|python|py|pip|ssh|ping|ipconfig|tracert|telnet|netstat|nslookup|Test-NetConnection|nmap|nc|netcat|docker|kubectl|shutdown|restart-computer|del|erase|rm|copy|xcopy|robocopy|move)\b/i.test(answer);
}

function hasFencedCommandBlock(answer: string) {
  return /```(?:cmd|powershell|bash|shell|sh|zsh|terminal)?\s*\n[\s\S]*?\n```/i.test(answer);
}

function hasThinCommandGuide(answer: string) {
  if (!hasFencedCommandBlock(answer)) return false;
  if (!mentionsRunnableCommand(answer)) return false;

  const prose = answer.replace(/```[\s\S]*?```/g, " ");
  const hasFlagOrArgumentExplanation = /(?:^|\n)\s*[-*]\s*(?:`|\/|--?)|(?:flag|argument|option|parameter|means|where)\b/i.test(prose);
  const hasVariantOrRecovery = /\b(?:variant|option|also|delay|force|target|remote|dry-run|status|check|cancel|abort|undo|revert|if it fails|access is denied|permission denied|success|expect)\b/i.test(
    prose,
  );
  const closesOrChangesSystemState = /\b(?:restart|reboot|shutdown|shut down|delete|remove|erase|kill|terminate|format|reset)\b/i.test(answer);
  const hasSafetyNote = /\b(?:save|unsaved|destructive|cannot be undone|will close|data loss|careful|confirm|backup)\b/i.test(prose);

  if (closesOrChangesSystemState && !hasSafetyNote) return true;
  return !hasFlagOrArgumentExplanation || !hasVariantOrRecovery;
}

function hasExampleCommandBlocks(answer: string) {
  return /(?:^|\n)\s*(?:for example|example)\b.*:?\s*\n\s*```(?:cmd|powershell|bash|shell|sh|zsh|terminal)?\s*\n[\s\S]*?\n```/i.test(answer);
}

function stripDuplicateExampleCommandBlocks(answer: string) {
  const lines = answer.replace(/\r\n/g, "\n").split("\n");
  const cleaned: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
    if (/^\s*(?:for example|example)\b.*:?\s*$/i.test(line) && /^\s*```(?:cmd|powershell|bash|shell|sh|zsh|terminal)?\s*$/i.test(nextLine)) {
      index += 2;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        index += 1;
      }
      continue;
    }

    cleaned.push(line);
  }

  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function looksLikeSourceRequest(message: string) {
  if (looksLikeApiImplementationCorrection(message)) return false;
  if (looksLikeImplementationWithSourceContext(message)) return false;
  if (looksLikeTroubleshootingDiagnostic(message)) return false;
  if (looksLikeDiagnosticPaste(message)) return false;
  if (looksLikeCommandOutputOrTechnicalTranscript(message)) return false;
  if (mentionsSourceAsCodeOrOrigin(message)) return false;
  const explicitSourcePhrase =
    /\b(look this up|search (?:the )?(?:web|online)|verify online|verify with sources|cite sources?|official docs?|official link|official url|docs url|docs link|documentation url|release notes?|changelog|download link|sample template|sample file)\b/i;
  const sourceTopic =
    /\b(docs?|documentation|sources?|citations?|release notes?|changelog|vendor|api requirements?|templates?|downloads?|import guide|sample files?|sample templates?|urls?|links?)\b/i;
  const sourceAction =
    /\b(find|send|give|open|show|need|want|search|look up|verify|cite|download|get|where(?:'s| is| can)?|what(?:'s| is)?)\b/i;
  const currentInfoIntent =
    /\b(latest|current|today|newest|most recent)\b.{0,80}\b(version|release|docs?|documentation|url|link|requirements?|changelog|download|template|pricing|status)\b|\b(version|release|docs?|documentation|url|link|requirements?|changelog|download|template|pricing|status)\b.{0,80}\b(latest|current|today|newest|most recent)\b/i;

  return explicitSourcePhrase.test(message) || (sourceAction.test(message) && sourceTopic.test(message)) || (sourceAction.test(message) && currentInfoIntent.test(message));
}

function looksLikeCommandOutputOrTechnicalTranscript(message: string) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  return [
    /^```(?:powershell|pwsh|cmd|bash|shell|sh|zsh|terminal)?$/i,
    /^\s*(PS\s+[A-Z]:\\|[A-Z]:\\|>\s*)/i,
    /\bgradlew(?:\.bat)?\b/i,
    /\bGradle\s+\d+(?:\.\d+)?/i,
    /\bBuild time:\b/i,
    /\bRevision:\b/i,
    /\bKotlin:\b/i,
    /\bGroovy:\b/i,
    /\bAnt:\b/i,
    /\bLauncher JVM:\b/i,
    /\bDaemon JVM:\b/i,
    /\bJVM:\b/i,
    /\bOS:\b/i,
    /\bDistribution URL:\b/i,
  ].some((pattern) => pattern.test(message));
}

function looksLikeImplementationWithSourceContext(message: string) {
  if (looksLikeApiImplementationCorrection(message)) return true;

  const hasSourceContext = /https?:\/\/|docs?|documentation|api reference|developer docs|source/i.test(message);
  const wantsBuild = /\b(build|create|make|write|generate|give me|provide|need|want|implement|code|script|tool|app|page|html|css|js|javascript|typescript|python|php|node|react|vue|svelte)\b/i.test(
    message,
  );
  const wantsArtifact = /\b(html|css|js|javascript|typescript|code|script|file|files|tool|app|page|form|upload|processor|parser|integration|endpoint|api call|sample implementation)\b/i.test(
    message,
  );
  const sourceOnly = /\b(just|only)\b.{0,30}\b(docs?|links?|urls?|sources?)\b/i.test(message);

  return hasSourceContext && wantsBuild && wantsArtifact && !sourceOnly;
}

function looksLikeApiImplementationCorrection(message: string) {
  const hasCodeOrPayload = /\bconst\s+\w+\s*=|x[A-Z][A-Za-z0-9_]*\s*:|body\s*=|payload|request body|params|fields?\b/i.test(message);
  const saysMissing = /\b(forgot|missing|missed|left out|didn'?t add|didnt add|add the|include the|required)\b/i.test(message);
  const referencesDocs = /\bdocs?|documentation|api|required|didn'?t you see|didnt you see\b/i.test(message);
  const namesApiFields = extractLikelyMissingFieldNames(message).length > 0;

  return hasCodeOrPayload && (saysMissing || namesApiFields) && referencesDocs;
}

function createApiPayloadCorrectionFallback(request: ReasoningRequest, answer: string) {
  if (!looksLikeApiImplementationCorrection(request.userMessage)) return "";
  if (!/\b(official links|verified sources|open the official|here are the .*links|https?:\/\/)\b/i.test(answer) && /```/.test(answer)) return "";

  const payload = extractConstObjectSnippet(request.userMessage);
  if (!payload) return "";

  const corrected = addMissingApiMetadataFields(payload, request);
  if (!corrected || corrected.trim() === payload.trim()) return "";

  return [
    "You're right. The payload should include the required API fields from the docs, not only the spreadsheet row fields.",
    "",
    "Update the request body to this shape:",
    "",
    "```javascript",
    corrected,
    "```",
    "",
    "Keep the configured values in env/config, and keep the uploaded Excel row values under `tx.*`.",
  ].join("\n");
}

function extractConstObjectSnippet(message: string) {
  const start = message.search(/\bconst\s+\w+\s*=\s*\{/);
  if (start < 0) return "";

  const end = message.indexOf("};", start);
  if (end < 0) return "";

  return message.slice(start, end + 2).trim();
}

function addMissingApiMetadataFields(snippet: string, request: ReasoningRequest) {
  const missing = missingApiMetadataFields(snippet, request);
  if (!missing.length) return "";

  const lines = snippet.replace(/\r\n/g, "\n").split("\n");
  const commandIndex = lines.findIndex((line) => /\bxCommand\s*:/.test(line));
  const insertIndex = commandIndex >= 0 ? commandIndex + 1 : Math.min(1, lines.length);
  const indent = lines.find((line) => /^\s+x[A-Z]/.test(line))?.match(/^\s*/)?.[0] ?? "      ";
  const insertion = missing.map((field) => `${indent}${field.name}: ${field.value},`);

  return [...lines.slice(0, insertIndex), ...insertion, ...lines.slice(insertIndex)].join("\n");
}

function missingApiMetadataFields(snippet: string, request: ReasoningRequest) {
  const fields: Array<{ name: string; value: string }> = [];
  const addField = (name: string, value: string) => {
    if (!new RegExp(`\\b${name}\\s*:`).test(snippet)) fields.push({ name, value });
  };

  const sourceFieldNames = extractApiFieldNamesFromKnownSources(request);
  const hints = extractMissingFieldHints(request.userMessage);
  const explicitFields = extractLikelyMissingFieldNames(request.userMessage);
  [...explicitFields, ...matchSourceFieldsToHints(sourceFieldNames, hints)].forEach((fieldName) => {
    addField(fieldName, placeholderForField(fieldName));
  });

  return fields;
}

function extractLikelyMissingFieldNames(message: string) {
  const beforePayload = message.split(/\bconst\s+\w+\s*=\s*\{/i)[0] ?? message;
  return extractApiFieldNames(beforePayload);
}

function extractApiFieldNamesFromKnownSources(request: ReasoningRequest) {
  return Array.from(
    new Set(
      request.sources.flatMap((source) => extractApiFieldNames([source.title, source.snippet ?? "", source.url].join("\n"))),
    ),
  );
}

function extractApiFieldNames(value: string) {
  return Array.from(new Set(Array.from(value.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g), (match) => match[0]).filter(isLikelyApiFieldName)));
}

function isLikelyApiFieldName(value: string) {
  if (/^x[A-Z][A-Za-z0-9_]*$/.test(value)) return true;
  if (/^(?:api|merchant|software|version|terminal|account|client|developer|vendor)[A-Z][A-Za-z0-9_]*$/.test(value)) return true;
  if (/^[A-Za-z]+(?:Version|Software|SoftwareName|ApiKey|Merchant|Terminal|Account|ClientId|Secret)$/.test(value)) return true;
  return false;
}

function extractMissingFieldHints(message: string) {
  const beforePayload = message.split(/\bconst\s+\w+\s*=\s*\{/i)[0] ?? message;
  const cleaned = beforePayload
    .replace(/[`"'.,;:()[\]{}]/g, " ")
    .replace(/\b(forgot|missing|missed|left|out|add|include|required|field|fields|docs?|documentation|didn|didnt|you|see|the|to|and|or)\b/gi, " ");

  return Array.from(
    new Set(
      cleaned
        .split(/\s+/)
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length >= 4),
    ),
  );
}

function matchSourceFieldsToHints(sourceFields: string[], hints: string[]) {
  if (!hints.length) return [];

  return sourceFields.filter((field) => {
    const normalized = field.toLowerCase().replace(/^x/, "");
    return hints.some((hint) => normalized.includes(hint) || hint.includes(normalized) || isNearFieldHint(normalized, hint));
  });
}

function isNearFieldHint(field: string, hint: string) {
  if (field.length < 5 || hint.length < 5) return false;
  const compactField = field.replace(/[^a-z0-9]/g, "");
  const compactHint = hint.replace(/[^a-z0-9]/g, "");
  if (Math.abs(compactField.length - compactHint.length) > 3) return false;
  return editDistanceWithin(compactField, compactHint, 2);
}

function editDistanceWithin(left: string, right: string, maxDistance: number) {
  if (Math.abs(left.length - right.length) > maxDistance) return false;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowBest = current[0] ?? 0;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      const insertion = current[rightIndex - 1] + 1;
      const deletion = previous[rightIndex] + 1;
      const value = Math.min(substitution, insertion, deletion);
      current[rightIndex] = value;
      rowBest = Math.min(rowBest, value);
    }

    if (rowBest > maxDistance) return false;
    previous = current;
  }

  return (previous[right.length] ?? Number.POSITIVE_INFINITY) <= maxDistance;
}

function placeholderForField(fieldName: string) {
  return fieldName
    .replace(/^x/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || "CONFIG_VALUE";
}

function looksLikeTroubleshootingDiagnostic(message: string) {
  const text = message.replace(/\s+/g, " ").trim();
  const explicitlyAsksForSources =
    /\b(find|send|give|open|show|need|want|search|look up|verify)\b.{0,80}\b(docs?|documentation|url|link|links|source|sources|release notes?|changelog)\b/i.test(text) ||
    /\b(docs?|documentation|url|link|links|source|sources|release notes?|changelog)\b.{0,80}\b(find|send|give|open|show|need|want|search|look up|verify)\b/i.test(text);
  if (explicitlyAsksForSources) return false;

  return /\b(FAILURE:\s*Build failed|BUILD FAILED|What went wrong|Try:|Run with --stacktrace|Run with --info|Run with --debug|Exception|Caused by:|Plugin .* was not found|Could not resolve|Unresolved reference|Compilation failed|Execution failed|error:|e: file:\/\/|failed with an exception)\b/i.test(message);
}

function createUserContent(request: ReasoningRequest, answerPlan: AnswerPlan): OpenAIInputContent[] {
  const content: OpenAIInputContent[] = [
    {
      type: "input_text",
      text: formatReasoningContext(request, answerPlan),
    },
  ];

  request.attachments
    .filter((attachment) => attachment.dataUrl && shouldSendImageAttachment(request, attachment.fileId))
    .slice(0, 4)
    .forEach((attachment) => {
      content.push({
        type: "input_image",
        image_url: attachment.dataUrl ?? "",
      });
    });

  return content;
}

function formatReasoningContext(request: ReasoningRequest, answerPlan: AnswerPlan) {
  const targeted = isTargetedFollowUp(request, answerPlan);
  const followUpResolution = resolveShortApprovalFollowUp(request);

  if (targeted) {
    return formatTargetedFollowUpContext(request, followUpResolution, answerPlan);
  }

  const currentSnippetSanity = analyzeCurrentSnippet(request.userMessage);
  const reasoningPacket = buildReasoningPacket(request, answerPlan);
  const toolchainNecessityContext = formatToolchainNecessityContext(request);

  return [
    "Context manager policy:",
    [
      "You are receiving a budgeted working-memory packet, not the full conversation.",
      "Treat this packet as the source of truth for the current turn.",
      "Do not ask for evidence that the selected evidence list says is already available.",
      "Do not assume omitted history is relevant; answer from current request, working memory, and selected evidence.",
      "If the selected evidence is insufficient for an exact fix, ask for the smallest missing item.",
    ].join(" "),
    formatReasoningPacket(reasoningPacket),
    request.compactedContext ? `Compacted mission/project memory (raw archive remains available by reference):\n${JSON.stringify(request.compactedContext)}` : "",
    toolchainNecessityContext ? "Toolchain/dependency necessity check:" : "",
    toolchainNecessityContext,
    "Internal answer plan:",
    formatAnswerPlan(answerPlan),
    targetedFollowUpInstruction(request, targeted),
    "Universal answer requirements:",
    [
      "Read the current user message literally before using prior context. If the current message contains pasted code, config, logs, or a snippet, inspect that current snippet first and answer about it directly.",
      request.investigation.newAttachmentIds.length
        ? "Current-turn readable attachments are the source of truth. Inspect every attached readable file by filename and raw content before using prior assistant replies, prior logs, or remembered fixes. If more than one readable file is attached, cross-check them together for already-present sections, duplicates, conflicts, missing pieces, and path/placement evidence. If the user reports a post-change result and attaches source/config/log files, diagnose those current files directly and cite the exact file and relevant snippet. Do not ask for files already attached. Do not repeat previous steps unless the current file contents prove they are still the needed action."
        : "",
      "If the user asks a yes/no or binary question, begin with Yes or No when the current evidence supports it, then give the correction or next action.",
      "When fixing pasted or attached code/config, include one copyable corrected snippet or corrected block per affected file. Do not split one file's replacement into multiple unrelated fences, do not invent labels from identifiers, and do not collapse multi-line snippets into one line.",
      "For code follow-ups, use the Current code/artifact memory as the working copy when no newer attached or pasted full file supersedes it. Apply the requested change to that code instead of starting over.",
      "If the user asks for full code, full file, send it back, complete snippet, or equivalent, output the complete updated artifact/file for the requested file(s), including unchanged sections needed for a valid file. Never cut off the middle, omit closing braces/tags, or answer with only the changed fragment.",
      "If the user asks to style CSS, XAML, HTML, UI, layout, or visual design, return genuinely improved polished code: spacing, hierarchy, color, alignment, responsiveness, hover/focus states when relevant, and cleaner structure. Do not only prettify indentation.",
      "For hosting/deployment/options answers, be explicit and complete. Give one recommended option first and explain why in one sentence. Then, for every option you mention, include a clickable Markdown link, when to use it, concrete setup steps, build command, start command, env-var/config notes, success check, failure check, and how to verify the deployed URL. Do not list alternatives as vague one-line names. Do not write raw bracket syntax as prose; use valid Markdown links such as [Render](https://render.com).",
      "For file-backed debugging, answer like this in spirit: 'I checked file A and file B. The break is in file A at this line/section. Use this replacement. Then run this verification.' Do this naturally, not as a rigid template.",
      "If uploaded files already contain a proposed block, do not show that same block as something to add. Say it is already present and move to the missing or conflicting part.",
      "If a complete-file replacement is needed, provide one complete valid file block for that file. If only a removal is needed, show the exact removable snippet only when it is visibly present in the current evidence.",
      "Before giving any replacement code/config snippet, silently sanity-check the snippet you are about to output. Do not tell the user to replace a file with a snippet that still has obvious structural errors, malformed fences, missing closing blocks, command/config confusion, unexplained invented versions, or missing placement/scope context.",
      "Keep troubleshooting replies human and compact. Avoid robotic sections such as Key points, Why this fixes your issue, Apply this now, or No guessing. Prefer direct answer, corrected snippet, run/check, expected result.",
      "Use the answer plan as the primary guide, not keyword matches.",
      "Respect workflow progress: do not repeat completed or verified steps; acknowledge them briefly and continue from the current or blocked step.",
      "Respect already-told guidance: do not restate earlier instructions. Refer to them as already covered and continue with what the user should do, verify, or decide now.",
      "For troubleshooting follow-ups, newest evidence wins. Decide whether the previous fix helped, failed, was incomplete, or caused a new error. If the user is frustrated, acknowledge it briefly and move straight to the current blocker.",
      request.troubleshooting.active && request.troubleshooting.isFollowUp
        ? "For this troubleshooting follow-up, continue the live debugging thread in natural prose. Do not force sections like Current blocker, What changed, Fix this now, Verify, or If it still fails. Say the exact blocker, the exact fix, and the exact next check in a compact ChatGPT-style answer."
        : "",
      "Evidence gate: concrete fixes must be evidence-backed. Do not invent exact versions, package names, file contents, paths, settings, class names, or APIs. If the evidence supports only a hypothesis, label it as a hypothesis and give the verification check.",
      "For API implementation follow-ups where the user says a required field from docs is missing, answer by updating the exact request body/payload with the missing required fields. Separate configured constants/env vars from row/upload fields. Do not re-explain the whole API unless needed.",
      "For workflow tasks, prefer the shape: Current situation, Do this now, Expected result, After that.",
      "If the request is ambiguous or platform-dependent, answer the most likely interpretation first, then cover other safe common interpretations or platforms briefly.",
      "If the request has multiple possible fixes, explanations, tools, platforms, or next actions, give the recommended path first. If you name alternatives/options, every named option must be actionable: when to choose it, exact steps or commands/UI actions, required config/env values, success check, and the main caveat. If you cannot make an alternative actionable, omit it. For a current error log, keep branches out unless they change the command or edit to do now.",
      "When instructions, troubleshooting, repair, setup, commands, or decisions are involved, include only the prerequisites, steps, verification, and recovery that matter for the user's immediate next action.",
      "Mandatory answer-depth planner before every nontrivial answer: silently ask what the common causes or paths are, what is most likely in this context, what should be checked first, what evidence would distinguish the possibilities, and what the user should do next. Surface those answers naturally. Do not give one tiny generic cause when several realistic causes are common.",
      "For missing plugin/package/dependency/toolchain errors, do not assume the named thing should be made to resolve. First ask whether the attached project evidence shows it is actually used. If it appears unused, the out-of-the-box fix is removal; if it is used, then diagnose resolution/configuration.",
      "Apply that same dependency/toolchain necessity check across all stacks: npm packages, Python modules, PHP Composer packages, Gradle/Maven plugins, Android SDKs, TypeScript tooling, copied boilerplate, API config, and framework-specific settings. Do not blindly fix the named thing; decide whether it belongs in the project first.",
      "For HTTP status, authentication, authorization, browser/network, API, build, runtime, configuration, and operational errors, cover the direct meaning, likely cause in context, first check, and next evidence only as much as needed. Avoid memorized templates.",
      "For build failures, prefer the shortest useful answer: one sentence explaining the error, the exact replacement/removal snippet if needed, the rerun command/check, and one sentence for why it works.",
      "If the user asks whether anything is still missing after showing terminal output and package metadata, answer as a project readiness/status check. Do not treat the entire message as code to correct. Separate what is already working from missing files, env vars, npm packages, commands, or next verification.",
      "If terminal output includes a success line such as 'Server running', 'listening', 'started', or a local URL and no error/exit line, treat the server as likely running. Do not infer that it stopped merely because the pasted transcript includes a prompt after the output; ask the user to verify in the browser or with a request.",
      "For a Node/Express readiness check, first say what is already OK from the evidence, then list only concrete missing/likely-needed items such as the frontend HTML page, upload route, API credentials/env vars, parser dependency, and one test request. Do not invent a crash or ask for server.js unless the evidence shows a server error or missing route.",
      "Markdown block rules: runnable commands must be in fenced shell/powershell/cmd/bash blocks so they are copyable. Actual replacement source/config snippets must be fenced with the right language. Short error messages should usually be quoted in normal prose or inline code, not placed in a code fence. Use a log fence only for a multi-line log excerpt the user needs to copy.",
      "Never fence a single path or placeholder path. Keep it in prose or inline/copyable path formatting and explain what exact value replaces any placeholder.",
      "For multi-file fixes, use the smallest number of blocks: normally one complete block per affected file. Put the filename and action in prose immediately before the block. Never scatter one file across several separate snippets.",
      "Command-answer rule: answer naturally. If one command works across the likely shells/platforms, show one fenced command block and say it works there. Only split into Windows/macOS/Linux or shell branches when the actual commands differ or the user asks for those branches.",
      "For command answers, put runnable commands in fenced command blocks, never inline backticks. Do not prefix the command text with a fence language word such as bash, shell, cmd, or powershell inside the code itself.",
      "Never tell the user to rerun, reuse, or use the same command unless you show that exact command in the next fenced command block. If the exact previous command is not available, say what is missing and ask for it instead of referring to an invisible command.",
      "For command answers, include what the important flags/arguments mean, useful variants such as delay/force/dry-run/target/undo/cancel when the command supports them, what success looks like, and what failure looks like in concrete terms for the task. For destructive or session-ending commands, include the relevant safety note. Avoid repeating the same command as both the command and the example unless the example changes a meaningful value.",
      "Use evidence-based project paths only when project editing is involved. If an absolute project root is visible or confirmed, give the full absolute file path. If no exact file path is visible or attached, do not invent one; say what project tree/file listing is needed or how to identify the exact file. Never invent a project path warning for conceptual answers, API troubleshooting, browser troubleshooting, logs, or command-only answers.",
      "For narrow follow-ups, continue from the referenced prior answer, option, evidence, command, or artifact instead of restarting.",
      "If the user edits, resends, or repeats a similar message, do not copy-paste the previous answer. Re-evaluate the current evidence and write a fresh response with the same conclusion only if it is still correct.",
      "Ask only when the missing detail would materially change the answer.",
    ].join(" "),
    currentSnippetSanity ? "Current pasted snippet sanity checks:" : "",
    currentSnippetSanity,
    troubleshootingContinuityInstruction(request),
    `Last result: ${request.lastResult ?? "None"}`,
    looksLikeDiagnosticPaste(request.userMessage)
      ? "Latest message type: terminal/log diagnostic evidence. Diagnose the latest command and output first. If it contradicts or supersedes prior advice, say so and correct the next step."
      : "",
    followUpResolution ? "Resolved follow-up intent:" : "",
    followUpResolution,
    "Current user message:",
    request.userMessage,
    isTextVisualFormatRequest(request.userMessage)
      ? "Output format requirement: The user explicitly asked for a text/ASCII visual. Provide the requested ASCII/text artifact directly. Do not create or describe an SVG/image artifact."
      : "",
  ].join("\n\n");
}

function validateAnswerAgainstCurrentSnippet(request: ReasoningRequest, answer: string, originalAnswer = answer) {
  if (!shouldAnalyzeCurrentMessageAsSnippet(request.userMessage)) return answer;
  const snippet = extractLikelyCodeOrConfigSnippet(request.userMessage);
  if (!snippet) return answer;

  const findings = [
    ...findDelimiterMismatches(snippet),
    ...findJsonShapeIssues(snippet),
    ...findXmlTagIssues(snippet),
    ...findRepeatedSimpleAssignments(snippet),
  ];
  if (!findings.length) return answer;
  if (!shouldRenderDeterministicSnippetCorrection(request.userMessage, originalAnswer)) return answer;

  const corrected = createCorrectedSnippet(snippet, findings, request.userMessage);
  const remainingFindings = [
    ...findDelimiterMismatches(corrected.code),
    ...findJsonShapeIssues(corrected.code),
    ...findXmlTagIssues(corrected.code),
  ];
  const parts = [
    directCorrectionLead(request.userMessage),
    "",
    "**Issue:**",
    findings.slice(0, 4).map((finding) => `- ${finding}`).join("\n"),
  ];

  if (remainingFindings.length) {
    parts.push(
      "",
      "I can identify the issue, but I am not going to label this as a corrected replacement because the generated snippet still fails structural validation.",
      "",
      "**Fix needed:**",
      recommendedFixFromFindings(findings),
      "",
      "**Still active:**",
      remainingFindings.slice(0, 4).map((finding) => `- ${finding}`).join("\n"),
    );
  } else {
    parts.push("", "**Corrected snippet:**", "", correctedSnippetBlock(corrected));
  }

  parts.push("", "**Verify:**", verificationForCorrectedSnippet(request.userMessage));

  return parts.join("\n");
}

function directCorrectionLead(message: string) {
  if (/\b(is|are|does|do|did|can|should|would|seems?|missing|correct|wrong)\b/i.test(message)) {
    return "Yes, you are right. The pasted snippet is missing a closing delimiter.";
  }

  return "The pasted snippet has a real issue.";
}

function recommendedFixFromFindings(findings: string[]) {
  const missingDelimiter = findings.find((finding) => /^Missing '([^']+)' for '([^']+)' opened at/.test(finding));
  if (missingDelimiter) {
    const match = missingDelimiter.match(/^Missing '([^']+)' for '([^']+)' opened at .*?: (.+)$/);
    const close = match?.[1] ?? "the missing closing delimiter";
    const openerLine = match?.[2] ?? "the named block";
    return `Add \`${close}\` to close the block opened by \`${openerLine}\`, before the next top-level statement or section begins.`;
  }

  const unexpectedClosing = findings.find((finding) => /^Unexpected closing/.test(finding));
  if (unexpectedClosing) return "Remove the unexpected closing delimiter named above, or move it so it closes the matching open block.";

  const jsonIssue = findings.find((finding) => finding.startsWith("JSON parse check failed"));
  if (jsonIssue) return "Fix the JSON syntax named above before using this as a valid JSON/config snippet.";

  const tagIssue = findings.find((finding) => /tag/i.test(finding));
  if (tagIssue) return "Fix the tag mismatch named above before treating the markup as valid.";

  return "Update the pasted snippet at the exact issue named above.";
}

type CorrectedSnippet = {
  code: string;
  language: string;
};

function correctedSnippetBlock(corrected: CorrectedSnippet) {
  return `\`\`\`${corrected.language}\n${corrected.code}\n\`\`\``;
}

function createCorrectedSnippet(snippet: string, findings: string[], message: string) {
  const language = inferSnippetFenceLanguage(snippet, message);
  const corrected = formatCorrectedSnippet(applySnippetCorrectionsUntilStable(snippet, findings));

  return {
    code: corrected,
    language,
  };
}

function formatCorrectedSnippet(snippet: string) {
  return snippet
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line) => expandInlineOpenBlockLine(line))
    .join("\n")
    .trim();
}

function expandInlineOpenBlockLine(line: string) {
  const match = line.match(/^(\s*[^{}]+?)\s*\{\s*(\S.*)$/);
  if (!match?.[1] || !match[2]) return [line];
  if (/^\s*[}\])]/.test(match[2])) return [line];

  const indent = match[1].match(/^\s*/)?.[0] ?? "";
  const childIndent = `${indent}    `;
  return [`${match[1].trimEnd()} {`, `${childIndent}${match[2].trim()}`];
}

function applySnippetCorrectionsUntilStable(snippet: string, initialFindings: string[]) {
  let current = snippet;
  let findings = initialFindings;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const next = applySimpleSnippetCorrections(current, findings);
    if (next.trim() === current.trim()) return next.trim();

    current = next;
    findings = findDelimiterMismatches(current);
    if (!findings.some((finding) => /^Missing /.test(finding))) return current.trim();
  }

  return current.trim();
}

function applySimpleSnippetCorrections(snippet: string, findings: string[]) {
  let lines = snippet.replace(/\r\n/g, "\n").split("\n");
  const missingClosers = findings
    .map((finding) => {
      const match = finding.match(/^Missing '([^']+)' for '([^']+)' opened at (?:pasted snippet )?line (\d+), column \d+:/);
      if (!match) return undefined;
      return {
        close: match[1],
        openerLineIndex: Number(match[3]) - 1,
      };
    })
    .filter((item): item is { close: string; openerLineIndex: number } => Boolean(item))
    .filter((item) => !Number.isNaN(item.openerLineIndex) && item.openerLineIndex >= 0 && item.openerLineIndex < lines.length)
    .sort((a, b) => b.openerLineIndex - a.openerLineIndex);

  missingClosers.forEach(({ close, openerLineIndex }) => {

    const indent = lines[openerLineIndex].match(/^\s*/)?.[0] ?? "";
    const insertIndex = findCloseInsertionIndex(lines, openerLineIndex, indent.length);
    const previousNonEmpty = [...lines.slice(0, insertIndex)].reverse().find((line) => line.trim());
    const previousIndent = previousNonEmpty?.match(/^\s*/)?.[0].length ?? -1;
    if (previousNonEmpty?.trim() === close && previousIndent === indent.length) return;

    lines = [...lines.slice(0, insertIndex), `${indent}${close}`, ...lines.slice(insertIndex)];
  });

  return lines.join("\n").trim();
}

function findCloseInsertionIndex(lines: string[], openerLineIndex: number, openerIndent: number) {
  for (let index = openerLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent > openerIndent) continue;
    if (/^\s*[}\])]/.test(line)) continue;

    let insertionIndex = index;
    while (insertionIndex > openerLineIndex + 1 && !lines[insertionIndex - 1]?.trim()) {
      insertionIndex -= 1;
    }

    return insertionIndex;
  }

  return lines.length;
}

function inferSnippetFenceLanguage(snippet: string, message = snippet) {
  const fileName = extractMentionedFileName(`${message}\n${snippet}`);
  const fileLanguage = fileName ? languageForFileName(fileName) : "";
  if (fileLanguage) return fileLanguage;
  if (/^\s*[{\[]/.test(snippet.trim())) return "json";
  if (/<[A-Za-z][^>]*>/.test(snippet)) return "xml";
  if (/^\s*[A-Za-z0-9_.-]+\s*:/im.test(snippet) && !/[{};]/.test(snippet)) return "yaml";
  if (/\b(pluginManagement|dependencyResolutionManagement|repositoriesMode|rootProject\.name|include\s*\()/i.test(snippet)) return "kotlin";
  if (/\b(import|export|class|interface|function|const|let|var|return)\b/.test(snippet)) return "typescript";
  return "text";
}

function verificationForCorrectedSnippet(message: string) {
  const fileName = extractMentionedFileName(message);
  const saveStep = fileName ? `Save \`${fileName}\`.` : "Save the file that contains this snippet.";

  return [`1. ${saveStep}`, `2. ${inferSpecificValidationStep(message)}`, "3. If it fails, send the new exact error from that validation run."].join("\n");
}

function inferSpecificValidationStep(message: string) {
  const text = message.toLowerCase();
  if (/\bgradle|settings\.gradle|build\.gradle\b/.test(text)) return "Sync Gradle or rerun the Gradle command that produced the error.";
  if (/\bjson|package\.json|tsconfig|composer\.json\b/.test(text)) return "Run the parser/build command that reads this JSON file.";
  if (/\bxml|manifest|pom\.xml\b/.test(text)) return "Run the tool or build step that parses this XML file.";
  if (/\byaml|yml|docker-compose|workflow\b/.test(text)) return "Run the tool or linter that parses this YAML file.";
  return "Run the same parser, build, sync, test, or validation step that exposed the problem.";
}

function validateGeneratedSnippets(answer: string) {
  let repairedAny = false;
  const repaired = answer.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (match, rawLanguage: string, code: string) => {
    if (!shouldValidateGeneratedSnippet(rawLanguage, code)) return match;

    const findings = [
      ...findDelimiterMismatches(code),
      ...findJsonShapeIssues(code),
      ...findXmlTagIssues(code),
      ...findRepeatedSimpleAssignments(code),
    ];

    if (!findings.length) return match;

    const corrected = applySimpleSnippetCorrections(code, findings);
    if (corrected.trim() === code.trim()) return match;

    repairedAny = true;
    return `\`\`\`${rawLanguage.trim()}\n${corrected}\n\`\`\``;
  });

  if (!repairedAny) return repaired;

  return [
    "I corrected one replacement snippet before showing it because the generated version still had a structural issue.",
    "",
    repaired,
  ].join("\n");
}

function shouldValidateGeneratedSnippet(language: string, code: string) {
  const lang = language.trim().toLowerCase();
  if (/^(shell|bash|zsh|powershell|cmd|terminal|log|text|plaintext)$/i.test(lang)) return false;
  if (looksLikeRunnableCommand(code)) return false;

  return /[{}()[\];=<>]|^\s*[A-Za-z_$][\w$.-]*\s*[:=]|^\s*(class|function|import|export|const|let|var|interface|type|enum|def|fn|func|package|namespace|module)\b/im.test(code);
}

function shouldTreatAsRenderableGeneratedBlock(language: string, code: string) {
  const lang = language.trim().toLowerCase();
  if (!code.trim()) return false;
  if (/^(shell|bash|zsh|powershell|cmd|terminal|log|text|plaintext)$/i.test(lang)) return false;
  if (looksLikeRunnableCommand(code)) return false;
  if (looksLikeConfigOrGradleFragment(language, code)) return true;
  return shouldValidateGeneratedSnippet(language, code);
}

function contradictsCurrentSnippetEvidence(answer: string) {
  return /\b(no\s+(?:bracket|brace|parenthes(?:is|es)|delimiter|tag|block)\s+is\s+missing|nothing\s+is\s+missing|looks\s+balanced|properly\s+nested|all\s+(?:brackets|braces|parentheses|delimiters|tags)\s+(?:match|are\s+balanced)|not\s+missing\s+any)\b/i.test(
    answer,
  );
}

function shouldRenderDeterministicSnippetCorrection(message: string, answer: string) {
  if (!shouldAnalyzeCurrentMessageAsSnippet(message)) return false;
  if (contradictsCurrentSnippetEvidence(answer)) return true;
  if (extractCodeFenceCount(answer) !== 1) return true;
  return /\b(missing|bracket|brace|parenthes(?:is|es)|delimiter|tag|block|correct|wrong|fix|valid|invalid|syntax|snippet|config|code|json)\b/i.test(message);
}

function extractCodeFenceCount(value: string) {
  return Math.floor((value.match(/```/g)?.length ?? 0) / 2);
}

function analyzeCurrentSnippet(message: string) {
  if (!shouldAnalyzeCurrentMessageAsSnippet(message)) return "";
  const snippet = extractLikelyCodeOrConfigSnippet(message);
  if (!snippet) return "";

  const findings = [
    ...findDelimiterMismatches(snippet),
    ...findJsonShapeIssues(snippet),
    ...findXmlTagIssues(snippet),
    ...findRepeatedSimpleAssignments(snippet),
  ].slice(0, 10);

  return [
    "The current user message contains pasted code/config. Inspect this current snippet literally before using prior assistant replies.",
    findings.length
      ? "Lightweight deterministic checks found current-snippet issues:"
      : "Lightweight deterministic checks did not find delimiter, JSON, XML/tag, or simple duplicate-assignment issues. Still inspect semantic correctness from the pasted snippet.",
    ...findings.map((finding) => `- ${finding}`),
    "Do not claim the pasted snippet is correct if a listed current-snippet issue contradicts that. For issues outside these checks, reason from the actual pasted text and say what evidence supports the answer.",
  ].join("\n");
}

function extractLikelyCodeOrConfigSnippet(message: string) {
  if (looksLikeTerminalTranscript(message) && !explicitlyAsksToValidateSnippet(message)) return "";

  const fencedBlock = extractFirstFencedBlock(message);
  const fenced = fencedBlock && shouldAnalyzeFenceAsSnippet(fencedBlock.language, fencedBlock.code) ? fencedBlock.code : "";
  if (fenced) return fenced;

  const jsonObject = extractLikelyJsonObject(message);
  if (jsonObject) return jsonObject;

  const lines = message.split(/\r?\n/);
  const codeLines = lines.filter((line) =>
    /[{}()[\];=<>]|^\s*[A-Za-z_$][\w$.-]*\s*[:=]|^\s*(class|function|import|export|const|let|var|interface|type|enum|def|fn|func|package|namespace|module)\b/i.test(line),
  );

  if (codeLines.length < 3) return "";
  if (looksLikeMixedTerminalAndQuestion(message) && !explicitlyAsksToValidateSnippet(message)) return "";

  const firstIndex = lines.findIndex((line) => codeLines.includes(line));
  let lastIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (codeLines.includes(lines[index])) {
      lastIndex = index;
      break;
    }
  }

  return lines.slice(Math.max(0, firstIndex), lastIndex + 1).join("\n");
}

function shouldAnalyzeCurrentMessageAsSnippet(message: string) {
  if (asksAboutAssistantResponse(message) && !explicitlyAsksToValidateSnippet(userAuthoredQuestionText(message))) return false;
  if (explicitlyAsksToValidateSnippet(message)) return true;
  const fenced = extractFirstFencedBlock(message);
  if (fenced) return shouldAnalyzeFenceAsSnippet(fenced.language, fenced.code);
  if (extractLikelyJsonObject(message) && /\b(package\.json|json|dependencies|scripts)\b/i.test(message) && !looksLikeMixedTerminalAndQuestion(message)) return true;
  return false;
}

function shouldAnalyzeFenceAsSnippet(language: string, code: string) {
  const lang = language.trim().toLowerCase();
  if (/^(shell|bash|zsh|powershell|pwsh|cmd|terminal|log|text|plaintext|console)$/i.test(lang)) return false;
  if (looksLikeTerminalTranscript(code)) return false;
  if (looksLikeRunnableCommand(code)) return false;
  if (!lang) return shouldValidateGeneratedSnippet("", code) && !looksLikeTerminalTranscript(code);
  return shouldValidateGeneratedSnippet(lang, code) || looksLikeConfigOrGradleFragment(lang, code);
}

function explicitlyAsksToValidateSnippet(message: string) {
  return /\b(is|are|does|do|did|can|should|would|seems?)\b.{0,80}\b(missing|correct|wrong|valid|invalid|broken|syntax|bracket|brace|parenthes(?:is|es)|delimiter|tag|json)\b|\b(fix|correct|validate|check|repair)\b.{0,80}\b(snippet|code|config|json|html|css|js|file|block|syntax|bracket|brace|delimiter)\b/i.test(
    message,
  );
}

function asksAboutAssistantResponse(message: string) {
  const question = userAuthoredQuestionText(message);
  return /\b(?:last|previous|that|their|foundry|assistant|response|answer|reply|they)\b.{0,80}\b(?:correct|right|wrong|accurate|good|bad|hallucinat|nonsense|responding|look at)\b|\b(?:look at|check|review)\b.{0,80}\b(?:last|previous|that|their|foundry|assistant|response|answer|reply)\b/i.test(
    question,
  );
}

function userAuthoredQuestionText(message: string) {
  return message
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:FW|Foundry|You|ME)\s*$/i.test(line))
    .filter((line) => !/^\s*(?:Issue|Fix needed|Still active|Verify|Show less|Sources)\s*:?$/i.test(line))
    .filter((line) => !/^\s*(?:Missing closing tag|I can identify the issue|The pasted snippet|Yes, you are right|Build was configured|Certificate already|PS\s+[A-Z]:\\|Windows PowerShell)/i.test(line))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function looksLikeMixedTerminalAndQuestion(message: string) {
  return (
    /\b(?:npm|node|python|php|composer|gradle|gradlew|server running|started|listening|C:\\|PS\s+[A-Z]:\\|> )\b/i.test(message) &&
    /\b(anything else|still missing|what else|am i missing|is anything missing|what now|next)\b/i.test(message)
  );
}

function extractLikelyJsonObject(message: string) {
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  const candidate = message.slice(start, end + 1).trim();
  if (!/^\{[\s\S]*\}$/.test(candidate)) return "";
  if (!/"[^"]+"\s*:/.test(candidate)) return "";
  return candidate;
}

function extractFirstFencedBlock(message: string) {
  const match = message.match(/```([^\n`]*)\n([\s\S]*?)```/);
  if (!match) return undefined;
  return {
    language: match[1]?.trim() ?? "",
    code: match[2]?.trim() ?? "",
  };
}

function looksLikeTerminalTranscript(value: string) {
  return /^\s*(?:PS\s+[A-Z]:\\|[A-Z]:\\|> |\$ )/im.test(value) || /\b(?:Windows PowerShell|BUILD FAILED|FAILURE: Build failed|Run with --stacktrace|Configuration cache entry stored)\b/i.test(value);
}

function extractMentionedFileName(message: string) {
  const candidates = Array.from(
    message.matchAll(/\b(?:[\w.-]+[\\/])?[\w.-]+\.(?:gradle\.kts|gradle|json|xml|ya?ml|toml|ini|conf|env|ts|tsx|js|jsx|css|html|py|java|kt|cs|go|rs|php|rb|sql|md)\b/gi),
    (match) => match[0],
  );

  return candidates.find((candidate) => /[A-Za-z]/.test(candidate) && !/^\d/.test(candidate) && languageForFileName(candidate)) ?? "";
}

function languageForFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".kt") || lower.endsWith(".kts")) return "kotlin";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  return "";
}

function looksLikeRunnableCommand(code: string) {
  const trimmed = code.trim();
  if (!/^\s*(?:\.\/|\.\\)?(?:npm|pnpm|yarn|bun|node|git|npx|curl|cd|mkdir|python|py|pip|powershell|pwsh|ssh|ping|ipconfig|tracert|shutdown|adb|java|javac|kotlinc|dotnet|mvn|gradle|gradlew|go|cargo|rustc|deno|docker|kubectl|helm|terraform)\b/im.test(trimmed)) {
    return false;
  }
  if (looksLikeCommandWithProse(trimmed)) return false;
  return true;
}

function looksLikeCommandWithProse(command: string) {
  const firstLine = command.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  if (/[.!?]\s+\w/.test(firstLine)) return true;
  if (/\b(from a|from the|in a|in the|and keep|then|if you|when you|so that|because|command prompt|terminal window|browser|double-click|open a|open the)\b/i.test(firstLine)) {
    return true;
  }
  const commandName = firstLine.split(/\s+/, 1)[0]?.replace(/^\.\//, "").replace(/^\.\\/, "").toLowerCase() ?? "";
  if (["npm", "pnpm", "yarn", "bun"].includes(commandName) && /\b(from|and|if|when|terminal|prompt|window|open)\b/i.test(firstLine)) return true;
  return false;
}

function findDelimiterMismatches(snippet: string) {
  const openers: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
  const closers = new Set(Object.values(openers));
  const stack: Array<{ char: string; line: number; column: number; text: string }> = [];
  const findings: string[] = [];
  const lines = snippet.split(/\r?\n/);
  let quote: "'" | '"' | "`" | "" = "";

  lines.forEach((line, lineIndex) => {
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const previous = line[index - 1];

      if (quote) {
        if (char === quote && previous !== "\\") quote = "";
        continue;
      }

      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        continue;
      }

      if (char === "/" && line[index + 1] === "/") break;

      if (openers[char]) {
        stack.push({ char, line: lineIndex + 1, column: index + 1, text: line.trim() });
        continue;
      }

      if (!closers.has(char)) continue;

      const opener = stack.at(-1);
      if (!opener) {
        findings.push(`Unexpected closing '${char}' at pasted snippet line ${lineIndex + 1}, column ${index + 1}.`);
        continue;
      }

      const expected = openers[opener.char];
      if (char !== expected) {
        findings.push(`Mismatched '${char}' at pasted snippet line ${lineIndex + 1}, column ${index + 1}; expected '${expected}' for '${opener.char}' opened at line ${opener.line}.`);
        stack.pop();
        continue;
      }

      stack.pop();
    }
  });

  stack.reverse().forEach((opener) => {
    findings.push(`Missing '${openers[opener.char]}' for '${opener.char}' opened at pasted snippet line ${opener.line}, column ${opener.column}: ${opener.text}`);
  });

  return findings.slice(0, 8);
}

function findJsonShapeIssues(snippet: string) {
  const trimmed = snippet.trim();
  if (!/^[{[]/.test(trimmed)) return [];

  try {
    JSON.parse(trimmed);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON shape.";
    return [`JSON parse check failed: ${message}`];
  }
}

function findXmlTagIssues(snippet: string) {
  if (!/<[A-Za-z][^>]*>/.test(snippet)) return [];

  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tagPattern = /<\/?([A-Za-z][\w:.-]*)(?:\s[^>]*)?>/g;
  const stack: Array<{ name: string; index: number }> = [];
  const findings: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(snippet))) {
    const raw = match[0];
    const name = match[1];
    const lowerName = name.toLowerCase();
    if (raw.startsWith("<?") || raw.startsWith("<!") || raw.endsWith("/>") || voidTags.has(lowerName)) continue;

    if (!raw.startsWith("</")) {
      stack.push({ name, index: match.index });
      continue;
    }

    const opener = stack.at(-1);
    if (!opener) {
      findings.push(`Unexpected closing tag </${name}>.`);
      continue;
    }

    if (opener.name.toLowerCase() !== lowerName) {
      findings.push(`Mismatched closing tag </${name}>; expected </${opener.name}>.`);
      stack.pop();
      continue;
    }

    stack.pop();
  }

  stack.reverse().forEach((opener) => findings.push(`Missing closing tag for <${opener.name}>.`));
  return findings.slice(0, 6);
}

function findRepeatedSimpleAssignments(snippet: string) {
  const assignments = new Map<string, number>();
  const findings: string[] = [];

  snippet.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    const match = trimmed.match(/^([A-Za-z_][\w.-]*)\s*[:=]\s*.+$/);
    if (!match || trimmed.startsWith("//") || trimmed.startsWith("#")) return;

    const key = match[1].toLowerCase();
    const previous = assignments.get(key);
    if (previous) {
      findings.push(`Repeated simple assignment '${match[1]}' at pasted snippet lines ${previous} and ${index + 1}; verify whether one should be removed or merged.`);
      return;
    }

    assignments.set(key, index + 1);
  });

  return findings.slice(0, 5);
}

function troubleshootingContinuityInstruction(request: ReasoningRequest) {
  const hasNewEvidence = request.conversationContext.currentRequest.hasNewEvidence || request.investigation.newAttachmentIds.length > 0 || request.troubleshooting.currentIssues.length > 0;
  const isTroubleshooting =
    request.troubleshooting.active ||
    request.conversationContext.currentRequest.containsDiagnosticEvidence ||
    request.attachments.some((attachment) => request.investigation.newAttachmentIds.includes(attachment.fileId) && /log|terminal|text|output|config|source|code/i.test(`${attachment.evidenceKind} ${attachment.fileType}`)) ||
    request.troubleshooting.currentIssues.length > 0 ||
    request.troubleshooting.previousIssues.length > 0;

  if (!hasNewEvidence || !isTroubleshooting) return "";

  const newEvidence = request.investigation.evidenceReviewed
    .filter((item) => item.role === "new")
    .map((item) => `${item.fileName} (${item.evidenceKind}, ${item.fileType})`)
    .join("; ");

  return [
    "Troubleshooting continuity mode:",
    `- Latest evidence to diagnose first: ${newEvidence || "current message diagnostic content"}.`,
    request.troubleshooting.currentBlocker ? `- Deterministic current blocker candidate: ${request.troubleshooting.currentBlocker.excerpt}.` : "",
    request.troubleshooting.resolvedIssues.length
      ? `- Prior issue(s) absent from latest evidence: ${request.troubleshooting.resolvedIssues.map((issue) => issue.excerpt).join(" | ")}.`
      : "",
    request.troubleshooting.newIssues.length
      ? `- New issue(s) in latest evidence: ${request.troubleshooting.newIssues.map((issue) => issue.excerpt).join(" | ")}.`
      : "",
    "- Treat this as the user's state after prior instructions, not as a brand-new setup request.",
    "- Before writing, compare the latest error against the previous recommendation and decide: old error resolved, old error unchanged, old error changed, or new error introduced.",
    "- In the answer, show a short exact log/config excerpt only when it proves the current blocker. Do not paste long logs.",
    "- Do not repeat previous fixes or full-file replacements unless the latest evidence proves the prior edit is wrong.",
    "- Give one precise next fix, the exact file/path or config block if evidence supports it, the command/check to verify, expected success, and the exact evidence needed if it still fails.",
    "- Do not invent versions, dependencies, plugin ids, paths, commands, or full file contents. If the current file was not provided, prefer a minimal targeted edit or ask for that file before a full replacement.",
    "- Separate evidence-backed facts from hypotheses. A hypothesis is allowed only if it is labeled as a hypothesis and paired with a check.",
    "- If the evidence is insufficient for an exact edit, say that plainly and ask for the smallest missing item instead of inventing.",
  ].join("\n");
}

function needsExpandedAnswer(request: ReasoningRequest, answerPlan: AnswerPlan) {
  if (isInstructionalRequest(request.userMessage)) return true;
  if (request.desiredOutcome === "code") return true;
  if (request.attachments.length > 0 || request.comparisonEvidence.length > 0) return true;
  if (request.conversationContext.currentRequest.hasNewEvidence) return true;
  if (answerPlan.intent.relationship === "follow-up") return true;
  if (answerPlan.intent.canAnswerMultipleSafely || answerPlan.intent.clarificationRequired) return true;
  return ["recommendation", "step-by-step instructions", "comparison", "correction", "verification", "implementation"].includes(
    answerPlan.intent.requestedAction,
  );
}

function mentionsSourceAsCodeOrOrigin(message: string) {
  return /\bsource\s+(code|access|folder|file|files|module|sdk|project|package|tree|repo|repository)\b/i.test(message);
}

function shouldUseImageEvidence(request: ReasoningRequest) {
  return (
    request.investigation.newAttachmentIds.some((id) => request.attachments.some((attachment) => attachment.fileId === id && attachment.uploadStatus === "image")) ||
    /\b(screenshot|screen shot|image|photo|picture|visual|shown|see in the screenshot|that screenshot|previous screenshot)\b/i.test(request.userMessage) ||
    /\b(path|full path|where|which file|project tree|folder|directory|navigator|explorer|structure|package\.json|config|manifest|settings|file to edit|edit file)\b/i.test(request.userMessage)
  );
}

function shouldSendImageAttachment(request: ReasoningRequest, fileId: string) {
  if (request.investigation.newAttachmentIds.includes(fileId)) return true;
  return shouldUseImageEvidence(request);
}

function isTextVisualFormatRequest(message: string) {
  return /\b(ascii|ascii art|text only|plain text|monospace|terminal drawing|character drawing|using characters|using text)\b/i.test(message);
}

function extractText(response: OpenAIResponse) {
  if (response.output_text) return response.output_text.trim();

  return response.output
    ?.flatMap((item) => [item.text, ...(item.content ?? []).map((content) => content.text)].filter(Boolean))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractRefusal(response: OpenAIResponse) {
  return response.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.refusal)
    .filter(Boolean)
    .join("\n")
    .trim();
}
