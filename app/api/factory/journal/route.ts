import { NextResponse } from "next/server";
import { readJournal } from "@/lib/factory/runtime";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";

    if (!projectId) {
      return NextResponse.json({ error: "Project id is required." }, { status: 400 });
    }

    const entries = await readJournal(projectId);
    return NextResponse.json({ projectId, entries });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not read the execution journal.",
      },
      { status: 500 },
    );
  }
}
