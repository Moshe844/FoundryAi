"use client";

import { CircleDot } from "lucide-react";
import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { FactoryExecutionEvent } from "@/lib/factory/types";
import { BlockedCommandLine } from "@/components/execution/ApprovalPrompt";
import {
  compactChangeText,
  eventVisibleAtLevel,
  executionTier,
  formatClockTime,
  humanizeKey,
  isNarrativeEvent,
  type BlockedCommandAction,
  type ExecutionLevel,
} from "@/components/execution/timelineUtils";

/**
 * Relocated verbatim from components/BuildDashboard.tsx (execution-canvas rebuild, step 5) — no
 * behavior change, only moved so the execution feed has its own file. Task-size gating (condensed
 * single-line view for tiny/small missions) is added in a later step, not part of this move.
 */
export function ExecutionLevelToggle({ level, onChange }: { level: ExecutionLevel; onChange: (level: ExecutionLevel) => void }) {
  const levels: Array<{ id: ExecutionLevel; label: string }> = [
    { id: "summary", label: "Summary" },
    { id: "details", label: "Details" },
    { id: "code", label: "Code" },
    { id: "command", label: "Command" },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.03] p-0.5" role="tablist" aria-label="Execution level">
      {levels.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={level === item.id}
          className={`rounded px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] transition ${level === item.id ? "bg-foundry-teal/20 text-foundry-teal" : "text-foundry-subtle hover:text-foundry-ink"}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function ExecutionTimeline({
  timeline,
  level,
  fallbackEvents,
  endRef,
  onReadFile,
  onFetchFileContent,
  onApproveCommand,
  suppressBlocked = false,
}: {
  timeline: FactoryExecutionEvent[];
  level: ExecutionLevel;
  fallbackEvents: string[];
  endRef?: RefObject<HTMLDivElement | null>;
  onReadFile?: (path: string) => void;
  onFetchFileContent?: (path: string) => Promise<string | null>;
  onApproveCommand?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void;
  /** True while the ApprovalGate is already showing the pending approval as a hard-pause card — the
   * timeline then omits its own inline copy so there's exactly one place to act on it, not two. */
  suppressBlocked?: boolean;
}) {
  const visibleTimeline = timeline.filter((event) => !event.internal);
  const narrativeEvents = visibleTimeline.filter((event) => event.kind !== "blocked" && isNarrativeEvent(event) && eventVisibleAtLevel(event, level));
  const traceEvents = visibleTimeline.filter((event) => event.kind !== "blocked" && executionTier(event) === "trace" && eventVisibleAtLevel(event, level));
  const blockedEvents = suppressBlocked ? [] : visibleTimeline.filter((event) => event.kind === "blocked" && eventVisibleAtLevel(event, level));
  const rawMode = level === "code" || level === "command";
  // Engineering work first, trace as proof: "inspection" events (file reads, directory listings —
  // pure investigation, not an outcome) are the highest-volume noise source and add nothing on their
  // own outside raw mode. Command/build/preview/edit/file events are real outcomes worth a visible
  // row (✓ Build passed, ✎ Updated server.js) — those stay inline; reads get bundled into one
  // collapsed "Trace evidence" line instead of one row each.
  const inlineTraceEvents = rawMode ? traceEvents : traceEvents.filter((event) => event.kind !== "inspection");
  const collapsedTraceEvents = rawMode ? [] : traceEvents.filter((event) => event.kind === "inspection");

  return (
    <div className="grid gap-0.5">
        {rawMode && (traceEvents.length || blockedEvents.length) ? (
          <>
            {traceEvents.map((event) => renderTraceEvent(event, { level, onReadFile, onFetchFileContent, onApproveCommand }))}
            {blockedEvents.map((event) => <BlockedCommandLine key={event.id} event={event} onApprove={onApproveCommand} />)}
          </>
        ) : narrativeEvents.length || traceEvents.length || blockedEvents.length ? (
          <>
            {narrativeEvents.map((event) => (
              <NarrativeLine key={event.id} event={event} />
            ))}
            {inlineTraceEvents.map((event) => renderTraceEvent(event, { level, onReadFile, onFetchFileContent, onApproveCommand }))}
            {blockedEvents.map((event) => <BlockedCommandLine key={event.id} event={event} onApprove={onApproveCommand} />)}
            {collapsedTraceEvents.length ? (
              <TraceEvidenceSummary events={collapsedTraceEvents} level={level} onReadFile={onReadFile} onFetchFileContent={onFetchFileContent} onApproveCommand={onApproveCommand} />
            ) : null}
          </>
        ) : visibleTimeline.length === 0 ? (
          fallbackEvents.map((event, index) => (
            <div key={`${event}-${index}`} className="flex items-center gap-2 py-1 text-sm text-foundry-muted">
              <CircleDot size={15} className="text-foundry-teal" />
              <span>{event}</span>
            </div>
          ))
        ) : (
          // The mission actually ran but has nothing in this specific category — say so plainly instead of
          // silently falling back to the same generic "getting started" text every empty tab would otherwise
          // share, which made Code and Command look identical for a mission with neither.
          <p className="py-2 text-sm text-foundry-subtle">
            {level === "code"
              ? "No file edits were made in this mission."
              : level === "command"
                ? "No commands were run in this mission."
                : "Nothing to show at this detail level."}
          </p>
        )}
        <div ref={endRef} />
    </div>
  );
}

function TraceEvidenceSummary({
  events,
  level,
  onReadFile,
  onFetchFileContent,
  onApproveCommand,
}: {
  events: FactoryExecutionEvent[];
  level: ExecutionLevel;
  onReadFile?: (path: string) => void;
  onFetchFileContent?: (path: string) => Promise<string | null>;
  onApproveCommand?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void;
}) {
  const readCount = events.filter((event) => /^Read\b/i.test(event.title)).length;
  const otherCount = events.length - readCount;
  const parts = [
    readCount ? `${readCount} read${readCount === 1 ? "" : "s"}` : "",
    otherCount ? `${otherCount} other check${otherCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  return (
    <details className="group my-0.5 rounded-md">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-1.5 py-1.5 text-[12px] font-bold uppercase tracking-[0.04em] text-foundry-subtle transition hover:text-foundry-muted">
        <span className="w-4 shrink-0 text-center font-mono normal-case">⋯</span>
        <span>Trace evidence: {parts.join(", ") || `${events.length} step${events.length === 1 ? "" : "s"}`}</span>
      </summary>
      <div className="ml-1 mt-0.5 border-l border-white/10 pl-3">
        {events.map((event) => renderTraceEvent(event, { level, onReadFile, onFetchFileContent, onApproveCommand }))}
      </div>
    </details>
  );
}

function renderTraceEvent(
  event: FactoryExecutionEvent,
  options: {
    level: ExecutionLevel;
    onReadFile?: (path: string) => void;
    onFetchFileContent?: (path: string) => Promise<string | null>;
    onApproveCommand?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void;
  },
) {
  if (event.kind === "blocked") return <BlockedCommandLine key={event.id} event={event} onApprove={options.onApproveCommand} />;
  if (event.kind === "reasoning") return <ReasoningLine key={event.id} event={event} />;
  if (event.kind === "build") return <BuildLine key={event.id} event={event} onReadFile={options.onReadFile} forceOpen={options.level === "command"} />;
  if (event.kind === "command") return <CommandLine key={event.id} event={event} forceOpen={options.level === "command"} />;
  return <TimelineItem key={event.id} event={event} forceOpen={options.level === "code"} onReadFile={options.onReadFile} onFetchFileContent={options.onFetchFileContent} />;
}

function NarrativeLine({ event }: { event: FactoryExecutionEvent }) {
  const tier = executionTier(event);
  const narrative = event.narrative;
  const evidence = narrative?.evidence ?? [];
  const source = narrative?.source ? humanizeKey(narrative.source.replace(/-/g, " ")) : "";
  const text = narrative?.rationale || event.rationale || event.title;
  const icon = tier === "finding" ? "✓" : tier === "decision" ? "→" : "!";

  if (tier !== "flag") {
    return (
      <details className="group my-0.5 rounded-md text-[13px] leading-5">
        <summary className="flex cursor-pointer list-none items-start gap-2 px-1.5 py-1.5 text-foundry-ink transition hover:bg-white/[0.035]">
          <span className={`mt-0.5 w-4 shrink-0 font-mono ${tier === "finding" ? "text-foundry-blue" : "text-foundry-teal"}`}>{icon}</span>
          <span className="min-w-0 flex-1">{text}</span>
          <span className="shrink-0 font-mono text-[10px] text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
        </summary>
        <div className="ml-7 grid gap-1.5 border-l border-white/10 px-3 py-2 text-xs leading-5 text-foundry-muted">
          {source ? <DetailRow label="Source" value={source} /> : null}
          {narrative?.filePath ? <DetailRow label="Path" value={narrative.filePath} /> : event.filePath ? <DetailRow label="Path" value={event.filePath} /> : null}
          {typeof narrative?.confidence === "number" ? <DetailRow label="Confidence" value={`${narrative.confidence}%`} /> : null}
          {narrative?.details
            ? Object.entries(narrative.details).map(([key, value]) =>
                typeof value === "undefined" ? null : <DetailRow key={key} label={humanizeKey(key)} value={Array.isArray(value) ? value.join("\n") : String(value)} />,
              )
            : null}
          {evidence.length ? <DetailRow label="Evidence" value={evidence.join("\n")} /> : null}
        </div>
      </details>
    );
  }

  return (
    <details className="group my-1 overflow-hidden rounded-md border border-foundry-amber/30 bg-foundry-amber/[0.08] text-foundry-amber" open>
      <summary className="cursor-pointer list-none px-3 py-2.5">
        <span className="grid gap-1">
          <span className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.08em]">Needs attention</span>
            <span className="font-mono text-[10px] text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
          </span>
          <span className="text-[13.5px] font-bold leading-5 text-foundry-ink">{text}</span>
          {narrative?.source === "conflict" ? (
            <span className="text-[11px] font-semibold normal-case tracking-normal text-foundry-amber/80">Type your answer in the message box below to continue.</span>
          ) : null}
        </span>
      </summary>
      <div className="grid gap-2 border-t border-foundry-amber/20 px-3 py-2 text-xs leading-5 text-foundry-muted">
        {source ? <DetailRow label="Source" value={source} /> : null}
        {narrative?.filePath ? <DetailRow label="Path" value={narrative.filePath} /> : event.filePath ? <DetailRow label="Path" value={event.filePath} /> : null}
        {typeof narrative?.confidence === "number" ? <DetailRow label="Confidence" value={`${narrative.confidence}%`} /> : null}
        {narrative?.details
          ? Object.entries(narrative.details).map(([key, value]) =>
              typeof value === "undefined" ? null : <DetailRow key={key} label={humanizeKey(key)} value={Array.isArray(value) ? value.join("\n") : String(value)} />,
            )
          : null}
        {evidence.length ? (
          <div>
            <p className="font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">Evidence</p>
            <ul className="mt-1 grid gap-1">
              {evidence.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function ReasoningLine({ event }: { event: FactoryExecutionEvent }) {
  return <p className="py-1.5 text-[14px] leading-6 text-foundry-ink">{event.title}</p>;
}

function CommandLine({ event, forceOpen = false }: { event: FactoryExecutionEvent; forceOpen?: boolean }) {
  const [tab, setTab] = useState<"stdout" | "stderr">("stdout");
  const failed = event.status === "error";
  const [open, setOpen] = useState(forceOpen || failed);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const running = event.status === "running";
  const command = event.command || event.title;
  const promptSymbol = running ? ">" : failed ? "!" : "$";
  const promptTone = running ? "text-foundry-blue" : failed ? "text-red-300" : "text-foundry-teal";
  const hasSplitOutput = Boolean(event.stdout || event.stderr);

  return (
    <div className={`my-1 overflow-hidden rounded-md border ${failed ? "border-red-400/25 bg-red-400/[0.05]" : "border-foundry-teal/20 bg-black/35"}`}>
      <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left font-mono text-[12.5px] leading-5" onClick={() => setOpen((current) => !current)}>
        <span className="font-mono text-[10px] text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
        <span className={`shrink-0 ${promptTone}`}>{promptSymbol}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[#d8f3ec]">{command}</span>
      </button>
      {event.cwd ? <p className="border-t border-white/10 px-3 py-1 text-[10.5px] text-foundry-subtle">cwd: {event.cwd}</p> : null}
      {event.details?.shellFallbackFrom ? (
        <p className="border-t border-white/10 px-3 py-1 text-[10.5px] text-foundry-amber">
          Ran via {String(event.details.shellUsed)} — {String(event.details.shellFallbackFrom)} didn&apos;t recognize this.
        </p>
      ) : null}
      {open && (hasSplitOutput || event.output) ? (
        <div>
          {hasSplitOutput ? (
            <div className="flex items-center gap-1 border-t border-white/10 px-2 pt-1.5">
              <button type="button" className={`rounded px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] ${tab === "stdout" ? "bg-foundry-teal/20 text-foundry-teal" : "text-foundry-subtle"}`} onClick={() => setTab("stdout")}>
                stdout
              </button>
              <button type="button" className={`rounded px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] ${tab === "stderr" ? "bg-foundry-teal/20 text-foundry-teal" : "text-foundry-subtle"}`} onClick={() => setTab("stderr")}>
                stderr
              </button>
              {typeof event.exitCode !== "undefined" ? <span className="ml-auto pr-1 text-[10px] font-bold text-foundry-subtle">exit {event.exitCode}</span> : null}
              {event.durationMs ? <span className="pr-1 text-[10px] font-bold text-foundry-subtle">{(event.durationMs / 1000).toFixed(1)}s</span> : null}
            </div>
          ) : null}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-white/10 bg-black/40 px-3 py-2 text-[11.5px] leading-5 text-foundry-muted">
            {hasSplitOutput ? (tab === "stdout" ? event.stdout || "(empty)" : event.stderr || "(empty)") : event.output}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

type BuildLocation = { file: string; line: number; column?: number; severity: "error" | "warning"; message: string };

function parseBuildLocations(output: string): BuildLocation[] {
  const results: BuildLocation[] = [];
  const lines = output.split(/\r?\n/);
  const pattern = /^(.*?\.(?:tsx?|jsx?|css|json|mjs|cjs)):(\d+):?(\d+)?/i;
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    const severity: "error" | "warning" = /error/i.test(line) ? "error" : "warning";
    results.push({
      file: match[1].replace(/\\/g, "/").replace(/^\.\//, ""),
      line: Number(match[2]),
      column: match[3] ? Number(match[3]) : undefined,
      severity,
      message: line.replace(pattern, "").trim().slice(0, 160),
    });
    if (results.length >= 25) break;
  }
  return results;
}

function BuildLine({ event, onReadFile, forceOpen = false }: { event: FactoryExecutionEvent; onReadFile?: (path: string) => void; forceOpen?: boolean }) {
  const failed = event.status === "error";
  const [open, setOpen] = useState(forceOpen || failed);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const output = `${event.stderr || ""}\n${event.stdout || ""}\n${event.output || ""}`.trim();
  const locations = parseBuildLocations(output);

  return (
    <div className={`my-1 overflow-hidden rounded-md border ${failed ? "border-red-400/25 bg-red-400/[0.05]" : "border-foundry-teal/20 bg-black/30"}`}>
      <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] font-bold" onClick={() => setOpen((current) => !current)}>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-normal text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
          <span className={failed ? "text-red-300" : "text-foundry-teal"}>{event.title}</span>
        </span>
        {locations.length ? <span className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-foundry-subtle">{locations.length} location{locations.length === 1 ? "" : "s"}</span> : null}
      </button>
      {open ? (
        <div className="border-t border-white/10 px-3 py-2">
          {locations.length ? (
            <div className="grid gap-1">
              {locations.map((location, index) => (
                <button
                  key={`${location.file}-${location.line}-${index}`}
                  type="button"
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-[11.5px] text-foundry-muted hover:bg-white/[0.05] hover:text-foundry-ink"
                  onClick={() => onReadFile?.(location.file)}
                >
                  <span className={`font-mono ${location.severity === "error" ? "text-red-300" : "text-foundry-amber"}`}>{location.severity === "error" ? "✕" : "!"}</span>
                  <span className="font-mono text-foundry-teal">
                    {location.file}:{location.line}
                    {location.column ? `:${location.column}` : ""}
                  </span>
                  <span className="min-w-0 truncate">{location.message}</span>
                </button>
              ))}
            </div>
          ) : null}
          {output ? <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{output}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

type CodeViewTab = "diff" | "entire" | "before-after";

export function CodeViewTabs({
  event,
  onFetchFileContent,
  onReadFile,
}: {
  event: FactoryExecutionEvent;
  onFetchFileContent?: (path: string) => Promise<string | null>;
  onReadFile?: (path: string) => void;
}) {
  const [tab, setTab] = useState<CodeViewTab>("diff");
  const [afterContent, setAfterContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const filePath = event.filePath;

  async function ensureAfterContent() {
    if (afterContent !== null || !filePath || !onFetchFileContent) return;
    setLoading(true);
    const content = await onFetchFileContent(filePath);
    setAfterContent(content ?? "Could not load current file content.");
    setLoading(false);
  }

  return (
    <div className="mt-1">
      <div className="mb-1.5 flex items-center gap-1">
        {(["diff", "entire", "before-after"] as CodeViewTab[]).map((id) => (
          <button
            key={id}
            type="button"
            className={`rounded px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] ${tab === id ? "bg-foundry-teal/20 text-foundry-teal" : "text-foundry-subtle hover:text-foundry-ink"}`}
            onClick={() => {
              setTab(id);
              if (id === "entire" || id === "before-after") void ensureAfterContent();
            }}
          >
            {id === "diff" ? "Diff" : id === "entire" ? "Entire file" : "Before / After"}
          </button>
        ))}
        {filePath && onReadFile ? (
          <button type="button" className="ml-auto text-[10px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal" onClick={() => onReadFile(filePath)}>
            Open in viewer
          </button>
        ) : null}
      </div>
      {tab === "diff" ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{event.output || "No diff captured for this change."}</pre>
      ) : tab === "entire" ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{loading ? "Loading..." : afterContent || "No content available."}</pre>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">Before</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{event.beforeContent || "(new file — no previous version)"}</pre>
          </div>
          <div>
            <p className="mb-1 font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">After</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{loading ? "Loading..." : afterContent || "No content available."}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineItem({
  event,
  forceOpen = false,
  onReadFile,
  onFetchFileContent,
}: {
  event: FactoryExecutionEvent;
  forceOpen?: boolean;
  onReadFile?: (path: string) => void;
  onFetchFileContent?: (path: string) => Promise<string | null>;
}) {
  const line = eventLineFor(event);
  const isCodeEvent = (event.kind === "edit" || event.kind === "file") && Boolean(event.filePath);
  return (
    <details className="group" open={forceOpen || event.status === "error"}>
      <summary className="cursor-pointer list-none">
        <span className="grid min-w-0 grid-cols-[3rem_1.25rem_minmax(0,1fr)_auto] items-center gap-2 py-1 text-sm">
          <span className="font-mono text-[10px] text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
          <span className={`font-mono text-sm ${line.tone}`}>{line.symbol}</span>
          <span className="min-w-0 truncate text-foundry-ink">{line.text}</span>
          {line.delta ? <span className="font-mono text-xs font-bold text-foundry-teal">{line.delta}</span> : null}
        </span>
      </summary>
      <div className="ml-5 grid gap-2 border-l border-white/10 py-2 pl-3 text-xs leading-5 text-foundry-muted">
        <DetailRow label="Status" value={event.status} />
        <DetailRow label="Time" value={new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} />
        {event.filePath ? <DetailRow label={event.status === "completed" ? "Path" : "File"} value={event.filePath} /> : null}
        {event.rationale ? <DetailRow label="Reason" value={event.rationale} /> : null}
        {event.command ? <DetailRow label="Command" value={event.command} /> : null}
        {typeof event.exitCode !== "undefined" ? <DetailRow label="Exit code" value={String(event.exitCode)} /> : null}
        {event.durationMs ? <DetailRow label="Duration" value={`${(event.durationMs / 1000).toFixed(1)} seconds`} /> : null}
        {event.details
          ? Object.entries(event.details).map(([key, value]) =>
              typeof value === "undefined" ? null : <DetailRow key={key} label={humanizeKey(key)} value={Array.isArray(value) ? value.join("\n") : String(value)} />,
            )
          : null}
        {isCodeEvent ? (
          <CodeViewTabs event={event} onFetchFileContent={onFetchFileContent} onReadFile={onReadFile} />
        ) : event.output ? (
          <div>
            <p className="font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">Output</p>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{event.output}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function eventLineFor(event: FactoryExecutionEvent) {
  const target = event.filePath || event.fileName || event.command || "";
  const delta = compactChangeText(event);
  const failed = event.status === "error";
  const running = event.status === "running";
  const warning = event.status === "warning";
  const symbol = failed ? "✕" : warning ? "⚠" : running ? "▶" : event.kind === "edit" || event.kind === "file" ? "✎" : "✓";
  const tone = failed ? "text-red-300" : warning ? "text-foundry-amber" : running ? "text-foundry-blue" : event.kind === "edit" || event.kind === "file" ? "text-foundry-teal" : "text-foundry-muted";
  const verb =
    event.kind === "command" || event.kind === "build"
      ? running
        ? "Running"
        : failed
          ? "Command failed"
          : "Ran"
      : event.kind === "edit"
        ? event.title
        : event.kind === "file"
          ? event.title.toLowerCase().includes("copied")
            ? "Copied"
            : event.title
            : event.kind === "inspection"
              ? event.title
            : event.kind === "preview"
              ? running
                ? "Preview updating"
                : "Preview ready"
            : event.kind === "summary"
                ? event.title
                : running
                  ? event.title
                  : event.title;
  const text = target && verb !== event.title ? `${verb} ${target}` : verb;

  return { symbol, tone, text, delta };
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[110px_minmax(0,1fr)]">
      <span className="font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words text-foundry-muted">{value}</span>
    </div>
  );
}
