import { NextResponse } from "next/server";
import { inspectLocalConnectorSource, inspectLocalProjectSource } from "@/lib/factory/runtime";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { localPath?: string; task?: string; localConnector?: { url: string; token?: string; rootLabel?: string } };
    const apiKey = process.env.OPENAI_API_KEY;
    if (body.localConnector?.url) {
      const result = await inspectLocalConnectorSource(body.localConnector, body.task ?? "", apiKey);
      return NextResponse.json(result);
    }
    if (!body.localPath?.trim()) {
      return NextResponse.json({ error: "Local path is required." }, { status: 400 });
    }

    const result = await inspectLocalProjectSource(body.localPath, body.task ?? "", apiKey);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Project inspection failed.",
      },
      { status: 500 },
    );
  }
}
