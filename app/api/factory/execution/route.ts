import { NextResponse } from "next/server";
import { getExecutionSnapshot, listActiveExecutionIds } from "@/lib/factory/execution-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const controlId = new URL(request.url).searchParams.get("controlId")?.trim();
  if (!controlId) return NextResponse.json({ activeControlIds: listActiveExecutionIds() }, { headers: { "cache-control": "no-store" } });
  const snapshot = getExecutionSnapshot(controlId);
  if (!snapshot) return NextResponse.json({ state: "missing" }, { status: 404 });
  return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
}
