import { NextResponse } from "next/server";
import { performRollback } from "@/lib/factory/runtime";
import type { LocalConnectorConfig } from "@/lib/ai/mission/project-access";

type UndoRequest = {
  projectId?: string;
  entryId?: string;
  localPath?: string;
  localConnector?: LocalConnectorConfig;
};

export async function POST(request: Request) {
  const body = (await request.json()) as UndoRequest;
  if (!body?.projectId || !body?.entryId) {
    return NextResponse.json({ error: "Missing projectId or entryId." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const result = await performRollback(body.projectId as string, body.entryId as string, { localPath: body.localPath, localConnector: body.localConnector }, (event) => {
          send({ type: "event", event });
        });
        send({ type: "result", result });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "Rollback failed." });
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
