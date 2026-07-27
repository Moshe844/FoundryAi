import { NextResponse } from "next/server";
import { readDurableMission } from "@/lib/mission-core/legacy-runtime-bridge";

export async function GET(_request: Request, context: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await context.params;
  if (!missionId) return NextResponse.json({ error: "Missing mission id." }, { status: 400 });
  const mission = await readDurableMission(missionId);
  if (!mission) return NextResponse.json({ error: "Mission not found." }, { status: 404 });
  return NextResponse.json(mission, {
    headers: {
      "Cache-Control": "no-store",
      "ETag": `W/\"mission-${mission.id}-${mission.revision}\"`,
    },
  });
}
