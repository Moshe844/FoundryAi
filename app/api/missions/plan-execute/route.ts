import { NextResponse } from "next/server";
import type { FactoryExistingProjectRequest } from "@/lib/factory/types";
import type { ModelTier } from "@/lib/ai/model-router";
import type { ProviderId } from "@/lib/ai/providers/types";
import { executePlannerFirstMission } from "@/lib/mission-core/planned-execution";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      request?: FactoryExistingProjectRequest;
      projectSnapshot?: string;
      provider?: ProviderId;
      tier?: ModelTier;
      allowCompatibilityFallback?: boolean;
    };
    if (!body.request?.task || !body.request?.brief) {
      return NextResponse.json({ error: "A complete existing-project request is required." }, { status: 400 });
    }
    if (!body.request.localPath && !body.request.files?.length) {
      return NextResponse.json({ error: "A local project path or uploaded files are required." }, { status: 400 });
    }
    const execution = await executePlannerFirstMission({
      body: body.request,
      projectSnapshot: body.projectSnapshot ?? "",
      provider: body.provider,
      tier: body.tier,
      signal: request.signal,
      allowCompatibilityFallback: body.allowCompatibilityFallback,
    });
    return NextResponse.json(execution);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Planner-first mission execution failed." }, { status: 500 });
  }
}
