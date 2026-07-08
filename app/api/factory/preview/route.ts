import { NextResponse } from "next/server";
import { getPreviewStatus, stopPreviewForProject } from "@/lib/factory/runtime";

type PreviewRequest = {
  projectId?: string;
  action?: "status" | "stop";
};

export async function POST(request: Request) {
  const body = (await request.json()) as PreviewRequest;
  if (!body?.projectId) {
    return NextResponse.json({ error: "Missing projectId." }, { status: 400 });
  }

  if (body.action === "stop") {
    stopPreviewForProject(body.projectId);
    return NextResponse.json({ previewState: "unavailable" });
  }

  return NextResponse.json(getPreviewStatus(body.projectId));
}
