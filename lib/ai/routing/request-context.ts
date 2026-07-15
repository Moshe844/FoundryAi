import type { ModelTier } from "@/lib/ai/model-router";
import type { ManagedModelRequest } from "@/lib/ai/providers/types";
import type { DynamicTaskAssessment } from "@/lib/ai/routing/types";

export function routingContext(task: string, stage: NonNullable<ManagedModelRequest["routing"]>["stage"], tier: ModelTier, workspaceId?: string, dynamicAssessment?: DynamicTaskAssessment, operationId = crypto.randomUUID()): NonNullable<ManagedModelRequest["routing"]> {
  // A budget belongs to one logical operation, not to the text of its prompt. A stable task hash
  // caused a repeated follow-up (or a retry after a blocker) to inherit the previous request's
  // exhausted ledger for 30 minutes. Multi-turn executors pass one operationId for all their turns;
  // independent route calls receive a fresh id automatically.
  const missionId = `${workspaceId ?? "workspace"}:${operationId}`;
  return { requestId: `${missionId}:${stage}`, missionId, stage, task, tier, dynamicAssessment };
}
