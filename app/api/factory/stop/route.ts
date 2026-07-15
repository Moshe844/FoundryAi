import { NextResponse } from "next/server";
import { stopExecution } from "@/lib/factory/execution-control";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { controlId?: string };
  const controlId = String(body.controlId ?? "").trim();
  if (!controlId) return NextResponse.json({ error: "Missing execution control id." }, { status: 400 });
  return NextResponse.json({ ok: true, stopped: stopExecution(controlId) });
}
