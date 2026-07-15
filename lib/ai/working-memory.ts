import type { ReasoningAttachment, ReasoningRequest } from "@/lib/ai/context";
import { formatEngineeringState } from "@/lib/ai/engineering-state";
import { hasSuccessfulProgressUpdate } from "@/lib/ai/intent-resolution";
import { formatProjectState } from "@/lib/ai/project-state";
import { formatTroubleshootingSnapshot } from "@/lib/ai/troubleshooting";

type ContextBudget = {
  totalChars: number;
  stateChars: number;
  evidenceChars: number;
  historyChars: number;
  perFileChars: number;
};

type SelectedEvidence = {
  attachment: ReasoningAttachment;
  relevance: number;
  reasons: string[];
  excerpt: string;
};

const DEFAULT_BUDGET: ContextBudget = {
  totalChars: 26000,
  stateChars: 7000,
  evidenceChars: 13000,
  historyChars: 3000,
  perFileChars: 4500,
};

export function buildWorkingMemoryContext(request: ReasoningRequest, budget: ContextBudget = DEFAULT_BUDGET) {
  const workingMemory = formatWorkingMemory(request, budget.stateChars);
  const evidence = formatSelectedEvidence(request, budget);
  const artifacts = formatArtifactMemory(request, Math.min(12000, Math.floor(budget.evidenceChars * 0.45)));
  const history = formatRelevantHistory(request, budget.historyChars);
  const sources = formatSources(request);

  return fitSections(
    [
      ["Current user request", request.userMessage],
      ["Working memory", workingMemory],
      ["Current code/artifact memory", artifacts],
      ["Selected evidence", evidence],
      ["Relevant prior context", history],
      ["Source context", sources],
    ],
    budget.totalChars,
  );
}

function formatArtifactMemory(request: ReasoningRequest, maxChars: number) {
  const codeArtifacts = extractRecentCodeArtifacts(request);
  const visualArtifacts = request.conversationContext.artifacts
    .slice(-4)
    .map((artifact) => `- ${artifact.title} (${artifact.kind}): ${artifact.description}`)
    .join("\n");

  if (!codeArtifacts.length && !visualArtifacts) {
    return "No prior generated/pasted code artifact selected for this turn.";
  }

  const parts = [
    "Use this as the current working copy for code follow-ups unless a newer attachment or pasted full file supersedes it.",
    "If the user asks to add/change/style/refactor this code, update this artifact instead of starting over.",
    "If the user asks for full code/full file, return the complete updated artifact for the requested file(s), not a shortened excerpt.",
    visualArtifacts ? ["Visual/UI artifacts:", visualArtifacts].join("\n") : "",
    codeArtifacts.map(formatCodeArtifact).join("\n\n"),
  ].filter(Boolean);

  return truncate(parts.join("\n\n"), maxChars);
}

type CodeArtifactMemory = {
  author: string;
  messageOffset: number;
  language: string;
  probableFile: string;
  code: string;
};

function extractRecentCodeArtifacts(request: ReasoningRequest) {
  const artifacts: CodeArtifactMemory[] = [];

  request.priorMessages.forEach((message, index) => {
    extractFencedCodeBlocks(message.body).forEach((block) => {
      if (!shouldKeepCodeArtifact(block.code, block.language)) return;
      artifacts.push({
        author: message.author,
        messageOffset: request.priorMessages.length - index,
        language: normalizeArtifactLanguage(block.language, block.code),
        probableFile: inferProbableFileName(message.body, block.language, block.code),
        code: block.code.trim(),
      });
    });
  });

  return artifacts
    .sort((a, b) => artifactScore(b) - artifactScore(a))
    .slice(0, 5)
    .sort((a, b) => b.messageOffset - a.messageOffset);
}

function formatCodeArtifact(artifact: CodeArtifactMemory) {
  const label = artifact.probableFile || `${artifact.language || "code"} artifact`;
  return [
    `Artifact: ${label}`,
    `Source: ${artifact.author}, ${artifact.messageOffset} message(s) ago`,
    `Language: ${artifact.language || "text"}`,
    "Current content:",
    `\`\`\`${artifact.language || "text"}`,
    truncate(artifact.code, 4500),
    "```",
  ].join("\n");
}

function artifactScore(artifact: CodeArtifactMemory) {
  return (
    (artifact.author === "Foundry" ? 30 : 20) +
    (artifact.probableFile ? 20 : 0) +
    Math.min(30, artifact.code.length / 300) -
    artifact.messageOffset
  );
}

function extractFencedCodeBlocks(value: string) {
  return Array.from(value.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g), (match) => ({
    language: (match[1] ?? "").trim(),
    code: (match[2] ?? "").trim(),
  }));
}

function shouldKeepCodeArtifact(code: string, language: string) {
  if (!code.trim()) return false;
  if (/^(shell|bash|zsh|powershell|cmd|terminal|log|text|plaintext)$/i.test(language.trim())) return false;
  if (code.length < 80 && !/[{}<>]/.test(code)) return false;
  if (/^\s*(npm|pnpm|yarn|node|git|curl|python|pip|gradle|gradlew)\b/im.test(code)) return false;
  return /[{}<>;=]|\b(class|function|const|let|var|def|import|export|plugins|dependencies|body|html|style)\b/i.test(code);
}

function normalizeArtifactLanguage(language: string, code: string) {
  const raw = language.trim().toLowerCase();
  if (raw && raw !== "code") return raw;
  if (/^\s*[{[]/.test(code)) return "json";
  if (/<html|<!doctype|<body|<div/i.test(code)) return "html";
  if (/\busing\s+System|\bnamespace\b|\bpublic\s+class\b/.test(code)) return "csharp";
  if (/\bfunction\b|\bconst\b|\blet\b|\bmodule\.exports\b/.test(code)) return "javascript";
  if (/\bplugins\s*\{|\bdependencies\s*\{/.test(code)) return "kotlin";
  if (/[.#][\w-]+\s*\{/.test(code)) return "css";
  return "text";
}

function inferProbableFileName(message: string, language: string, code: string) {
  const beforeFence = message.slice(0, Math.max(0, message.indexOf(code))).slice(-500);
  const fileMatch = beforeFence.match(/\b[\w.-]+\.(?:html|css|js|jsx|ts|tsx|json|xml|xaml|py|php|java|kt|kts|cs|go|rs|rb|sql|md)\b/i);
  if (fileMatch?.[0]) return fileMatch[0];

  const lang = normalizeArtifactLanguage(language, code);
  const defaults: Record<string, string> = {
    html: "index.html",
    css: "styles.css",
    javascript: "script.js",
    js: "script.js",
    json: "package.json",
    xaml: "MainWindow.xaml",
  };

  return defaults[lang] ?? "";
}

function formatWorkingMemory(request: ReasoningRequest, maxChars: number) {
  const state = request.engineeringState;
  const workflow = request.conversationContext.workflowState;
  const investigation = request.conversationContext.investigationState;
  const lines = [
    "Stored progressive memory:",
    request.workMemory?.summary || "No stored progressive memory yet.",
    "",
    `Work item: ${request.missionTitle}`,
    `Current goal: ${state.currentGoal || workflow.goal}`,
    `Current objective: ${state.currentObjective}`,
    `Current blocker: ${state.currentBlocker}`,
    `Current hypothesis: ${state.currentHypothesis}`,
    `Recommended next action: ${state.recommendedNextAction}`,
    `Response focus: ${state.responseFocus}`,
    "Completed work:",
    formatCompactList(state.completedWork, 8, "None confirmed."),
    "Resolved or no longer current:",
    formatCompactList(state.resolvedThisTurn, 6, "None proven resolved."),
    "Rejected hypotheses:",
    formatCompactList(state.rejectedHypotheses, 6, "None."),
    "Still active:",
    formatCompactList(state.stillActive, 6, state.currentBlocker),
    "Pending questions:",
    formatCompactList(state.pendingQuestions, 5, "None."),
    "What changed this turn:",
    formatCompactList(state.whatChangedThisTurn, 5, "No explicit change detected."),
    "Investigation state:",
    `- Current diagnosis: ${investigation.currentDiagnosis}`,
    `- Confirmed findings: ${investigation.confirmedFindings.slice(0, 4).join(" | ") || "None yet"}`,
    `- Rejected findings: ${investigation.rejectedFindings.slice(0, 3).join(" | ") || "None"}`,
    "Troubleshooting state:",
    truncate(formatTroubleshootingSnapshot(request.troubleshooting), 3500),
    "Project state:",
    truncate(formatProjectState(request.projectState), 5000),
    "Authoritative engineering state:",
    truncate(formatEngineeringState(request.engineeringState), 5000),
  ];

  return truncate(lines.join("\n"), maxChars);
}

function formatSelectedEvidence(request: ReasoningRequest, budget: ContextBudget) {
  const selected = selectEvidence(request);
  if (!selected.length) return "No file evidence selected for this request.";

  let remaining = budget.evidenceChars;
  const parts: string[] = [];

  for (const evidence of selected) {
    if (remaining <= 800) break;
    const formatted = formatEvidence(evidence, Math.min(budget.perFileChars, remaining));
    parts.push(formatted);
    remaining -= formatted.length;
  }

  return parts.join("\n\n");
}

function selectEvidence(request: ReasoningRequest) {
  if (
    hasSuccessfulProgressUpdate(request.userMessage) &&
    request.investigation.newAttachmentIds.length === 0 &&
    !request.conversationContext.currentRequest.containsDiagnosticEvidence
  ) {
    return [];
  }

  const requestTerms = importantTerms([
    request.userMessage,
    request.engineeringState.currentBlocker,
    request.engineeringState.currentHypothesis,
    request.engineeringState.recommendedNextAction,
    request.targetVariants.join(" "),
  ].join(" "));
  const needsProjectLanguageEvidence = isBuildToolchainFailure(request);

  return request.attachments
    .map((attachment): SelectedEvidence => {
      const isNew = request.investigation.newAttachmentIds.includes(attachment.fileId);
      const isReadable = attachment.uploadStatus === "readable";
      const isImage = attachment.uploadStatus === "image";
      const content = `${attachment.fileName} ${attachment.fileType} ${attachment.evidenceKind} ${attachment.rawText ?? ""}`.toLowerCase();
      const termHits = requestTerms.filter((term) => content.includes(term)).length;
      const matchedFacts = attachment.evidenceIndex?.filter((fact) => fact.matchedTargetVariants?.length).length ?? 0;
      const diagnostic = containsDiagnosticText(attachment.rawText ?? "");
      const projectLanguageEvidence = needsProjectLanguageEvidence && isProjectLanguageEvidence(attachment);
      const currentBlockerHit = request.engineeringState.currentBlocker
        ? looseIncludes(content, request.engineeringState.currentBlocker)
        : false;
      const reasons = [
        isNew ? "new this turn" : "",
        matchedFacts ? `${matchedFacts} matched indexed fact(s)` : "",
        termHits ? `${termHits} request term hit(s)` : "",
        diagnostic ? "contains diagnostic text" : "",
        projectLanguageEvidence ? "project language/toolchain evidence" : "",
        currentBlockerHit ? "matches current blocker" : "",
        isImage && shouldUseImageEvidence(request) ? "image relevant to current turn" : "",
      ].filter(Boolean);
      const relevance =
        (isNew ? 100 : 0) +
        (isReadable ? 20 : 0) +
        (isImage && shouldUseImageEvidence(request) ? 80 : 0) +
        termHits * 10 +
        matchedFacts * 18 +
        (diagnostic ? 45 : 0) +
        (projectLanguageEvidence ? 70 : 0) +
        (currentBlockerHit ? 55 : 0);

      return {
        attachment,
        relevance,
        reasons,
        excerpt: isReadable ? selectRelevantExcerpt(attachment.rawText ?? "", requestTerms, request) : "",
      };
    })
    .filter((item) => item.relevance > 0 || request.attachments.length <= 3)
    .sort((a, b) => b.relevance - a.relevance || Date.parse(b.attachment.createdAt) - Date.parse(a.attachment.createdAt))
    .slice(0, 6);
}

function isBuildToolchainFailure(request: ReasoningRequest) {
  return /\b(plugin|dependency|dependencies|toolchain|compiler|gradle|maven|npm|package|module|sdk|classpath|could not resolve|not found|unresolved reference)\b/i.test(
    `${request.userMessage}\n${request.engineeringState.currentBlocker}\n${request.engineeringState.currentHypothesis}`,
  );
}

function isProjectLanguageEvidence(attachment: ReasoningAttachment) {
  const name = attachment.fileName.toLowerCase();
  return (
    attachment.uploadStatus === "readable" &&
    /\.(java|kt|kts|gradle|gradle\.kts|xml|json|ts|tsx|js|jsx|py|cs|go|rs|rb|php)$/.test(name)
  );
}

function formatEvidence(evidence: SelectedEvidence, maxChars: number) {
  const attachment = evidence.attachment;
  const indexedFacts = (attachment.evidenceIndex ?? [])
    .slice(0, 12)
    .map(
      (fact) =>
        `- ${fact.path}: ${truncate(fact.rawValue, 260)}${fact.decodedValue ? `; decoded=${truncate(fact.decodedValue, 180)}` : ""}${
          fact.parentContext ? `; nearby=${truncate(fact.parentContext, 220)}` : ""
        }`,
    )
    .join("\n");
  const body = [
    `File: ${attachment.fileName}`,
    `Type: ${attachment.fileType}; kind=${attachment.evidenceKind}; status=${attachment.uploadStatus}; size=${attachment.size}; created=${attachment.createdAt}`,
    `Why selected: ${evidence.reasons.join(", ") || "small current evidence set"}`,
    attachment.uploadStatus === "image" ? "Image is sent separately as visual input when relevant." : "",
    indexedFacts ? "Relevant indexed facts:" : "",
    indexedFacts,
    evidence.excerpt ? "Relevant excerpt:" : "",
    evidence.excerpt,
  ]
    .filter(Boolean)
    .join("\n");

  return truncate(body, maxChars);
}

function formatRelevantHistory(request: ReasoningRequest, maxChars: number) {
  const terms = importantTerms(`${request.userMessage} ${request.engineeringState.currentBlocker} ${request.engineeringState.recommendedNextAction}`);
  const selected = request.priorMessages
    .map((message, index) => {
      const normalized = message.body.replace(/\s+/g, " ").trim();
      const lower = normalized.toLowerCase();
      const hits = terms.filter((term) => lower.includes(term)).length;
      const isRecent = index >= request.priorMessages.length - 4;
      const isAssistantFinding = /\b(checked|found|current blocker|resolved|still|next|fix|error|attached|file)\b/i.test(normalized);
      const score = hits * 12 + (isRecent ? 18 : 0) + (isAssistantFinding ? 10 : 0);
      return { message, score, normalized };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .sort((a, b) => request.priorMessages.indexOf(a.message) - request.priorMessages.indexOf(b.message));

  const summary = [
    `Compressed history: ${request.priorMessages.length} prior message(s) available; ${selected.length} selected for this request.`,
    `Prior user questions: ${request.conversationContext.priorQuestions.slice(-4).join(" | ") || "None"}`,
    "Selected prior messages:",
    selected.map((item) => `${item.message.author}: ${truncate(item.normalized, 900)}`).join("\n"),
  ].join("\n");

  return truncate(summary, maxChars);
}

function formatSources(request: ReasoningRequest) {
  if (!request.sources.length) return "None.";

  return request.sources
    .slice(0, 6)
    .map((source) => `- ${source.title}: ${source.url}`)
    .join("\n");
}

function selectRelevantExcerpt(rawText: string, terms: string[], request: ReasoningRequest) {
  const text = rawText.replace(/\r\n/g, "\n");
  if (!text.trim()) return "";
  if (text.length <= 7000) return text;

  const lines = text.split("\n");
  const blockerTerms = importantTerms(request.engineeringState.currentBlocker);
  const allTerms = Array.from(new Set([...terms, ...blockerTerms]));
  const scored = lines
    .map((line, index) => {
      const lower = line.toLowerCase();
      const termScore = allTerms.filter((term) => lower.includes(term)).length * 10;
      const issueScore = containsDiagnosticText(line) ? 45 : 0;
      return { index, score: termScore + issueScore };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index);

  if (!scored.length) {
    return `${text.slice(0, 2400)}\n\n[Middle omitted]\n\n${text.slice(-2400)}`;
  }

  const windows: string[] = [];
  const used = new Set<number>();
  scored.forEach((item) => {
    const start = Math.max(0, item.index - 8);
    const end = Math.min(lines.length, item.index + 9);
    const key = start * 100000 + end;
    if (used.has(key)) return;
    used.add(key);
    windows.push(
      [
        `--- excerpt lines ${start + 1}-${end} ---`,
        lines
          .slice(start, end)
          .map((line, offset) => `${start + offset + 1}: ${line}`)
          .join("\n"),
      ].join("\n"),
    );
  });

  return truncate(windows.join("\n\n"), 7000);
}

function fitSections(sections: Array<[string, string]>, maxChars: number) {
  let remaining = maxChars;
  const output: string[] = [];

  for (const [title, body] of sections) {
    if (remaining <= 500) break;
    const content = `## ${title}\n${truncate(body || "None.", remaining - 80)}`;
    output.push(content);
    remaining -= content.length + 2;
  }

  return output.join("\n\n");
}

function formatCompactList(items: string[], limit: number, empty: string) {
  const selected = items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, limit);
  return selected.length ? selected.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function importantTerms(value: string) {
  const stop = new Set([
    "about",
    "after",
    "again",
    "also",
    "because",
    "before",
    "current",
    "error",
    "file",
    "from",
    "have",
    "latest",
    "message",
    "please",
    "problem",
    "question",
    "should",
    "that",
    "this",
    "what",
    "when",
    "where",
    "with",
    "your",
  ]);

  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/`([^`]+)`/g, " $1 ")
        .replace(/[^a-z0-9_.#/-]+/g, " ")
        .split(/\s+/)
        .filter((term) => term.length >= 4 && !stop.has(term))
        .slice(0, 80),
    ),
  );
}

function shouldUseImageEvidence(request: ReasoningRequest) {
  return (
    request.investigation.newAttachmentIds.some((id) => request.attachments.some((attachment) => attachment.fileId === id && attachment.uploadStatus === "image")) ||
    /\b(screenshot|screen shot|image|photo|picture|visual|shown|see in the screenshot|that screenshot|previous screenshot)\b/i.test(request.userMessage)
  );
}

function containsDiagnosticText(value: string) {
  return /\b(error|failed|failure|exception|fatal|cannot|unable|unresolved reference|not found|missing|duplicate|conflict|build failed|traceback|forbidden|denied|timeout)\b/i.test(value);
}

function looseIncludes(haystack: string, needle: string) {
  const terms = importantTerms(needle).slice(0, 8);
  return terms.length > 0 && terms.some((term) => haystack.includes(term));
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  if (maxChars <= 40) return value.slice(0, maxChars);
  return `${value.slice(0, Math.max(0, maxChars - 34)).trimEnd()}\n[truncated for working-memory budget]`;
}
