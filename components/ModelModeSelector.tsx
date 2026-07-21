"use client";

import { AUTO_DISPLAY, TIER_DISPLAY, type ModelMode, type ModelTier, type TierResolution } from "@/lib/ai/model-router";
import { useModelMode } from "@/lib/ai/model-mode";
import { BrainCircuit, ChevronDown, CircleDollarSign, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

const MODES: ModelMode[] = ["auto", "fast", "builder", "architect", "enterprise-architect", "super-reasoning"];

function displayFor(mode: ModelMode) {
  return mode === "auto" ? AUTO_DISPLAY : TIER_DISPLAY[mode];
}

type DailySpendSnapshot = {
  actualCostUsd: number;
  reservedCostUsd: number;
  limitUsd: number;
  remainingUsd: number;
  blocked: boolean;
};

function useDailySpend() {
  const [dailySpend, setDailySpend] = useState<DailySpendSnapshot>();

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/settings/models/spend", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { dailySpend?: DailySpendSnapshot };
        if (!cancelled && result.dailySpend) setDailySpend(result.dailySpend);
      } catch {
        // The tracker is advisory; model execution remains protected by the server-side ledger.
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return dailySpend;
}

/**
 * The 6-option model-routing control (5 tiers + Auto), mounted in FactorySettingsView. Selection
 * persists via useModelMode()'s localStorage-backed hook and is read directly by the Phase-A helper
 * routes (discover/recommendations/history-recommendation) on their next request — this component
 * itself makes no network calls.
 */
export function ModelModeSelector() {
  const { mode, setMode, showModelNames, setShowModelNames } = useModelMode();
  const [validation, setValidation] = useState<{ loading: boolean; message?: string }>({ loading: false });
  const dailySpend = useDailySpend();

  async function validateModels() {
    setValidation({ loading: true });
    try {
      const response = await fetch("/api/settings/models/validate", { method: "POST" });
      const result = await response.json() as { models?: Array<{ status: string; available: boolean }>; probes?: Array<{ ok: boolean }> };
      const models = result.models ?? [];
      const discovered = models.filter((model) => model.available).length;
      const probes = result.probes ?? [];
      const valid = probes.filter((probe) => probe.ok).length;
      setValidation({ loading: false, message: `${valid}/${probes.length} routed models passed a real tool call · ${discovered} catalogue models available.` });
    } catch {
      setValidation({ loading: false, message: "Model validation could not reach the configured providers." });
    }
  }

  return (
    <section className="grid gap-3 border-b border-overlay/10 pb-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold text-foundry-ink">Model routing</h2>
        <label className="flex items-center gap-2 text-xs font-bold text-foundry-subtle">
          <input type="checkbox" checked={showModelNames} onChange={(event) => setShowModelNames(event.target.checked)} className="accent-foundry-teal" />
          Advanced
        </label>
      </div>
      <p className="text-xs leading-5 text-foundry-muted">
        Sets the maximum intelligence level. Auto inspects the mission and relevant project working set, then chooses the least expensive validated model for each step.
      </p>
      {dailySpend ? (
        <div className={`rounded-md border px-3 py-2 text-xs ${dailySpend.blocked ? "border-amber-400/35 bg-amber-400/[0.08] text-amber-100" : "border-overlay/10 bg-overlay/[0.03] text-foundry-muted"}`}>
          <span className="font-extrabold">Foundry recorded today: ${dailySpend.actualCostUsd.toFixed(2)} of ${dailySpend.limitUsd.toFixed(2)}</span>
          <span className="ml-2">${dailySpend.remainingUsd.toFixed(2)} available{dailySpend.reservedCostUsd ? ` · $${dailySpend.reservedCostUsd.toFixed(2)} currently reserved` : ""}</span>
          {dailySpend.blocked ? <span className="mt-1 block">Paid model calls are stopped. Raise FOUNDRY_DAILY_MODEL_BUDGET_USD only when you explicitly authorize more spend.</span> : null}
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map((candidate) => {
          const display = displayFor(candidate);
          const active = candidate === mode;
          return (
            <button
              key={candidate}
              type="button"
              onClick={() => setMode(candidate)}
              className={`rounded-md border p-3 text-left transition ${
                active ? "border-foundry-teal/45 bg-foundry-teal/[0.1]" : "border-overlay/10 bg-overlay/[0.03] hover:border-foundry-teal/30 hover:bg-overlay/[0.05]"
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-extrabold text-foundry-ink">
                <span aria-hidden="true">{display.emoji}</span>
                {display.label}
              </span>
              <span className="mt-1 block text-[11px] leading-4 text-foundry-muted">{display.blurb}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={validateModels} disabled={validation.loading} className="inline-flex items-center gap-2 rounded-md border border-overlay/15 bg-overlay/[0.03] px-3 py-2 text-xs font-bold text-foundry-ink transition hover:border-foundry-teal/35 disabled:opacity-60">
          <RefreshCw size={13} className={validation.loading ? "animate-spin" : ""} />
          Validate configured models
        </button>
        <span className="text-[11px] text-foundry-muted">Runs real paid provider probes.</span>
        {validation.message ? <span className="text-xs text-foundry-muted">{validation.message}</span> : null}
      </div>
    </section>
  );
}

export function ComposerModelSelector() {
  const { mode, setMode } = useModelMode();
  const display = displayFor(mode);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label className="relative inline-flex min-w-0 items-center gap-2 text-xs text-foundry-muted">
        {mode === "auto" ? <Sparkles size={14} className="text-foundry-teal" /> : <BrainCircuit size={14} className="text-foundry-blue" />}
        <span className="sr-only">Model intelligence</span>
        <select
          aria-label="Model intelligence"
          value={mode}
          onChange={(event) => setMode(event.target.value as ModelMode)}
          className="min-h-8 max-w-[250px] appearance-none truncate rounded-md border border-overlay/15 bg-foundry-raised py-1 pl-2.5 pr-8 text-xs font-bold text-foundry-ink outline-none transition hover:border-foundry-teal/35 focus:border-foundry-teal/60"
        >
          {MODES.map((candidate) => {
            const option = displayFor(candidate);
            return <option key={candidate} value={candidate}>{candidate === "auto" ? "Auto - Foundry chooses" : `${option.label} - ${option.blurb}`}</option>;
          })}
        </select>
        <ChevronDown size={13} aria-hidden="true" className="pointer-events-none absolute right-2.5 text-foundry-subtle" />
      </label>
      <DailyModelSpendTracker />
      <span className="hidden 2xl:inline text-xs text-foundry-muted">{mode === "auto" ? "Adapts to this task" : display.blurb}</span>
    </div>
  );
}

export function DailyModelSpendTracker() {
  const dailySpend = useDailySpend();
  if (!dailySpend) return null;

  const committed = dailySpend.actualCostUsd + dailySpend.reservedCostUsd;
  const utilization = dailySpend.limitUsd > 0 ? committed / dailySpend.limitUsd : 1;
  const tone = dailySpend.blocked
    ? "border-red-400/35 bg-red-400/[0.09] text-red-100"
    : utilization >= 0.8
      ? "border-amber-400/35 bg-amber-400/[0.08] text-amber-100"
      : "border-foundry-teal/30 bg-foundry-teal/[0.07] text-foundry-subtle";
  const label = `$${dailySpend.actualCostUsd.toFixed(2)} / $${dailySpend.limitUsd.toFixed(2)} today`;
  const title = [
    `Foundry-recorded model spend: $${dailySpend.actualCostUsd.toFixed(2)} of $${dailySpend.limitUsd.toFixed(2)} today.`,
    dailySpend.reservedCostUsd ? `$${dailySpend.reservedCostUsd.toFixed(2)} is reserved by active calls.` : "No active call reservation.",
    dailySpend.blocked ? "Paid model calls are currently stopped." : `$${dailySpend.remainingUsd.toFixed(2)} remains.`,
    "Local estimate; provider invoices remain authoritative.",
  ].join(" ");

  return (
    <span
      role="status"
      aria-label={`Daily model spend: ${label}${dailySpend.blocked ? ", limit reached" : ""}`}
      title={title}
      className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-extrabold tabular-nums ${tone}`}
    >
      <CircleDollarSign size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Renders the exact modelSelection a route returned — never re-derives tier/model client-side.
 * Capability-First Experience: normal users interact with Foundry, not individual AI models — this
 * Always shows the routed provider/model so execution information is auditable. Advanced Mode adds
 * the full routing reason as hover detail.
 */
export function ModelSelectionChip({
  selection,
  showModelNames,
}: {
  selection: (TierResolution & { autoSelected: boolean; reason?: string }) | null | undefined;
  showModelNames: boolean;
}) {
  if (!selection) return null;
  const tierDisplay = TIER_DISPLAY[selection.tier as ModelTier] ?? TIER_DISPLAY.builder;
  const label = selection.autoSelected ? `${AUTO_DISPLAY.emoji} Auto (selected: ${tierDisplay.emoji} ${tierDisplay.label})` : `${tierDisplay.emoji} ${tierDisplay.label}`;

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-overlay/10 bg-overlay/[0.04] px-2 py-0.5 text-[10px] font-bold text-foundry-subtle" title={showModelNames ? selection.reason : `Selected ${selection.provider}/${selection.model}`}>
      {label}
      <span className="text-foundry-muted">· {selection.provider}/{selection.model}</span>
    </span>
  );
}
