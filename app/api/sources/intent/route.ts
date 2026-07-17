import { NextResponse } from "next/server";
import { needsSources } from "@/lib/sources/provider";
import type { SourceProviderRequest } from "@/lib/sources/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<SourceProviderRequest>;
    const sourceRequest: SourceProviderRequest = {
      missionTitle: typeof body.missionTitle === "string" ? body.missionTitle : "",
      userMessage: typeof body.userMessage === "string" ? body.userMessage : "",
      priorMessages: Array.isArray(body.priorMessages) ? body.priorMessages : [],
      previousSources: Array.isArray(body.previousSources) ? body.previousSources : [],
    };

    return NextResponse.json({ needsSources: needsSources(sourceRequest) });
  } catch {
    return NextResponse.json({ needsSources: false });
  }
}
