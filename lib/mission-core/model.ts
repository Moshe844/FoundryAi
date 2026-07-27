export const missionStatuses = [
  "draft",
  "understanding",
  "awaiting_clarification",
  "planned",
  "awaiting_approval",
  "executing",
  "verifying",
  "repairing",
  "previewing",
  "completed",
  "completed_with_warnings",
  "blocked",
  "failed",
  "canceled",
] as const;

export type MissionStatus = (typeof missionStatuses)[number];

export const operationKinds = [
  "read_file",
  "write_file",
  "patch_file",
  "delete_file",
  "run_command",
  "start_process",
  "stop_process",
  "browser_action",
  "verify",
] as const;

export type OperationKind = (typeof operationKinds)[number];
export type OperationStatus = "pending" | "running" | "awaiting_approval" | "succeeded" | "failed" | "skipped" | "canceled";
export type RequirementStatus = "open" | "satisfied" | "blocked" | "deferred";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "canceled";
export type ApprovalScope = "once" | "mission" | "project" | "exact_action";
export type VerificationStatus = "pending" | "passed" | "failed" | "warning" | "skipped";

export type MissionRequirement = {
  id: string;
  text: string;
  status: RequirementStatus;
  evidenceIds: string[];
};

export type OperationInput = {
  content?: string;
  patch?: string;
  cwd?: string;
  approvedCommands?: string[];
  approvedCategories?: string[];
  standingApprovedCommands?: string[];
  browser?: {
    url: string;
    actions?: Array<{ action: string; selector?: string; value?: string; text?: string; key?: string; ms?: number; exact?: boolean; expected?: number }>;
    viewport?: { width: number; height: number };
    screenshotName?: string;
    baselineScreenshot?: string;
  };
  metadata?: Record<string, unknown>;
};

export type OperationResult = {
  summary: string;
  evidence: string[];
  output?: string;
  error?: string;
  exitCode?: number | null;
  durationMs?: number;
  contentHash?: string;
  changed?: boolean;
  completedAt: string;
};

export type PlannedOperation = {
  id: string;
  missionId: string;
  kind: OperationKind;
  title: string;
  target?: string;
  command?: string;
  input?: OperationInput;
  result?: OperationResult;
  dependsOn: string[];
  requirementIds: string[];
  risk: "safe" | "development" | "modification" | "high_risk";
  status: OperationStatus;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRequest = {
  id: string;
  missionId: string;
  operationId: string;
  projectId: string;
  category: string;
  exactAction: string;
  reason: string;
  impact: string;
  affectedFiles: string[];
  allowedScopes: ApprovalScope[];
  selectedScope?: ApprovalScope;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
};

export type VerificationResult = {
  id: string;
  missionId: string;
  operationId?: string;
  name: string;
  status: VerificationStatus;
  summary: string;
  evidence: string[];
  createdAt: string;
};

export type MissionJournalEntry = {
  id: string;
  missionId: string;
  at: string;
  type: "state" | "operation" | "approval" | "verification" | "recovery" | "note";
  message: string;
  data?: Record<string, unknown>;
};

export type MissionRecord = {
  id: string;
  projectId: string;
  objective: string;
  status: MissionStatus;
  revision: number;
  requirements: MissionRequirement[];
  operations: PlannedOperation[];
  approvals: ApprovalRequest[];
  verification: VerificationResult[];
  journal: MissionJournalEntry[];
  blocker?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export function createMissionRecord(input: { id: string; projectId: string; objective: string; now?: string }): MissionRecord {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    projectId: input.projectId,
    objective: input.objective,
    status: "draft",
    revision: 0,
    requirements: [],
    operations: [],
    approvals: [],
    verification: [],
    journal: [],
    createdAt: now,
    updatedAt: now,
  };
}
