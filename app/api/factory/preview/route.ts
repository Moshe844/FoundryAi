import { NextResponse } from "next/server";
import { getPreviewStatus, launchDesktopPreview, refreshPreviewForProject, stopPreviewForProject } from "@/lib/factory/runtime";

type PreviewRequest = {
  projectId?: string;
  action?: "status" | "stop" | "launch-desktop" | "refresh";
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as PreviewRequest | null;
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

  if (body.action === "refresh") {
    try {
      return NextResponse.json(await refreshPreviewForProject(body.projectId));
    } catch (error) {
      return NextResponse.json({
        previewState: "unavailable",
        previewPlatform: "web",
        previewReason: error instanceof Error ? error.message : "The project preview could not be refreshed.",
      });
    }
  }

  return NextResponse.json(await getPreviewStatus(body.projectId));
}
