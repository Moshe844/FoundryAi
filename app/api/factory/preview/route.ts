import { NextResponse } from "next/server";
import { getPreviewStatus, launchAndroidPreview, launchDesktopPreview, refreshPreviewForProject, stopPreviewForProject } from "@/lib/factory/runtime";
import { captureAndroidEmulatorFrame, sendAndroidEmulatorTap } from "@/lib/factory/android-emulator";

type PreviewRequest = {
  projectId?: string;
  projectPath?: string;
  action?: "status" | "stop" | "launch-desktop" | "launch-android" | "android-frame" | "android-tap" | "refresh";
  serial?: string;
  x?: number;
  y?: number;
  localConnector?: {
    url?: string;
    token?: string;
    rootLabel?: string;
  };
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
    const result = await launchDesktopPreview(body.projectId, body.projectPath);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  if (body.action === "launch-android") {
    const result = await launchAndroidPreview(body.projectId, body.projectPath);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  if (body.action === "android-frame") {
    const result = captureAndroidEmulatorFrame(body.serial);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  if (body.action === "android-tap") {
    const result = sendAndroidEmulatorTap(Number(body.x), Number(body.y), body.serial);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  if (body.action === "refresh") {
    try {
      const localConnector = body.localConnector?.url && body.localConnector.rootLabel
        ? {
            url: body.localConnector.url,
            token: body.localConnector.token,
            rootLabel: body.localConnector.rootLabel,
          }
        : undefined;
      return NextResponse.json(await refreshPreviewForProject(body.projectId, localConnector));
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
