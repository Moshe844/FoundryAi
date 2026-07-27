import { NextResponse } from "next/server";
import { executePlannerFirstMission } from "@/lib/mission-core/planned-execution";
import { factoryResultFromMission } from "@/lib/mission-core/factory-result-adapter";
import { completeExecution, failExecution, registerExecution } from "@/lib/factory/execution-control";
import type { FactoryExistingProjectRequest } from "@/lib/factory/types";

export async function POST(request: Request) {
  const body = (await request.json()) as FactoryExistingProjectRequest;
  if (!body?.brief || !body?.task) {
    return NextResponse.json({ error: "Missing brief or task." }, { status: 400 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("stream") !== "1") {
    try {
      const execution = await executePlannerFirstMission({
        body,
        projectSnapshot: projectSnapshotFrom(body),
        signal: request.signal,
      });
      const result = factoryResultFromMission(execution.mission, {
        projectPath: body.localPath,
        sourceMode: body.localPath ? "local-folder" : "uploaded-copy",
      });
      return NextResponse.json({
        ...result,
        durableMissionId: execution.mission.id,
        durableMissionRevision: execution.mission.revision,
        missionExecutionPath: execution.executionPath,
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Existing project execution failed." }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const runtimeController = new AbortController();
  const unregisterExecution = registerExecution(body.controlId, runtimeController);
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lastMissionRevision = -1;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      heartbeat = setInterval(() => send({ type: "heartbeat", at: Date.now() }), 15_000);

      try {
        const execution = await executePlannerFirstMission({
          body,
          projectSnapshot: projectSnapshotFrom(body),
          signal: runtimeController.signal,
          onMissionUpdate: async (mission) => {
            if (mission.revision <= lastMissionRevision) return;
            lastMissionRevision = mission.revision;
            send({ type: "mission", mission });
          },
        });
        const result = factoryResultFromMission(execution.mission, {
          projectPath: body.localPath,
          sourceMode: body.localPath ? "local-folder" : "uploaded-copy",
        });
        const enriched = {
          ...result,
          durableMissionId: execution.mission.id,
          durableMissionRevision: execution.mission.revision,
          missionExecutionPath: execution.executionPath,
          planningAttempts: execution.planningAttempts,
          recoveryStrategies: execution.recoveryStrategies,
        };
        completeExecution(body.controlId, enriched);
        if (execution.mission.revision > lastMissionRevision) send({ type: "mission", mission: execution.mission });
        send({ type: "result", result: enriched });
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
      runtimeController.abort();
      if (heartbeat) clearInterval(heartbeat);
      unregisterExecution();
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
  return [
    body.brief,
    files ? `Uploaded file inventory:\n${files}` : "",
    body.localPath ? `Connected project root: ${body.localPath}` : "",
    body.localConnector?.rootLabel ? `Local agent project root: ${body.localConnector.rootLabel}` : "",
  ].filter(Boolean).join("\n\n");
}
