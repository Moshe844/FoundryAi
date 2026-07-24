import { NextResponse } from "next/server";
import { createFactoryProject } from "@/lib/factory/runtime";
import { completeExecution, failExecution, recordExecutionEvent, registerExecution } from "@/lib/factory/execution-control";
import type { FactoryCreateRequest, FactoryExecutionEvent } from "@/lib/factory/types";
import { stackManifest } from "@/lib/certified-build";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const body = (await request.json()) as Partial<FactoryCreateRequest>;
    if (!body.brief?.trim()) {
      return NextResponse.json({ error: "Project brief is required." }, { status: 400 });
    }
    const certifiedStackId = body.brief.match(/^Certified stack id:\s*(.+)$/im)?.[1]?.trim();
    if (certifiedStackId === "none") {
      return NextResponse.json({
        error: "Foundry did not find a Level 4 certified stack that can deliver this project in the current environment. Review the architecture limitation or configure the required build environment before starting execution.",
        code: "NO_ELIGIBLE_CERTIFIED_STACK",
      }, { status: 409 });
    }
    if (certifiedStackId) {
      const manifest = stackManifest(certifiedStackId);
      if (!manifest || manifest.supportLevel !== 4 || manifest.status !== "certified") {
        return NextResponse.json({ error: "The selected stack does not have a current Level 4 Foundry certification manifest.", code: "STACK_NOT_CERTIFIED" }, { status: 409 });
      }
    }
    const architectureLine = body.brief.match(/^Project architecture:\s*(.+)$/im)?.[1]?.trim();
    if (architectureLine) {
      try {
        const architecture = JSON.parse(architectureLine) as { applications?: Array<{ stackId?: string }> };
        const unsupported = (architecture.applications ?? []).map((application) => application.stackId ?? "").filter((stackId) => { const manifest = stackManifest(stackId); return !manifest || manifest.supportLevel !== 4 || manifest.status !== "certified"; });
        if (unsupported.length) return NextResponse.json({ error: `The composite project includes stacks without a current Level 4 implementation: ${unsupported.join(", ")}.`, code: "COMPOSITE_STACK_NOT_CERTIFIED" }, { status: 409 });
      } catch {
        return NextResponse.json({ error: "The certified project architecture is malformed.", code: "INVALID_PROJECT_ARCHITECTURE" }, { status: 400 });
      }
    }

    if (url.searchParams.get("stream") === "1") {
      const encoder = new TextEncoder();
      const runtimeController = new AbortController();
      const unregisterExecution = registerExecution(body.controlId, runtimeController);
      let disconnected = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const stream = new ReadableStream({
        start(controller) {
          const sentEvents = new Set<string>();
          const send = (payload: unknown) => {
            if (!disconnected) controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          };

          // A single model call generating the first batch — or a long install/build — can legitimately
          // emit no events for minutes. Without a keepalive the client's 150s inactivity watchdog kills
          // the mission mid-work (observed: "Generating the first runnable source batch" → stopped at
          // 150s). This heartbeat only signals the server is still alive and working; genuine hangs stay
          // bounded by the per-operation server timeouts, and if the server process dies the heartbeat
          // stops so the client watchdog still fires correctly. The client ignores unknown message types.
          heartbeat = setInterval(() => send({ type: "heartbeat", at: Date.now() }), 30_000);

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
            body.evidenceAttachments ?? [],
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
              if (heartbeat) clearInterval(heartbeat);
              unregisterExecution();
            });
        },
        cancel() {
          disconnected = true;
          if (heartbeat) clearInterval(heartbeat);
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

    const result = await createFactoryProject(body.brief, undefined, body.discovery, body.modelMode, body.quality, undefined, body.evidenceAttachments ?? []);
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
