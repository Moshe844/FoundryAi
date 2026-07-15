"use client";

import { useState } from "react";
import type { MissionRecommendation } from "@/lib/ai/mission/recommendations";
import type { FactoryExecutionEvent } from "@/lib/factory/types";
import type { CanvasMissionVM, CanvasPhase, CanvasVoiceGroup, CanvasWorkEvent } from "@/lib/canvas/model";
import { formatDuration } from "@/lib/canvas/model";
import type { BlockedCommandAction } from "@/components/execution/ApprovalPrompt";
import { BlockingCard } from "@/components/canvas/BlockingCard";
import { LiveActivityRow } from "@/components/canvas/LiveActivityRow";
import { SummaryBlock } from "@/components/canvas/SummaryBlock";

/**
 * §2/§3 — one mission on the canvas: the user's message (the only accent-bordered
 * element), Foundry's voice lines, the real work rows beneath each, phase digests for
 * large plans, then the blocking card / live activity row / terminal block. Older
 * event groups self-digest to keep the density budget (§14.8) without hiding anything.
 */
export function MissionBlock({
  vm,
  recorded = false,
  revealEventIds,
  liveActivity,
  suggestions = [],
  onAnswer,
  onApprove,
  onEvidenceClick,
  onSuggestion,
}: {
  vm: CanvasMissionVM;
  /** True for a prior mission's trace: fully digested, nothing live. */
  recorded?: boolean;
  /** Event ids to force-expand and scroll to (evidence links from the summary). */
  revealEventIds?: string[];
  liveActivity?: { text: string; elapsedMs: number } | null;
  suggestions?: MissionRecommendation[];
  onAnswer?: (answers: Array<{ question: string; answer: string }>) => void;
  onApprove?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void;
  onEvidenceClick?: (eventIds: string[]) => void;
  onSuggestion?: (recommendation: MissionRecommendation) => void;
}) {
  const showPhases = (vm.tier === "large" || vm.tier === "huge") && vm.phases.length > 0;
  const blocked = Boolean(vm.blocking);
  const elapsedMs = Math.max(0, new Date(vm.updatedAt).getTime() - new Date(vm.requestedAt).getTime());

  return (
    <article className="grid gap-5" aria-label={vm.request}>
      <div className="border-l-[3px] border-foundry-teal pl-3">
        <p className="whitespace-pre-wrap text-[16px] font-semibold leading-[1.5] text-foundry-ink">{vm.request}</p>
      </div>

      {showPhases ? <PhaseList phases={vm.phases} recorded={recorded} /> : null}

      <VoiceTrail groups={vm.groups} recorded={recorded} busy={vm.isBusy && !recorded} revealEventIds={revealEventIds} />

      {!recorded && vm.blocking && onAnswer && onApprove ? (
        <BlockingCard blocking={vm.blocking} onAnswer={onAnswer} onApprove={onApprove} />
      ) : null}

      {!recorded && !blocked && vm.isBusy && liveActivity ? (
        <LiveActivityRow text={liveActivity.text} elapsedMs={liveActivity.elapsedMs} />
      ) : null}

      {vm.summary ? (
        <div className="grid gap-2">
          <p className="font-mono text-[12px] text-foundry-subtle">Elapsed · {formatDuration(elapsedMs)}</p>
          <SummaryBlock
            summary={vm.summary}
            suggestions={recorded ? [] : suggestions}
            onEvidenceClick={onEvidenceClick ?? (() => {})}
            onSuggestion={onSuggestion ?? (() => {})}
          />
        </div>
      ) : null}
    </article>
  );
}

/** §3.1/§13.4 — the real plan as phase rows: completed phases digest to one line, the live phase is the only expanded one. */
function PhaseList({ phases, recorded }: { phases: CanvasPhase[]; recorded: boolean }) {
  const [openPhases, setOpenPhases] = useState<Record<number, boolean>>({});

  return (
    <div className="grid gap-1" role="list" aria-label="Mission plan">
      {phases.map((phase) => {
        const complete = phase.done === phase.total;
        const expanded = openPhases[phase.index] ?? (!recorded && phase.isLive);
        return (
          <div key={phase.index} role="listitem">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpenPhases((current) => ({ ...current, [phase.index]: !expanded }))}
              className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left transition hover:bg-white/[0.03]"
            >
              <span className={`font-mono text-[12px] ${phase.failed ? "text-red-300" : complete ? "text-foundry-teal" : "text-foundry-subtle"}`} aria-hidden="true">
                {phase.failed ? "!" : complete ? "✓" : "○"}
              </span>
              <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-foundry-subtle">
                {phase.label ? `${phase.index} · ${phase.label}` : "Plan"}
              </span>
              <span className="ml-auto text-[12px] text-foundry-subtle">
                {phase.done}/{phase.total}
                {phase.failed ? <span className="ml-1.5 text-red-300">{phase.failed} blocked</span> : null}
              </span>
            </button>
            {expanded ? (
              <ul className="ml-6 mt-1 grid gap-0.5">
                {phase.items.map((item) => (
                  <li key={item.id} className="flex items-baseline gap-2 text-[13px] leading-6">
                    <span className={`font-mono text-[11px] ${item.status === "blocked" ? "text-red-300" : item.status === "completed" ? "text-foundry-teal" : item.status === "running" ? "text-foundry-ink" : "text-foundry-subtle"}`} aria-hidden="true">
                      {item.status === "completed" ? "✓" : item.status === "skipped" ? "–" : item.status === "blocked" ? "!" : item.status === "running" ? "▸" : "○"}
                    </span>
                    <span className={item.status === "running" ? "text-foundry-ink" : "text-foundry-muted"}>{item.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Voice lines with their work rows. While live, only the two most recent groups stay
 * expanded — everything older digests to a one-line real count, expandable in place.
 * Recorded traces start fully digested (fully past = fully compressed).
 */
function VoiceTrail({ groups, recorded, busy, revealEventIds }: { groups: CanvasVoiceGroup[]; recorded: boolean; busy: boolean; revealEventIds?: string[] }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const autoExpandFrom = recorded ? groups.length : Math.max(0, groups.length - 2);
  const revealed = new Set(revealEventIds ?? []);

  return (
    <div className="grid gap-4">
      {groups.map((group, index) => {
        const expanded = openGroups[group.id] ?? (index >= autoExpandFrom || group.events.some((event) => revealed.has(event.id)));
        return (
          <section key={group.id} className={busy && index === groups.length - 1 ? "canvas-enter" : undefined}>
            {group.voice ? (
              <p className="max-w-[70ch] whitespace-pre-wrap text-[15px] leading-[1.6] text-foundry-ink" aria-live={busy && index === groups.length - 1 ? "polite" : undefined}>
                {group.voice}
              </p>
            ) : null}
            {group.events.length ? (
              expanded ? (
                <ul className="mt-2 grid gap-1.5 pl-5">
                  {group.events.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </ul>
              ) : (
                <button
                  type="button"
                  aria-expanded={false}
                  onClick={() => setOpenGroups((current) => ({ ...current, [group.id]: true }))}
                  className="mt-2 flex items-baseline gap-2 pl-5 text-left text-[13px] leading-6 text-foundry-subtle transition hover:text-foundry-muted"
                >
                  <span className={groupFailures(group) ? "text-red-300" : "text-foundry-teal"} aria-hidden="true">{groupFailures(group) ? "!" : "✓"}</span>
                  {digestText(group)}
                </button>
              )
            ) : null}
            {expanded && index < autoExpandFrom ? (
              <button
                type="button"
                aria-expanded
                onClick={() => setOpenGroups((current) => ({ ...current, [group.id]: false }))}
                className="mt-1 pl-5 text-left text-[12px] text-foundry-subtle transition hover:text-foundry-muted"
              >
                collapse
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function EventRow({ event }: { event: CanvasWorkEvent }) {
  const [open, setOpen] = useState(false);
  const failed = event.status === "error";
  const hasPayload = Boolean(event.output);

  return (
    <li id={`canvas-evt-${event.id}`} className="group/row rounded transition-colors">
      <div className="flex items-baseline gap-2">
        {hasPayload ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className={`min-w-0 flex-1 text-left font-mono text-[13px] leading-6 ${failed ? "text-red-300" : "text-foundry-muted"} transition hover:text-foundry-ink`}
          >
            {event.text}
          </button>
        ) : (
          <span className={`min-w-0 flex-1 font-mono text-[13px] leading-6 ${failed ? "text-red-300" : "text-foundry-muted"}`}>{event.text}</span>
        )}
        <span className="shrink-0 text-[11px] text-foundry-subtle opacity-0 transition-opacity duration-150 group-hover/row:opacity-100">
          {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      {open && event.output ? (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-white/8 bg-black/30 p-2.5 font-mono text-[12px] leading-5 text-foundry-muted">{event.output}</pre>
      ) : null}
    </li>
  );
}

function groupFailures(group: CanvasVoiceGroup): number {
  return group.events.filter((event) => event.status === "error").length;
}

function digestText(group: CanvasVoiceGroup): string {
  const files = new Set(group.events.filter((event) => event.kind === "file" || event.kind === "edit").map((event) => event.filePath ?? event.text)).size;
  const commands = group.events.filter((event) => event.kind === "command" || event.kind === "build").length;
  const failures = groupFailures(group);
  const totalMs = group.events.reduce((sum, event) => sum + (event.durationMs ?? 0), 0);
  const parts: string[] = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (commands) parts.push(`${commands} command${commands === 1 ? "" : "s"}`);
  if (!parts.length) parts.push(`${group.events.length} event${group.events.length === 1 ? "" : "s"}`);
  if (failures) parts.push(`${failures} failed`);
  if (totalMs > 0) parts.push(formatDuration(totalMs));
  return parts.join(" · ");
}
