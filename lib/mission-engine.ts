import type { WorkspaceNote } from "@/components/WorkspaceShell";
import { artifactKindForOutcome, titleFromContent } from "@/lib/artifacts";
import type { CommandApprovalScope } from "@/lib/ai/mission/command-permissions";

export type { CommandApprovalScope } from "@/lib/ai/mission/command-permissions";
import { classifyEvidenceKind, type WorkspaceAttachment } from "@/lib/files";
import type { ExecutionMissionVerification, FactoryCommandEvent, FactoryExecutionEvent, FactoryObjectiveChecklistItem } from "@/lib/factory/types";
import type { SourceReference } from "@/lib/sources/types";
import type { VisualArtifact } from "@/lib/visual-artifacts";

export type { ExecutionMissionVerification } from "@/lib/factory/types";

export type MissionStatus = "idle" | "active" | "waitingForInput" | "complete" | "cancelled";
export type MissionStage =
  | "intake"
  | "classified"
  | "waitingForReasoningEngine"
  | "waitingForPreviewEngine"
  | "waitingForProjectTarget"
  | "waitingForFiles"
  | "waitingForExecutionEngine"
  | "ready";
export type OutcomeType =
  | "answer"
  | "sketch"
  | "mockup"
  | "diagram"
  | "code"
  | "project"
  | "fileAnalysis"
  | "patch"
  | "command"
  | "report"
  | "export"
  | "conversation";

export type FollowUpType =
  | "newMission"
  | "followUp"
  | "correction"
  | "clarification"
  | "approval"
  | "cancellation"
  | "questionAboutLastResult";

export type CreatedArtifact = {
  id: string;
  sourceMessageId: string;
  type: OutcomeType;
  kind: ReturnType<typeof artifactKindForOutcome>;
  title: string;
  body: string;
  description: string;
  visualArtifact?: VisualArtifact;
  createdAt: string;
};

export type ExecutionMissionState =
  | "idle"
  | "understanding"
  | "planning"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "executing"
  | "verifying"
  | "blocked"
  | "failed"
  | "complete"
  | "cancelled"
  | "undoing";

export type ExecutionMissionVerificationStatus = "none" | "passed" | "failed" | "unverified";

export type ExecutionMissionFileTouch = {
  path: string;
  diff?: string;
  verified: boolean;
  status?: "created" | "edited" | "uploaded";
  evidence?: string;
};

export type ExecutionMissionCommandRun = FactoryCommandEvent & {
  approved_by?: "user" | "system" | "project-scope" | "exact-command" | "auto-safe";
  approval_scope?: CommandApprovalScope;
  /** Always populated, plain language: what was actually granted, e.g. "Always allowed: exact command `npm install xlsx`, this project only." Shown identically in the live timeline and history panel. */
  approval_scope_label: string;
};

export type ExecutionMission = {
  id: string;
  title: string;
  source_requirements: string[];
  state: ExecutionMissionState;
  verification_status: ExecutionMissionVerificationStatus;
  plan: FactoryObjectiveChecklistItem[];
  files_touched: ExecutionMissionFileTouch[];
  commands_run: ExecutionMissionCommandRun[];
  verification: ExecutionMissionVerification[];
  blocked_reason?: string;
  undo_snapshot?: string;
  summary: string;
  parent_mission_id?: string;
  request_message_id?: string;
  result_message_id?: string;
  timeline: FactoryExecutionEvent[];
  created_at: string;
  updated_at: string;
};

export type MissionState = {
  missionId: string;
  conversationTitle: string;
  title: string;
  objective: string;
  status: MissionStatus;
  currentStage: MissionStage;
  desiredOutcome: OutcomeType;
  artifactType: OutcomeType;
  messages: WorkspaceNote[];
  attachments: WorkspaceAttachment[];
  createdArtifacts: CreatedArtifact[];
  sources: SourceReference[];
  lastResult: string;
  executionMissions: ExecutionMission[];
  activeExecutionMissionId?: string;
  workMemory: {
    currentGoal: string;
    currentBlocker: string;
    completedWork: string[];
    resolvedErrors: string[];
    rejectedHypotheses: string[];
    latestEvidence: string[];
    relevantFiles: string[];
    recommendedNextAction: string;
    summary: string;
    updatedAt: string;
  };
  followUpContext: {
    type: FollowUpType;
    summary: string;
    previousMissionId?: string;
  };
  liveWorkEvents: string[];
  createdAt: string;
  updatedAt: string;
};

type Classification = {
  outcome: OutcomeType;
  followUpType: FollowUpType;
  isNewMission: boolean;
};

type ApplyUserMessageOptions = {
  assistantBody?: string;
  includeAssistantMessage?: boolean;
};

export type WorkThreadDecision = "continue" | "newWorkItem" | "ambiguous";

const outcomeLabels: Record<OutcomeType, string> = {
  answer: "Answer",
  sketch: "Sketch",
  mockup: "Mockup",
  diagram: "Diagram",
  code: "Code",
  project: "Project",
  fileAnalysis: "File analysis",
  patch: "Patch",
  command: "Command",
  report: "Report",
  export: "Export",
  conversation: "Conversation",
};

const outcomeEvents: Record<OutcomeType, string[]> = {
  answer: ["Reading your question", "Checking current task context", "Preparing answer"],
  sketch: ["Sketch request captured", "Preview support comes next"],
  mockup: ["Design request captured", "Preview support comes next"],
  diagram: ["Diagram request captured", "Diagram support comes next"],
  code: ["Code request captured", "Code support comes next"],
  project: ["Project request captured", "Project creation comes next"],
  fileAnalysis: ["File review request captured", "File review support comes next"],
  patch: ["Change request captured", "File editing comes next"],
  command: ["Command request captured", "Command running comes next"],
  report: ["Report request captured", "Report writing comes next"],
  export: ["Export request captured", "Export support comes next"],
  conversation: ["Reading your question", "Checking current task context", "Preparing answer"],
};

const stopWords = new Set([
  "a",
  "about",
  "add",
  "an",
  "and",
  "are",
  "as",
  "be",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "have",
  "here",
  "how",
  "i",
  "in",
  "is",
  "it",
  "make",
  "me",
  "my",
  "now",
  "of",
  "on",
  "or",
  "please",
  "that",
  "the",
  "this",
  "to",
  "using",
  "would",
  "what",
  "with",
  "who",
  "you",
]);

const titleStopWords = new Set([
  ...stopWords,
  "able",
  "build",
  "code",
  "create",
  "debug",
  "design",
  "docs",
  "documentation",
  "draw",
  "explain",
  "fix",
  "full",
  "give",
  "got",
  "help",
  "internally",
  "need",
  "nice",
  "please",
  "real",
  "replace",
  "show",
  "simple",
  "sketch",
  "there",
  "under",
  "wireframe",
  "mockup",
  "project",
  "website",
  "site",
  "want",
  "work",
]);

const genericTitleWords = new Set(["app", "application", "site", "system", "tool"]);
const titleAnchorWords = new Set([
  "admin",
  "api",
  "csv",
  "dashboard",
  "dns",
  "inventory",
  "json",
  "landing",
  "login",
  "page",
  "shopping",
  "shop",
  "store",
  "ecommerce",
  "catalog",
  "portal",
  "signup",
  "website",
  "xml",
]);

const topicDomains: Record<string, string[]> = {
  network: ["ping", "ip", "network", "router", "dns", "flush", "windows", "cmd", "command", "prompt", "pc", "device", "restart", "tracert", "trace", "timeout", "timed"],
  productPage: ["signup", "login", "page", "landing", "form", "button", "google", "blue", "layout", "screen", "design"],
  data: ["json", "csv", "log", "value", "field", "setting", "feature", "config", "terminal"],
  react: ["react", "next", "component", "frontend", "hook", "state", "props", "route", "tailwind"],
  project: ["project", "app", "website", "site", "dashboard", "inventory", "crm", "portal", "saas", "backend", "frontend"],
  execution: ["run", "execute", "terminal", "command", "install", "build", "test", "deploy"],
};

const stableTitles: Array<[RegExp, string]> = [
  [/\b(login|sign in|signin)\b.*\b(sketch|wireframe|draw)\b|\b(sketch|wireframe|draw)\b.*\b(login|sign in|signin)\b/, "Login Page Sketch"],
  [/\b(signup|sign up|registration)\b.*\b(sketch|wireframe|draw)\b|\b(sketch|wireframe|draw)\b.*\b(signup|sign up|registration)\b/, "Signup Page Sketch"],
  [/\b(gym|fitness|membership)\b.*\b(signup|sign up|registration|join)\b|\b(signup|sign up|registration)\b.*\b(gym|fitness|membership)\b/, "Gym Membership Signup"],
  [/\b(shop|shopping|store|ecommerce|commerce|catalog|product|products|cart|checkout|collection|retail)\b.*\b(sketch|wireframe|draw)\b|\b(sketch|wireframe|draw)\b.*\b(shop|shopping|store|ecommerce|commerce|catalog|product|products|cart|checkout|collection|retail)\b/, "Shopping Page Sketch"],
  [/\b(react)\b.*\b(dashboard)\b|\b(dashboard)\b.*\b(react)\b/, "React Dashboard"],
  [/\b(ping|ip address|device|network|router|dns|windows|cmd|command prompt|pc)\b/, "Windows Network Troubleshooting"],
  [/\b(json|terminal|config|configuration|settings)\b/, "Terminal Configuration Investigation"],
  [/\b(dashboard|analytics|admin)\b/, "Dashboard Design"],
  [/\b(react|next\.?js|frontend|component)\b.*\b(fix|repair|bug|broken|error)\b|\b(fix|repair)\b.*\b(react|next\.?js|frontend|component)\b/, "React Application Repair"],
  [/\b(draw|sketch|wireframe)\b/, "Visual Sketch"],
  [/\b(design|mockup|prototype)\b/, "Product Design"],
  [/\b(analyze|inspect|review)\b/, "Technical Investigation"],
  [/\b(fix|repair|debug|error|bug)\b/, "Technical Repair"],
];

const initialMissionDate = new Date("2026-06-28T13:05:00.000Z");

export function createInitialMission(now = initialMissionDate): MissionState {
  const iso = now.toISOString();

  return {
    missionId: `mission-${now.getTime()}`,
    conversationTitle: "New Work Item",
    title: "New Work Item",
    objective: "",
    status: "active",
    currentStage: "ready",
    desiredOutcome: "conversation",
    artifactType: "conversation",
    messages: [],
    attachments: [],
    createdArtifacts: [],
    sources: [],
    lastResult: "",
    executionMissions: [],
    activeExecutionMissionId: undefined,
    workMemory: createEmptyWorkMemory(iso),
    followUpContext: {
      type: "newMission",
      summary: "Ready for a new work item.",
    },
    liveWorkEvents: [],
    createdAt: iso,
    updatedAt: iso,
  };
}

export function classifyMessage(message: string, mission: MissionState): Classification {
  const text = message.trim().toLowerCase();
  const hasActiveMission = mission.status !== "idle" && mission.status !== "cancelled";
  const outcome = classifyOutcome(text);
  const followUpType = classifyFollowUp(text, mission);
  const isNewMission = followUpType === "newMission" || !hasActiveMission;

  return {
    outcome,
    followUpType,
    isNewMission,
  };
}

export function applyUserMessage(
  mission: MissionState,
  message: string,
  attachments: WorkspaceAttachment[],
  options: ApplyUserMessageOptions = {},
): MissionState {
  const now = new Date();
  const iso = now.toISOString();
  const classification = classifyMessage(message, mission);
  const baseMission = classification.isNewMission ? createMissionFromMessage(message, classification.outcome, now) : mission;
  const title = classification.isNewMission ? createMissionTitle(message, classification.outcome) : baseMission.title;
  const conversationTitle = classification.isNewMission ? title : mission.conversationTitle;
  const objective = classification.isNewMission ? message : mergeObjective(baseMission.objective, message, classification.followUpType);
  const effectiveOutcome = resolveEffectiveOutcome(classification);
  const stage = stageFor(effectiveOutcome, classification.followUpType);
  const lastResult = options.assistantBody ?? createUserFacingUpdate(classification, effectiveOutcome);
  const events = eventsFor(effectiveOutcome, classification.followUpType);
  const messageAttachments = attachments.map((attachment) => ({
    ...attachment,
    missionId: baseMission.missionId,
  }));
  const userNote = createMessage("You", "ME", "human", message, now, undefined, messageAttachments);
  const userNoteAttachments = messageAttachments.map((attachment) => ({
    ...attachment,
    messageId: userNote.id,
  }));
  const finalUserNote = {
    ...userNote,
    attachments: userNoteAttachments,
  };
  const systemNote = createMessage("Foundry", "FW", "system", lastResult, now);
  const visibleMessages = baseMission.messages;
  const nextMessages = options.includeAssistantMessage === false ? [...visibleMessages, finalUserNote] : [...visibleMessages, finalUserNote, systemNote];
  const nextAttachments = mergeAttachments(baseMission.attachments, userNoteAttachments);

  return {
    ...baseMission,
    conversationTitle,
    title,
    objective,
    status: statusFor(classification.followUpType),
    currentStage: stage,
    desiredOutcome: effectiveOutcome,
    artifactType: effectiveOutcome,
    messages: nextMessages,
    attachments: nextAttachments,
    createdArtifacts: baseMission.createdArtifacts,
    lastResult,
    workMemory: classification.isNewMission ? createEmptyWorkMemory(iso) : baseMission.workMemory,
    followUpContext: {
      type: classification.followUpType,
      summary: followUpSummary(classification.followUpType, effectiveOutcome),
      previousMissionId: classification.isNewMission ? mission.missionId : undefined,
    },
    liveWorkEvents: events,
    updatedAt: iso,
  };
}

export function appendAssistantMessage(
  mission: MissionState,
  body: string,
  now = new Date(),
  sources: SourceReference[] = [],
  visualArtifact?: VisualArtifact,
): MissionState {
  const message = {
    ...createMessage("Foundry", "FW", "system", body, now),
    sources,
    visualArtifact,
  };
  const artifact = createArtifactFromMessage(mission, message, now);
  const workMemory = updateWorkMemory(mission, body, now);

  return {
    ...mission,
    messages: [...mission.messages, message],
    createdArtifacts: [artifact, ...mission.createdArtifacts],
    sources: mergeSources(mission.sources ?? [], sources),
    lastResult: body,
    workMemory,
    liveWorkEvents: ["Reading your question", "Checking current task context", "Preparing answer"],
    updatedAt: now.toISOString(),
  };
}

function createEmptyWorkMemory(updatedAt: string): MissionState["workMemory"] {
  return {
    currentGoal: "",
    currentBlocker: "",
    completedWork: [],
    resolvedErrors: [],
    rejectedHypotheses: [],
    latestEvidence: [],
    relevantFiles: [],
    recommendedNextAction: "",
    summary: "No working memory has been established yet.",
    updatedAt,
  };
}

function updateWorkMemory(mission: MissionState, assistantAnswer: string, now: Date): MissionState["workMemory"] {
  const previous = mission.workMemory ?? createEmptyWorkMemory(now.toISOString());
  const latestUser = [...mission.messages].reverse().find((message) => message.tone === "human" && message.body.trim())?.body ?? mission.objective;
  const latestAttachments = mission.attachments
    .slice(-6)
    .map((attachment) => `${attachment.fileName} (${attachment.evidenceKind ?? classifyEvidenceKind(attachment.fileName, attachment.fileType)}, ${attachment.uploadStatus})`);
  const completed = [
    ...previous.completedWork,
    ...extractMemoryItems(assistantAnswer, /\b(done|complete|completed|fixed|resolved|works|working|passed|success|already present|no longer)\b/i),
  ];
  const blockers = extractMemoryItems(`${latestUser}\n${assistantAnswer}`, /\b(error|failed|failure|blocked|stuck|unresolved|missing|cannot|can't|not working|current blocker)\b/i);
  const resolved = [
    ...previous.resolvedErrors,
    ...extractMemoryItems(assistantAnswer, /\b(resolved|fixed|no longer|absent|disappeared|already present|not the current blocker)\b/i),
  ];
  const rejected = [
    ...previous.rejectedHypotheses,
    ...extractMemoryItems(assistantAnswer, /\b(not|no longer|does not|isn't|wasn't|wrong|not supported|not proven|do not)\b/i),
  ];
  const nextAction =
    extractMemoryItems(assistantAnswer, /\b(next|run|verify|check|send|replace|remove|add|update|sync|build|test|open)\b/i).at(-1) ??
    previous.recommendedNextAction;
  const currentBlocker = blockers.at(-1) ?? previous.currentBlocker;
  const currentGoal = mission.objective || previous.currentGoal || latestUser;
  const memory: MissionState["workMemory"] = {
    currentGoal,
    currentBlocker,
    completedWork: uniqueMemoryItems(completed).slice(-10),
    resolvedErrors: uniqueMemoryItems(resolved).slice(-10),
    rejectedHypotheses: uniqueMemoryItems(rejected).slice(-10),
    latestEvidence: uniqueMemoryItems(latestAttachments).slice(-8),
    relevantFiles: uniqueMemoryItems(mission.attachments.map((attachment) => attachment.fileName)).slice(-12),
    recommendedNextAction: nextAction,
    summary: "",
    updatedAt: now.toISOString(),
  };

  memory.summary = [
    `Goal: ${memory.currentGoal || "Not set"}`,
    `Current blocker: ${memory.currentBlocker || "None proven"}`,
    `Completed: ${memory.completedWork.slice(-4).join(" | ") || "None confirmed"}`,
    `Resolved: ${memory.resolvedErrors.slice(-4).join(" | ") || "None"}`,
    `Rejected: ${memory.rejectedHypotheses.slice(-3).join(" | ") || "None"}`,
    `Latest evidence: ${memory.latestEvidence.join(" | ") || "None"}`,
    `Next action: ${memory.recommendedNextAction || "Answer the current request"}`,
  ].join("\n");

  return memory;
}

function extractMemoryItems(text: string, pattern: RegExp) {
  return text
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((item) =>
      item
        .replace(/^[\s>*#-]+/, "")
        .replace(/^\d+[.)]\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((item) => item.length >= 8 && item.length <= 220 && pattern.test(item));
}

function uniqueMemoryItems(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

export function shouldUseReasoning(outcome: OutcomeType) {
  return outcome === "answer" || outcome === "conversation" || outcome === "fileAnalysis" || outcome === "report" || outcome === "code";
}

export function outcomeLabel(outcome: OutcomeType) {
  return outcomeLabels[outcome];
}

function classifyOutcome(text: string): OutcomeType {
  if (isTextVisualFormatRequest(text)) return "answer";
  if (looksLikeDiagnosticPaste(text)) return "answer";
  if (/\b(diagram|flowchart|architecture diagram|er diagram|entity relationship|system flow)\b/.test(text)) return "diagram";
  if (/\b(generate|create|make|produce)\b.*\b(image|picture|visual|preview|mockup|wireframe)\b/.test(text)) return "mockup";
  if (/\b(image|picture|visual|preview)\b.*\b(for|of)\b.*\b(page|screen|ui|form|dashboard|website|site|app|layout)\b/.test(text)) return "mockup";
  if (hasVisualIntent(text, ["draw", "sketch", "wireframe"])) return "sketch";
  if (isVisualDesignRequest(text)) return "mockup";
  if (isExcerptQuestion(text)) return "answer";
  if (isInstructionalBuildRequest(text)) return "answer";
  if (/\b(build it|build this|make it real|create project)\b/.test(text)) return "project";
  if (/\b(build|create|make)\b.*\b(app|website|site)\b/.test(text) && !hasVisualIntent(text)) return "project";
  if (/\b(create|build|make)\b.*\b(signup page|sign up page|landing page|page|site)\b/.test(text) && !hasVisualIntent(text)) return "project";
  if (/\b(error|failed|failing|failure|problem|issue|troubleshoot|troubleshooting|not working|broken)\b/.test(text)) return "answer";
  if (/\b(analyze|inspect|review file|read file|attachment|json|csv|log)\b/.test(text)) return "fileAnalysis";
  if (/\b(map)\b/.test(text)) return "diagram";
  if (/\b(code|component|function|typescript|javascript|html|css|react|markup|stylesheet)\b/.test(text)) return "code";
  if (/\b(explain|where|what|when|why|how|who)\b/.test(text) || text.endsWith("?")) return "answer";
  if (/\b(patch|fix|change file|edit file)\b/.test(text)) return "patch";
  if (/\b(run|execute|command|terminal)\b/.test(text)) return "command";
  if (/\b(report|summary|findings)\b/.test(text)) return "report";
  if (/\b(export|download|pdf|csv|json)\b/.test(text)) return "export";
  return "conversation";
}

function isExcerptQuestion(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  const finalLine = lines.at(-1) ?? "";
  if (!finalLine.endsWith("?")) return false;

  return !asksToCreateBuildOrModifyFiles(finalLine);
}

function asksToCreateBuildOrModifyFiles(text: string) {
  return /\b(build it|build this|create project|make it real|turn this into|generate files|create files|scaffold|set up the project for me|apply|edit files?|modify files?|write files?)\b/.test(
    text,
  );
}

function isTextVisualFormatRequest(text: string) {
  return /\b(ascii|ascii art|text only|plain text|monospace|terminal drawing|character drawing|using characters|using text)\b/i.test(text);
}

function isInstructionalBuildRequest(text: string) {
  const asksForGuidance =
    /\b(step by step|steps?|instructions?|guide|walkthrough|roadmap|plan|approach|how to|how would|how should|are you able to|can you explain|show me how)\b/.test(
      text,
    );
  const mentionsCreating = /\b(build|create|make|develop|implement|set up|setup)\b/.test(text);
  const asksToCreateNow = asksToCreateBuildOrModifyFiles(text);

  return asksForGuidance && mentionsCreating && !asksToCreateNow;
}

function isVisualDesignRequest(text: string) {
  if (/\b(mockup|mock-up|prototype|visual design|landing page concept)\b/.test(text)) return true;
  if (/\b(image|picture|visual|preview)\b/.test(text) && /\b(page|screen|ui|ux|interface|layout|dashboard|website|site|landing|form|flow|diagram|app concept)\b/.test(text)) return true;
  if (!/\b(design|visualize|layout)\b/.test(text)) return false;

  return /\b(page|screen|ui|ux|interface|layout|mockup|wireframe|dashboard|website|site|landing|form|flow|flowchart|diagram|app concept|visual)\b/.test(text);
}

function hasVisualIntent(text: string, words = ["draw", "sketch", "wireframe", "mockup", "visualize", "layout", "image", "picture", "preview"]) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return tokens.some((token) => words.includes(token));
}

function classifyFollowUp(text: string, mission: MissionState): FollowUpType {
  if (mission.messages.length === 0) return "newMission";
  if (/\b(cancel|stop|never mind|nevermind)\b/.test(text)) return "cancellation";
  if (/\b(yes|approved|approve|go ahead|sounds good|do it)\b/.test(text)) return "approval";
  if (/\b(where was it created|where is it|what did you create|where did you put)\b/.test(text)) return "questionAboutLastResult";
  if (isActiveTroubleshootingThread(mission) && !startsClearlySeparateObjective(text)) return text.endsWith("?") ? "followUp" : "clarification";
  if (isAttachedFileContextFollowUp(text, mission)) return text.endsWith("?") ? "followUp" : "clarification";
  if (/\b(no|instead|actually|change that|use\b|should be)\b/.test(text)) return "correction";
  if (isExplicitContinuation(text)) return text.endsWith("?") ? "followUp" : "clarification";
  const threadDecision = decideWorkThread(text, mission);
  if (threadDecision === "newWorkItem") return "newMission";
  if (threadDecision === "ambiguous") return "clarification";
  if (isShortQuestionFollowUp(text, mission)) return "followUp";
  if (text.length < 80 && !text.endsWith("?")) return "clarification";
  return "followUp";
}

function isExplicitContinuation(text: string) {
  if (/\b(it|this|that|same|above|there|those|them)\b/.test(text)) return true;
  if (referencesCurrentWork(text)) return true;
  if (/^(make|add|remove|change|update|use|try|also|and)\b/.test(text)) return true;
  if (/^how about\b/.test(text)) return true;
  return false;
}

function referencesCurrentWork(text: string) {
  const words = new Set(
    text
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
  const hasCurrentReference = ["the", "this", "that", "same", "current", "above"].some((word) => words.has(word));
  const hasWorkObject = ["issue", "problem", "error", "failure", "fix", "solution", "answer", "step", "steps", "instructions"].some((word) => words.has(word));
  const asksForContinuation = ["fix", "solve", "resolve", "explain", "elaborate", "show", "give", "provide", "walk", "continue"].some((word) => words.has(word));

  return (hasCurrentReference && hasWorkObject) || (hasWorkObject && asksForContinuation);
}

function isAttachedFileContextFollowUp(text: string, mission: MissionState) {
  if (mission.attachments.length === 0) return false;

  const asksAboutEvidence =
    /\b(tag|field|value|setting|config|blob|hex|tlv|encoded|decode|represent|mean|means|difference|different|added|missing|compare|changed)\b/.test(text);
  const hasCodeLikeToken = /\b(?:[a-f0-9]{6,}|[a-z]{1,6}\d{2,}[a-z0-9]*)\b/i.test(text);
  const shortContextQuestion = text.endsWith("?") && text.split(/\s+/).filter(Boolean).length <= 10;

  return asksAboutEvidence || (hasCodeLikeToken && shortContextQuestion);
}

function isImageGenerationRequest(text: string) {
  return (
    /\b(generate|create|make|produce)\b.*\b(image|picture|visual|preview|mockup|wireframe)\b/.test(text) ||
    /\b(image|picture|visual|preview)\b.*\b(for|of)\b.*\b(page|screen|ui|form|dashboard|website|site|app|layout)\b/.test(text)
  );
}

export function decideWorkThread(message: string, mission: MissionState): WorkThreadDecision {
  const text = message.trim().toLowerCase();
  if (!text || mission.messages.length === 0 || !mission.objective.trim()) return "continue";
  if (isImageGenerationRequest(text)) return "continue";
  if (isActiveTroubleshootingThread(mission) && !startsClearlySeparateObjective(text)) return "continue";
  if (isExplicitContinuation(text) || referencesCurrentWork(text) || isShortQuestionFollowUp(text, mission) || isAttachedFileContextFollowUp(text, mission)) return "continue";

  const currentDomains = detectDomains(`${mission.objective} ${mission.title} ${mission.conversationTitle}`);
  const nextDomains = detectDomains(text);
  const objectiveAction = objectiveActionFor(text);

  if (sharesWorkContinuity(text, mission, currentDomains, nextDomains)) return "continue";

  if (objectiveAction === "strong") return "newWorkItem";
  if (objectiveAction === "weak") return "ambiguous";

  return "continue";
}

function isActiveTroubleshootingThread(mission: MissionState) {
  const recentText = [
    mission.objective,
    mission.title,
    mission.conversationTitle,
    mission.lastResult,
    ...mission.messages.slice(-8).map((message) => message.body),
    ...mission.attachments.slice(-4).map((attachment) => `${attachment.fileName} ${attachment.evidenceKind} ${attachment.rawText.slice(0, 1200)}`),
  ].join("\n");

  return (
    mission.attachments.some((attachment) => /log|source-code|text|markdown|json|xml|unknown/i.test(attachment.evidenceKind)) ||
    looksLikeDiagnosticPaste(recentText) ||
    /\b(error|failed|failure|exception|fatal|cannot|unable|unresolved reference|not found|missing|duplicate|conflict|build failed|traceback)\b/i.test(recentText)
  );
}

function startsClearlySeparateObjective(text: string) {
  if (referencesCurrentWork(text) || isExplicitContinuation(text)) return false;

  return (
    /\b(new|different|separate|unrelated|another|from scratch)\b.{0,80}\b(app|site|project|page|feature|design|diagram|question|topic)\b/.test(text) ||
    /^(start|create|build|design|make|write|generate)\b.{0,80}\b(new|different|separate|unrelated|from scratch)\b/.test(text)
  );
}

function sharesWorkContinuity(text: string, mission: MissionState, currentDomains = detectDomains(`${mission.objective} ${mission.title} ${mission.conversationTitle}`), nextDomains = detectDomains(text)) {
  const currentTerms = new Set([...tokenize(mission.objective), ...tokenize(mission.title), ...tokenize(mission.conversationTitle)]);
  const nextTerms = tokenize(text);

  if (currentDomains.size > 0 && nextDomains.size > 0) {
    return [...nextDomains].some((domain) => currentDomains.has(domain));
  }

  if (nextTerms.some((term) => currentTerms.has(term))) return true;
  if (currentDomains.has("data") && /\b(value|field|setting|feature|option|json)\b/.test(text)) {
    return true;
  }
  if (currentDomains.has("productPage") && /\b(button|page|screen|layout|color|login|signup|sign in|google)\b/.test(text)) {
    return true;
  }

  return false;
}

function objectiveActionFor(text: string): "none" | "weak" | "strong" {
  if (/\b(build|create|make|design|draw|sketch|generate|write|implement|develop)\b/.test(text)) {
    const hasConcreteObject = /\b(app|website|site|project|dashboard|portal|page|screen|form|api|service|component|file|json|csv|log|report|diagram|image|mockup|wireframe|script|feature|bug|error)\b/.test(text);
    const explicitSplit = /\b(new|different|separate|another|unrelated|instead|from scratch)\b/.test(text);
    return hasConcreteObject || explicitSplit ? "strong" : "weak";
  }

  if (/\b(analyze|inspect|review|fix|repair|debug|troubleshoot)\b/.test(text)) return "weak";

  if (/^(can you|could you|would you|i need|i want|help me)\b/.test(text)) return "weak";
  return "none";
}

function detectDomains(value: string) {
  const text = value.toLowerCase();
  const domains = new Set<string>();

  Object.entries(topicDomains).forEach(([domain, terms]) => {
    if (terms.some((term) => new RegExp(`\\b${term}\\b`).test(text))) {
      domains.add(domain);
    }
  });

  return domains;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

function isShortQuestionFollowUp(text: string, mission: MissionState) {
  if (mission.desiredOutcome === "conversation") return false;
  if (!text.endsWith("?")) return false;
  const words = text.replace(/[?!.]/g, "").trim().split(/\s+/).filter(Boolean);
  return words.length <= 4;
}

function createMissionFromMessage(message: string, outcome: OutcomeType, now: Date): MissionState {
  const iso = now.toISOString();

  return {
    ...createInitialMission(now),
    missionId: `mission-${now.getTime()}`,
    title: createMissionTitle(message, outcome),
    objective: message,
    status: "active",
    currentStage: stageFor(outcome, "newMission"),
    desiredOutcome: outcome,
    artifactType: outcome,
    messages: [],
    createdArtifacts: [],
    sources: [],
    lastResult: "",
    followUpContext: {
      type: "newMission",
      summary: followUpSummary("newMission", outcome),
    },
    liveWorkEvents: eventsFor(outcome, "newMission"),
    createdAt: iso,
    updatedAt: iso,
  };
}

function createMissionTitle(message: string, outcome: OutcomeType) {
  const rawText = message.trim();
  const text = rawText.toLowerCase();
  const dynamicTitle = createObjectiveTitle(rawText, outcome);
  if (dynamicTitle) return dynamicTitle;

  const matched = stableTitles.find(([pattern]) => pattern.test(text));
  if (matched) return matched[1];

  const fallbackTitles: Record<OutcomeType, string> = {
    answer: "Technical Question",
    sketch: "Visual Sketch",
    mockup: "Product Design",
    diagram: "System Diagram",
    code: "Code Work",
    project: "Project Build",
    fileAnalysis: "Technical Investigation",
    patch: "Code Change",
    command: "Command Run",
    report: "Technical Report",
    export: "Workspace Export",
    conversation: "Engineering Conversation",
  };

  return fallbackTitles[outcome];
}

function createObjectiveTitle(rawText: string, outcome: OutcomeType) {
  const text = rawText.toLowerCase();

  const diagnosticTitle = createDiagnosticTitle(rawText);
  if (diagnosticTitle) return diagnosticTitle;

  if (/\b(docs?|documentation|source|sources|url|link|know if there is docs)\b/.test(text)) {
    const technicalObject = extractTechnicalObject(rawText);
    if (technicalObject) return `${technicalObject} Documentation`;
  }

  if (/\bdns\b/.test(text)) return /\b(windows|cmd|command prompt|powershell|pc)\b/.test(text) ? "Windows DNS Troubleshooting" : "DNS Troubleshooting";
  if (/\b(ping|ip address|network|router|device)\b/.test(text)) {
    return /\b(windows|cmd|command prompt|powershell|pc)\b/.test(text) ? "Windows Network Troubleshooting" : "Network Troubleshooting";
  }
  if (/\b(payment\s*form|paymentform|checkout\s*form|checkoutform|billing\s*form|billingform|card\s*form|cardform)\b/.test(text)) {
    return outcome === "project" ? "Payment Form Build" : "Payment Form Sketch";
  }
  if (/\b(inventory|stock|warehouse)\b/.test(text) && /\b(dashboard|admin|analytics|kpi|table)\b/.test(text)) {
    return outcome === "sketch" || outcome === "mockup" ? "Inventory Dashboard Sketch" : "Inventory Dashboard";
  }
  if (/\b(gym|fitness|membership)\b/.test(text) && /\b(signup|sign up|registration|join)\b/.test(text)) {
    return outcome === "sketch" ? "Gym Signup Sketch" : "Gym Signup Page Build";
  }
  if (/\b(signup|sign up|registration)\b/.test(text) && /\b(page|website|site|form)\b/.test(text)) {
    return outcome === "sketch" ? "Signup Page Sketch" : "Signup Page Build";
  }
  if (/\b(shop|shopping|store|ecommerce|commerce|catalog|product|products|cart|checkout|collection|retail)\b/.test(text)) {
    const object = extractObjectiveObject(text);
    if (object) return `${object} ${outcome === "sketch" || outcome === "mockup" ? "Sketch" : "Build"}`;
  }
  if (/\bjson\b/.test(text) && /\b(config|configuration|setting|settings|analyz|inspect|review)\b/.test(text)) {
    return "JSON Configuration Investigation";
  }

  const object = extractObjectiveObject(text);
  if (!object) return undefined;

  const suffixByOutcome: Record<OutcomeType, string> = {
    answer: "Troubleshooting",
    sketch: "Sketch",
    mockup: "Design",
    diagram: "Diagram",
    code: "Code Work",
    project: "Build",
    fileAnalysis: "Investigation",
    patch: "Repair",
    command: "Command Run",
    report: "Report",
    export: "Export",
    conversation: "Conversation",
  };

  return `${object} ${suffixByOutcome[outcome]}`;
}

function extractObjectiveObject(text: string) {
  const words = stripDiagnosticNoise(text)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^\d+$/.test(word))
    .filter((word) => !titleStopWords.has(word) && !hasVisualIntent(word));

  const preferred = words.filter((word) => titleAnchorWords.has(word) || !genericTitleWords.has(word));
  const selected = preferred.slice(0, 4);
  if (!selected.length) return undefined;

  return selected.map(toTitleWord).join(" ");
}

export function looksLikeDiagnosticPaste(rawText: string) {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const diagnosticLineCount = lines.filter(isDiagnosticOutputLine).length;
  const hasDiagnosticAsk = lines.some((line) => isHumanProblemStatement(line));
  const hasStructuredOutput = diagnosticLineCount >= 2 || lines.some((line) => looksLikeCommandInvocation(line));
  const hasShellPrompt = lines.some((line) => looksLikeShellPrompt(line));
  const hasFailureOutput = lines.some((line) => looksLikeFailureOutput(line));

  return diagnosticLineCount >= 3 || (hasStructuredOutput && hasDiagnosticAsk) || (hasShellPrompt && hasFailureOutput);
}

function createDiagnosticTitle(rawText: string) {
  if (!looksLikeDiagnosticPaste(rawText)) return undefined;

  const evidenceTitle = extractDiagnosticIssueTitle(rawText);
  if (evidenceTitle) return evidenceTitle;

  const statement = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && isHumanProblemStatement(line));

  const subject = statement ? extractDiagnosticSubject(statement) : undefined;
  if (subject) return `${subject} Troubleshooting`;

  return rawText.toLowerCase().includes("build") ? "Build Troubleshooting" : "Technical Error Troubleshooting";
}

function extractDiagnosticIssueTitle(rawText: string) {
  const text = rawText.toLowerCase();

  if (/\bduplicate\s+class|duplicate\s+classes|duplicate\s+entry|already\s+exists\b/.test(text)) return "Duplicate Class Conflict";
  if (/\bredeclaration|already\s+defined|defined\s+multiple\s+times\b/.test(text)) return "Redeclaration Error";
  if (/\bdependency\s+conflict|version\s+conflict|conflicting\s+dependencies\b/.test(text)) return "Dependency Conflict";
  if (/\bno installed distributions|wrong shell|not recognized|command not found|cannot find the path|no such file\b/.test(text)) return "Command Environment Error";
  if (/\bassemble|compile|build failed|compilation failed|task .* failed|failed to compile\b/.test(text)) return "Build Failure";
  if (/\bconnection timed out|timeout|timed out|could not connect|connection refused\b/.test(text)) return "Connection Failure";
  if (/\bpermission denied|access denied|unauthorized|forbidden\b/.test(text)) return "Permission Failure";

  return undefined;
}

function stripDiagnosticNoise(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !isDiagnosticOutputLine(line))
    .filter((line) => !looksLikeCommandInvocation(line))
    .join(" ");
}

function isHumanProblemStatement(line: string) {
  const text = line.toLowerCase();
  const hasProblemLanguage = /\b(error|failed|failing|failure|problem|issue|troubleshoot|not working|cannot|can't|unable|when trying|trying to)\b/.test(text);
  return hasProblemLanguage && !isDiagnosticOutputLine(line);
}

function isDiagnosticOutputLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (looksLikeShellPrompt(trimmed)) return true;
  const startsLikeToolOutput = /^([>$#]\s*)?[\w.-]+(:[\w.-]+)+\b/.test(trimmed);
  const hasTerminalPrefix = /^([>$#]|\[[^\]]+\]|error[:\s]|warning[:\s]|exception[:\s])/i.test(trimmed);
  const hasStatusToken = /\b[A-Z][A-Z_-]{2,}\b/.test(trimmed);
  const hasPathOrQualifiedName = /([A-Za-z]:\\|\/[\w.-]+\/|[\w.-]+(\.[\w.-]+){2,})/.test(trimmed);
  const hasBuildVerb = /\b(generate|generated|merge|merged|compile|compiled|process|processed|package|packaged|assemble|check|desugar|transform|link|bundle|minify|lint|test)\w*\b/i.test(
    trimmed,
  );

  return (startsLikeToolOutput && (hasStatusToken || hasBuildVerb)) || (hasTerminalPrefix && (hasStatusToken || hasPathOrQualifiedName || hasBuildVerb));
}

function looksLikeCommandInvocation(line: string) {
  return (
    /\b(executing|running|starting)\s+[\w\s-]*[:[]/i.test(line) ||
    /\b(project|workspace|directory)\s+([A-Za-z]:\\|\/)/i.test(line) ||
    looksLikeShellPrompt(line)
  );
}

function looksLikeShellPrompt(line: string) {
  const trimmed = line.trim();
  return (
    /^PS\s+[A-Za-z]:\\[^>]*>\s*\S+/.test(trimmed) ||
    /^[A-Za-z]:\\[^>]*>\s*\S+/.test(trimmed) ||
    /^[^@\s]+@[^:\s]+:[^\n$#]*[$#]\s*\S+/.test(trimmed) ||
    /^[$#]\s*\S+/.test(trimmed)
  );
}

function looksLikeFailureOutput(line: string) {
  return /\b(error|failed|failure|exception|cannot|can't|unable|not recognized|not found|no installed|missing|denied|conflict|duplicate|redeclaration|timed out|timeout|traceback)\b/i.test(
    line,
  );
}

function extractDiagnosticSubject(statement: string) {
  const cleaned = statement
    .replace(/\b(getting|got|have|having|the|below|following|this|that|error|issue|problem|when|while|trying|try|to|my|a|an)\b/gi, " ")
    .replace(/\b(build|compile|run|start|open|load|execute|executing)\w*\b/gi, " ")
    .replace(/[^A-Za-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .filter((word) => !titleStopWords.has(word.toLowerCase()));

  const selected = words.slice(0, 4);
  if (!selected.length) return undefined;

  return selected.map((word) => toTitleWord(word.toLowerCase())).join(" ");
}

function extractTechnicalObject(rawText: string) {
  const technicalTerms = new Set<string>();

  Array.from(rawText.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+\b/g)).forEach((match) => {
    match[0].split(".").forEach((part) => addTechnicalTerm(technicalTerms, part));
  });

  Array.from(rawText.matchAll(/<\/?([A-Za-z][A-Za-z0-9_-]*)\b/g)).forEach((match) => addTechnicalTerm(technicalTerms, match[1]));

  rawText
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .forEach((word) => {
      if (/^[A-Z]{2,}[A-Z0-9-]*$/.test(word) || /[A-Z][a-z]+[A-Z]/.test(word)) {
        addTechnicalTerm(technicalTerms, word);
      }
    });

  const selected = Array.from(technicalTerms).slice(0, 4);
  if (selected.length >= 2) return selected.map(toTitleWord).join(" ");

  const fallback = extractObjectiveObject(rawText.toLowerCase());
  return fallback;
}

function addTechnicalTerm(terms: Set<string>, value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!normalized || normalized.length < 3) return;
  if (titleStopWords.has(normalized) || genericTitleWords.has(normalized)) return;
  if (/^(row|condition|true|false|null|with|from|into|type|code|work|answer|customer|customers)$/.test(normalized)) return;

  terms.add(normalized);
}

function toTitleWord(word: string) {
  const known: Record<string, string> = {
    api: "API",
    csv: "CSV",
    dns: "DNS",
    ip: "IP",
    json: "JSON",
    ui: "UI",
    url: "URL",
    xml: "XML",
  };

  return known[word] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

function resolveEffectiveOutcome(classification: Classification) {
  if (classification.isNewMission) return classification.outcome;
  if (classification.outcome === "sketch" || classification.outcome === "mockup" || classification.outcome === "diagram") return classification.outcome;
  if (classification.outcome === "answer") return "answer";
  if (classification.outcome === "conversation") return "answer";
  return classification.outcome;
}

function mergeObjective(objective: string, message: string, followUpType: FollowUpType) {
  if (followUpType === "correction") return `${objective} Correction: ${message}`;
  if (followUpType === "clarification") return `${objective} Clarification: ${message}`;
  return objective;
}

function stageFor(outcome: OutcomeType, followUpType: FollowUpType): MissionStage {
  if (followUpType === "questionAboutLastResult") return "waitingForReasoningEngine";
  if (followUpType === "cancellation") return "ready";
  if (outcome === "project" || outcome === "patch") return "waitingForProjectTarget";
  if (outcome === "command") return "waitingForExecutionEngine";
  if (outcome === "fileAnalysis") return "waitingForFiles";
  if (outcome === "sketch" || outcome === "mockup" || outcome === "diagram") return "waitingForPreviewEngine";
  return "waitingForReasoningEngine";
}

function statusFor(followUpType: FollowUpType): MissionStatus {
  if (followUpType === "cancellation") return "cancelled";
  return "waitingForInput";
}

function eventsFor(outcome: OutcomeType, followUpType: FollowUpType) {
  if (followUpType === "questionAboutLastResult") {
    return ["Question captured", "Full response support comes next"];
  }
  if (followUpType === "correction") {
    return ["Correction captured", "Full response support comes next"];
  }
  return outcomeEvents[outcome];
}

function createUserFacingUpdate(classification: Classification, outcome: OutcomeType) {
  const prefix = classification.isNewMission
    ? "I understand what you're trying to accomplish."
    : "I'll keep this tied to the same task.";

  return `${prefix} ${userFacingOutcome(outcome)} ${unavailableMessage(outcome)}`;
}

function userFacingOutcome(outcome: OutcomeType) {
  const messages: Record<OutcomeType, string> = {
    answer: "This needs a full response.",
    sketch: "Preparing a sketch.",
    mockup: "Preparing a design direction.",
    diagram: "Preparing a diagram.",
    code: "Preparing to work with code.",
    project: "Preparing to build a project.",
    fileAnalysis: "Preparing to review the file content.",
    patch: "Preparing to change files.",
    command: "Preparing to run a command.",
    report: "Preparing a report.",
    export: "Preparing an export.",
    conversation: "This needs a full response.",
  };

  return messages[outcome];
}

function unavailableMessage(outcome: OutcomeType) {
  if (outcome === "sketch" || outcome === "mockup" || outcome === "diagram") {
    return "Preview generation is not available yet.";
  }
  if (outcome === "project" || outcome === "patch") {
    return "Project file creation is not available yet.";
  }
  if (outcome === "command") return "Command running comes next.";
  if (outcome === "fileAnalysis") return "File review comes next.";
  if (outcome === "export") return "Export support comes next.";
  return "Full response support comes next.";
}

function followUpSummary(type: FollowUpType, outcome: OutcomeType) {
  const outcomeText = outcomeLabels[outcome].toLowerCase();
  const summaries: Record<FollowUpType, string> = {
    newMission: `Started a new ${outcomeText} mission.`,
    followUp: `Continuing the active mission as ${outcomeText}.`,
    correction: `Applied a correction to the active ${outcomeText} mission.`,
    clarification: `Captured clarification for the active ${outcomeText} mission.`,
    approval: `Captured approval for the active ${outcomeText} mission.`,
    cancellation: "Cancelled the active mission.",
    questionAboutLastResult: "Question about last result recorded.",
  };

  return summaries[type];
}

function createMessage(
  author: string,
  initials: string,
  tone: WorkspaceNote["tone"],
  body: string,
  now: Date,
  tags?: string[],
  attachments?: WorkspaceAttachment[],
): WorkspaceNote {
  return {
    id: `${now.toISOString()}-${author}-${body.length}`,
    author,
    initials,
    time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    tone,
    body,
    tags,
    attachments,
  };
}

function mergeAttachments(existing: WorkspaceAttachment[], incoming: WorkspaceAttachment[]) {
  const merged = new Map(existing.map((attachment) => [attachment.fileId, attachment]));

  incoming.forEach((attachment) => {
    merged.set(attachment.fileId, attachment);
  });

  return Array.from(merged.values());
}

function mergeSources(existing: SourceReference[], incoming: SourceReference[]) {
  const merged = new Map(existing.map((source) => [source.url, source]));

  incoming.forEach((source) => {
    merged.set(source.url, source);
  });

  return Array.from(merged.values()).slice(-40);
}

function createArtifactFromMessage(mission: MissionState, message: WorkspaceNote, now: Date): CreatedArtifact {
  const kind = artifactKindForOutcome(mission.desiredOutcome);
  const title = titleFromContent(message.body, mission.conversationTitle);

  return {
    id: `artifact-${message.id}`,
    sourceMessageId: message.id,
    type: mission.desiredOutcome,
    kind,
    title,
    body: message.body,
    description: `${title} generated in ${mission.conversationTitle}.`,
    visualArtifact: message.visualArtifact,
    createdAt: now.toISOString(),
  };
}
