"use client";

import { QUALITY_LEVEL_DISPLAY, type MissionQualityLevel } from "@/lib/ai/mission/quality-level";
import { useMissionQuality } from "@/lib/ai/mission/quality-mode";

const LEVELS: MissionQualityLevel[] = ["quick", "standard", "thorough", "production"];

/**
 * Independent of and complementary to the Model Mode / Auto routing selector (components/ModelModeSelector.tsx,
 * Settings) — this picks how much process a mission gets (planning depth, review, verification), not which
 * model handles any given call. Lives in the composer since quality is a per-request choice, not a workspace
 * setting.
 */
export function MissionQualitySelector() {
  const { quality, setQuality } = useMissionQuality();

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Mission quality level">
      {LEVELS.map((level) => {
        const display = QUALITY_LEVEL_DISPLAY[level];
        const active = level === quality;
        return (
          <button
            key={level}
            type="button"
            title={display.blurb}
            onClick={() => setQuality(level)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold transition ${
              active ? "border-foundry-teal/45 bg-foundry-teal/[0.14] text-foundry-ink" : "border-overlay/10 bg-overlay/[0.03] text-foundry-subtle hover:border-foundry-teal/25 hover:text-foundry-ink"
            }`}
          >
            <span aria-hidden="true">{display.emoji}</span>
            {display.label}
          </button>
        );
      })}
    </div>
  );
}
