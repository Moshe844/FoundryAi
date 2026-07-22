"use client";

import type { CanvasMissionVM } from "@/lib/canvas/model";
import { MissionBlock } from "@/components/canvas/MissionBlock";

/**
 * §5 — one finished mission as one quiet row: status glyph, the real request, the real
 * outcome phrase. Click grows it in place to the original recorded trace (the clicked
 * header never moves; expansion grows downward). At most one prior mission is expanded
 * at a time — the parent owns that invariant.
 */
export function CollapsedMissionRow({
  vm,
  expanded,
  onToggle,
}: {
  vm: CanvasMissionVM;
  expanded: boolean;
  onToggle: () => void;
}) {
  const failed = vm.state === "failed" || vm.state === "blocked";
  const cancelled = vm.state === "cancelled";
  const glyph = vm.state === "complete" ? "✓" : cancelled ? "⊘" : failed ? "✕" : "○";
  const glyphColor = vm.state === "complete" ? "text-foundry-teal" : failed ? "text-red-300" : "text-foundry-subtle";
  const statusLabel = vm.state === "complete" ? "Completed" : cancelled ? "Stopped" : failed ? "Failed" : "In progress";

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={`group/row flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left transition ${expanded ? "bg-overlay/[0.04]" : "hover:bg-overlay/[0.03]"}`}
      >
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border border-overlay/10 bg-overlay/[0.03] font-mono text-[11px] ${glyphColor}`} aria-hidden="true">{glyph}</span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] leading-6 text-foundry-muted">
          {firstLine(vm.request)}
          {vm.outcome ? <span className="text-foundry-subtle"> — {vm.outcome}</span> : null}
        </span>
        <span className="shrink-0 text-[10px] text-foundry-subtle opacity-0 transition-opacity duration-150 group-hover/row:opacity-100">
          {relativeTime(vm.updatedAt)}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] ${vm.state === "complete" ? "bg-foundry-teal/10 text-foundry-teal" : failed ? "bg-red-400/10 text-red-300" : "bg-overlay/[0.06] text-foundry-subtle"}`}>
          {statusLabel}
        </span>
      </button>
      {expanded ? (
        <div className="canvas-enter mt-2 border-l border-overlay/8 py-3 pl-4">
          <MissionBlock vm={vm} recorded />
        </div>
      ) : null}
    </div>
  );
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((part) => part.trim()) ?? text;
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const deltaMs = Date.now() - then;
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
