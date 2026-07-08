import type { ReasoningRequest } from "@/lib/ai/context";

export type ResponseVerificationIssue = {
  code:
    | "raw-provider-error"
    | "command-intro-without-command"
    | "asks-for-existing-evidence"
    | "mixed-fence-content"
    | "stale-troubleshooting"
    | "contradicts-current-evidence"
    | "missing-current-blocker"
    | "missing-verification";
  severity: "warning" | "critical";
  message: string;
};

export type ResponseVerificationResult = {
  ok: boolean;
  issues: ResponseVerificationIssue[];
  answer: string;
};

export function verifyFoundryResponse(request: ReasoningRequest, answer: string): ResponseVerificationResult {
  const issues = [
    ...detectRawProviderErrors(answer),
    ...detectCommandIntroWithoutCommand(answer),
    ...detectExistingEvidenceRequests(request, answer),
    ...detectMixedFenceContent(answer),
    ...detectStaleTroubleshooting(request, answer),
    ...detectPastedConfigContradiction(request, answer),
    ...detectMissingCurrentBlocker(request, answer),
    ...detectMissingVerification(request, answer),
  ];

  return {
    ok: !issues.some((issue) => issue.severity === "critical"),
    issues,
    answer: issues.some((issue) => issue.severity === "critical") ? createSafeFallback(request, issues, answer) : answer,
  };
}

export function formatResponseVerification(result: ResponseVerificationResult) {
  if (!result.issues.length) return "Response verification passed.";
  return result.issues.map((issue) => `- ${issue.severity}: ${issue.code}: ${issue.message}`).join("\n");
}

function detectRawProviderErrors(answer: string): ResponseVerificationIssue[] {
  if (!/\b(rate limit reached|tokens per min|organization org-|requested \d+|openai|api key|stack trace|TypeError|ReferenceError)\b/i.test(answer)) {
    return [];
  }

  return [
    {
      code: "raw-provider-error",
      severity: "critical",
      message: "Raw provider/server internals appeared in the answer.",
    },
  ];
}

function detectCommandIntroWithoutCommand(answer: string): ResponseVerificationIssue[] {
  const lines = answer.replace(/\r\n/g, "\n").split("\n");
  const failed = lines.some((line, index) => {
    if (!/\b(?:run|use|try|execute|rerun|re-run)\b.{0,100}\b(?:following command|this command|the command|command below|same command|command you (?:just )?(?:tried|ran|used)|previous command)\b/i.test(line)) return false;
    const next = lines.slice(index + 1, index + 5).join("\n");
    return !/^```(?:cmd|powershell|shell|bash|sh|zsh|terminal)?\s*\n[\s\S]+?\n```/i.test(next.trim());
  });

  return failed
    ? [
        {
          code: "command-intro-without-command",
          severity: "critical",
          message: "The answer introduced a command without showing a command block directly below.",
        },
      ]
    : [];
}

function detectExistingEvidenceRequests(request: ReasoningRequest, answer: string): ResponseVerificationIssue[] {
  if (!request.attachments.length) return [];
  if (!/\b(?:send|share|attach|upload|provide|paste)\b.{0,120}\b(?:file|log|screenshot|image|config|json|xml|csv|output)\b/i.test(answer)) return [];

  return [
    {
      code: "asks-for-existing-evidence",
      severity: "warning",
      message: "The answer may ask for evidence even though attachments are already available.",
    },
  ];
}

function detectMixedFenceContent(answer: string): ResponseVerificationIssue[] {
  const mixed = Array.from(answer.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)).some((match) => {
    const language = (match[1] ?? "").trim().toLowerCase();
    const code = (match[2] ?? "").trim();
    if (!/^(cmd|powershell|shell|bash|sh|zsh|terminal|log)$/i.test(language)) return false;
    return code.split(/\r?\n/).some((line) => /^\s*(?:here|this|because|when|if|then|note:|explanation:)\b/i.test(line));
  });

  return mixed
    ? [
        {
          code: "mixed-fence-content",
          severity: "critical",
          message: "A command/log fence appears to contain explanatory prose.",
        },
      ]
    : [];
}

function detectStaleTroubleshooting(request: ReasoningRequest, answer: string): ResponseVerificationIssue[] {
  if (!request.troubleshooting.active) return [];

  const latestText = request.userMessage.toLowerCase();
  const answerText = answer.toLowerCase();
  const latestHasAccessDenied = /\b(?:access is denied|permission denied|denied access)\b/i.test(latestText);
  const answerCentersAccessDenied = /\baccess is denied\b/i.test(answer) || /\b(?:run|open|launch|start)\b.{0,100}\b(?:as administrator|as admin|elevated|administrator privileges)\b/i.test(answer);
  const currentBlockerText = [
    request.engineeringState.currentBlocker,
    request.troubleshooting.currentBlocker?.excerpt ?? "",
    ...request.troubleshooting.currentIssues.map((issue) => issue.excerpt),
  ].join("\n");
  const currentHasSslOrCertificateBlocker = /\b(?:sslhandshake|ssl handshake|certificate_unknown|pkix|truststore|cacerts|certification path|unable to find valid certification path)\b/i.test(
    currentBlockerText,
  );
  const answerCentersSslOrCertificate =
    /\b(?:sslhandshake|ssl handshake|truststore|cacerts|certificate_unknown|pkix|maven central|gradle plugin portal)\b/i.test(answer) &&
    !/\b(?:not|no longer|isn't|is not)\b.{0,60}\b(?:ssl|truststore|certificate|cacerts|pkix)\b/i.test(answer);
  const currentBlockerTerms = request.engineeringState.currentBlocker && request.engineeringState.currentBlocker !== "No exact current blocker is proven by the available evidence."
    ? importantTerms(request.engineeringState.currentBlocker).slice(0, 10)
    : [];
  const specificCurrentBlockerTerms = currentBlockerTerms.filter(
    (term) =>
      !/^(?:build|gradle|file|error|failed|failure|project|current|blocker|configured|configuration|build\.gradle\.kts|settings\.gradle\.kts)$/.test(
        term,
      ),
  );
  const termsForCurrentBlockerMatch = specificCurrentBlockerTerms.length ? specificCurrentBlockerTerms : currentBlockerTerms;
  const mentionsCurrentBlocker =
    termsForCurrentBlockerMatch.length > 0 && termsForCurrentBlockerMatch.some((term) => answerText.includes(term));

  if (answerCentersAccessDenied && !latestHasAccessDenied && currentBlockerTerms.length > 0 && !mentionsCurrentBlocker) {
    return [
      {
        code: "stale-troubleshooting",
        severity: "critical",
        message: "The answer centered an old access/admin blocker instead of the current blocker from the latest evidence.",
      },
    ];
  }

  if (answerCentersSslOrCertificate && !currentHasSslOrCertificateBlocker && currentBlockerTerms.length > 0 && !mentionsCurrentBlocker) {
    return [
      {
        code: "stale-troubleshooting",
        severity: "critical",
        message: "The answer centered an old SSL/certificate blocker instead of the current blocker from the latest evidence.",
      },
    ];
  }

  if (request.troubleshooting.oldIssueStatus !== "resolved-or-replaced") return [];

  const resolvedTerms = request.troubleshooting.resolvedIssues
    .flatMap((issue) => importantTerms(issue.excerpt))
    .slice(0, 12);
  if (!resolvedTerms.length) return [];

  const repeatsResolved = resolvedTerms.some((term) => answerText.includes(term));
  if (!repeatsResolved) return [];

  return [
    {
      code: "stale-troubleshooting",
      severity: mentionsCurrentBlocker ? "warning" : "critical",
      message: "The answer mentions a resolved prior issue; ensure it is not centered as active.",
    },
  ];
}

function detectPastedConfigContradiction(request: ReasoningRequest, answer: string): ResponseVerificationIssue[] {
  if (!looksLikeGradleRepositoryPolicyConflict(request)) return [];

  const pasted = extractFirstFencedBlock(request.userMessage);
  if (!pasted || !/build\.gradle(?:\.kts)?|gradle/i.test(`${request.userMessage}\n${pasted.language}`)) return [];
  if (!hasRootGradleRepositoryDeclaration(pasted.code)) return [];

  const saysNoChangeNeeded = /\b(?:already correct|already minimal|file is fine|looks good|no changes? needed|do not change|don't change|there are no changes needed)\b/i.test(
    answer,
  );
  const answerKeepsRejectedBlocks = hasRootGradleRepositoryDeclaration(answer);
  const answersDifferentOldIssue =
    /\b(?:sslhandshake|ssl handshake|truststore|cacerts|certificate_unknown|pkix|access is denied|administrator privileges|as administrator)\b/i.test(
      answer,
    );

  if (!saysNoChangeNeeded && !answerKeepsRejectedBlocks && !answersDifferentOldIssue) return [];

  return [
    {
      code: "contradicts-current-evidence",
      severity: "critical",
      message: "The answer contradicts the latest pasted Gradle config and the current repository-policy blocker.",
    },
  ];
}

function looksLikeGradleRepositoryPolicyConflict(request: ReasoningRequest) {
  const text = [
    request.userMessage,
    request.engineeringState.currentBlocker,
    request.troubleshooting.currentBlocker?.excerpt ?? "",
    ...request.troubleshooting.currentIssues.map((issue) => issue.excerpt),
    ...request.priorMessages.slice(-6).map((message) => message.body),
  ].join("\n");

  return (
    /prefer settings repositories over project repositories|repository ['"][^'"]+['"] was added by build file|RepositoriesMode\.FAIL_ON_PROJECT_REPOS/i.test(text) ||
    /\bonly use repositories declared in settings\.gradle(?:\.kts)?\b|\bremove any repositories\b.{0,80}\broot build\.gradle(?:\.kts)?\b/i.test(text)
  );
}

function hasRootGradleRepositoryDeclaration(value: string) {
  return /\b(?:buildscript|allprojects|subprojects)\s*\{[\s\S]{0,600}\brepositories\s*\{/i.test(value);
}

function extractFirstFencedBlock(message: string) {
  const match = message.match(/```([^\n`]*)\n([\s\S]*?)```/);
  if (!match) return undefined;
  return {
    language: match[1]?.trim() ?? "",
    code: match[2]?.trim() ?? "",
  };
}

function detectMissingCurrentBlocker(request: ReasoningRequest, answer: string): ResponseVerificationIssue[] {
  if (!request.troubleshooting.active || !request.engineeringState.currentBlocker) return [];
  if (request.engineeringState.currentBlocker === "No exact current blocker is proven by the available evidence.") return [];

  const terms = importantTerms(request.engineeringState.currentBlocker).slice(0, 10);
  if (!terms.length) return [];
  const lowerAnswer = answer.toLowerCase();
  const hits = terms.filter((term) => lowerAnswer.includes(term)).length;

  return hits === 0
    ? [
        {
          code: "missing-current-blocker",
          severity: "warning",
          message: "The answer does not appear to mention the current blocker from engineering state.",
        },
      ]
    : [];
}

function detectMissingVerification(request: ReasoningRequest, answer: string): ResponseVerificationIssue[] {
  if (!request.troubleshooting.active && request.desiredOutcome !== "code") return [];
  if (/\b(verify|check|rerun|run|test|build|expected|success|should see)\b/i.test(answer)) return [];

  return [
    {
      code: "missing-verification",
      severity: "warning",
      message: "The answer should include a concrete verification step.",
    },
  ];
}

function createSafeFallback(request: ReasoningRequest, issues: ResponseVerificationIssue[], answer: string) {
  const hasProviderLeak = issues.some((issue) => issue.code === "raw-provider-error");
  if (hasProviderLeak) {
    return "The answer is still queued. Foundry will keep trying.";
  }

  const contradictsCurrentEvidence = issues.some((issue) => issue.code === "contradicts-current-evidence" || issue.code === "stale-troubleshooting");
  if (contradictsCurrentEvidence) {
    return "The answer is still queued. Foundry will keep trying.";
  }

  const blocker = request.engineeringState.currentBlocker;
  const verify = request.engineeringState.recommendedNextAction;
  const sanitized = answer.replace(/```[\s\S]*?```/g, "").replace(/\s+/g, " ").trim();

  return [
    blocker && blocker !== "No exact current blocker is proven by the available evidence." ? `The current blocker is ${blocker}` : "I need to keep this grounded in the current evidence.",
    sanitized ? sanitized.slice(0, 700) : "",
    verify ? `Verify by doing this next: ${verify}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function importantTerms(value: string) {
  const stop = new Set(["error", "failed", "failure", "current", "blocker", "message", "this", "that", "with", "from", "could", "cannot", "found"]);
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/`([^`]+)`/g, " $1 ")
        .replace(/[^a-z0-9_.#/-]+/g, " ")
        .split(/\s+/)
        .filter((term) => term.length >= 5 && !stop.has(term)),
    ),
  );
}
