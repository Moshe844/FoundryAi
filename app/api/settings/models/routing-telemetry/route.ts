import { NextResponse } from "next/server";
import { routingTelemetrySnapshot } from "@/lib/ai/routing/telemetry";
import { globalSpendSnapshot } from "@/lib/ai/routing/spend-ledger";

export async function GET() {
  return NextResponse.json({ ...(await routingTelemetrySnapshot()), dailySpend: globalSpendSnapshot() });
}
