import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { pricingForProviderModel, type ModelTier } from "@/lib/ai/model-router";
import type { ManagedModelRequest } from "@/lib/ai/providers/types";
import type { CostClass, RoutingBudget } from "@/lib/ai/routing/types";
import { DailySpendLimitError, releaseGlobalModelSpend, reserveGlobalModelSpend, settleGlobalModelSpend, type GlobalSpendReservation } from "@/lib/ai/routing/spend-ledger";

type RequiredRoutingBudget = Required<Pick<RoutingBudget, "maximumModelCalls" | "premiumCallLimit" | "maximumParallelCalls" | "estimatedCostUsd">>;

const TIER_ROUTING_BUDGETS: Record<ModelTier, RequiredRoutingBudget> = {
  // Last-resort runaway ceilings. Normal waste is stopped by the executor's durable-progress guard,
  // while estimated spend remains the primary cost boundary. Healthy multi-step work should not
  // fail merely because it needed a fourth action.
  fast: { maximumModelCalls: 12, estimatedCostUsd: 0.5, premiumCallLimit: 2, maximumParallelCalls: 1 },
  builder: { maximumModelCalls: 24, estimatedCostUsd: 2, premiumCallLimit: 4, maximumParallelCalls: 1 },
  architect: { maximumModelCalls: 32, estimatedCostUsd: 4, premiumCallLimit: 6, maximumParallelCalls: 1 },
  "enterprise-architect": { maximumModelCalls: 40, estimatedCostUsd: 7, premiumCallLimit: 8, maximumParallelCalls: 1 },
  "super-reasoning": { maximumModelCalls: 40, estimatedCostUsd: 8, premiumCallLimit: 8, maximumParallelCalls: 1 },
};

/** Fast is the safe default. A mission receives more guarded capacity only after evidence raises its tier. */
export const DEFAULT_ROUTING_BUDGET = routingBudgetForTier("fast");

export function routingBudgetForTier(tier: ModelTier): RequiredRoutingBudget {
  const tierBudget = TIER_ROUTING_BUDGETS[tier];
  return {
    maximumModelCalls: envNumber("FOUNDRY_MAX_MODEL_CALLS_PER_REQUEST", tierBudget.maximumModelCalls),
    estimatedCostUsd: envNumber("FOUNDRY_MAX_ESTIMATED_COST_USD_PER_REQUEST", tierBudget.estimatedCostUsd),
    premiumCallLimit: envNumber("FOUNDRY_MAX_PREMIUM_CALLS_PER_MISSION", tierBudget.premiumCallLimit),
    maximumParallelCalls: 1,
  };
}

type Ledger = {
  calls: number;
  premiumCalls: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  activeCalls: number;
  expiresAt: number;
  maximumModelCalls: number;
  premiumCallLimit: number;
  estimatedCostLimitUsd: number;
};
const ledgers = new Map<string, Ledger>();

export type CostGuardContext = {
  requestId: string;
  missionId?: string;
  tier: ModelTier;
  costClass: CostClass;
  budget?: RoutingBudget;
};

export type CostReservation = { key: string; estimatedCostUsd: number; premium: boolean; callNumber: number; globalReservation: GlobalSpendReservation };

export function reserveModelCall(request: ManagedModelRequest, context: CostGuardContext): CostReservation {
  cleanup();
  const budget = { ...routingBudgetForTier(context.tier), ...context.budget };
  const key = context.missionId || context.requestId;
  const ledger = ledgers.get(key) ?? {
    calls: 0,
    premiumCalls: 0,
    estimatedCostUsd: 0,
    actualCostUsd: 0,
    activeCalls: 0,
    expiresAt: Date.now() + 30 * 60_000,
    maximumModelCalls: budget.maximumModelCalls,
    premiumCallLimit: budget.premiumCallLimit,
    estimatedCostLimitUsd: budget.estimatedCostUsd,
  };
  // Most multi-stage missions preserve the greatest capacity already granted. Explicitly bounded
  // interaction repairs are different: their ceiling is the user's protection against a small fix
  // silently becoming a full-price mission, so later stages must not widen it.
  ledger.maximumModelCalls = context.budget?.hardCeiling
    ? Math.min(ledger.maximumModelCalls, budget.maximumModelCalls)
    : Math.max(ledger.maximumModelCalls, budget.maximumModelCalls);
  ledger.premiumCallLimit = context.budget?.hardCeiling
    ? Math.min(ledger.premiumCallLimit, budget.premiumCallLimit)
    : Math.max(ledger.premiumCallLimit, budget.premiumCallLimit);
  ledger.estimatedCostLimitUsd = context.budget?.hardCeiling
    ? Math.min(ledger.estimatedCostLimitUsd, budget.estimatedCostUsd)
    : Math.max(ledger.estimatedCostLimitUsd, budget.estimatedCostUsd);
  // "High" is the normal Builder/Architect workhorse class. Counting every high-capability turn as
  // premium made ordinary debugging exhaust the premium allowance during inspection, before an edit.
  // The estimated-dollar and total-call ceilings still bound those turns; this counter is reserved
  // for genuinely premium models.
  const premium = context.costClass === "premium";
  const estimate = estimateCallCost(request);
  if (ledger.calls >= ledger.maximumModelCalls) throw new CostGuardError(`Model-call limit reached (${ledger.maximumModelCalls}) for this request.`);
  if (premium && ledger.premiumCalls >= ledger.premiumCallLimit) throw new CostGuardError(`Premium-model call limit reached (${ledger.premiumCallLimit}) for this mission.`);
  if (ledger.estimatedCostUsd + estimate > ledger.estimatedCostLimitUsd) throw new CostGuardError(`Estimated request cost would exceed the $${ledger.estimatedCostLimitUsd.toFixed(2)} limit.`);
  if (ledger.activeCalls >= budget.maximumParallelCalls) throw new CostGuardError("A duplicate or parallel model call is already active for this request.");
  let globalReservation: GlobalSpendReservation;
  try {
    globalReservation = reserveGlobalModelSpend(estimate);
  } catch (error) {
    if (error instanceof DailySpendLimitError) throw new CostGuardError(error.message);
    throw error;
  }
  ledger.calls += 1;
  ledger.premiumCalls += premium ? 1 : 0;
  ledger.estimatedCostUsd += estimate;
  ledger.activeCalls += 1;
  ledger.expiresAt = Date.now() + 30 * 60_000;
  ledgers.set(key, ledger);
  return { key, estimatedCostUsd: estimate, premium, callNumber: ledger.calls, globalReservation };
}

export function settleModelCall(reservation: CostReservation, usage: RuntimeUsageRecord) {
  const ledger = ledgers.get(reservation.key);
  settleGlobalModelSpend(reservation.globalReservation, usage.estimatedCostUsd);
  if (!ledger) return;
  ledger.activeCalls = Math.max(0, ledger.activeCalls - 1);
  if (usage.requestCount <= 0) {
    // Provider rejections and other zero-usage responses are not paid work. They must not consume
    // the operation's action allowance or make a schema error exhaust the mission.
    ledger.calls = Math.max(0, ledger.calls - 1);
    if (reservation.premium) ledger.premiumCalls = Math.max(0, ledger.premiumCalls - 1);
  }
  // Reservations use the request's worst-case max-output estimate so concurrent calls cannot
  // overcommit the mission budget. Once the call finishes, replace that reservation with the
  // provider's actual metered usage. Keeping every worst-case reservation forever made a normal
  // multi-turn build mathematically incapable of completing inside its budget even when each turn
  // returned only a small tool call.
  ledger.estimatedCostUsd = Math.max(0, ledger.estimatedCostUsd - reservation.estimatedCostUsd) + usage.estimatedCostUsd;
  ledger.actualCostUsd += usage.estimatedCostUsd;
}

export function releaseModelCall(reservation: CostReservation) {
  releaseGlobalModelSpend(reservation.globalReservation);
  const ledger = ledgers.get(reservation.key);
  if (ledger) {
    ledger.activeCalls = Math.max(0, ledger.activeCalls - 1);
    ledger.estimatedCostUsd = Math.max(0, ledger.estimatedCostUsd - reservation.estimatedCostUsd);
  }
}

export function routingBudgetSnapshot(requestId: string) {
  const ledger = ledgers.get(requestId);
  return ledger ? { ...ledger } : undefined;
}

export function estimateCallCost(request: ManagedModelRequest) {
  const inputCharacters = (request.system?.length ?? 0) + JSON.stringify(request.messages).length + JSON.stringify(request.tools ?? []).length;
  const inputTokens = Math.ceil(inputCharacters / 4);
  const pricing = pricingForProviderModel(request.provider, request.model);
  return Number(((inputTokens * pricing.input + request.maxOutputTokens * pricing.output) / 1_000_000).toFixed(6));
}

export class CostGuardError extends Error {}

function cleanup() {
  const now = Date.now();
  for (const [key, ledger] of ledgers) if (ledger.expiresAt < now) ledgers.delete(key);
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
