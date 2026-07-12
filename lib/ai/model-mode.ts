"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ModelMode } from "@/lib/ai/model-router";

const MODEL_MODE_STORAGE_KEY = "foundry.modelMode";
const SHOW_MODEL_NAMES_STORAGE_KEY = "foundry.showModelNames";
const DEFAULT_MODE: ModelMode = "auto";

export function readStoredModelMode(): ModelMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
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
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SHOW_MODEL_NAMES_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persists the user's chosen model mode + advanced-display preference across reloads, same try/catch-around-localStorage pattern already used in WorkspaceShell.tsx. */
const MODEL_MODE_EVENT = "foundry:model-mode-change";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(MODEL_MODE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(MODEL_MODE_EVENT, onStoreChange);
  };
}

export function useModelMode(): { mode: ModelMode; setMode: (mode: ModelMode) => void; showModelNames: boolean; setShowModelNames: (show: boolean) => void } {
  const mode = useSyncExternalStore(subscribe, readStoredModelMode, () => DEFAULT_MODE);
  const showModelNames = useSyncExternalStore(subscribe, readShowModelNames, () => false);

  const setMode = useCallback((next: ModelMode) => {
    try {
      window.localStorage.setItem(MODEL_MODE_STORAGE_KEY, next);
    } catch {
      // Best-effort persistence only.
    }
    window.dispatchEvent(new Event(MODEL_MODE_EVENT));
  }, []);

  const setShowModelNames = useCallback((show: boolean) => {
    try {
      window.localStorage.setItem(SHOW_MODEL_NAMES_STORAGE_KEY, show ? "1" : "0");
    } catch {
      // Best-effort persistence only.
    }
    window.dispatchEvent(new Event(MODEL_MODE_EVENT));
  }, []);

  return { mode, setMode, showModelNames, setShowModelNames };
}
