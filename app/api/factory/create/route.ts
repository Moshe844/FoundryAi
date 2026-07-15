import { NextResponse } from "next/server";
import { createFactoryProject } from "@/lib/factory/runtime";
import { completeExecution, failExecution, recordExecutionEvent, registerExecution } from "@/lib/factory/execution-control";
import type { FactoryCreateRequest, FactoryExecutionEvent } from "@/lib/factory/types";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const body = (await request.json()) as Partial<FactoryCreateRequest>;
    if (!body.brief?.trim()) {
      return NextResponse.json({ error: "Project brief is required." }, { status: 400 });
    }

    if (url.searchParams.get("stream") === "1") {
      const encoder = new TextEncoder();
      const runtimeController = new AbortController();
      const unregisterExecution = registerExecution(body.controlId, runtimeController);
      let disconnected = false;
      const stream = new ReadableStream({
        start(controller) {
          const sentEvents = new Set<string>();
          const send = (payload: unknown) => {
            if (!disconnected) controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          };

          void createFactoryProject(
            body.brief ?? "",
            (event: FactoryExecutionEvent) => {
              const key = event.details?.stage && /^Model\s*·/i.test(event.title) ? `model:${event.details.stage}:${event.title}` : event.id;
              if (sentEvents.has(key)) return;
              sentEvents.add(key);
              recordExecutionEvent(body.controlId, event);
              send({ type: "event", event });
            },
            body.discovery,
            body.modelMode,
            body.quality,
            runtimeController.signal,
          )
            .then((result) => {
              completeExecution(body.controlId, result);
              send({ type: "result", result });
              if (!disconnected) controller.close();
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : "Factory project creation failed.";
              failExecution(body.controlId, message);
              send({ type: "error", error: message });
              if (!disconnected) controller.close();
            })
            .finally(() => {
              unregisterExecution();
            });
        },
        cancel() {
          disconnected = true;
          // Reload/navigation disconnects only this stream subscriber. The
          // build remains active until completion or an explicit Stop request.
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-cache, no-transform",
        },
      });
    }

    const result = await createFactoryProject(body.brief, undefined, body.discovery, body.modelMode, body.quality);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Factory project creation failed.",
      },
      { status: 500 },
    );
  }
}
