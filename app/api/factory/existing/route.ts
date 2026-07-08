import { NextResponse } from "next/server";
import { executeExistingProjectTask } from "@/lib/factory/runtime";
import type { FactoryExistingProjectRequest } from "@/lib/factory/types";

export async function POST(request: Request) {
  const body = (await request.json()) as FactoryExistingProjectRequest;
  if (!body?.brief || !body?.task) {
    return NextResponse.json({ error: "Missing brief or task." }, { status: 400 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("stream") !== "1") {
    try {
      const result = await executeExistingProjectTask(body.brief, body.task, body.files ?? [], body.localPath, undefined, body.localConnector, request.signal, body.approvedCategories ?? [], body.approvedCommands ?? [], body.parentMission, body.continuity, body.approvalResponse);
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Existing project execution failed." }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const result = await executeExistingProjectTask(body.brief, body.task, body.files ?? [], body.localPath, (event) => {
          send({ type: "event", event });
        }, body.localConnector, request.signal, body.approvedCategories ?? [], body.approvedCommands ?? [], body.parentMission, body.continuity, body.approvalResponse);
        send({ type: "result", result });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "Existing project execution failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
