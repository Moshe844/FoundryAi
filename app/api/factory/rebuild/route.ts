import { NextResponse } from "next/server";
import { rebuildFactoryProject } from "@/lib/factory/runtime";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { projectId?: string };
    if (!body.projectId?.trim()) {
      return NextResponse.json({ error: "Project id is required." }, { status: 400 });
    }

    const result = await rebuildFactoryProject(body.projectId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Factory rebuild failed.",
      },
      { status: 500 },
    );
  }
}
