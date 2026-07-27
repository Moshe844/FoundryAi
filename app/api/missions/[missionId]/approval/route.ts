import { NextResponse } from "next/server";
import type { ApprovalScope } from "@/lib/mission-core/model";
import { transitionMission } from "@/lib/mission-core/state-machine";
import { durableMissionRepository, durablePermissionCoordinator } from "@/lib/mission-core/stores";

export async function POST(request: Request, context: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await context.params;
  const body = (await request.json().catch(() => null)) as { approvalId?: string; decision?: "approve" | "deny"; scope?: ApprovalScope } | null;
  if (!missionId || !body?.approvalId || !body.decision) {
    return NextResponse.json({ error: "Missing mission id, approval id, or decision." }, { status: 400 });
  }

  const mission = await durableMissionRepository.get(missionId);
  if (!mission) return NextResponse.json({ error: "Mission not found." }, { status: 404 });
  const approval = mission.approvals.find((item) => item.id === body.approvalId);
  if (!approval) return NextResponse.json({ error: "Approval request not found." }, { status: 404 });
  if (approval.status !== "pending") return NextResponse.json({ error: `Approval is already ${approval.status}.` }, { status: 409 });

  const decided = await durablePermissionCoordinator.decide(approval, body.decision, body.scope);
  const now = new Date().toISOString();
  let updated = {
    ...mission,
    approvals: mission.approvals.map((item) => item.id === approval.id ? decided : item),
    revision: mission.revision + 1,
    updatedAt: now,
    journal: [
      ...mission.journal,
      {
        id: `${mission.id}:approval:${approval.id}:${mission.revision + 1}`,
        missionId: mission.id,
        at: now,
        type: "approval" as const,
        message: `${body.decision === "approve" ? "Approved" : "Denied"} ${approval.exactAction}${decided.selectedScope ? ` (${decided.selectedScope})` : ""}`,
        data: { approvalId: approval.id, decision: body.decision, scope: decided.selectedScope },
      },
    ],
  };

  if (mission.status === "awaiting_approval") {
    updated = transitionMission(updated, body.decision === "approve" ? "executing" : "blocked", {
      reason: body.decision === "deny" ? `Approval denied for ${approval.exactAction}.` : undefined,
    });
  }

  const saved = await durableMissionRepository.save(updated, mission.revision);
  return NextResponse.json(saved, { headers: { "Cache-Control": "no-store" } });
}
