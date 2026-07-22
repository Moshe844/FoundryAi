"use client";

import { useState } from "react";
import type { MissionRecommendation } from "@/lib/ai/mission/recommendations";
import type { FactoryExecutionEvent } from "@/lib/factory/types";
import type { CanvasMissionVM, CanvasPhase, CanvasVoiceGroup } from "@/lib/canvas/model";
import { formatDuration, groupExecutionUnits } from "@/lib/canvas/model";
import type { BlockedCommandAction } from "@/components/execution/ApprovalPrompt";
import { BlockingCard } from "@/components/canvas/BlockingCard";
import { ExecutionRail } from "@/components/canvas/ExecutionRail";
import { LiveActivityRow } from "@/components/canvas/LiveActivityRow";
import { SummaryBlock } from "@/components/canvas/SummaryBlock";
import { CanvasMarkdown } from "@/components/canvas/CanvasMarkdown";

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
  onUpload,
  onLocateSdk,
  onEvidenceClick,
  onSuggestion,
}: {
  vm: CanvasMissionVM;
  /** True for a prior mission's trace: fully digested, nothing live. */
  recorded?: boolean;
  /** Event ids to force-expand and scroll to (evidence links from the summary). */
  revealEventIds?: string[];
  liveActivity?: { id: string; text: string; elapsedMs: number } | null;
  suggestions?: MissionRecommendation[];
  onAnswer?: (answers: Array<{ question: string; answer: string }>) => void;
  onApprove?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void;
  onUpload?: (files: File[]) => void;
  onLocateSdk?: () => void;
  onEvidenceClick?: (eventIds: string[]) => void;
  onSuggestion?: (recommendation: MissionRecommendation) => void;
}) {
  const showPhases = (vm.tier === "large" || vm.tier === "huge") && vm.phases.length > 0;
  const blocked = Boolean(vm.blocking);
  const currentLiveActivity = !recorded && vm.isBusy ? liveActivity : null;
  const elapsedMs = vm.summary?.elapsedMs
    ?? Math.max(0, new Date(vm.updatedAt).getTime() - new Date(vm.requestedAt).getTime());

  return (
    <article className="grid gap-5" aria-label={vm.request}>
      <div className="border-l-[3px] border-foundry-teal pl-3">
        <p className="whitespace-pre-wrap text-[16px] font-semibold leading-[1.5] text-foundry-ink">{vm.request}</p>
        {vm.requestAttachments.length ? <MessageImages attachments={vm.requestAttachments} /> : null}
        {vm.requestBrief ? <RequestBrief brief={vm.requestBrief} /> : null}
      </div>

      {showPhases ? <PhaseList phases={vm.phases} recorded={recorded} /> : null}

      <VoiceTrail
        groups={currentLiveActivity ? groupsWithoutLiveEvent(vm.groups, currentLiveActivity.id) : vm.groups}
        recorded={recorded}
        busy={vm.isBusy && !recorded}
        revealEventIds={revealEventIds}
      />

      {!recorded && vm.isBusy && (vm.verification.length || vm.browserSteps.length) ? (
        <LiveExecutionPanel checks={vm.verification} steps={vm.browserSteps} />
      ) : null}

      {vm.deliveredFiles.length ? <DeliveredFiles files={vm.deliveredFiles} /> : null}

      {!recorded && vm.blocking && onAnswer && onApprove ? (
        <BlockingCard blocking={vm.blocking} onAnswer={onAnswer} onApprove={onApprove} onUpload={onUpload} onLocateSdk={onLocateSdk} />
      ) : null}

      {!blocked && currentLiveActivity ? (
        <LiveActivityRow text={currentLiveActivity.text} elapsedMs={currentLiveActivity.elapsedMs} />
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

function RequestBrief({ brief }: { brief: NonNullable<CanvasMissionVM["requestBrief"]> }) {
  return (
    <details className="mt-3 max-w-[760px] overflow-hidden rounded-lg border border-overlay/10 bg-overlay/[0.025]">
      <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[12px] font-bold text-foundry-muted transition hover:bg-overlay/[0.04] hover:text-foundry-ink">
        Project brief{brief.customInstructions ? " · custom instructions included" : ""}
      </summary>
      <div className="grid gap-3 border-t border-overlay/8 px-3.5 py-3">
        {brief.customInstructions ? (
          <div className="rounded-md border border-foundry-teal/20 bg-foundry-teal/[0.055] p-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-foundry-teal">Your custom instructions</p>
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-6 text-foundry-ink">{brief.customInstructions}</p>
          </div>
        ) : null}
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">Saved as foundry-brief.md</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-shade/30 p-3 font-mono text-[11px] leading-5 text-foundry-muted">{brief.content}</pre>
        </div>
      </div>
    </details>
  );
}

function MessageImages({ attachments }: { attachments: CanvasMissionVM["requestAttachments"] }) {
  return (
    <div className="mt-3 flex max-w-[760px] flex-wrap gap-2" aria-label="Attached screenshots">
      {attachments.map((attachment) => (
        <a
          key={attachment.fileId}
          href={attachment.dataUrl}
          target="_blank"
          rel="noreferrer"
          className="group relative w-full max-w-[280px] overflow-hidden rounded-lg border border-overlay/12 bg-shade/30 transition hover:border-foundry-teal/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foundry-teal/50"
          title={`Open ${attachment.fileName}`}
        >
          {/* Attachment data URLs are already-local persisted evidence, so Next image optimization cannot improve this render. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachment.dataUrl}
            alt={attachment.fileName || "Attached screenshot"}
            className="block h-36 w-full bg-shade/20 object-contain"
          />
          <span className="flex items-center justify-between gap-2 border-t border-overlay/8 px-2.5 py-1.5 text-[10px] text-foundry-subtle group-hover:text-foundry-muted">
            <span className="truncate">{attachment.fileName}</span>
            <span className="shrink-0">Expand</span>
          </span>
        </a>
      ))}
    </div>
  );
}

/**
 * The newest event has a dedicated live-status row while work is running. Remove that exact event
 * identity from the permanent trail until the mission settles; comparing text would incorrectly
 * collapse legitimate repeated commands or reads.
 */
function groupsWithoutLiveEvent(groups: CanvasVoiceGroup[], liveEventId: string): CanvasVoiceGroup[] {
  return groups.flatMap((group) => {
    if (group.id === liveEventId) {
      return group.events.length ? [{ ...group, id: `${group.id}-prior-work`, voice: undefined }] : [];
    }
    const events = group.events.filter((event) => event.id !== liveEventId);
    return group.voice || events.length ? [{ ...group, events }] : [];
  });
}

function DeliveredFiles({ files }: { files: CanvasMissionVM["deliveredFiles"] }) {
  return (
    <section className="grid gap-2" aria-label="Delivered project files">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-foundry-subtle">Files</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {files.map((file) => (
          <a
            key={file.path}
            href={`data:${file.mediaType};charset=utf-8,${encodeURIComponent(file.content)}`}
            download={file.path.split("/").at(-1) || "project-file"}
            className="group flex min-w-0 items-center gap-3 rounded-lg border border-overlay/10 bg-overlay/[0.035] px-3 py-2.5 transition hover:border-foundry-teal/45 hover:bg-foundry-teal/[0.06]"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-foundry-teal/25 bg-foundry-teal/[0.09] font-mono text-[11px] font-bold text-foundry-teal">↓</span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-foundry-ink">{file.path}</span>
              <span className="block text-[11px] text-foundry-subtle">{Math.max(1, Math.ceil(file.size / 1024))} KB · Download</span>
            </span>
          </a>
        ))}
      </div>
    </section>
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
              className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left transition hover:bg-overlay/[0.03]"
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
              <CanvasMarkdown value={group.voice} live={busy && index === groups.length - 1} />
            ) : null}
            {group.events.length ? (
              expanded ? (
                <ExecutionRail units={groupExecutionUnits(group.events)} />
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

/**
 * §Compact Verification Activity — the live gates and browser steps as a calm two-column card. Each
 * column renders only when it has real content; nothing is invented. Rows update in place as the mission
 * progresses (a running check shows a pulsing marker, then resolves to ✓ / ✕).
 */
function LiveExecutionPanel({ checks, steps }: { checks: CanvasMissionVM["verification"]; steps: CanvasMissionVM["browserSteps"] }) {
  const columns = Number(checks.length > 0) + Number(steps.length > 0);
  return (
    <div className={`grid gap-x-8 gap-y-4 rounded-xl border border-overlay/10 bg-overlay/[0.015] p-4 ${columns > 1 ? "sm:grid-cols-2" : ""}`} aria-label="Live execution">
      {checks.length ? (
        <section className="grid content-start gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-foundry-subtle">Verification</p>
          <ul className="grid gap-1.5">
            {checks.map((check) => (
              <li key={check.label} className="flex items-baseline gap-2 border-b border-dashed border-overlay/8 pb-1.5 text-[13px] leading-6 last:border-0 last:pb-0">
                <span className={`shrink-0 font-mono text-[11px] ${check.status === "pass" ? "text-foundry-teal" : check.status === "fail" ? "text-red-300" : "text-foundry-subtle"}`} aria-hidden="true">
                  {check.status === "pass" ? "✓" : check.status === "fail" ? "✕" : "–"}
                </span>
                <span className={check.status === "fail" ? "text-red-300" : "text-foundry-muted"}>{check.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {steps.length ? (
        <section className="grid content-start gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-foundry-subtle">Browser steps</p>
          <ul className="grid gap-1.5">
            {steps.map((step) => (
              <li key={step.label} className="flex items-baseline gap-2 border-b border-dashed border-overlay/8 pb-1.5 text-[13px] leading-6 last:border-0 last:pb-0">
                {step.status === "running" ? (
                  <span className="relative flex h-2 w-2 translate-y-[-1px] shrink-0" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foundry-teal/50" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-foundry-teal" />
                  </span>
                ) : (
                  <span className={`shrink-0 font-mono text-[11px] ${step.status === "failed" ? "text-red-300" : "text-foundry-teal"}`} aria-hidden="true">
                    {step.status === "failed" ? "✕" : "✓"}
                  </span>
                )}
                <span className={step.status === "failed" ? "text-red-300" : "text-foundry-muted"}>{step.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
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
