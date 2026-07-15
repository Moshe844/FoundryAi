import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type DailySpendState = {
  date: string;
  actualCostUsd: number;
  reservedCostUsd: number;
  calls: number;
};

export type GlobalSpendReservation = {
  id: string;
  date: string;
  estimatedCostUsd: number;
};

const routingRoot = path.join(process.cwd(), ".foundry-data", "routing");
const ledgerPath = path.join(routingRoot, "spend-ledger.json");
const providerCallPath = path.join(routingRoot, "provider-calls.ndjson");
const spendGlobal = globalThis as typeof globalThis & { __foundryDailySpend?: DailySpendState };

/**
 * A process-wide and restart-safe ceiling for every paid model surface. Per-mission budgets limit
 * one workflow; this ledger prevents retries, continuations, and separate API routes from silently
 * adding up to an unbounded daily bill.
 */
export function reserveGlobalModelSpend(estimatedCostUsd: number): GlobalSpendReservation {
  const state = currentState();
  const estimate = Math.max(0, estimatedCostUsd);
  const limit = dailyModelBudgetUsd();
  if (state.actualCostUsd + state.reservedCostUsd + estimate > limit) {
    throw new DailySpendLimitError(
      `Daily model-spend limit reached ($${state.actualCostUsd.toFixed(2)} used, $${limit.toFixed(2)} limit). No provider call was sent. Set FOUNDRY_DAILY_MODEL_BUDGET_USD to an explicit higher amount only when you want to authorize more spend.`,
    );
  }
  state.reservedCostUsd += estimate;
  persist(state);
  return { id: crypto.randomUUID(), date: state.date, estimatedCostUsd: estimate };
}

export function settleGlobalModelSpend(reservation: GlobalSpendReservation, actualCostUsd: number) {
  const state = currentState();
  if (reservation.date !== state.date) return;
  state.reservedCostUsd = Math.max(0, state.reservedCostUsd - reservation.estimatedCostUsd);
  state.actualCostUsd += Math.max(0, actualCostUsd);
  state.calls += 1;
  persist(state);
}

export function releaseGlobalModelSpend(reservation: GlobalSpendReservation) {
  const state = currentState();
  if (reservation.date !== state.date) return;
  state.reservedCostUsd = Math.max(0, state.reservedCostUsd - reservation.estimatedCostUsd);
  persist(state);
}

export function globalSpendSnapshot() {
  const state = currentState();
  const limitUsd = dailyModelBudgetUsd();
  return {
    ...state,
    limitUsd,
    remainingUsd: Number(Math.max(0, limitUsd - state.actualCostUsd - state.reservedCostUsd).toFixed(6)),
    blocked: state.actualCostUsd + state.reservedCostUsd >= limitUsd,
  };
}

export class DailySpendLimitError extends Error {}

function currentState(): DailySpendState {
  const date = localDateKey();
  const existing = spendGlobal.__foundryDailySpend;
  if (existing?.date === date) return existing;

  const persisted = readPersistedState();
  const recordedProviderCost = readRecordedProviderCost(date);
  const persistedCost = persisted?.date === date ? persisted.actualCostUsd : 0;
  const state: DailySpendState = {
    date,
    // `calls` counts settlements made by this ledger. A zero-call persisted file is only a cached
    // telemetry bootstrap and may be recalculated (for example after correcting timezone handling).
    // Once direct or managed calls settle here, keep the larger total because direct-answer history
    // is not present in provider-calls.ndjson.
    actualCostUsd: persisted?.date === date && persisted.calls > 0
      ? Math.max(persistedCost, recordedProviderCost)
      : recordedProviderCost,
    // Active reservations cannot survive a process restart. Never carry stale reservations forward.
    reservedCostUsd: 0,
    calls: persisted?.date === date ? persisted.calls : 0,
  };
  spendGlobal.__foundryDailySpend = state;
  persist(state);
  return state;
}

function readPersistedState(): DailySpendState | undefined {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath, "utf8")) as Partial<DailySpendState>;
    if (!parsed.date || !Number.isFinite(parsed.actualCostUsd) || !Number.isFinite(parsed.calls)) return undefined;
    return {
      date: parsed.date,
      actualCostUsd: Math.max(0, Number(parsed.actualCostUsd)),
      reservedCostUsd: 0,
      calls: Math.max(0, Number(parsed.calls)),
    };
  } catch {
    return undefined;
  }
}

function readRecordedProviderCost(date: string) {
  try {
    return readFileSync(providerCallPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .reduce((total, line) => {
        try {
          const record = JSON.parse(line) as { createdAt?: string; actualCostUsd?: number };
          const createdAt = record.createdAt ? new Date(record.createdAt) : undefined;
          return createdAt && !Number.isNaN(createdAt.getTime()) && localDateKey(createdAt) === date
            ? total + Math.max(0, Number(record.actualCostUsd) || 0)
            : total;
        } catch {
          return total;
        }
      }, 0);
  } catch {
    return 0;
  }
}

function persist(state: DailySpendState) {
  try {
    mkdirSync(routingRoot, { recursive: true });
    writeFileSync(ledgerPath, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  } catch {
    // The in-memory guard remains active if diagnostics storage is temporarily unavailable.
  }
}

function dailyModelBudgetUsd() {
  const configured = Number(process.env.FOUNDRY_DAILY_MODEL_BUDGET_USD);
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
}

function localDateKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
