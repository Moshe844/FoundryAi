"use client";

import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { MissionRecommendation } from "@/lib/ai/mission/recommendations";
import type { FactoryExecutionEvent } from "@/lib/factory/types";
import type { CanvasMissionVM, CanvasPhase, CanvasVoiceGroup } from "@/lib/canvas/model";
import { formatDuration, groupExecutionUnits } from "@/lib/canvas/model";
import type { BlockedCommandAction } from "@/components/execution/ApprovalPrompt";
import { BlockingCard } from "@/components/canvas/BlockingCard";
import { ExecutionRail } from "@/components/canvas/ExecutionRail";
import { LiveExecutionPanel } from "@/components/canvas/LiveExecutionPanel";
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
  currentFocus,
  currentStateLabel,
  focusOpen = true,
  onFocusToggle,
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
  /** Concise phrase for the focus banner, which sits directly under the request/brief. */
  currentFocus?: string;
  /** Short live state word for the current entry ("Editing page.tsx", "Running tests"). */
  currentStateLabel?: string;
  focusOpen?: boolean;
  onFocusToggle?: () => void;
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

      {!recorded && vm.isBusy && currentFocus ? (
        <FocusBanner
          focus={currentFocus}
          open={focusOpen}
          onToggle={onFocusToggle}
          liveActivity={blocked ? null : currentLiveActivity}
          checks={vm.verification}
          steps={vm.browserSteps}
        />
      ) : null}

      {showPhases ? <PhaseList phases={vm.phases} recorded={recorded} /> : null}

      <VoiceTrail
        groups={currentLiveActivity ? groupsWithoutLiveEvent(vm.groups, currentLiveActivity.id) : vm.groups}
        recorded={recorded}
        busy={vm.isBusy && !recorded}
        currentStateLabel={currentStateLabel}
        revealEventIds={revealEventIds}
      />

      {vm.deliveredFiles.length ? <DeliveredFiles files={vm.deliveredFiles} /> : null}

      {!recorded && vm.blocking && onAnswer && onApprove ? (
        <BlockingCard blocking={vm.blocking} onAnswer={onAnswer} onApprove={onApprove} onUpload={onUpload} onLocateSdk={onLocateSdk} />
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
 * The Current-focus banner: sits directly under the request/brief and owns "what is happening right
 * now" — the live activity line and the live gates. Nothing here is duplicated further down the page.
 */
function FocusBanner({
  focus, open, onToggle, liveActivity, checks, steps,
}: {
  focus: string;
  open: boolean;
  onToggle?: () => void;
  liveActivity?: { text: string; elapsedMs: number } | null;
  checks: CanvasMissionVM["verification"];
  steps: CanvasMissionVM["browserSteps"];
}) {
  const hasDetail = Boolean(liveActivity) || checks.length > 0 || steps.length > 0;
  return (
    <div className="overflow-hidden rounded-xl border border-foundry-teal/25 bg-foundry-teal/[0.045]">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        disabled={!hasDetail}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-foundry-teal/[0.04] disabled:cursor-default"
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foundry-teal/50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-foundry-teal" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[12.5px] leading-5 text-foundry-ink">
          <span className="font-bold text-foundry-teal">Current focus: </span>
          <span className="font-semibold">{focus}</span>
        </p>
        <span className="hidden shrink-0 text-[11px] text-foundry-subtle lg:block">Older progress collapses automatically</span>
        {hasDetail ? <ChevronDown size={14} className={`shrink-0 text-foundry-teal/70 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" /> : null}
      </button>
      {open && hasDetail ? (
        <div className="grid gap-3 border-t border-foundry-teal/15 bg-foundry-surface/60 px-3.5 py-3">
          {liveActivity ? (
            <p className="flex items-baseline gap-2 font-mono text-[12px] leading-6">
              <span className="shrink-0 text-foundry-teal" aria-hidden="true">●</span>
              <span className="min-w-0 flex-1 text-foundry-muted">{liveActivity.text}</span>
              <span className="shrink-0 text-foundry-subtle">{formatDuration(liveActivity.elapsedMs)} since last update</span>
            </p>
          ) : null}
          <LiveExecutionPanel checks={checks} steps={steps} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The engineering thread. Every entry except the current one compacts to a single quiet row
 * ("Foundry · Completed"); only the live entry stays fully open, with a "Previous progress" separator
 * above it. Clicking any compacted entry reopens it in place and re-compacts the others, so a long
 * mission stays readable after hundreds of runtime events instead of becoming a flat wall of text.
 */
function VoiceTrail({
  groups, recorded, busy, currentStateLabel, revealEventIds,
}: {
  groups: CanvasVoiceGroup[];
  recorded: boolean;
  busy: boolean;
  currentStateLabel?: string;
  revealEventIds?: string[];
}) {
  const [reopenedId, setReopenedId] = useState<string | null>(null);
  const revealed = new Set(revealEventIds ?? []);
  const currentIndex = groups.length - 1;

  return (
    <div className="relative grid gap-2.5 pl-[38px] before:absolute before:bottom-1 before:left-[15px] before:top-3 before:w-px before:bg-overlay/10 before:content-['']">
      {groups.map((group, index) => {
        const isCurrent = !recorded && index === currentIndex;
        const reopened = reopenedId === group.id || group.events.some((event) => revealed.has(event.id));
        const open = isCurrent || reopened;
        const failures = groupFailures(group);
        const state = isCurrent ? (currentStateLabel || "Working") : failures ? "Attention" : "Completed";
        return (
          <Fragment key={group.id}>
            {!recorded && index === currentIndex && groups.length > 1 ? (
              <div className="my-1 flex items-center gap-2.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-foundry-subtle/70">
                <span className="h-px flex-1 bg-overlay/10" aria-hidden="true" />
                <span className="whitespace-nowrap">Previous progress — click any item to reopen</span>
                <span className="h-px flex-1 bg-overlay/10" aria-hidden="true" />
              </div>
            ) : null}
            <section className={`relative ${busy && isCurrent ? "canvas-enter" : ""}`}>
              <span
                className={`absolute -left-[38px] top-0 grid h-[26px] w-[26px] place-items-center rounded-lg border text-[11px] font-extrabold ${
                  open ? "border-foundry-teal/30 bg-foundry-teal/10 text-foundry-teal" : "border-overlay/10 bg-overlay/[0.03] text-foundry-subtle"
                }`}
                aria-hidden="true"
              >
                F
              </span>
              <div className={`rounded-xl transition ${open ? "border border-overlay/10 bg-foundry-surface/70 p-3.5 shadow-[0_6px_18px_rgba(0,0,0,0.03)]" : ""}`}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setReopenedId(open && !isCurrent ? null : group.id)}
                  disabled={isCurrent}
                  className={`flex w-full items-center justify-between gap-3 text-left ${open ? "mb-2" : "rounded-lg px-1 py-1 hover:bg-overlay/[0.03]"} disabled:cursor-default`}
                >
                  <span className={`text-[12.5px] font-bold ${open ? "text-foundry-ink" : "text-foundry-subtle"}`}>Foundry</span>
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] ${isCurrent ? "text-foundry-teal" : failures ? "text-red-300" : "text-foundry-subtle"}`}>
                    <span className={`h-[6px] w-[6px] rounded-full ${isCurrent ? "animate-pulse bg-foundry-teal" : failures ? "bg-red-300" : "bg-foundry-subtle/60"}`} aria-hidden="true" />
                    {state}
                  </span>
                </button>
                {open ? (
                  <>
                    {group.voice ? <CanvasMarkdown value={group.voice} live={busy && isCurrent} /> : null}
                    {group.events.length ? <ExecutionRail units={groupExecutionUnits(group.events)} /> : null}
                  </>
                ) : null}
              </div>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}

function groupFailures(group: CanvasVoiceGroup): number {
  return group.events.filter((event) => event.status === "error").length;
}
