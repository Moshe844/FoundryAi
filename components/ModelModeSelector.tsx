"use client";

import { AUTO_DISPLAY, TIER_DISPLAY, type ModelMode, type ModelTier, type TierResolution } from "@/lib/ai/model-router";
import { useModelMode } from "@/lib/ai/model-mode";

const MODES: ModelMode[] = ["auto", "fast", "builder", "architect", "enterprise-architect", "super-reasoning"];

function displayFor(mode: ModelMode) {
  return mode === "auto" ? AUTO_DISPLAY : TIER_DISPLAY[mode];
}

/**
 * The 6-option model-routing control (5 tiers + Auto), mounted in FactorySettingsView. Selection
 * persists via useModelMode()'s localStorage-backed hook and is read directly by the Phase-A helper
 * routes (discover/recommendations/history-recommendation) on their next request — this component
 * itself makes no network calls.
 */
export function ModelModeSelector() {
  const { mode, setMode, showModelNames, setShowModelNames } = useModelMode();

  return (
    <section className="grid gap-3 border-b border-white/10 pb-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold text-foundry-ink">Model routing</h2>
        <label className="flex items-center gap-2 text-xs font-bold text-foundry-subtle">
          <input type="checkbox" checked={showModelNames} onChange={(event) => setShowModelNames(event.target.checked)} className="accent-foundry-teal" />
          Advanced
        </label>
      </div>
      <p className="text-xs leading-5 text-foundry-muted">
        Controls how much reasoning depth Foundry applies to project understanding and suggestions. Auto picks a tier per request and shows what it picked.
        {/* Mission execution (the actual build/coding loop) doesn't read this yet — that lands separately. */}
      </p>
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
                active ? "border-foundry-teal/45 bg-foundry-teal/[0.1]" : "border-white/10 bg-white/[0.03] hover:border-foundry-teal/30 hover:bg-white/[0.05]"
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
    </section>
  );
}

/**
 * Renders the exact modelSelection a route returned — never re-derives tier/model client-side.
 * Capability-First Experience: normal users interact with Foundry, not individual AI models — this
 * renders nothing at all unless Advanced Mode (showModelNames from useModelMode()) is on.
 */
export function ModelSelectionChip({
  selection,
  showModelNames,
}: {
  selection: (TierResolution & { autoSelected: boolean; reason?: string }) | null | undefined;
  showModelNames: boolean;
}) {
  if (!selection || !showModelNames) return null;
  const tierDisplay = TIER_DISPLAY[selection.tier as ModelTier] ?? TIER_DISPLAY.builder;
  const label = selection.autoSelected ? `${AUTO_DISPLAY.emoji} Auto (selected: ${tierDisplay.emoji} ${tierDisplay.label})` : `${tierDisplay.emoji} ${tierDisplay.label}`;

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-foundry-subtle" title={selection.reason}>
      {label}
      <span className="text-foundry-muted">· {selection.provider}/{selection.model}</span>
    </span>
  );
}
