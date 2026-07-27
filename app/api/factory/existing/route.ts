import { NextResponse } from "next/server";
import { executeExistingProjectTask } from "@/lib/factory/runtime";
import { executeExistingProjectThroughMissionCore } from "@/lib/mission-core/legacy-runtime-bridge";
import { executePlannerFirstMission } from "@/lib/mission-core/planned-execution";
import { factoryResultFromMission } from "@/lib/mission-core/factory-result-adapter";
import { completeExecution, failExecution, recordExecutionEvent, registerExecution } from "@/lib/factory/execution-control";
import type { FactoryExecutionEvent, FactoryExistingProjectRequest } from "@/lib/factory/types";

const missionCoreEnabled = process.env.FOUNDRY_MISSION_CORE_V2 === "1";
const typedPlannerEnabled = process.env.FOUNDRY_TYPED_OPERATION_PLANNER === "1";

export async function POST(request: Request) {
  const body = (await request.json()) as FactoryExistingProjectRequest;
  if (!body?.brief || !body?.task) {
    return NextResponse.json({ error: "Missing brief or task." }, { status: 400 });
  }
  const evidenceAttachments = body.evidenceAttachments ?? (body.evidenceImages ?? []).map((image) => ({
    ...image,
    uploadStatus: "image" as const,
  }));

  const url = new URL(request.url);
  if (url.searchParams.get("stream") !== "1") {
    try {
      if (missionCoreEnabled && typedPlannerEnabled) {
        const execution = await executePlannerFirstMission({
          body,
          projectSnapshot: projectSnapshotFrom(body),
          signal: request.signal,
          allowCompatibilityFallback: true,
        });
        const result = execution.result ?? factoryResultFromMission(execution.mission, {
          projectPath: body.localPath,
          sourceMode: body.localPath ? "local-folder" : "uploaded-copy",
        });
        return NextResponse.json({
          ...result,
          durableMissionId: execution.mission.id,
          durableMissionRevision: execution.mission.revision,
          missionExecutionPath: execution.executionPath,
          missionFallbackReason: execution.fallbackReason,
        });
      }
      if (missionCoreEnabled) {
        const execution = await executeExistingProjectThroughMissionCore(body, { signal: request.signal });
        return NextResponse.json({ ...execution.result, durableMissionId: execution.mission.id, durableMissionRevision: execution.mission.revision });
      }
      const result = await executeExistingProjectTask(body.brief, body.task, body.files ?? [], body.localPath, undefined, body.localConnector, request.signal, body.approvedCategories ?? [], body.approvedCommands ?? [], body.parentMission, body.followUpResolution, body.continuity, body.approvalResponse, body.quality, body.modelMode, evidenceAttachments, body.idempotencyCandidate, body.retryExecutionId);
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Existing project execution failed." }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const runtimeController = new AbortController();
  const unregisterExecution = registerExecution(body.controlId, runtimeController);
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      const sentEvents = new Set<string>();
      const send = (payload: unknown) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };
      const handleEvent = (event: FactoryExecutionEvent) => {
        const key = event.details?.stage && /^Model\s*·/i.test(event.title) ? `model:${event.details.stage}:${event.title}` : event.id;
        if (sentEvents.has(key)) return;
        sentEvents.add(key);
        recordExecutionEvent(body.controlId, event);
        send({ type: "event", event });
      };

      heartbeat = setInterval(() => send({ type: "heartbeat", at: Date.now() }), 30_000);

      try {
        if (missionCoreEnabled && typedPlannerEnabled) {
          const execution = await executePlannerFirstMission({
            body,
            projectSnapshot: projectSnapshotFrom(body),
            signal: runtimeController.signal,
            allowCompatibilityFallback: true,
          });
          const result = execution.result ?? factoryResultFromMission(execution.mission, {
            projectPath: body.localPath,
            sourceMode: body.localPath ? "local-folder" : "uploaded-copy",
          });
          const enriched = {
            ...result,
            durableMissionId: execution.mission.id,
            durableMissionRevision: execution.mission.revision,
            missionExecutionPath: execution.executionPath,
            missionFallbackReason: execution.fallbackReason,
          };
          completeExecution(body.controlId, enriched);
          send({ type: "mission", mission: execution.mission });
          send({ type: "result", result: enriched });
        } else if (missionCoreEnabled) {
          const execution = await executeExistingProjectThroughMissionCore(body, { signal: runtimeController.signal, onEvent: handleEvent });
          const result = { ...execution.result, durableMissionId: execution.mission.id, durableMissionRevision: execution.mission.revision };
          completeExecution(body.controlId, result);
          send({ type: "mission", mission: execution.mission });
          send({ type: "result", result });
        } else {
          const result = await executeExistingProjectTask(body.brief, body.task, body.files ?? [], body.localPath, handleEvent, body.localConnector, runtimeController.signal, body.approvedCategories ?? [], body.approvedCommands ?? [], body.parentMission, body.followUpResolution, body.continuity, body.approvalResponse, body.quality, body.modelMode, evidenceAttachments, body.idempotencyCandidate, body.retryExecutionId);
          completeExecution(body.controlId, result);
          send({ type: "result", result });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Existing project execution failed.";
        failExecution(body.controlId, message);
        send({ type: "error", error: message });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        unregisterExecution();
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function projectSnapshotFrom(body: FactoryExistingProjectRequest) {
  const files = (body.files ?? []).slice(0, 200).map((file) => `${file.path} (${file.size} bytes)`).join("\n");
  return [body.brief, files ? `Uploaded file inventory:\n${files}` : "", body.localPath ? `Connected project root: ${body.localPath}` : ""]
    .filter(Boolean)
    .join("\n\n");
}
