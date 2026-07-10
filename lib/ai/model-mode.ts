"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelMode } from "@/lib/ai/model-router";

const MODEL_MODE_STORAGE_KEY = "foundry.modelMode";
const SHOW_MODEL_NAMES_STORAGE_KEY = "foundry.showModelNames";
const DEFAULT_MODE: ModelMode = "auto";

function readStoredMode(): ModelMode {
  try {
    const stored = window.localStorage.getItem(MODEL_MODE_STORAGE_KEY);
    if (stored === "auto" || stored === "fast" || stored === "builder" || stored === "architect" || stored === "enterprise-architect" || stored === "super-reasoning") {
      return stored;
    }
  } catch {
    // localStorage unavailable (private browsing, etc.) — fall back to the default below.
  }
  return DEFAULT_MODE;
}

function readShowModelNames(): boolean {
  try {
    return window.localStorage.getItem(SHOW_MODEL_NAMES_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persists the user's chosen model mode + advanced-display preference across reloads, same try/catch-around-localStorage pattern already used in WorkspaceShell.tsx. */
export function useModelMode(): { mode: ModelMode; setMode: (mode: ModelMode) => void; showModelNames: boolean; setShowModelNames: (show: boolean) => void } {
  const [mode, setModeState] = useState<ModelMode>(DEFAULT_MODE);
  const [showModelNames, setShowModelNamesState] = useState(false);

  useEffect(() => {
    setModeState(readStoredMode());
    setShowModelNamesState(readShowModelNames());
  }, []);

  const setMode = useCallback((next: ModelMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODEL_MODE_STORAGE_KEY, next);
    } catch {
      // Best-effort persistence only.
    }
  }, []);

  const setShowModelNames = useCallback((show: boolean) => {
    setShowModelNamesState(show);
    try {
      window.localStorage.setItem(SHOW_MODEL_NAMES_STORAGE_KEY, show ? "1" : "0");
    } catch {
      // Best-effort persistence only.
    }
  }, []);

  return { mode, setMode, showModelNames, setShowModelNames };
}
