import type { ConversationContext, InvestigationContext, ReasoningAttachment } from "@/lib/ai/context";
import type { TroubleshootingEvidenceSnapshot } from "@/lib/ai/troubleshooting";
import type { MissionState, OutcomeType } from "@/lib/mission-engine";

export type ProjectStateConfidence = "low" | "medium" | "high";

export type ProjectStateHypothesis = {
  cause: string;
  confidence: number;
  evidence: string[];
  recommendedAction: string;
};

export type ProjectState = {
  projectName: string;
  languages: string[];
  framework: string;
  buildSystem: string;
  packageManager: string;
  relevantFilesFound: string[];
  currentBlocker: string;
  previousFixesAttempted: string[];
  contradictionsFound: string[];
  hypotheses: ProjectStateHypothesis[];
  confidenceLevel: ProjectStateConfidence;
  investigationMemory: string[];
};

type ProjectEvidence = {
  fileName: string;
  rawText: string;
};

export function buildProjectState(input: {
  missionTitle: string;
  desiredOutcome: OutcomeType;
  userMessage: string;
  priorMessages?: Array<{ author: string; body: string }>;
  attachments: ReasoningAttachment[];
  investigation: InvestigationContext;
  troubleshooting: TroubleshootingEvidenceSnapshot;
  conversationContext: ConversationContext;
  workMemory?: MissionState["workMemory"];
}): ProjectState {
  const evidence = collectProjectEvidence(input.attachments, input.userMessage, input.priorMessages ?? []);
  const projectName = inferProjectName(input.missionTitle, input.conversationContext, evidence);
  const languages = inferLanguages(evidence);
  const framework = inferFramework(evidence);
  const buildSystem = inferBuildSystem(evidence);
  const packageManager = inferPackageManager(evidence);
  const currentBlocker =
    input.troubleshooting.currentBlocker?.excerpt ||
    input.conversationContext.workflowState.blockedStep ||
    input.conversationContext.investigationState.currentDiagnosis ||
    "No exact current blocker is proven yet.";
  const previousFixesAttempted = inferPreviousFixes(input.workMemory, input.investigation, input.conversationContext);
  const contradictionsFound = detectContradictions({
    userMessage: input.userMessage,
    currentBlocker,
    evidence,
    languages,
    framework,
    buildSystem,
    packageManager,
  });
  const hypotheses = rankHypotheses({
    userMessage: input.userMessage,
    currentBlocker,
    evidence,
    languages,
    framework,
    buildSystem,
    packageManager,
    contradictionsFound,
  });
  const relevantFilesFound = selectRelevantFiles(evidence, currentBlocker, input.userMessage);
  const confidenceLevel = confidenceFor(evidence, hypotheses, contradictionsFound, input.troubleshooting.active);

  return {
    projectName,
    languages,
    framework,
    buildSystem,
    packageManager,
    relevantFilesFound,
    currentBlocker,
    previousFixesAttempted,
    contradictionsFound,
    hypotheses,
    confidenceLevel,
    investigationMemory: [
      `Project: ${projectName}`,
      `Stack: ${languages.join(", ") || "unknown language"}; ${framework}; ${buildSystem}; ${packageManager}`,
      `Blocker: ${currentBlocker}`,
      hypotheses[0] ? `Top hypothesis: ${hypotheses[0].cause}` : "Top hypothesis: not enough evidence yet.",
      contradictionsFound.length ? `Contradictions: ${contradictionsFound.join(" | ")}` : "Contradictions: none detected.",
      previousFixesAttempted.length ? `Previous fixes: ${previousFixesAttempted.join(" | ")}` : "Previous fixes: none captured.",
    ],
  };
}

export function formatProjectState(state: ProjectState) {
  return [
    "Project state object:",
    `- projectName: ${state.projectName}`,
    `- language(s): ${state.languages.join(", ") || "unknown"}`,
    `- framework: ${state.framework}`,
    `- buildSystem: ${state.buildSystem}`,
    `- package manager: ${state.packageManager}`,
    `- relevant files found: ${state.relevantFilesFound.join(", ") || "none"}`,
    `- current blocker: ${state.currentBlocker}`,
    `- confidence level: ${state.confidenceLevel}`,
    "Previous fixes attempted:",
    formatList(state.previousFixesAttempted, "none captured"),
    "Contradictions found:",
    formatList(state.contradictionsFound, "none detected"),
    "Ranked hypotheses:",
    state.hypotheses.length
      ? state.hypotheses
          .map(
            (hypothesis, index) =>
              `${index + 1}. ${hypothesis.cause} (${hypothesis.confidence}/100). Evidence: ${
                hypothesis.evidence.join("; ") || "not enough evidence"
              }. Smallest safe action: ${hypothesis.recommendedAction}`,
          )
          .join("\n")
      : "1. No ranked hypothesis yet. Ask for or inspect the smallest missing project evidence.",
    "Investigation memory to carry forward:",
    formatList(state.investigationMemory, "none"),
  ].join("\n");
}

export function failingIdentifierFromProjectState(state: ProjectState) {
  const text = `${state.currentBlocker}\n${state.hypotheses.map((item) => item.cause).join("\n")}`;
  return extractFailingIdentifier(text);
}

function collectProjectEvidence(attachments: ReasoningAttachment[], userMessage: string, priorMessages: Array<{ author: string; body: string }>) {
  const attached = attachments
    .filter((attachment) => attachment.uploadStatus === "readable" && attachment.rawText?.trim())
    .map((attachment) => ({
      fileName: attachment.fileName,
      rawText: attachment.rawText,
    }));

  const pastedFiles = [
    ...extractPastedProjectFiles(userMessage),
    ...priorMessages
      .slice(-8)
      .filter((message) => message.author !== "Foundry")
      .flatMap((message) => extractPastedProjectFiles(message.body)),
  ];
  return mergeProjectStateEvidence([...attached, ...pastedFiles]);
}

function mergeProjectStateEvidence(evidence: ProjectEvidence[]) {
  const merged = new Map<string, ProjectEvidence>();

  for (const item of evidence) {
    const normalized = item.rawText.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized) continue;
    const key = `${item.fileName.toLowerCase()}:${normalized}`;
    if (!merged.has(key)) merged.set(key, item);
  }

  return Array.from(merged.values());
}

function extractPastedProjectFiles(message: string): ProjectEvidence[] {
  const knownNames = Array.from(
    message.matchAll(/\b(?:[\w.-]+[\\/])?[\w.-]+\.(?:gradle\.kts|gradle|json|xml|toml|ya?ml|properties|java|kt|ts|tsx|js|jsx|mjs|cjs|py|cs|go|rs|php|rb)\b/gi),
    (match) => match[0],
  );

  if (!knownNames.length) return [];

  return knownNames.slice(0, 8).map((fileName) => ({
    fileName,
    rawText: message,
  }));
}

function inferProjectName(fallback: string, conversationContext: ConversationContext, evidence: ProjectEvidence[]) {
  const combined = evidence.map((item) => item.rawText).join("\n");
  const packageName = combined.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
  const gradleName = combined.match(/\brootProject\.name\s*=\s*["']([^"']+)["']/)?.[1];
  const androidNamespace = combined.match(/\bnamespace\s*=\s*["']([^"']+)["']|\bnamespace\s+["']([^"']+)["']/)?.[1];
  return packageName || gradleName || androidNamespace || conversationContext.currentWorkItem.title || fallback || "Current project";
}

function inferLanguages(evidence: ProjectEvidence[]) {
  const sourceText = evidence.map((item) => `${item.fileName}\n${item.rawText}`).join("\n");
  const hits: Array<[string, number]> = [
    ["Java", countMatches(sourceText, /\.java\b|\bpublic\s+class\b|\bimport\s+java\.|\bimport\s+android\./gi)],
    ["Kotlin", countMatches(sourceText, /\.kt\b|\bfun\s+\w+\s*\(|\bval\s+\w+\s*=|\bimport\s+kotlin\./gi)],
    ["Gradle Kotlin DSL", countMatches(sourceText, /\.gradle\.kts\b|\bsettings\.gradle\.kts\b/gi)],
    ["Gradle Groovy DSL", countMatches(sourceText, /(?<!\.kts)\.gradle\b|\bsettings\.gradle\b/gi)],
    ["TypeScript", countMatches(sourceText, /\.tsx?\b|\binterface\s+\w+|\btype\s+\w+\s*=|\bimport\s+type\b/gi)],
    ["JavaScript", countMatches(sourceText, /\.jsx?\b|\.mjs\b|\.cjs\b|\bmodule\.exports\b|\brequire\s*\(/gi)],
    ["Python", countMatches(sourceText, /\.py\b|\bdef\s+\w+\s*\(|\bimport\s+[a-z_][\w.]*/gi)],
    ["C#", countMatches(sourceText, /\.cs\b|\busing\s+System\b|\bnamespace\s+\w+/gi)],
    ["Go", countMatches(sourceText, /\.go\b|\bpackage\s+main\b|\bfunc\s+\w+\s*\(/gi)],
    ["Rust", countMatches(sourceText, /\.rs\b|\bfn\s+\w+\s*\(|\bCargo\.toml\b/gi)],
    ["PHP", countMatches(sourceText, /\.php\b|<\?php|\bcomposer\.json\b/gi)],
  ];

  return hits
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

function inferFramework(evidence: ProjectEvidence[]) {
  const text = evidence.map((item) => `${item.fileName}\n${item.rawText}`).join("\n");
  if (/\bcom\.android\.(application|library)\b|\bAndroidManifest\.xml\b|\bandroidx\.|\bcompileSdk\b|\bminSdk\b/i.test(text)) return "Android";
  if (/"next"\s*:|next\.config\.[cm]?[jt]s|\bfrom\s+["']next\//i.test(text)) return "Next.js";
  if (/"react"\s*:|\bfrom\s+["']react["']|\bReact\./i.test(text)) return "React";
  if (/"vue"\s*:|vue\.config|\.vue\b/i.test(text)) return "Vue";
  if (/"svelte"\s*:|svelte\.config/i.test(text)) return "Svelte";
  if (/\bpom\.xml\b|\.java\b|\.kt\b/i.test(text)) return "plain JVM";
  if (/"express"\s*:|\bfrom\s+["']express["']|\brequire\s*\(["']express["']\)/i.test(text)) return "Express/Node";
  return "unknown";
}

function inferBuildSystem(evidence: ProjectEvidence[]) {
  const text = evidence.map((item) => `${item.fileName}\n${item.rawText}`).join("\n");
  const systems: string[] = [];
  if (/\.gradle\.kts\b|settings\.gradle\.kts\b/i.test(text)) systems.push("Gradle Kotlin DSL");
  if (/(?<!\.kts)\.gradle\b|settings\.gradle\b/i.test(text)) systems.push("Gradle Groovy DSL");
  if (/\bpom\.xml\b/i.test(text)) systems.push("Maven");
  if (/\bpackage\.json\b|"(scripts|dependencies|devDependencies)"\s*:/i.test(text)) systems.push("npm scripts");
  if (/\btsconfig\.json\b/i.test(text)) systems.push("TypeScript compiler");
  if (/\bCargo\.toml\b/i.test(text)) systems.push("Cargo");
  if (/\bgo\.mod\b/i.test(text)) systems.push("Go modules");
  if (/\bcomposer\.json\b/i.test(text)) systems.push("Composer");
  return systems.join(" + ") || "unknown";
}

function inferPackageManager(evidence: ProjectEvidence[]) {
  const text = evidence.map((item) => `${item.fileName}\n${item.rawText}`).join("\n");
  if (/\bpnpm-lock\.yaml\b|"packageManager"\s*:\s*"pnpm@/i.test(text)) return "pnpm";
  if (/\byarn\.lock\b|"packageManager"\s*:\s*"yarn@/i.test(text)) return "Yarn";
  if (/\bpackage-lock\.json\b|\bpackage\.json\b|"packageManager"\s*:\s*"npm@/i.test(text)) return "npm";
  if (/\bgradle\/wrapper\b|\bgradlew\b|\.gradle(?:\.kts)?\b/i.test(text)) return "Gradle";
  if (/\bpom\.xml\b/i.test(text)) return "Maven";
  if (/\bcomposer\.lock\b|\bcomposer\.json\b/i.test(text)) return "Composer";
  if (/\bCargo\.lock\b|\bCargo\.toml\b/i.test(text)) return "Cargo";
  return "unknown";
}

function detectContradictions(input: {
  userMessage: string;
  currentBlocker: string;
  evidence: ProjectEvidence[];
  languages: string[];
  framework: string;
  buildSystem: string;
  packageManager: string;
}) {
  const text = input.evidence.map((item) => `${item.fileName}\n${item.rawText}`).join("\n");
  const contradictions: string[] = [];
  const failing = extractFailingIdentifier(`${input.userMessage}\n${input.currentBlocker}`);
  const usage = failing ? analyzeIdentifierUsage(failing.id, input.evidence) : undefined;
  const hasJavaSource = hasMeaningfulJavaSource(input.evidence);
  const hasKotlinSource = hasMeaningfulKotlinSource(input.evidence);

  if (failing && usage?.declarationFound && !usage.usedOutsideDeclarations) {
    contradictions.push(`The failing identifier \`${failing.id}\` is declared in project evidence but no meaningful usage was found outside declarations.`);
  }

  if (hasJavaSource && !hasKotlinSource && /\borg\.jetbrains\.kotlin|kotlin\s*\(/i.test(text)) {
    contradictions.push("The project evidence shows Java/Android source but no Kotlin source, while Kotlin tooling is declared.");
  }

  if (input.framework === "plain JVM" && /\bcom\.android\.(application|library)\b|\bcompileSdk\b/i.test(text)) {
    contradictions.push("The project was otherwise detected as plain JVM, but Android Gradle configuration appears in project files.");
  }

  if (input.framework === "Android" && /\bpom\.xml\b/i.test(text) && !/\.gradle/i.test(text)) {
    contradictions.push("Android indicators appear without visible Gradle project files, so the build system evidence is incomplete.");
  }

  if (/"next"\s*:/i.test(text) && !/"react"\s*:/i.test(text)) {
    contradictions.push("Next.js is present but React is not visible in the provided package evidence.");
  }

  if (/\bpackage\.json\b/i.test(text) && input.packageManager === "unknown") {
    contradictions.push("Node package metadata appears but no package manager or lockfile was detected.");
  }

  return unique(contradictions);
}

function rankHypotheses(input: {
  userMessage: string;
  currentBlocker: string;
  evidence: ProjectEvidence[];
  languages: string[];
  framework: string;
  buildSystem: string;
  packageManager: string;
  contradictionsFound: string[];
}): ProjectStateHypothesis[] {
  const combined = `${input.userMessage}\n${input.currentBlocker}`;
  const hypotheses: ProjectStateHypothesis[] = [];
  const failing = extractFailingIdentifier(combined);
  const usage = failing ? analyzeIdentifierUsage(failing.id, input.evidence) : undefined;

  if (failing && usage?.declarationFound && !usage.usedOutsideDeclarations) {
    hypotheses.push({
      cause: `Unused or mismatched declaration for \`${failing.id}\` is blocking the build/install.`,
      confidence: usage.hasEnoughEvidence ? 88 : 64,
      evidence: [
        `blocker names \`${failing.id}\``,
        `declaration found in ${usage.declarationFiles.join(", ")}`,
        "no usage found outside declaration-like lines",
      ],
      recommendedAction: "Remove the unnecessary declaration first, then rerun the same build/check.",
    });
  }

  if (failing && usage?.usedOutsideDeclarations) {
    hypotheses.push({
      cause: `Required dependency/toolchain \`${failing.id}\` is present but not resolving or configured correctly.`,
      confidence: 76,
      evidence: [`blocker names \`${failing.id}\``, `usage found in ${usage.usageFiles.join(", ")}`],
      recommendedAction: "Fix the version, repository, install, import, or plugin configuration that provides the required identifier.",
    });
  }

  if (/\bUnresolved reference\b|\bexpected\b|\bUnexpected\b|\bSyntaxError\b|\bParseError\b/i.test(combined)) {
    hypotheses.push({
      cause: "The current blocker may be syntax or DSL shape, not a missing download.",
      confidence: input.buildSystem.includes("Gradle") || input.buildSystem.includes("TypeScript") ? 70 : 58,
      evidence: ["error text indicates unresolved/syntax parsing", `detected build system: ${input.buildSystem}`],
      recommendedAction: "Inspect the exact file/line and make the smallest syntax/config-block correction.",
    });
  }

  if (/\bPlugin .* was not found|Could not resolve|Cannot find module|Module not found|package .* not found|dependency .* not found/i.test(combined) && !usage?.declarationFound) {
    hypotheses.push({
      cause: "A dependency/plugin/package named by the error is missing from visible project configuration or declared in an unprovided file.",
      confidence: input.evidence.length ? 62 : 42,
      evidence: [`detected stack: ${input.framework}; ${input.buildSystem}; ${input.packageManager}`],
      recommendedAction: "Search the project for the exact identifier and inspect the config file that declares or imports it before adding anything new.",
    });
  }

  if (input.contradictionsFound.length) {
    hypotheses.push({
      cause: "Project evidence contains stack/config contradictions, so the safest fix is to remove or align the mismatched configuration.",
      confidence: 80,
      evidence: input.contradictionsFound,
      recommendedAction: "Prefer the smallest alignment/removal that matches the detected source files and build system.",
    });
  }

  if (!hypotheses.length) {
    hypotheses.push({
      cause: "The active blocker is not specific enough to choose an exact fix from project evidence.",
      confidence: input.evidence.length ? 45 : 25,
      evidence: input.evidence.length ? [`visible files: ${input.evidence.map((item) => item.fileName).join(", ")}`] : ["no readable project files"],
      recommendedAction: "Ask for or inspect the smallest missing file/log that contains the exact failing line and relevant config.",
    });
  }

  return hypotheses
    .map((hypothesis) => ({
      ...hypothesis,
      confidence: Math.max(0, Math.min(100, Math.round(hypothesis.confidence))),
      evidence: unique(hypothesis.evidence).slice(0, 5),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

function inferPreviousFixes(workMemory: MissionState["workMemory"] | undefined, investigation: InvestigationContext, conversationContext: ConversationContext) {
  return unique([
    ...(workMemory?.completedWork ?? []),
    ...(workMemory?.resolvedErrors ?? []).map((item) => `Resolved earlier: ${item}`),
    ...(workMemory?.rejectedHypotheses ?? []).map((item) => `Rejected earlier: ${item}`),
    ...investigation.previousAssistantNotes.slice(-3),
    ...conversationContext.workflowState.alreadyTold.slice(-4),
    ...conversationContext.workflowState.alreadyFailed.slice(-4).map((item) => `Failed earlier: ${item}`),
  ])
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-10);
}

function selectRelevantFiles(evidence: ProjectEvidence[], blocker: string, userMessage: string) {
  const terms = importantTerms(`${blocker}\n${userMessage}`);
  return evidence
    .map((item) => {
      const searchable = `${item.fileName}\n${item.rawText}`.toLowerCase();
      const hits = terms.filter((term) => searchable.includes(term)).length;
      const configScore = /\b(package\.json|build\.gradle|settings\.gradle|pom\.xml|AndroidManifest\.xml|tsconfig\.json|next\.config|vite\.config|Cargo\.toml|go\.mod|composer\.json)\b/i.test(
        item.fileName,
      )
        ? 5
        : 0;
      return { fileName: item.fileName, score: hits + configScore };
    })
    .filter((item) => item.score > 0 || evidence.length <= 5)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.fileName)
    .filter((fileName, index, array) => array.indexOf(fileName) === index)
    .slice(0, 12);
}

function confidenceFor(evidence: ProjectEvidence[], hypotheses: ProjectStateHypothesis[], contradictions: string[], troubleshootingActive: boolean): ProjectStateConfidence {
  const top = hypotheses[0]?.confidence ?? 0;
  if (top >= 80 && evidence.length && (troubleshootingActive || contradictions.length)) return "high";
  if (top >= 55 || evidence.length >= 2) return "medium";
  return "low";
}

function extractFailingIdentifier(text: string) {
  const candidates = [
    text.match(/Plugin \[id:\s*['"]([^'"]+)['"](?:,\s*version:\s*['"]([^'"]+)['"])?/i),
    text.match(/\bid\s*\(\s*["']([^"']+)["']\s*\)\s*version\s*["']([^"']+)["']/i),
    text.match(/\b(?:Cannot find module|Module not found|Could not resolve|Could not find|package)\s+['"]?(@?[\w.-]+(?:\/[\w.-]+)?(?::[\w.-]+)?)['"]?/i),
  ];

  for (const candidate of candidates) {
    if (candidate?.[1]) return { id: candidate[1], version: candidate[2] ?? "" };
  }

  return undefined;
}

function analyzeIdentifierUsage(identifier: string, evidence: ProjectEvidence[]) {
  const declarationFiles = new Set<string>();
  const usageFiles = new Set<string>();
  const needle = identifier.toLowerCase();

  evidence.forEach((item) => {
    item.rawText.split(/\r?\n/).forEach((line) => {
      if (!line.toLowerCase().includes(needle)) return;
      if (looksLikeDeclarationLine(line)) {
        declarationFiles.add(item.fileName);
        return;
      }
      usageFiles.add(item.fileName);
    });
  });

  return {
    declarationFound: declarationFiles.size > 0,
    usedOutsideDeclarations: usageFiles.size > 0,
    hasEnoughEvidence: evidence.length > 0,
    declarationFiles: Array.from(declarationFiles),
    usageFiles: Array.from(usageFiles),
  };
}

function looksLikeDeclarationLine(line: string) {
  return /\b(id|alias|classpath|implementation|api|compileOnly|runtimeOnly|testImplementation|dependency|dependencies|plugins|version|devDependencies|peerDependencies|optionalDependencies|require|import)\b/i.test(
    line,
  );
}

function hasMeaningfulJavaSource(evidence: ProjectEvidence[]) {
  return evidence.some((item) => /\.java$/i.test(item.fileName) || /\bpublic\s+class\b|\bimport\s+(?:java|androidx?|com\.)\./.test(item.rawText));
}

function hasMeaningfulKotlinSource(evidence: ProjectEvidence[]) {
  return evidence.some((item) => /\.kt$/i.test(item.fileName) || /\bfun\s+\w+\s*\(|\bclass\s+\w+\s*:\s*|\bimport\s+kotlin\./.test(item.rawText));
}

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
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
        .filter((term) => term.length >= 4 && !stop.has(term))
        .slice(0, 80),
    ),
  );
}

function formatList(items: string[], empty: string) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function unique(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  items.forEach((item) => {
    const value = item.replace(/\s+/g, " ").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    result.push(value);
  });
  return result;
}
