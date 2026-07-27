import { NextResponse } from "next/server";
import { executeDirectMission, type DirectMissionRequest } from "@/lib/mission-core/direct-execution";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DirectMissionRequest;
    const mission = await executeDirectMission(body, request.signal);
    return NextResponse.json(mission, {
      status: mission.status === "awaiting_approval" ? 202 : 200,
      headers: {
        "Cache-Control": "no-store",
        "ETag": `W/\"mission-${mission.id}-${mission.revision}\"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Direct mission execution failed.";
    const status = /required|at least|unique|at most/i.test(message) ? 400 : /already exists/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
