"use client";

import type { FactoryExecutionEvent } from "@/lib/factory/types";
import { formatClockTime, type BlockedCommandAction } from "@/components/execution/timelineUtils";

export type { BlockedCommandAction } from "@/components/execution/timelineUtils";

/**
 * Relocated verbatim from components/BuildDashboard.tsx (execution-canvas rebuild, step 5) — same
 * (event, action) callback signature as before. NOT yet redesigned to the plan's single `onDecide`
 * signature over ExecutionMissionApproval — that redesign is deferred to the data-model swap (step 6),
 * once approvals are real reducer state instead of a raw FactoryExecutionEvent read out of the old
 * WorkspaceShell state shape. Doing it now would mean building a throwaway adapter.
 *
 * Hard pause, rendered as a prominent card at the top of the active mission — not buried as one more
 * timeline row. While this is showing, nothing else in the mission can proceed: the composer disables
 * free-text send (ProjectComposer's `locked`), and ExecutionTimeline suppresses its own inline copy of
 * the same blocked event so there is exactly one place to resolve it.
 */
export function ApprovalGate({ event, onApprove }: { event: FactoryExecutionEvent | undefined; onApprove?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void }) {
  if (!event) return null;
  return (
    <div className="mb-4 overflow-hidden rounded-lg border-2 border-foundry-amber/40 bg-foundry-amber/[0.05] shadow-[0_0_0_1px_rgba(232,183,92,0.08)]">
      <div className="flex items-center gap-2 border-b border-foundry-amber/25 bg-foundry-amber/[0.08] px-3.5 py-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foundry-amber" />
        <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-foundry-amber">Execution paused — approval required</p>
      </div>
      <BlockedCommandLine event={event} onApprove={onApprove} />
    </div>
  );
}

export function BlockedCommandLine({ event, onApprove }: { event: FactoryExecutionEvent; onApprove?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void }) {
  const reason = (event.details?.reason as string | undefined) || event.output || "Foundry needs approval before continuing.";
  const category = event.details?.category as string | undefined;
  const command = event.command || event.title;
  return (
    <div className="my-1 overflow-hidden rounded-md border border-foundry-amber/30 bg-foundry-amber/[0.06]">
      <div className="flex items-start gap-2 px-3 py-2 font-mono text-[12.5px] leading-5">
        <span className="font-mono text-[10px] text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
        <span className="shrink-0 text-foundry-amber">!</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[#f3e0b8]">{command}</span>
      </div>
      <div className="border-t border-foundry-amber/20 bg-black/20 px-3 py-2">
        <p className="text-xs leading-5 text-foundry-amber">Needs your approval - {reason}</p>
        <p className="mt-1 text-[11px] leading-5 text-foundry-subtle">
          Exact command approvals only match this command text in this project. They do not widen to other installs, deletes, pushes, or shell mutations.
        </p>
        {onApprove ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="shrink-0 rounded border border-foundry-amber/40 bg-foundry-amber/[0.14] px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-foundry-amber transition hover:bg-foundry-amber/[0.22]"
              onClick={() => onApprove(event, "approve-once")}
            >
              Allow once
            </button>
            {category ? (
              <button
                type="button"
                className="shrink-0 rounded border border-foundry-amber/40 bg-foundry-amber/[0.14] px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-foundry-amber transition hover:bg-foundry-amber/[0.22]"
                onClick={() => onApprove(event, "approve-category")}
              >
                Allow this category
              </button>
            ) : null}
            <button
              type="button"
              className="shrink-0 rounded border border-foundry-amber/40 bg-foundry-amber/[0.14] px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-foundry-amber transition hover:bg-foundry-amber/[0.22]"
              onClick={() => onApprove(event, "approve-command")}
            >
              Always allow exact command
            </button>
            <button
              type="button"
              className="shrink-0 rounded border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-foundry-subtle transition hover:bg-white/[0.08] hover:text-foundry-ink"
              onClick={() => onApprove(event, "skip")}
            >
              Deny
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
