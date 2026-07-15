import { NextResponse } from "next/server";
import { globalSpendSnapshot } from "@/lib/ai/routing/spend-ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ dailySpend: globalSpendSnapshot() });
}
