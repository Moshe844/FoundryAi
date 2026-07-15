import { NextResponse } from "next/server";
import { environmentReadinessForStack, installToolchain } from "@/lib/toolchains/provisioner";

export const maxDuration = 1200;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { action?: "inspect" | "install"; stackId?: string; toolchainId?: string; approvedCommand?: string };
    if (body.action === "inspect" && body.stackId) return NextResponse.json(await environmentReadinessForStack(body.stackId));
    if (body.action === "install" && body.toolchainId && body.approvedCommand) {
      const result = await installToolchain(body.toolchainId, body.approvedCommand);
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }
    return NextResponse.json({ error: "Missing a valid environment action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Environment preparation failed.";
    const status = /unknown toolchain|approval did not match/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
