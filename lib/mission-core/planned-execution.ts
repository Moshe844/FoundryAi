import type { ProviderId } from "@/lib/ai/providers/types";
import type { ModelTier } from "@/lib/ai/model-router";
import type { FactoryExistingProjectRequest } from "@/lib/factory/types";
import type { MissionRecord } from "./model";
import { executeDirectMission } from "./direct-execution";
import { planTypedOperations } from "./typed-operation-planner";

export type PlannerFirstExecutionResult = {
  mission: MissionRecord;
  executionPath: "typed-operations";
};

export async function executePlannerFirstMission(input: {
  body: FactoryExistingProjectRequest;
  projectSnapshot: string;
  provider?: ProviderId;
  tier?: ModelTier;
  signal?: AbortSignal;
}): Promise<PlannerFirstExecutionResult> {
  const planned = await planTypedOperations({
    missionId: input.body.controlId,
    projectId: input.body.parentMission?.projectIdentity,
    objective: input.body.task,
    projectSnapshot: input.projectSnapshot,
    localPath: input.body.localPath,
    uploadedFiles: input.body.files,
    provider: input.provider,
    tier: input.tier,
  });

  if (!planned.request) {
    throw new Error(planned.unsupportedReason || "Typed operation planning did not produce an executable plan.");
  }

  const mission = await executeDirectMission(planned.request, input.signal);
  return { mission, executionPath: "typed-operations" };
}
