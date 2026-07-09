import type { CommandApprovalScope, CommandPermissionCategory } from "@/lib/ai/mission/command-permissions";

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
export type FactoryPreviewPlatform = "web" | "api" | "desktop" | "android" | "mobile";

/** A single piece of real evidence backing (or refuting) mission completion. Built server-side from the same evidence the executor's completion gate inspects — never independently re-derived by the client. */
export type ExecutionMissionVerification = {
  check_type: "file-read" | "build" | "test" | "lint" | "typecheck" | "preview" | "manual-evidence" | "checklist" | "command";
  result: "pass" | "fail" | "skipped";
  evidence: string;
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
  exportUrl?: string;
  timeline?: FactoryExecutionEvent[];
  sessionSummary?: FactorySessionSummary;
  /** Plain-language questions the planner needs answered before it can safely proceed (contradictory or ambiguous requirements). Present only when status is "needs-clarification". */
  clarificationQuestions?: string[];
  /** Real verification evidence backing this result, built from the same checks the executor's completion gate used. Empty when nothing could be verified — the client must show "unverified" rather than guessing at pass/fail itself. */
  verification?: ExecutionMissionVerification[];
};

export type FactoryCreateRequest = {
  brief: string;
};

export type FactoryUploadedFile = {
  path: string;
  content: string;
  size: number;
};

/** Structured record of the mission this follow-up continues, sent verbatim instead of a flattened prose digest so the executor can act on real plan/decision state rather than re-deriving it from a paragraph. */
export type MissionParentContext = {
  id: string;
  /** Free-text mirror of ExecutionMissionState (kept as a plain string here to avoid a circular import between lib/factory/types.ts and lib/mission-engine.ts). */
  state: string;
  plan: FactoryObjectiveChecklistItem[];
  files_touched: Array<{ path: string; status?: string; diffSummary?: string; verified: boolean }>;
  commands_run: Array<{ command: string; exitCode: number | null; approval_scope_label?: string }>;
  /** Rationale strings pulled from the narrative "decision" tier, most recent last, capped to a small number. */
  decisions: string[];
  /** Rationale strings pulled from the narrative "finding" tier, most recent last, capped to a small number. */
  findings: string[];
  blocked_reason?: string;
  summary: string;
};

export type FactoryExistingProjectRequest = {
  brief: string;
  task: string;
  files: FactoryUploadedFile[];
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
  /** Whether this follow-up should revise the parent mission's still-open plan (carry_forward_plan) or replan from scratch (fresh_plan). Only meaningful when parentMission is present. */
  continuity?: "carry_forward_plan" | "fresh_plan";
  /** The user's structured answer to a pending command-approval prompt. Replaces parsing "Approved: run ..." / "Denied approval to run ..." back out of the task string. */
  approvalResponse?: {
    requestedCommand: string;
    decision: "approve-once" | "approve-command" | "approve-category" | "deny";
    category?: CommandPermissionCategory;
  };
};

export type FactoryFileReadResult = {
  projectId: string;
  path: string;
  content: string;
};
