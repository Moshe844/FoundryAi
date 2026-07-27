import type { ProviderId } from "@/lib/ai/providers/types";
import type { ModelTier } from "@/lib/ai/model-router";
import type { FactoryExistingProjectRequest } from "@/lib/factory/types";
import type { MissionRecord } from "./model";
import { executeDirectMission } from "./direct-execution";
import { planTypedOperations } from "./typed-operation-planner";
import {
  executionIdempotencyKey,
  planFingerprint,
  plannerRecoveryAttempts,
  recoveryInstruction,
} from "./planner-recovery-policy";

export type PlannerFirstExecutionResult = {
  mission: MissionRecord;
  executionPath: "typed-operations";
  planningAttempts: number;
  recoveryStrategies: string[];
};

const inFlightExecutions = new Map<string, Promise<PlannerFirstExecutionResult>>();

export async function executePlannerFirstMission(input: {
  body: FactoryExistingProjectRequest;
  projectSnapshot: string;
  provider?: ProviderId;
  tier?: ModelTier;
  signal?: AbortSignal;
}): Promise<PlannerFirstExecutionResult> {
  const key = executionIdempotencyKey({
    controlId: input.body.controlId,
    projectIdentity: input.body.parentMission?.projectIdentity || input.body.localPath,
    task: input.body.task,
  });
  const existing = inFlightExecutions.get(key);
  if (existing) return existing;

  const execution = executeWithRecovery(input);
  inFlightExecutions.set(key, execution);
  try {
    return await execution;
  } finally {
    if (inFlightExecutions.get(key) === execution) inFlightExecutions.delete(key);
  }
}

async function executeWithRecovery(input: {
  body: FactoryExistingProjectRequest;
  projectSnapshot: string;
  provider?: ProviderId;
  tier?: ModelTier;
  signal?: AbortSignal;
}): Promise<PlannerFirstExecutionResult> {
  const attempts = plannerRecoveryAttempts(input.tier ?? "builder");
  const priorReasons: string[] = [];
  const seenPlans = new Set<string>();

  for (const attempt of attempts) {
    if (input.signal?.aborted) throw new Error("Mission planning was canceled.");
    try {
      const planned = await planTypedOperations({
        missionId: input.body.controlId,
        projectId: input.body.parentMission?.projectIdentity,
        objective: input.body.task,
        projectSnapshot: input.projectSnapshot,
        localPath: input.body.localPath,
        uploadedFiles: input.body.files,
        provider: input.provider,
        tier: attempt.tier,
        maxOutputTokens: attempt.maxOutputTokens,
        recoveryInstruction: recoveryInstruction(attempt, priorReasons),
      });

      if (!planned.request) {
        priorReasons.push(planned.unsupportedReason || `Planning attempt ${attempt.number} produced no executable operations.`);
        continue;
      }

      const fingerprint = planFingerprint(planned.request);
      if (seenPlans.has(fingerprint)) {
        priorReasons.push(`Planning attempt ${attempt.number} repeated an already rejected operation plan.`);
        continue;
      }
      seenPlans.add(fingerprint);

      const mission = await executeDirectMission(planned.request, input.signal);
      return {
        mission,
        executionPath: "typed-operations",
        planningAttempts: attempt.number,
        recoveryStrategies: attempts.slice(0, attempt.number).map((item) => item.strategy),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/No API key is configured|canceled|aborted/i.test(reason)) throw error;
      priorReasons.push(`Attempt ${attempt.number} (${attempt.strategy}, ${attempt.tier}) failed: ${reason}`);
    }
  }

  throw new Error([
    "Foundry exhausted its bounded autonomous planning recovery budget without producing a safe executable plan.",
    ...priorReasons.map((reason) => `- ${reason}`),
    "No duplicate or unbounded paid planner calls were made.",
  ].join("\n"));
}
