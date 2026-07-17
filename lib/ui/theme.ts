"use client";

import { useEffect, useState } from "react";

/**
 * Foundry's visual themes. "Light" is the default; "Dusk" and "Midnight" are the progressively
 * darker options. Every surface resolves through the CSS variables in app/globals.css, including
 * the `overlay-*` / `shade-*` tokens that replaced literal white/black translucency — that is what
 * lets one component tree render correctly in both the light and dark families.
 */
export type FoundryTheme = "light" | "dusk" | "midnight";

export const FOUNDRY_THEMES: Array<{ id: FoundryTheme; label: string; blurb: string }> = [
  { id: "light", label: "Light", blurb: "Warm and bright — the default" },
  { id: "dusk", label: "Dusk", blurb: "Softer slate — easier at night" },
  { id: "midnight", label: "Midnight", blurb: "Near-black, maximum contrast" },
];

export const THEME_STORAGE_KEY = "foundry-theme";
export const DEFAULT_THEME: FoundryTheme = "light";

export function isFoundryTheme(value: unknown): value is FoundryTheme {
  return value === "light" || value === "dusk" || value === "midnight";
}

export function applyTheme(theme: FoundryTheme) {
  document.documentElement.dataset.theme = theme;
}

/** Reads the persisted theme, applies it, and keeps every mounted selector in sync. */
export function useFoundryTheme(): [FoundryTheme, (theme: FoundryTheme) => void] {
  const [theme, setThemeState] = useState<FoundryTheme>(DEFAULT_THEME);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (isFoundryTheme(current)) setThemeState(current);
    // Multiple selectors can be mounted (top bar + settings); keep them consistent.
    const onThemeChange = (event: Event) => {
      const next = (event as CustomEvent<FoundryTheme>).detail;
      if (isFoundryTheme(next)) setThemeState(next);
    };
    window.addEventListener("foundry-theme-change", onThemeChange);
    return () => window.removeEventListener("foundry-theme-change", onThemeChange);
  }, []);

  function setTheme(next: FoundryTheme) {
    setThemeState(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Theme still applies for this session when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent("foundry-theme-change", { detail: next }));
  }

  return [theme, setTheme];
}

/**
 * Runs before first paint so a stored theme never flashes the default first. Kept as a string for
 * the layout's inline script — it must not wait for the React bundle.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});document.documentElement.dataset.theme=(t==="light"||t==="dusk"||t==="midnight")?t:${JSON.stringify(DEFAULT_THEME)};}catch(e){document.documentElement.dataset.theme=${JSON.stringify(DEFAULT_THEME)};}})();`;
