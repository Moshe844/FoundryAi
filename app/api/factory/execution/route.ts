import { NextResponse } from "next/server";
import { getExecutionSnapshot } from "@/lib/factory/execution-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const controlId = new URL(request.url).searchParams.get("controlId")?.trim();
  if (!controlId) return NextResponse.json({ error: "Missing execution control id." }, { status: 400 });
  const snapshot = getExecutionSnapshot(controlId);
  if (!snapshot) return NextResponse.json({ state: "missing" }, { status: 404 });
  return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
}
