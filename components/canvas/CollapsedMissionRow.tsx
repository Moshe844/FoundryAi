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
  const glyph = vm.state === "complete" ? "✓" : vm.state === "cancelled" ? "⊘" : vm.state === "failed" || vm.state === "blocked" ? "✕" : "○";
  const glyphColor =
    vm.state === "complete" ? "text-foundry-teal" : vm.state === "cancelled" ? "text-foundry-subtle" : vm.state === "failed" || vm.state === "blocked" ? "text-red-300" : "text-foundry-subtle";

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="group/row flex h-10 w-full items-center gap-2.5 rounded px-1.5 text-left transition hover:bg-overlay/[0.03]"
      >
        <span className={`shrink-0 font-mono text-[12px] ${glyphColor}`} aria-hidden="true">{glyph}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] leading-6 text-foundry-muted">
          {firstLine(vm.request)}
          {vm.outcome ? <span className="text-foundry-subtle"> — {vm.outcome}</span> : null}
        </span>
        <span className="shrink-0 text-[11px] text-foundry-subtle opacity-0 transition-opacity duration-150 group-hover/row:opacity-100">
          {relativeTime(vm.updatedAt)}
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
