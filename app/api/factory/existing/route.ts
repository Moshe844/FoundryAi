import { NextResponse } from "next/server";
import { executeExistingProjectTask } from "@/lib/factory/runtime";
import { completeExecution, failExecution, recordExecutionEvent, registerExecution } from "@/lib/factory/execution-control";
import type { FactoryExistingProjectRequest } from "@/lib/factory/types";
import { plannerLocalPath } from "@/lib/mission-core/execution-project-source";

export async function POST(request: Request) {
  const body = (await request.json()) as FactoryExistingProjectRequest;
  if (!body?.brief || !body?.task) {
    return NextResponse.json({ error: "Missing brief or task." }, { status: 400 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("stream") !== "1") {
    try {
      return NextResponse.json(await runExistingProject(body, request.signal));
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
      const send = (payload: unknown) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      heartbeat = setInterval(() => send({ type: "heartbeat", at: Date.now() }), 15_000);

      try {
        const result = await runExistingProject(body, runtimeController.signal, (event) => {
          recordExecutionEvent(body.controlId, event);
          send({ type: "event", event });
        });
        completeExecution(body.controlId, result);
        send({ type: "result", result });
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

function runExistingProject(body: FactoryExistingProjectRequest, signal: AbortSignal, onEvent?: Parameters<typeof executeExistingProjectTask>[4]) {
  const localPath = plannerLocalPath(body) ?? body.localPath ?? "";
  // A loopback Local Agent root is the same machine as this desktop runtime. Execute against that
  // real path directly so command recovery inherits Foundry's trusted CA/toolchain environment;
  // retain the connector transport only for genuinely remote agents.
  const localConnector = localPath && !body.localPath ? undefined : body.localConnector;
  return executeExistingProjectTask(
    body.brief,
    body.task,
    body.files ?? [],
    localPath,
    onEvent,
    localConnector,
    signal,
    body.approvedCategories ?? [],
    body.approvedCommands ?? [],
    body.parentMission,
    body.followUpResolution,
    body.continuity,
    body.approvalResponse,
    body.quality,
    body.modelMode,
    body.evidenceAttachments ?? [],
    body.idempotencyCandidate,
    body.retryExecutionId,
  );
}
