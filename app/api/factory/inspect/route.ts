import { NextResponse } from "next/server";
import { inspectLocalConnectorSource, inspectLocalProjectSource, inspectUploadedProjectSource } from "@/lib/factory/runtime";
import { apiKeyForProvider } from "@/lib/ai/providers/dispatch";
import { routePayloadDynamically } from "@/lib/ai/routing/dynamic-router";
import { tierForRuntimePayload, type ModelMode } from "@/lib/ai/model-router";
import type { FactoryExecutionEvent, FactoryUploadedFile } from "@/lib/factory/types";

type InspectRequest = {
  localPath?: string;
  task?: string;
  mode?: ModelMode;
  localConnector?: { url: string; token?: string; rootLabel?: string };
  files?: FactoryUploadedFile[];
};

async function performInspection(body: InspectRequest, onEvent?: (event: FactoryExecutionEvent) => void | Promise<void>) {
  // Manual modes are ceilings, as promised by the selector UI, not a requirement to spend at
  // that tier. A Builder ceiling must still route a simple question to Fast.
  const requestedCeiling = body.mode && body.mode !== "auto" ? body.mode : undefined;
  const tier = tierForRuntimePayload(body.task ?? "", requestedCeiling);
  const routed = await routePayloadDynamically({ task: body.task ?? "" }, tier);
  const selected = { provider: routed.decision.provider, apiKey: apiKeyForProvider(routed.decision.provider) };
  const result = body.localConnector?.url
    ? await inspectLocalConnectorSource(body.localConnector, body.task ?? "", selected.apiKey, selected.provider, tier, onEvent)
    : body.localPath?.trim()
      ? await inspectLocalProjectSource(body.localPath, body.task ?? "", selected.apiKey, selected.provider, tier, onEvent)
      : await inspectUploadedProjectSource(body.files ?? [], body.task ?? "", selected.apiKey, selected.provider, tier, onEvent);
  return { ...result, modelSelection: result.answeredByModel ? routed.decision : undefined };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InspectRequest;
    if (!body.localConnector?.url && !body.localPath?.trim() && !body.files?.length) {
      return NextResponse.json({ error: "A local path, connector, or uploaded project files are required." }, { status: 400 });
    }

    const url = new URL(request.url);
    if (url.searchParams.get("stream") !== "1") {
      return NextResponse.json(await performInspection(body));
    }

    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };
        try {
          const initialEvent: FactoryExecutionEvent = {
            id: `inspect-start-${Date.now()}`,
            timestamp: new Date().toISOString(),
            kind: "planning",
            status: "completed",
            title: /\b(send|share|give|attach|download|export|provide)\b/i.test(body.task ?? "")
              ? "Locating the requested project files"
              : "Identifying the project evidence needed for this question",
          };
          send({ type: "event", event: initialEvent });
          const result = await performInspection(body, (event) => send({ type: "event", event }));
          send({ type: "result", result });
        } catch (error) {
          send({ type: "error", error: error instanceof Error ? error.message : "Project inspection failed." });
        } finally {
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Project inspection failed." }, { status: 500 });
  }
}
