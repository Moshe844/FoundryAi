import type { ReasoningAttachment } from "@/lib/ai/context";
import { hasSuccessfulProgressUpdate } from "@/lib/ai/intent-resolution";
import type { EvidenceKind } from "@/lib/files";
import { looksLikeDiagnosticPaste } from "@/lib/mission-engine";

export type TroubleshootingIssue = {
  signature: string;
  excerpt: string;
  sourceName: string;
  line?: number;
  kind: "error" | "warning" | "failure" | "syntax" | "missing" | "conflict" | "unknown";
};

export type TroubleshootingEvidenceSnapshot = {
  active: boolean;
  isFollowUp: boolean;
  latestEvidenceName: string;
  latestEvidenceKind: EvidenceKind | "pasted-diagnostic" | "none";
  latestEvidenceCreatedAt: string;
  currentIssues: TroubleshootingIssue[];
  previousIssues: TroubleshootingIssue[];
  resolvedIssues: TroubleshootingIssue[];
  persistentIssues: TroubleshootingIssue[];
  newIssues: TroubleshootingIssue[];
  currentBlocker?: TroubleshootingIssue;
  oldIssueStatus: "no-previous-issue" | "resolved-or-replaced" | "still-present" | "changed" | "unknown";
  userChanged: string;
  summaryLines: string[];
};

export function buildTroubleshootingSnapshot(input: {
  userMessage: string;
  attachments: ReasoningAttachment[];
  newAttachmentIds: Set<string>;
  priorMessages: Array<{ author: string; body: string }>;
}): TroubleshootingEvidenceSnapshot {
  const configInspectionTurn = isPastedConfigInspectionTurn(input.userMessage);
  const latestEvidence = selectLatestTroubleshootingEvidence(input.userMessage, input.attachments, input.newAttachmentIds);
  const latestIssues = latestEvidence ? extractIssues(latestEvidence.text, latestEvidence.name) : [];
  const previousEvidence = input.attachments
    .filter((attachment) => !input.newAttachmentIds.has(attachment.fileId))
    .filter((attachment) => isTroubleshootingEvidence(attachment.evidenceKind, attachment.fileType, attachment.rawText))
    .flatMap((attachment) => extractIssues(attachment.rawText, attachment.fileName));
  const previousAssistantIssues = extractPreviousAssistantIssues(input.priorMessages);
  const previousIssues = uniqueIssues([...previousEvidence, ...previousAssistantIssues]).slice(0, 12);
  const currentIssuesFromLatest = uniqueIssues(latestIssues).slice(0, 12);
  const successfulProgressUpdate = !latestEvidence && hasSuccessfulProgressUpdate(input.userMessage);
  const contextualContinuation = !configInspectionTurn && isContextualTroubleshootingTurn(input.userMessage, previousIssues);
  const recurringReference = !configInspectionTurn && latestIssues.length === 0 && isRecurringIssueReference(input.userMessage, previousIssues);
  const referencedPreviousIssue = recurringReference ? previousIssues[0] : undefined;
  const currentIssues = successfulProgressUpdate
    ? []
    : referencedPreviousIssue
      ? uniqueIssues([referencedPreviousIssue, ...currentIssuesFromLatest]).slice(0, 12)
      : currentIssuesFromLatest;
  const latestSignatures = new Set(currentIssues.map((issue) => issue.signature));
  const previousSignatures = new Set(previousIssues.map((issue) => issue.signature));
  const resolvedIssues = successfulProgressUpdate ? previousIssues.slice(0, 6) : recurringReference ? [] : previousIssues.filter((issue) => !latestSignatures.has(issue.signature)).slice(0, 6);
  const persistentIssues = recurringReference
    ? currentIssues.slice(0, 1)
    : currentIssues.filter((issue) => previousSignatures.has(issue.signature)).slice(0, 6);
  const newIssues = recurringReference ? [] : currentIssues.filter((issue) => !previousSignatures.has(issue.signature)).slice(0, 6);
  const active = !successfulProgressUpdate && (Boolean(latestEvidence) || contextualContinuation);
  const isFollowUp = Boolean(previousIssues.length && (latestEvidence || contextualContinuation));
  const currentBlocker = currentIssues[0];
  const oldIssueStatus = successfulProgressUpdate ? "resolved-or-replaced" : recurringReference ? "still-present" : deriveOldIssueStatus(previousIssues, currentIssues, persistentIssues, newIssues);
  const userChanged = inferUserChange(input.userMessage);
  const latestEvidenceName = latestEvidence?.name ?? (recurringReference ? "referenced previous error" : looksLikeDiagnosticPaste(input.userMessage) ? "current message diagnostic text" : "none");

  return {
    active,
    isFollowUp,
    latestEvidenceName,
    latestEvidenceKind: latestEvidence?.kind ?? (looksLikeDiagnosticPaste(input.userMessage) ? "pasted-diagnostic" : "none"),
    latestEvidenceCreatedAt: latestEvidence?.createdAt ?? "",
    currentIssues,
    previousIssues,
    resolvedIssues,
    persistentIssues,
    newIssues,
    currentBlocker,
    oldIssueStatus,
    userChanged,
    summaryLines: buildSummaryLines({ currentBlocker, resolvedIssues, persistentIssues, newIssues, oldIssueStatus }),
  };
}

export function formatTroubleshootingSnapshot(snapshot: TroubleshootingEvidenceSnapshot) {
  if (!snapshot.active) return "No active troubleshooting investigation detected for this turn.";

  return [
    "Live troubleshooting state:",
    `- Latest evidence source of truth: ${snapshot.latestEvidenceName} (${snapshot.latestEvidenceKind}).`,
    `- User changed since prior advice: ${snapshot.userChanged || "not explicitly stated"}.`,
    `- Previous issue status: ${snapshot.oldIssueStatus}.`,
    `- Current blocker: ${snapshot.currentBlocker ? formatIssue(snapshot.currentBlocker) : "No exact error extracted from latest evidence."}`,
    snapshot.resolvedIssues.length ? "Resolved or no longer present in latest evidence:" : "Resolved or no longer present in latest evidence: none detected.",
    ...snapshot.resolvedIssues.map((issue) => `  - ${formatIssue(issue)}`),
    snapshot.persistentIssues.length ? "Still present in latest evidence:" : "Still present in latest evidence: none detected.",
    ...snapshot.persistentIssues.map((issue) => `  - ${formatIssue(issue)}`),
    snapshot.newIssues.length ? "New in latest evidence:" : "New in latest evidence: none detected.",
    ...snapshot.newIssues.map((issue) => `  - ${formatIssue(issue)}`),
    "Answer style: write like a senior engineer continuing the live debug session. Do not expose this state as headings or a report. Quote the exact blocker in normal prose unless a longer log excerpt is genuinely useful.",
  ].join("\n");
}

function selectLatestTroubleshootingEvidence(userMessage: string, attachments: ReasoningAttachment[], newAttachmentIds: Set<string>) {
  const newReadable = attachments
    .filter((attachment) => newAttachmentIds.has(attachment.fileId))
    .filter((attachment) => attachment.uploadStatus === "readable" && isTroubleshootingEvidence(attachment.evidenceKind, attachment.fileType, attachment.rawText))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  if (newReadable.length > 1) {
    const combined = newReadable
      .map((attachment) => [`--- ${attachment.fileName} ---`, attachment.rawText].join("\n"))
      .join("\n\n");

    return {
      name: newReadable.map((attachment) => attachment.fileName).join(", "),
      kind: "source-code" as EvidenceKind,
      createdAt: newReadable[0]?.createdAt ?? "",
      text: combined,
    };
  }

  const newestAttachment = newReadable[0];
  if (newestAttachment?.rawText) {
    return {
      name: newestAttachment.fileName,
      kind: newestAttachment.evidenceKind,
      createdAt: newestAttachment.createdAt,
      text: newestAttachment.rawText,
    };
  }

  if (!isPastedConfigInspectionTurn(userMessage) && (looksLikeDiagnosticPaste(userMessage) || containsDiagnosticText(userMessage))) {
    return {
      name: "current message diagnostic text",
      kind: "pasted-diagnostic" as const,
      createdAt: new Date().toISOString(),
      text: userMessage,
    };
  }

  return undefined;
}

function isTroubleshootingEvidence(kind: EvidenceKind, fileType: string, rawText: string) {
  return /log|text|source-code|markdown|json|xml|unknown/i.test(kind) || /log|txt|gradle|kts|kt|java|js|ts|tsx|json|xml|md|yaml|yml/i.test(fileType) || containsDiagnosticText(rawText);
}

function extractIssues(text: string, sourceName: string): TroubleshootingIssue[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const issues: TroubleshootingIssue[] = [];

  lines.forEach((line, index) => {
    const normalized = line.trim();
    if (!normalized || normalized.length > 900) return;
    if (/^\*+\s*What went wrong:/i.test(normalized)) {
      const detail = nextMeaningfulIssueDetail(lines, index);
      if (detail) {
        issues.push({
          signature: signatureFor(detail),
          excerpt: detail,
          sourceName,
          line: lines.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.trim() === detail) + 1 || index + 1,
          kind: issueKind(detail),
        });
      }
    }
    if (!isIssueLine(normalized, lines[index - 1] ?? "")) return;

    issues.push({
      signature: signatureFor(normalized),
      excerpt: normalized,
      sourceName,
      line: index + 1,
      kind: issueKind(normalized),
    });
  });

  return uniqueIssues(prioritizeIssues(issues)).slice(0, 16);
}

function nextMeaningfulIssueDetail(lines: string[], markerIndex: number) {
  for (let index = markerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) continue;
    if (/^\*+\s+\w/.test(line) || /^> /.test(line)) return "";
    if (/^(?:Try:|Run with|Get more help|BUILD FAILED|Configuration cache)/i.test(line)) return "";
    return line;
  }

  return "";
}

function extractPreviousAssistantIssues(priorMessages: Array<{ author: string; body: string }>) {
  return priorMessages
    .filter((message) => /\b(foundry|assistant|system)\b/i.test(message.author))
    .slice(-4)
    .flatMap((message) => extractIssues(message.body, "previous Foundry answer"))
    .slice(0, 10);
}

function isIssueLine(line: string, previousLine: string) {
  if (/^\s*(?:at\s+[\w.$]+\(|\.\.\. \d+ more$)/i.test(line)) return false;
  if (/^\s*(?:note:|info:|debug:)/i.test(line)) return false;
  if (/\b(no exact error|without the exact error|send me the exact|need the exact|cannot pinpoint|can't pinpoint)\b/i.test(line)) return false;

  return (
    /\b(?:error|failed|failure|exception|fatal|cannot|can't|unable|unresolved reference|not found|missing|expected|unexpected|duplicate|conflict|denied|timeout|timed out|invalid|syntax)\b/i.test(line) ||
    /\b(?:prefer settings repositories|settings repositories over project repositories|repository ['"][^'"]+['"] was added|repository .+ was added by build file)\b/i.test(line) ||
    /^\s*(?:e:|error:|warning:|\* What went wrong:|Caused by:|FAILURE:|BUILD FAILED)\b/i.test(line) ||
    (/\^/.test(line) && /\b(expected|unexpected|syntax)\b/i.test(previousLine))
  );
}

function isRecurringIssueReference(message: string, previousIssues: TroubleshootingIssue[]) {
  if (!previousIssues.length) return false;

  const text = message.replace(/\s+/g, " ").trim().toLowerCase();
  if (!text) return false;

  const directRecurrence = /\b(same|still|again|unchanged|persists?|continues?|keeps?|kept|same thing|same problem|same issue|same failure|same error)\b/.test(text);
  const resultAfterAction = /\b(after|since|now|when|while)\b.{0,120}\b(sync|build|run|compile|install|start|test|rebuild|rerun|retry|apply|update)\b/.test(text);
  const failureLanguage = /\b(error|issue|problem|failure|failed|fails|failing|blocked|stuck|exception|trace|log|output)\b/.test(text);
  const mentionsKnownIssue = previousIssues.some((issue) => {
    const terms = issue.excerpt
      .toLowerCase()
      .replace(/[^a-z0-9\s._-]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 4)
      .filter((term) => !["error", "failed", "failure", "exception", "current", "blocker"].includes(term))
      .slice(0, 10);

    return terms.some((term) => text.includes(term));
  });

  return (directRecurrence && (failureLanguage || text.split(/\s+/).length <= 12)) || (resultAfterAction && failureLanguage) || mentionsKnownIssue;
}

function containsDiagnosticText(value: string) {
  return /\b(error|failed|failure|exception|fatal|cannot|unable|unresolved reference|not found|missing|duplicate|conflict|build failed|traceback)\b/i.test(value);
}

function isPastedConfigInspectionTurn(message: string) {
  const fenced = extractFirstFencedBlock(message);
  if (!fenced) return false;
  if (/^(?:shell|bash|zsh|powershell|pwsh|cmd|terminal|log|text|plaintext|console)$/i.test(fenced.language.trim())) return false;
  if (looksLikeDiagnosticPaste(fenced.code) || containsDiagnosticText(fenced.code)) return false;

  const prose = message.replace(/```[\s\S]*?```/g, " ");
  const asksAboutShape =
    /\b(?:how should|should look|look now|is this|does this|correct|right|wrong|fix|clean|remove|change|edit|file|config|snippet|block)\b/i.test(
      prose,
    );
  const looksLikeConfig = /\b(?:plugins|buildscript|allprojects|subprojects|repositories|dependencies|android|pluginManagement|dependencyResolutionManagement)\s*\{/i.test(
    fenced.code,
  );

  return asksAboutShape && looksLikeConfig;
}

function extractFirstFencedBlock(message: string) {
  const match = message.match(/```([^\n`]*)\n([\s\S]*?)```/);
  if (!match) return undefined;
  return {
    language: match[1]?.trim() ?? "",
    code: match[2]?.trim() ?? "",
  };
}

function issueKind(line: string): TroubleshootingIssue["kind"] {
  if (/\b(warn|warning)\b/i.test(line)) return "warning";
  if (/\b(syntax|expected|unexpected|missing bracket|missing brace|missing '\}'|missing '\)')\b/i.test(line)) return "syntax";
  if (/\b(missing|not found|unresolved reference|cannot find)\b/i.test(line)) return "missing";
  if (/\b(conflict|duplicate|already exists|redeclaration|settings repositories over project repositories|repository .+ was added by build file)\b/i.test(line)) return "conflict";
  if (/\b(failed|failure|build failed)\b/i.test(line)) return "failure";
  if (/\b(error|exception|fatal)\b/i.test(line)) return "error";
  return "unknown";
}

function prioritizeIssues(issues: TroubleshootingIssue[]) {
  return [...issues].sort((a, b) => issueRank(a) - issueRank(b) || (a.line ?? 0) - (b.line ?? 0));
}

function issueRank(issue: TroubleshootingIssue) {
  if (/\b(?:prefer settings repositories|settings repositories over project repositories|repository ['"][^'"]+['"] was added|repository .+ was added by build file)\b/i.test(issue.excerpt)) return 0;
  if (/\bunresolved reference\b/i.test(issue.excerpt)) return 0;
  if (/\b(?:error|exception|fatal|caused by)\b/i.test(issue.excerpt)) return 1;
  if (/^\*+\s*What went wrong:/i.test(issue.excerpt)) return 4;
  if (/\b(?:failed|failure|build failed)\b/i.test(issue.excerpt)) return 2;
  if (/\balready exists in keystore|Certificate already exists\b/i.test(issue.excerpt)) return 7;
  if (issue.kind === "warning") return 6;
  return 3;
}

function signatureFor(line: string) {
  return line
    .toLowerCase()
    .replace(/\b[A-Za-z]:\\[^\s)]+/g, "<path>")
    .replace(/\/[^\s)]+/g, "<path>")
    .replace(/\bline\s+\d+\b/g, "line <n>")
    .replace(/:\d+:\d+/g, ":<n>:<n>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function uniqueIssues(issues: TroubleshootingIssue[]) {
  const seen = new Set<string>();
  const result: TroubleshootingIssue[] = [];

  issues.forEach((issue) => {
    if (seen.has(issue.signature)) return;
    seen.add(issue.signature);
    result.push(issue);
  });

  return result;
}

function deriveOldIssueStatus(
  previousIssues: TroubleshootingIssue[],
  currentIssues: TroubleshootingIssue[],
  persistentIssues: TroubleshootingIssue[],
  newIssues: TroubleshootingIssue[],
): TroubleshootingEvidenceSnapshot["oldIssueStatus"] {
  if (!previousIssues.length) return "no-previous-issue";
  if (!currentIssues.length) return "unknown";
  if (persistentIssues.length) return "still-present";
  if (newIssues.length) return "resolved-or-replaced";
  return "changed";
}

function inferUserChange(userMessage: string) {
  const text = userMessage.replace(/\s+/g, " ").trim();
  const match = text.match(/\b(?:i|we)?\s*(?:fixed|changed|updated|removed|added|replaced|ran|synced|rebuilt|retried|tried|applied|edited|patched|moved|deleted|installed|upgraded|downgraded|restarted|recreated|regenerated|refreshed)\b.{0,160}/i);
  if (match) return match[0].trim();
  if (containsDiagnosticText(text) || /\b(?:after|before|during|while|again|now|next|latest|current)\b.{0,80}\b(?:sync|build|run|install|start|restart|compile|test|output|log|result|error|failure)\b/i.test(text)) {
    return text.slice(0, 220);
  }
  return "";
}

function buildSummaryLines(input: {
  currentBlocker?: TroubleshootingIssue;
  resolvedIssues: TroubleshootingIssue[];
  persistentIssues: TroubleshootingIssue[];
  newIssues: TroubleshootingIssue[];
  oldIssueStatus: TroubleshootingEvidenceSnapshot["oldIssueStatus"];
}) {
  const resolved = input.resolvedIssues[0];
  const current = input.currentBlocker;
  const lines: string[] = [];

  if (resolved) lines.push(`Resolved: ${resolved.excerpt}`);
  if (input.persistentIssues[0]) lines.push(`Still present: ${input.persistentIssues[0].excerpt}`);
  if (input.newIssues[0]) lines.push(`New blocker: ${input.newIssues[0].excerpt}`);
  if (current && !lines.some((line) => line.includes(current.excerpt))) lines.push(`Current blocker: ${current.excerpt}`);
  if (!lines.length && input.oldIssueStatus !== "no-previous-issue") lines.push(`Previous issue status: ${input.oldIssueStatus}`);

  return lines.slice(0, 4);
}

function formatIssue(issue: TroubleshootingIssue) {
  const location = issue.line ? `${issue.sourceName}:${issue.line}` : issue.sourceName;
  return `${issue.excerpt} (${location})`;
}

function isContextualTroubleshootingTurn(message: string, previousIssues: TroubleshootingIssue[]) {
  if (!previousIssues.length) return false;
  if (containsDiagnosticText(message) || looksLikeDiagnosticPaste(message)) return true;

  const text = message.trim();
  if (!text) return false;

  const words = text.split(/\s+/).filter(Boolean);
  const hasQuestionShape = text.includes("?");
  const hasThreadReference = /\b(this|that|it|same|previous|earlier|above|still|again|now|next|current)\b/i.test(text);
  const hasResultOrChangeLanguage = /\b(after|before|then|now|changed|updated|removed|added|replaced|ran|tried|applied|sync|build|result|output|log)\b/i.test(text);
  const asksAboutKnownIssueTerm = previousIssues.some((issue) => {
    const issueTerms = issue.excerpt
      .toLowerCase()
      .replace(/[^a-z0-9\s._-]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 3)
      .slice(0, 8);

    const messageText = text.toLowerCase();
    return issueTerms.some((term) => messageText.includes(term));
  });

  return (
    words.length <= 18 && (hasQuestionShape || hasThreadReference || hasResultOrChangeLanguage || asksAboutKnownIssueTerm)
  ) || (
    words.length <= 60 && (hasThreadReference || asksAboutKnownIssueTerm) && hasResultOrChangeLanguage
  );
}
