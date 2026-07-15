import type { CommandApprovalScope, CommandPermissionCategory } from "@/lib/ai/mission/command-permissions";
import type { MissionQualityLevel } from "@/lib/ai/mission/quality-level";
import type { ModelMode } from "@/lib/ai/model-router";
import type { EnvironmentReadiness } from "@/lib/toolchains/provisioner";
import type { FollowUpResolutionRecord } from "@/lib/mission/classifyFollowUp";

export type FactoryBuildStatus = "created" | "running" | "passed" | "failed" | "unsupported" | "stopped" | "awaiting-approval" | "needs-clarification" | "awaiting-mock-approval";

export type FactoryFileEntry = {
  path: string;
  status: "created" | "edited" | "uploaded";
  size: number;
  content?: string;
};

export type FactorySourceMode = "local-folder" | "uploaded-copy" | "new-project";

export type FactoryObjectiveChecklistItem = {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "blocked" | "skipped" | "needs-approval";
  evidence?: string;
  /** Logical phase this item belongs to, e.g. "Foundation" or "Feature: checkout". Items with no phase render in a single implicit group. */
  phase?: string;
};

export type FactoryCommandEvent = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs?: number;
  /** Which grant let this command run — absent when it never needed approval. See CommandApprovalScope. */
  approvalScope?: CommandApprovalScope;
};

export type FactoryExecutionEventStatus = "running" | "completed" | "warning" | "error" | "skipped";

export type FactoryExecutionEventKind =
  | "planning"
  | "folder"
  | "file"
  | "edit"
  | "command"
  | "stdout"
  | "stderr"
  | "build"
  | "preview"
  | "fix"
  | "inspection"
  | "summary"
  | "reasoning"
  | "blocked";

export type FactoryExecutionTier = "trace" | "finding" | "decision" | "flag";

export type FactoryNarrativeObject = {
  id: string;
  tier: Exclude<FactoryExecutionTier, "trace">;
  rationale: string;
  evidence: string[];
  source: "project-understanding" | "confidence-map" | "uncertainty" | "conflict";
  confidence?: number;
  filePath?: string;
  details?: Record<string, string | number | boolean | string[] | undefined>;
};

export type FactorySessionSummary = {
  outcome: string;
  preserved: string[];
  changes: string[];
  flags: string[];
};

export type FactoryExecutionEvent = {
  id: string;
  timestamp: string;
  tier?: FactoryExecutionTier;
  kind: FactoryExecutionEventKind;
  status: FactoryExecutionEventStatus;
  title: string;
  fileName?: string;
  filePath?: string;
  command?: string;
  cwd?: string;
  output?: string;
  stdout?: string;
  stderr?: string;
  beforeContent?: string;
  exitCode?: number | null;
  durationMs?: number;
  rationale?: string;
  narrative?: FactoryNarrativeObject;
  details?: Record<string, string | number | boolean | string[] | undefined>;
  /** Engine-internal bookkeeping (exploratory reads, checklist sync, retry mechanics). Never render this to the user. */
  internal?: boolean;
};

export type FactoryJournalEntry = {
  id: string;
  projectId: string;
  timestamp: string;
  event: FactoryExecutionEvent;
  beforeContent?: string;
  afterContent?: string;
  reverted?: boolean;
};

export type FactoryPreviewState = "unavailable" | "starting" | "ready" | "error";
export type FactoryPreviewPlatform = "web" | "api" | "desktop" | "android" | "mobile" | "cli" | "database" | "game" | "report";

export type FactoryArtifact = {
  name: string;
  platform: string;
  version: string;
  fileType: string;
  sizeBytes: number;
  createdAt: string;
  buildStatus: "verified";
  downloadUrl: string;
};

/** A single piece of real evidence backing (or refuting) mission completion. Built server-side from the same evidence the executor's completion gate inspects — never independently re-derived by the client. */
export type ExecutionMissionVerification = {
  check_type: "file-read" | "build" | "test" | "lint" | "typecheck" | "preview" | "manual-evidence" | "checklist" | "command";
  result: "pass" | "fail" | "skipped";
  evidence: string;
};

/**
 * A single blocking decision the mission needs from the user. `options` are concrete clickable choices
 * when the producer knows them (e.g. a yes/adjust scope confirmation); when absent the UI shows a free
 * text field instead. Only one is ever presented at a time.
 */
export type MissionClarification = {
  question: string;
  options?: string[];
};

export type FactoryProjectResult = {
  projectId: string;
  projectName: string;
  projectPath: string;
  briefPath: string;
  stack: string;
  template: string;
  sourceMode?: FactorySourceMode;
  objective?: string;
  checklist?: FactoryObjectiveChecklistItem[];
  status: FactoryBuildStatus;
  supported: boolean;
  blocker?: string;
  events: string[];
  files: FactoryFileEntry[];
  commands: FactoryCommandEvent[];
  previewUrl?: string;
  previewState?: FactoryPreviewState;
  previewPlatform?: FactoryPreviewPlatform;
  previewReason?: string;
  /** Server-derived metadata for an artifact that exists on disk. Never synthesize this client-side. */
  artifact?: FactoryArtifact;
  /** True only when a separately approved atomic action verified that the connected project root no longer exists. */
  projectDeleted?: boolean;
  exportUrl?: string;
  timeline?: FactoryExecutionEvent[];
  sessionSummary?: FactorySessionSummary;
  /** Questions the planner needs answered before it can safely proceed (contradictory or ambiguous requirements). Present only when status is "needs-clarification". Surfaced one at a time as an inline decision prompt. */
  clarificationQuestions?: MissionClarification[];
  /** Real verification evidence backing this result, built from the same checks the executor's completion gate used. Empty when nothing could be verified — the client must show "unverified" rather than guessing at pass/fail itself. */
  verification?: ExecutionMissionVerification[];
  /** Provider-reported usage for the implementation loop. Discovery is reported by its own request. */
  modelUsage?: Array<{
    provider: "openai" | "anthropic" | "google";
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    cachedCalls: number;
  }>;
  executionTurns?: number;
  /** Real local toolchain readiness plus trusted one-click setup recipes for this stack. */
  environment?: EnvironmentReadiness;
};

/**
 * Structured Decision Memo content, sent verbatim instead of relying on a regex-scraped fragment of
 * the flattened brief string — same problem, same fix as MissionParentContext below, applied to
 * project creation instead of mission follow-ups. Optional so ad-hoc/legacy callers of
 * /api/factory/create that only ever sent a brief keep working unchanged.
 */
export type StructuredDiscovery = {
  projectType: string;
  architecture: string;
  styleDirection: string;
  mainFeatures: string[];
  dataModel: string[];
  keyFacts: string[];
  futureCapabilities: string[];
  recommendedStack: string;
  decisions: Array<{ dimension: string; hypothesis: string; rationale: string }>;
};

export type FactoryCreateRequest = {
  brief: string;
  /** Client mission id used to recover or explicitly stop an in-flight build. */
  controlId?: string;
  discovery?: StructuredDiscovery;
  modelMode?: ModelMode;
  quality?: MissionQualityLevel;
};

export type FactoryUploadedFile = {
  path: string;
  content: string;
  size: number;
};

/** Structured record of the mission this follow-up continues, sent verbatim instead of a flattened prose digest so the executor can act on real plan/decision state rather than re-deriving it from a paragraph. */
export type MissionParentContext = {
  id: string;
  /** The original user request(s) this mission is still carrying out. Approval replies must resume
   * these requirements instead of replacing them with synthetic "Approved" text. */
  source_requirements: string[];
  /** Free-text mirror of ExecutionMissionState (kept as a plain string here to avoid a circular import between lib/factory/types.ts and lib/mission-engine.ts). */
  state: string;
  plan: FactoryObjectiveChecklistItem[];
  files_touched: Array<{ path: string; status?: string; diffSummary?: string; verified: boolean }>;
  commands_run: Array<{ command: string; exitCode: number | null; approval_scope_label?: string }>;
  /** Rationale strings pulled from the narrative "decision" tier, most recent last, capped to a small number. */
  decisions: string[];
  /** Rationale strings pulled from the narrative "finding" tier, most recent last, capped to a small number. */
  findings: string[];
  /** Actions explicitly denied earlier in this mission. */
  denied_actions?: string[];
  blocked_reason?: string;
  summary: string;
};

export type FactoryExistingProjectRequest = {
  brief: string;
  task: string;
  files: FactoryUploadedFile[];
  /** Client mission id used only to route an explicit Stop signal to this in-flight server execution. */
  controlId?: string;
  localPath?: string;
  localConnector?: {
    url: string;
    token?: string;
    rootLabel?: string;
  };
  /** Command categories the user has approved for the rest of this conversation (e.g. "dependencies"). */
  approvedCategories?: string[];
  /** Exact commands the user has approved for the rest of this conversation. */
  approvedCommands?: string[];
  /** Structured record of the mission this follow-up continues. Replaces the old flattened missionDigest string. */
  parentMission?: MissionParentContext;
  /** Canonical resolution record for this follow-up. The runtime must not re-resolve its target. */
  followUpResolution?: FollowUpResolutionRecord;
  /** Whether this follow-up should revise the parent mission's still-open plan (carry_forward_plan) or replan from scratch (fresh_plan). Only meaningful when parentMission is present. */
  continuity?: "carry_forward_plan" | "fresh_plan";
  /** The user's structured answer to a pending command-approval prompt. Replaces parsing "Approved: run ..." / "Denied approval to run ..." back out of the task string. */
  approvalResponse?: {
    requestedCommand: string;
    decision: "approve-once" | "approve-command" | "approve-category" | "deny";
    category?: CommandPermissionCategory;
  };
  /** Defaults to "standard" — how much planning/review/verification depth this mission gets. Independent of Model Mode (which model handles a call); see lib/ai/mission/quality-level.ts. */
  quality?: MissionQualityLevel;
  /** Auto chooses from the real task; an explicit mode pins the intelligence tier. */
  modelMode?: ModelMode;
  /** Current-turn screenshot/image evidence sent to the execution model, never written into the project. */
  evidenceImages?: Array<{ fileName: string; mediaType: string; dataUrl: string }>;
};

export type FactoryFileReadResult = {
  projectId: string;
  path: string;
  content: string;
};
