import { NextResponse } from "next/server";
import { getPreviewStatus, launchDesktopPreview, stopPreviewForProject } from "@/lib/factory/runtime";

type PreviewRequest = {
  projectId?: string;
  action?: "status" | "stop" | "launch-desktop";
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

  if (body.action === "launch-desktop") {
    const result = launchDesktopPreview(body.projectId);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  return NextResponse.json(getPreviewStatus(body.projectId));
}
