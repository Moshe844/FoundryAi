import { randomUUID } from "node:crypto";
import path from "node:path";
import { executeExistingProjectTask } from "@/lib/factory/runtime";
import type { FactoryExecutionEvent, FactoryExistingProjectRequest, FactoryProjectResult } from "@/lib/factory/types";
import { FileMissionRepository } from "./file-repository";
import { createMissionRecord, type MissionRecord, type PlannedOperation } from "./model";
import { transitionMission } from "./state-machine";

const repository = new FileMissionRepository(path.join(process.cwd(), ".foundry-data", "missions-v2"));

export type MissionCoreExecutionResult = {
  result: FactoryProjectResult;
  mission: MissionRecord;
};

/**
 * Compatibility boundary used during the architectural migration.
 *
 * The existing runtime still performs the engineering work, but mission ownership is moved out of
 * browser-only state immediately: every execution receives a durable mission record, explicit state
 * transitions, one compatibility operation, and a journal of streamed evidence. The adapter can be
 * deleted once the typed scheduler owns all runtime operations directly.
 */
export async function executeExistingProjectThroughMissionCore(
  body: FactoryExistingProjectRequest,
  options: {
    signal?: AbortSignal;
    onEvent?: (event: FactoryExecutionEvent) => void | Promise<void>;
  } = {},
): Promise<MissionCoreExecutionResult> {
  const now = new Date().toISOString();
  const missionId = body.controlId || `mission-${randomUUID()}`;
  const projectId = body.parentMission?.projectIdentity || body.localPath || body.localConnector?.rootLabel || `uploaded:${missionId}`;
  const operation: PlannedOperation = {
    id: `${missionId}:legacy-runtime`,
    missionId,
    kind: "verify",
    title: "Execute existing project through compatibility runtime",
    input: { metadata: { adapter: "legacy-runtime", sourceMode: body.localPath ? "local-folder" : "uploaded-copy" } },
    dependsOn: [],
    requirementIds: [],
    risk: "modification",
    status: "pending",
    attempt: 0,
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
  };

  let mission = createMissionRecord({ id: missionId, projectId, objective: body.task, now });
  mission = transitionMission(mission, "understanding", { now });
  mission = transitionMission(mission, "planned", { now });
  mission = { ...mission, operations: [operation], revision: mission.revision + 1, updatedAt: now };
  await repository.create(mission);

  mission = await saveTransition(mission, "executing");
  mission = await updateMission(mission, (current) => ({
    ...current,
    operations: current.operations.map((item) => item.id === operation.id
      ? { ...item, status: "running", attempt: 1, updatedAt: new Date().toISOString() }
      : item),
  }));

  const evidenceAttachments = body.evidenceAttachments ?? (body.evidenceImages ?? []).map((image) => ({ ...image, uploadStatus: "image" as const }));
  let journalQueue = Promise.resolve();
  let journalError: unknown;
  const enqueueEvent = (event: FactoryExecutionEvent) => {
    journalQueue = journalQueue.then(async () => {
      mission = await appendRuntimeEvent(mission, event);
      await options.onEvent?.(event);
    }).catch((error) => {
      journalError = journalError ?? error;
      // Evidence persistence failure is recorded after the legacy runtime settles; it must not create
      // concurrent revision retries or interrupt the runtime while it may hold project processes open.
    });
  };

  try {
    const result = await executeExistingProjectTask(
      body.brief,
      body.task,
      body.files ?? [],
      body.localPath,
      enqueueEvent,
      body.localConnector,
      options.signal,
      body.approvedCategories ?? [],
      body.approvedCommands ?? [],
      body.parentMission,
      body.followUpResolution,
      body.continuity,
      body.approvalResponse,
      body.quality,
      body.modelMode,
      evidenceAttachments,
      body.idempotencyCandidate,
      body.retryExecutionId,
    );
    await journalQueue;
    if (journalError) {
      mission = await appendNote(mission, `Some streamed event evidence could not be persisted: ${journalError instanceof Error ? journalError.message : String(journalError)}`);
    }

    const completedAt = new Date().toISOString();
    const changedFiles = result.files.filter((file) => file.status === "created" || file.status === "edited").map((file) => file.path);
    mission = await updateMission(mission, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operation.id
        ? {
            ...item,
            status: result.status === "awaiting-approval" ? "awaiting_approval" : result.status === "failed" ? "failed" : "succeeded",
            updatedAt: completedAt,
            result: {
              summary: `Compatibility runtime returned status ${result.status}.`,
              evidence: [
                ...changedFiles,
                ...result.commands.map((command) => `${command.command}: ${command.exitCode ?? "running"}`),
              ].slice(0, 100),
              changed: changedFiles.length > 0,
              completedAt,
            },
          }
        : item),
    }));

    if (result.status === "awaiting-approval") {
      mission = await saveTransition(mission, "awaiting_approval", result.blocker);
      return { result, mission };
    }
    if (result.status === "needs-clarification") {
      mission = await saveTransition(mission, "blocked", result.blocker || "Mission requires clarification.");
      return { result, mission };
    }
    if (result.status === "failed" || result.status === "unsupported" || result.status === "stopped") {
      mission = await saveTransition(mission, "failed", result.blocker || `Runtime settled with ${result.status}.`);
      return { result, mission };
    }

    mission = await saveTransition(mission, "verifying");
    const hasFailedVerification = result.verification?.some((entry) => entry.result === "fail") ?? false;
    const hasWarnings = hasFailedVerification || Boolean(result.engineeringReport?.remainingIssues.length);
    mission = await saveTransition(mission, hasWarnings ? "completed_with_warnings" : "completed");
    return { result, mission };
  } catch (error) {
    await journalQueue;
    const failedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Existing project execution failed.";
    mission = await updateMission(mission, (current) => ({
      ...current,
      blocker: message,
      operations: current.operations.map((item) => item.id === operation.id
        ? {
            ...item,
            status: "failed",
            updatedAt: failedAt,
            result: { summary: message, evidence: [], error: error instanceof Error ? error.stack || message : message, completedAt: failedAt },
          }
        : item),
    }));
    mission = await saveTransition(mission, "failed", message);
    throw error;
  }
}

export async function readDurableMission(missionId: string) {
  return repository.get(missionId);
}

async function appendRuntimeEvent(mission: MissionRecord, event: FactoryExecutionEvent) {
  return updateMission(mission, (current) => ({
    ...current,
    journal: [
      ...current.journal,
      {
        id: `${current.id}:legacy-event:${event.id}:${current.revision + 1}`,
        missionId: current.id,
        at: new Date().toISOString(),
        type: "operation",
        message: `${event.title}${event.status ? ` (${event.status})` : ""}`,
        data: {
          legacyEventId: event.id,
          kind: event.kind,
          status: event.status,
          filePath: event.filePath,
          command: event.command,
        },
      },
    ],
  }));
}

async function appendNote(mission: MissionRecord, message: string) {
  return updateMission(mission, (current) => ({
    ...current,
    journal: [...current.journal, { id: `${current.id}:note:${current.revision + 1}`, missionId: current.id, at: new Date().toISOString(), type: "note", message }],
  }));
}

async function saveTransition(mission: MissionRecord, status: Parameters<typeof transitionMission>[1], reason?: string) {
  return repository.save(transitionMission(mission, status, { reason }), mission.revision);
}

async function updateMission(mission: MissionRecord, updater: (record: MissionRecord) => MissionRecord) {
  const now = new Date().toISOString();
  const updated = updater(mission);
  return repository.save({ ...updated, revision: mission.revision + 1, updatedAt: now }, mission.revision);
}
