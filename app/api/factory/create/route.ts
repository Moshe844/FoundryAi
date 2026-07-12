import { NextResponse } from "next/server";
import { createFactoryProject } from "@/lib/factory/runtime";
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
      const stream = new ReadableStream({
        start(controller) {
          const send = (payload: unknown) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          };

          void createFactoryProject(
            body.brief ?? "",
            (event: FactoryExecutionEvent) => {
              send({ type: "event", event });
            },
            body.discovery,
            body.modelMode,
          )
            .then((result) => {
              send({ type: "result", result });
              controller.close();
            })
            .catch((error) => {
              send({ type: "error", error: error instanceof Error ? error.message : "Factory project creation failed." });
              controller.close();
            });
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-cache, no-transform",
        },
      });
    }

    const result = await createFactoryProject(body.brief, undefined, body.discovery, body.modelMode);
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
