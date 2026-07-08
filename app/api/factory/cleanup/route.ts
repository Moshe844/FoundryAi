import { NextResponse } from "next/server";
import { deleteFactoryProject } from "@/lib/factory/runtime";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { projectId?: string };
  const projectId = body.projectId?.trim() ?? "";
  if (!projectId) {
    return NextResponse.json({ error: "Project id is required." }, { status: 400 });
  }

  try {
    await deleteFactoryProject(projectId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete project workspace." }, { status: 500 });
  }
}
