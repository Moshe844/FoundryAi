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
  onMissionUpdate?: (mission: MissionRecord) => void | Promise<void>;
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
  onMissionUpdate?: (mission: MissionRecord) => void | Promise<void>;
}): Promise<PlannerFirstExecutionResult> {
  const attempts = plannerRecoveryAttempts(input.tier ?? "builder");
  const priorReasons: string[] = [];
  const seenPlans = new Set<string>();
  let latestMission: MissionRecord | undefined;

  for (const attempt of attempts) {
    if (input.signal?.aborted) throw new Error("Mission planning was canceled.");
    try {
      const recoverySnapshot = priorReasons.length
        ? `${input.projectSnapshot}\n\nVerified failures from earlier attempts:\n${priorReasons.map((reason) => `- ${reason}`).join("\n")}`
        : input.projectSnapshot;
      const missionId = attempt.number === 1
        ? input.body.controlId
        : `${input.body.controlId || "mission"}:repair:${attempt.number}`;
      const planned = await planTypedOperations({
        missionId,
        projectId: input.body.parentMission?.projectIdentity,
        objective: input.body.task,
        projectSnapshot: recoverySnapshot,
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

      const mission = await executeDirectMission(planned.request, input.signal, input.onMissionUpdate);
      latestMission = mission;
      if (mission.status !== "failed") {
        return {
          mission,
          executionPath: "typed-operations",
          planningAttempts: attempt.number,
          recoveryStrategies: attempts.slice(0, attempt.number).map((item) => item.strategy),
        };
      }

      const evidence = executionFailureEvidence(mission);
      priorReasons.push(`Execution attempt ${attempt.number} failed after making real project progress. Repair the exact remaining failure without repeating successful work. ${evidence}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/No API key is configured|canceled|aborted/i.test(reason)) throw error;
      priorReasons.push(`Attempt ${attempt.number} (${attempt.strategy}, ${attempt.tier}) failed: ${reason}`);
    }
  }

  if (latestMission) {
    return {
      mission: latestMission,
      executionPath: "typed-operations",
      planningAttempts: attempts.length,
      recoveryStrategies: attempts.map((item) => item.strategy),
    };
  }

  throw new Error([
    "Foundry exhausted its bounded autonomous recovery budget without producing a safe executable plan.",
    ...priorReasons.map((reason) => `- ${reason}`),
    "No duplicate or unbounded paid planner calls were made.",
  ].join("\n"));
}

export function executionFailureEvidence(mission: MissionRecord): string {
  const failed = mission.operations.filter((operation) => operation.status === "failed");
  if (!failed.length) return mission.blocker || "The mission failed without operation-level diagnostics.";
  return failed.map((operation) => {
    const result = operation.result;
    const diagnostic = [result?.summary, result?.error, result?.output]
      .filter(Boolean)
      .join("\n")
      .slice(0, 6_000);
    return `${operation.title}${operation.target ? ` (${operation.target})` : operation.command ? ` (${operation.command})` : ""}: ${diagnostic || "No diagnostic was recorded."}`;
  }).join("\n\n");
}
