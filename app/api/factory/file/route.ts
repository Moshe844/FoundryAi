import { NextResponse } from "next/server";
import { readProjectFile } from "@/lib/factory/runtime";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";
    const filePath = url.searchParams.get("path") ?? "";

    if (!projectId || !filePath) {
      return NextResponse.json({ error: "Project id and path are required." }, { status: 400 });
    }

    const content = await readProjectFile(projectId, filePath);
    return NextResponse.json({ projectId, path: filePath, content });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not read file.",
      },
      { status: 500 },
    );
  }
}
