import { NextResponse } from "next/server";
import { listProjectFiles, safeProjectPath } from "@/lib/factory/runtime";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";

    if (!projectId) {
      return NextResponse.json({ error: "Project id is required." }, { status: 400 });
    }

    const projectPath = safeProjectPath(projectId);
    const files = await listProjectFiles(projectPath);
    return NextResponse.json({ projectId, files });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not list files.",
      },
      { status: 500 },
    );
  }
}
