"use client";

import { Moon, Sun, Sunset } from "lucide-react";
import { FOUNDRY_THEMES, useFoundryTheme } from "@/lib/ui/theme";

const icons = { light: Sun, dusk: Sunset, midnight: Moon } as const;

/** Light is the default; Dusk and Midnight are the progressively darker options. */
export function ThemeToggle() {
  const [theme, setTheme] = useFoundryTheme();

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-overlay/10 bg-overlay/[0.04] p-0.5"
      role="radiogroup"
      aria-label="Appearance"
    >
      {FOUNDRY_THEMES.map((option) => {
        const Icon = icons[option.id];
        const active = theme === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${option.label} theme — ${option.blurb}`}
            title={`${option.label} — ${option.blurb}`}
            onClick={() => setTheme(option.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foundry-teal/50 ${
              active
                ? "bg-foundry-surface text-foundry-ink shadow-sm ring-1 ring-overlay/10"
                : "text-foundry-subtle hover:text-foundry-ink"
            }`}
          >
            <Icon size={12} />
            <span className={active ? "" : "sr-only"}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
