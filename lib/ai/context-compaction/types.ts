export type CompactionItem = { text: string; sourceId?: string; status?: string; rationale?: string };

export type CompactionSnapshot = {
  version: 1;
  projectId: string;
  missionId: string;
  createdAt: string;
  sourceRange: { firstMessageId?: string; lastMessageId?: string; messageCount: number; eventCount: number };
  objective: string;
  activeState: string;
  activePhase: string;
  activeTask: string;
  requirements: { pending: CompactionItem[]; active: CompactionItem[]; completed: CompactionItem[]; blocked: CompactionItem[]; skipped: CompactionItem[] };
  decisions: CompactionItem[];
  userPreferences: CompactionItem[];
  files: { relevant: CompactionItem[]; changed: CompactionItem[]; created: CompactionItem[]; deleted: CompactionItem[] };
  commands: { approved: CompactionItem[]; denied: CompactionItem[]; completed: CompactionItem[]; failed: CompactionItem[] };
  verification: CompactionItem[];
  blockers: CompactionItem[];
  failedApproaches: CompactionItem[];
  nextActions: CompactionItem[];
  restorePoints: CompactionItem[];
  references: Record<string, string>;
  fileHashes: Record<string, string>;
  compactionMethod: "deterministic-v1";
  validation: { valid: boolean; missing: string[] };
  rawArchive: { retained: true; messageIds: string[]; executionMissionIds: string[] };
};

export type CompactionState = { snapshot: CompactionSnapshot; archivedMessageCount: number; lastCompactedAt: string };
export type ContextPackageTier = "fast" | "builder" | "architect" | "enterprise-architect" | "super-reasoning";
export type ContextPackage = { tier: ContextPackageTier; snapshotVersion: number; active: unknown; mission?: unknown; project?: unknown; archiveReferences: string[]; estimatedTokens: number };
