import { createHash } from "node:crypto";
import type { ModelTier } from "@/lib/ai/model-router";
import type { DirectMissionRequest } from "./direct-execution";

export type PlannerRecoveryAttempt = {
  number: number;
  tier: ModelTier;
  strategy: "initial" | "more-context" | "decompose" | "alternate-approach";
  maxOutputTokens: number;
};

export type PlannerRecoveryBudget = {
  maxPaidCalls: number;
  maxTotalOutputTokens: number;
  allowPremiumEscalation: boolean;
};

const DEFAULT_BUDGET: PlannerRecoveryBudget = {
  maxPaidCalls: 3,
  maxTotalOutputTokens: 24000,
  allowPremiumEscalation: false,
};

export function plannerRecoveryBudgetFromEnv(): PlannerRecoveryBudget {
  return {
    maxPaidCalls: boundedInt(process.env.FOUNDRY_PLANNER_MAX_PAID_CALLS, 1, 5, DEFAULT_BUDGET.maxPaidCalls),
    maxTotalOutputTokens: boundedInt(process.env.FOUNDRY_PLANNER_MAX_OUTPUT_TOKENS, 4000, 50000, DEFAULT_BUDGET.maxTotalOutputTokens),
    allowPremiumEscalation: process.env.FOUNDRY_ALLOW_PREMIUM_RECOVERY === "1",
  };
}

export function plannerRecoveryAttempts(initialTier: ModelTier, budget = plannerRecoveryBudgetFromEnv()): PlannerRecoveryAttempt[] {
  const tiers = tierSequence(initialTier, budget.allowPremiumEscalation);
  const strategies: PlannerRecoveryAttempt["strategy"][] = ["initial", "more-context", "decompose", "alternate-approach"];
  const attempts: PlannerRecoveryAttempt[] = [];
  let remainingTokens = budget.maxTotalOutputTokens;

  for (let index = 0; index < Math.min(budget.maxPaidCalls, strategies.length); index += 1) {
    const callsLeft = Math.min(budget.maxPaidCalls, strategies.length) - index;
    const tokenCap = Math.max(3000, Math.min(12000, Math.floor(remainingTokens / callsLeft)));
    attempts.push({ number: index + 1, tier: tiers[Math.min(index, tiers.length - 1)], strategy: strategies[index], maxOutputTokens: tokenCap });
    remainingTokens -= tokenCap;
  }
  return attempts;
}

export function recoveryInstruction(attempt: PlannerRecoveryAttempt, priorReasons: string[]): string {
  const evidence = priorReasons.length ? `\nPrior planning failures:\n- ${priorReasons.join("\n- ")}` : "";
  switch (attempt.strategy) {
    case "initial":
      return `Produce the safest complete executable plan within the available project evidence.${evidence}`;
    case "more-context":
      return `Retry planning using the full project inventory and prior failure evidence. Prefer read operations before edits and do not repeat an identical rejected plan.${evidence}`;
    case "decompose":
      return `Decompose the outcome into smaller independently executable operations. Complete safe prerequisites first and isolate only genuine external blockers.${evidence}`;
    case "alternate-approach":
      return `Try a materially different supported implementation approach while preserving the requested outcome. Do not merely rename or reorder the previous plan.${evidence}`;
  }
}

export function planFingerprint(request: DirectMissionRequest): string {
  const normalized = request.operations.map((operation) => ({
    kind: operation.kind,
    target: operation.target ?? "",
    command: operation.command?.replace(/\s+/g, " ").trim() ?? "",
    contentHash: typeof operation.input?.content === "string" ? createHash("sha256").update(operation.input.content).digest("hex") : "",
    dependsOn: [...(operation.dependsOn ?? [])].sort(),
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function executionIdempotencyKey(input: { controlId?: string; projectIdentity?: string; task: string }) {
  if (input.controlId) return `control:${input.controlId}`;
  return createHash("sha256")
    .update(`${input.projectIdentity ?? "unknown-project"}\n${input.task.trim().replace(/\s+/g, " ").toLowerCase()}`)
    .digest("hex");
}

function tierSequence(initial: ModelTier, allowPremium: boolean): ModelTier[] {
  const order: ModelTier[] = ["fast", "builder", "architect", "enterprise-architect", "super-reasoning"];
  const start = Math.max(0, order.indexOf(initial));
  const maximum = allowPremium ? order.length - 1 : order.indexOf("architect");
  return order.slice(start, Math.max(start, maximum) + 1).length ? order.slice(start, Math.max(start, maximum) + 1) : [initial];
}

function boundedInt(raw: string | undefined, minimum: number, maximum: number, fallback: number) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}
