"use client";

import { useEffect, useState } from "react";

/**
 * §7.1 — the one live indicator on the canvas. Shows the most recent real event
 * verbatim; it changes only when a new real event arrives. If the stream goes quiet
 * the row counts the silence honestly (the sole timer-driven UI in the product,
 * labeled as silence, not progress), and past a minute it converts to a stall notice —
 * the screen is allowed to feel a stall.
 */

export const SILENCE_AFTER_MS = 5_000;
export const ATTENTION_AFTER_MS = 30_000;
export const STALL_AFTER_MS = 180_000;

/** Seconds since `timestamp`, ticking once a second while `active`. */
export function useElapsedSince(timestamp: string | undefined, active: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active || !timestamp) {
      setElapsedMs(0);
      return;
    }
    const started = Date.parse(timestamp);
    if (!Number.isFinite(started)) return;
    const update = () => setElapsedMs(Math.max(0, Date.now() - started));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [timestamp, active]);

  return elapsedMs;
}

export function isStalled(elapsedMs: number): boolean {
  return elapsedMs >= STALL_AFTER_MS;
}

export function LiveActivityRow({ text, elapsedMs }: { text: string; elapsedMs: number }) {
  if (elapsedMs >= STALL_AFTER_MS) {
    return (
      <p className="canvas-enter font-mono text-[13px] leading-6 text-foundry-amber" role="status">
        Still on: {text} · no new engine event for {formatElapsed(elapsedMs)}. You can stop this run if the provider is not responding.
      </p>
    );
  }
  return (
    <p className="canvas-enter font-mono text-[13px] leading-6 text-foundry-muted" role="status">
      <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-foundry-teal align-middle" aria-hidden="true" />
      {elapsedMs >= ATTENTION_AFTER_MS ? "Still working on: " : ""}{text}
      {elapsedMs >= SILENCE_AFTER_MS ? <span className="text-foundry-subtle"> · {formatElapsed(elapsedMs)} since last update</span> : null}
    </p>
  );
}

function formatElapsed(elapsedMs: number) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
