import { NextResponse } from "next/server";
import { executeExistingProjectTask } from "@/lib/factory/runtime";
import { completeExecution, failExecution, recordExecutionEvent, registerExecution } from "@/lib/factory/execution-control";
import type { FactoryExecutionEvent, FactoryExistingProjectRequest } from "@/lib/factory/types";

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
  const stream = new ReadableStream({
    async start(controller) {
      const sentEvents = new Set<string>();
      const send = (payload: unknown) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const result = await executeExistingProjectTask(body.brief, body.task, body.files ?? [], body.localPath, (event: FactoryExecutionEvent) => {
          const key = event.details?.stage && /^Model\s*·/i.test(event.title) ? `model:${event.details.stage}:${event.title}` : event.id;
          if (sentEvents.has(key)) return;
          sentEvents.add(key);
          recordExecutionEvent(body.controlId, event);
          send({ type: "event", event });
        }, body.localConnector, runtimeController.signal, body.approvedCategories ?? [], body.approvedCommands ?? [], body.parentMission, body.followUpResolution, body.continuity, body.approvalResponse, body.quality, body.modelMode, evidenceAttachments, body.idempotencyCandidate, body.retryExecutionId);
        completeExecution(body.controlId, result);
        send({ type: "result", result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Existing project execution failed.";
        failExecution(body.controlId, message);
        send({ type: "error", error: message });
      } finally {
        unregisterExecution();
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      // A browser reload only disconnects this subscriber. The server execution
      // remains active and can be recovered through its durable control snapshot.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
