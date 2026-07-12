import { NextResponse } from "next/server";
import { inspectLocalConnectorSource, inspectLocalProjectSource } from "@/lib/factory/runtime";
import { providerForTier } from "@/lib/ai/providers/dispatch";
import { tierForRuntimePayload, type ModelMode } from "@/lib/ai/model-router";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { localPath?: string; task?: string; mode?: ModelMode; localConnector?: { url: string; token?: string; rootLabel?: string } };
    const tier = body.mode && body.mode !== "auto" ? body.mode : tierForRuntimePayload({ task: body.task ?? "" });
    const selected = providerForTier(tier);
    if (body.localConnector?.url) {
      const result = await inspectLocalConnectorSource(body.localConnector, body.task ?? "", selected?.apiKey, selected?.provider, tier);
      return NextResponse.json(result);
    }
    if (!body.localPath?.trim()) {
      return NextResponse.json({ error: "Local path is required." }, { status: 400 });
    }

    const result = await inspectLocalProjectSource(body.localPath, body.task ?? "", selected?.apiKey, selected?.provider, tier);
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
