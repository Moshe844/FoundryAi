import type { CompactionSnapshot, CompactionState, ContextPackage, ContextPackageTier } from "./types";

type CompactableMission = {
  missionId: string; objective: string; status: string; currentStage: string; lastResult: string; activeExecutionMissionId?: string;
  messages: Array<{ id: string; tone: string; body: string }>;
  attachments: Array<{ fileId: string; fileName: string; uploadStatus: string }>;
  workMemory: { currentBlocker: string; rejectedHypotheses: string[]; relevantFiles: string[]; recommendedNextAction: string };
  followUpContext: { summary: string };
  compaction?: CompactionState;
  executionMissions: Array<{
    id: string; state: string; activeStep?: string | null; source_requirements: string[]; blocked_reason?: string; summary: string; undo_snapshot?: string;
    plan: Array<{ label: string; status: "pending" | "running" | "completed" | "blocked" | "skipped" | "needs-approval" }>;
    timeline: Array<{ tier?: string; status: string; title: string; kind: string; filePath?: string; narrative?: { rationale: string } }>;
    approvals?: Array<{ id: string; command: string; decidedAs?: string }>;
    commands_run: Array<{ command: string; exitCode: number | null; stdout: string; stderr: string }>;
    files_touched: Array<{ path: string; status?: string; verified: boolean; diff?: string; evidence?: string }>;
    verification: unknown[]; verification_status: string;
  }>;
};

export const COMPACTION_THRESHOLDS = { softContextRatio: 0.55, strongContextRatio: 0.75, emergencyContextRatio: 0.9, messageCount: 40, executionEventCount: 120, commandOutputChars: 24_000 } as const;

export function shouldCompactMission(mission: CompactableMission, contextRatio = 0): boolean {
  const eventCount = mission.executionMissions.reduce((sum, item) => sum + item.timeline.length, 0);
  return contextRatio >= COMPACTION_THRESHOLDS.softContextRatio || mission.messages.length >= COMPACTION_THRESHOLDS.messageCount || eventCount >= COMPACTION_THRESHOLDS.executionEventCount || mission.executionMissions.some((item) => item.commands_run.some((command) => `${command.stdout ?? ""}${command.stderr ?? ""}`.length >= COMPACTION_THRESHOLDS.commandOutputChars));
}

export function compactMission(mission: CompactableMission, projectId = "workspace"): CompactionState {
  const executions = mission.executionMissions;
  const active = executions.find((item) => item.id === mission.activeExecutionMissionId) ?? executions.at(-1);
  const plans = executions.flatMap((item) => item.plan.map((plan) => ({ plan, missionId: item.id })));
  const requirements = {
    pending: plans.filter(({ plan }) => plan.status === "pending").map(({ plan, missionId }) => item(plan.label, missionId, plan.status)),
    active: plans.filter(({ plan }) => plan.status === "running" || plan.status === "needs-approval").map(({ plan, missionId }) => item(plan.label, missionId, plan.status)),
    completed: plans.filter(({ plan }) => plan.status === "completed").map(({ plan, missionId }) => item(plan.label, missionId, plan.status)),
    blocked: plans.filter(({ plan }) => plan.status === "blocked").map(({ plan, missionId }) => item(plan.label, missionId, plan.status)),
    skipped: plans.filter(({ plan }) => plan.status === "skipped").map(({ plan, missionId }) => item(plan.label, missionId, plan.status)),
  };
  if (!plans.length && mission.objective) requirements.active.push(item(mission.objective, mission.missionId, "active"));
  const approvals = executions.flatMap((execution) => execution.approvals ?? []);
  const commands = executions.flatMap((execution) => execution.commands_run);
  const fileTouches = executions.flatMap((execution) => execution.files_touched);
  const messages = mission.messages;
  const snapshot: CompactionSnapshot = {
    version: 1 as const, projectId, missionId: mission.missionId, createdAt: new Date().toISOString(),
    sourceRange: { firstMessageId: messages[0]?.id, lastMessageId: messages.at(-1)?.id, messageCount: messages.length, eventCount: executions.reduce((sum, execution) => sum + execution.timeline.length, 0) },
    objective: mission.objective, activeState: active?.state ?? mission.status, activePhase: active?.activeStep ?? mission.currentStage, activeTask: active?.source_requirements.at(-1) ?? mission.followUpContext.summary,
    requirements,
    decisions: unique(executions.flatMap((execution) => execution.timeline.filter((event) => event.tier === "decision").map((event) => item(event.narrative?.rationale ?? event.title, execution.id, event.status)))),
    userPreferences: extractFacts(messages.filter((message) => message.tone === "human").map((message) => message.body), /\b(prefer|always|never|keep|use|don't|do not)\b/i),
    files: {
      relevant: unique([...mission.workMemory.relevantFiles.map((file) => item(file)), ...mission.attachments.map((file) => item(file.fileName, file.fileId, file.uploadStatus))]),
      changed: unique(fileTouches.filter((file) => file.status === "edited" || !file.status).map((file) => item(file.path, undefined, file.verified ? "verified" : "unverified", file.diff))),
      created: unique(fileTouches.filter((file) => file.status === "created").map((file) => item(file.path, undefined, file.verified ? "verified" : "unverified", file.diff))),
      deleted: unique(executions.flatMap((execution) => execution.timeline.filter((event) => event.filePath && /\b(delet|remov)/i.test(event.title)).map((event) => item(event.filePath!, execution.id, event.status)))),
    },
    commands: {
      approved: unique(approvals.filter((approval) => approval.decidedAs && approval.decidedAs !== "deny").map((approval) => item(approval.command, approval.id, approval.decidedAs))),
      denied: unique(approvals.filter((approval) => approval.decidedAs === "deny").map((approval) => item(approval.command, approval.id, "denied"))),
      completed: unique(commands.filter((command) => command.exitCode === 0).map((command) => item(command.command, undefined, "passed", summarizeCommand(command.stdout, command.stderr)))),
      failed: unique(commands.filter((command) => command.exitCode !== 0).map((command) => item(command.command, undefined, `exit ${command.exitCode}`, summarizeCommand(command.stdout, command.stderr)))),
    },
    verification: unique(executions.flatMap((execution) => execution.verification.map((verification) => item(JSON.stringify(verification), execution.id, execution.verification_status)))),
    blockers: unique([mission.workMemory.currentBlocker, ...executions.map((execution) => execution.blocked_reason ?? "")].filter(Boolean).map((text) => item(text))),
    failedApproaches: unique([...mission.workMemory.rejectedHypotheses.map((text) => item(text)), ...executions.filter((execution) => execution.state === "failed").map((execution) => item(execution.summary, execution.id, "failed"))]),
    nextActions: unique([mission.workMemory.recommendedNextAction, ...requirements.pending.slice(0, 5).map((entry) => entry.text)].filter(Boolean).map((text) => item(text))),
    restorePoints: unique(executions.filter((execution) => execution.undo_snapshot).map((execution) => item(execution.undo_snapshot!, execution.id, "available"))),
    references: { latestResult: mission.lastResult ? "mission.lastResult" : "", rawMessages: `mission:${mission.missionId}:messages`, executionArchive: `mission:${mission.missionId}:executions` },
    fileHashes: Object.fromEntries(fileTouches.map((file) => [file.path, stableHash(`${file.path}:${file.diff ?? file.evidence ?? ""}`)])),
    compactionMethod: "deterministic-v1" as const, validation: { valid: false, missing: [] as string[] },
    rawArchive: { retained: true as const, messageIds: messages.map((message) => message.id), executionMissionIds: executions.map((execution) => execution.id) },
  };
  snapshot.validation = validateCompactionSnapshot(snapshot);
  return { snapshot, archivedMessageCount: Math.max(0, messages.length - 8), lastCompactedAt: snapshot.createdAt };
}

export function validateCompactionSnapshot(snapshot: CompactionSnapshot) {
  const missing: string[] = [];
  if (!snapshot.objective.trim()) missing.push("objective");
  if (!snapshot.activeState) missing.push("activeState");
  if (![...snapshot.requirements.pending, ...snapshot.requirements.active, ...snapshot.requirements.completed, ...snapshot.requirements.blocked, ...snapshot.requirements.skipped].length) missing.push("requirements");
  if (!snapshot.rawArchive.retained || !snapshot.references.rawMessages) missing.push("rawArchive");
  if (!snapshot.activeTask && !snapshot.nextActions.length) missing.push("continuation");
  return { valid: missing.length === 0, missing };
}

export function buildContextPackage(mission: CompactableMission, tier: ContextPackageTier): ContextPackage {
  const state = mission.compaction ?? compactMission(mission);
  const snapshot = state.snapshot;
  const active = { objective: snapshot.objective, state: snapshot.activeState, phase: snapshot.activePhase, task: snapshot.activeTask, activeRequirements: snapshot.requirements.active, pendingRequirements: snapshot.requirements.pending, blockers: snapshot.blockers, nextActions: snapshot.nextActions };
  const missionDigest = { completed: snapshot.requirements.completed, decisions: snapshot.decisions, files: snapshot.files, commands: snapshot.commands, verification: snapshot.verification, failedApproaches: snapshot.failedApproaches, restorePoints: snapshot.restorePoints };
  const projectMemory = { preferences: snapshot.userPreferences, fileHashes: snapshot.fileHashes, relevantFiles: snapshot.files.relevant };
  const payload = tier === "fast" ? { active } : tier === "builder" ? { active, mission: missionDigest, project: projectMemory } : { active, mission: missionDigest, project: projectMemory, references: snapshot.references };
  return { tier, snapshotVersion: snapshot.version, ...payload, archiveReferences: Object.values(snapshot.references).filter((value): value is string => Boolean(value)), estimatedTokens: Math.ceil(JSON.stringify(payload).length / 4) };
}

export function compactMissionIfNeeded<T extends CompactableMission>(mission: T, contextRatio = 0): T {
  return shouldCompactMission(mission, contextRatio) ? { ...mission, compaction: compactMission(mission) } : mission;
}

function item(text: string, sourceId?: string, status?: string, rationale?: string) { return { text: text.trim(), sourceId, status, rationale }; }
function unique<T extends { text: string }>(values: T[]) { return [...new Map(values.filter((value) => value.text).map((value) => [value.text.toLowerCase(), value])).values()]; }
function extractFacts(values: string[], pattern: RegExp) { return unique(values.flatMap((value) => value.split(/(?<=[.!?])\s+|\r?\n/).filter((line) => pattern.test(line)).map((line) => item(line)))); }
function summarizeCommand(stdout = "", stderr = "") { const lines = `${stderr}\n${stdout}`.split(/\r?\n/).filter(Boolean); return [...lines.filter((line) => /error|fail|warn|exception|passed|success/i.test(line)).slice(0, 12), ...lines.slice(-3)].join("\n").slice(0, 4000); }
function stableHash(value: string) { let hash = 2166136261; for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, "0"); }
