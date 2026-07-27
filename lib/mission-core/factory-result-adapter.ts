import type { FactoryExecutionEvent, FactoryFileEntry, FactoryProjectResult } from "@/lib/factory/types";
import type { MissionRecord } from "./model";

export function factoryResultFromMission(mission: MissionRecord, input: { projectName?: string; projectPath?: string; sourceMode?: FactoryProjectResult["sourceMode"] } = {}): FactoryProjectResult {
  const files = changedFiles(mission);
  const commands = mission.operations
    .filter((operation) => operation.command && operation.result)
    .map((operation) => ({
      command: operation.command!,
      exitCode: operation.result?.exitCode ?? (operation.status === "succeeded" ? 0 : null),
      stdout: operation.result?.output ?? "",
      stderr: operation.result?.error ?? "",
      durationMs: operation.result?.durationMs,
    }));
  const timeline: FactoryExecutionEvent[] = mission.journal.map((entry) => ({
    id: entry.id,
    timestamp: entry.at,
    kind: entry.type === "verification" ? "build" : entry.type === "approval" ? "blocked" : entry.type === "recovery" ? "fix" : "reasoning",
    status: /failed|denied|blocked/i.test(entry.message) ? "error" : /warning/i.test(entry.message) ? "warning" : "completed",
    title: entry.message,
    details: entry.data as FactoryExecutionEvent["details"],
  }));
  const status: FactoryProjectResult["status"] = mission.status === "awaiting_approval"
    ? "awaiting-approval"
    : mission.status === "awaiting_clarification"
      ? "needs-clarification"
      : mission.status === "failed" || mission.status === "blocked"
        ? "failed"
        : mission.status === "canceled"
          ? "stopped"
          : mission.status === "completed" || mission.status === "completed_with_warnings"
            ? "passed"
            : "running";
  return {
    projectId: mission.projectId,
    projectName: input.projectName || mission.projectId.split(/[\\/]/).filter(Boolean).pop() || "Foundry project",
    projectPath: input.projectPath || mission.projectId,
    briefPath: "",
    stack: "Existing project",
    template: "mission-core",
    sourceMode: input.sourceMode,
    objective: mission.objective,
    status,
    supported: true,
    blocker: mission.blocker,
    events: mission.journal.map((entry) => entry.message),
    files,
    commands,
    timeline,
    verification: mission.verification.map((verification) => ({
      check_type: "manual-evidence",
      result: verification.status === "passed" ? "pass" : verification.status === "failed" ? "fail" : "skipped",
      evidence: [verification.summary, ...verification.evidence].filter(Boolean).join(" — "),
    })),
  };
}

function changedFiles(mission: MissionRecord): FactoryFileEntry[] {
  const entries = new Map<string, FactoryFileEntry>();
  for (const operation of mission.operations) {
    if (!operation.target || !operation.result?.changed) continue;
    if (operation.kind !== "write_file" && operation.kind !== "delete_file") continue;
    entries.set(operation.target, {
      path: operation.target,
      status: operation.kind === "write_file" ? "edited" : "edited",
      size: typeof operation.input?.content === "string" ? Buffer.byteLength(operation.input.content) : 0,
      contentHash: operation.result.contentHash,
    });
  }
  return [...entries.values()];
}
