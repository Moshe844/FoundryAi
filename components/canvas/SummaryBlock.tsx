"use client";

import type { MissionRecommendation } from "@/lib/ai/mission/recommendations";
import type { CanvasSummary } from "@/lib/canvas/model";
import { formatDuration } from "@/lib/canvas/model";

/**
 * §9/§10 — the terminal block. Plain timeline content, no card. Every claim is a real
 * recorded fact: "verified" appears only with verification evidence behind it, and the
 * absence of verification is stated outright rather than papered over. Suggestions are
 * quiet one-line rows that vanish the moment any next step begins.
 */
export function SummaryBlock({
  summary,
  suggestions,
  onEvidenceClick,
  onSuggestion,
}: {
  summary: CanvasSummary;
  suggestions: MissionRecommendation[];
  onEvidenceClick: (eventIds: string[]) => void;
  onSuggestion: (recommendation: MissionRecommendation) => void;
}) {
  const headingColor =
    summary.heading === "Done" ? "text-foundry-teal" : summary.heading === "Stopped" ? "text-foundry-ink" : "text-red-300";

  return (
    <div className="canvas-enter mt-5 grid gap-3">
      <p className="text-[15px] font-semibold leading-6">
        <span className={headingColor}>{summary.heading}</span>
        {summary.elapsedMs ? <span className="ml-2 text-[12px] font-normal text-foundry-subtle">{formatDuration(summary.elapsedMs)}</span> : null}
      </p>

      {summary.outcome ? (
        <p className="max-w-3xl whitespace-pre-wrap text-[14px] leading-6 text-foundry-ink">{summary.outcome}</p>
      ) : null}

      {summary.whatChanged.length ? (
        <ul className="grid gap-1">
          {summary.whatChanged.map((line) => (
            <li key={line.text}>
              <button
                type="button"
                onClick={() => onEvidenceClick(line.evidenceEventIds)}
                disabled={!line.evidenceEventIds.length}
                className="text-left font-mono text-[13px] leading-6 text-foundry-muted transition enabled:hover:text-foundry-ink enabled:hover:underline disabled:cursor-default"
                title={line.evidenceEventIds.length ? "Show the events behind this change" : undefined}
              >
                {line.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {summary.verified.length ? (
        <ul className="grid gap-1">
          {summary.verified.map((item, index) => (
            <li key={`verified-${index}`} className="text-[13px] leading-6 text-foundry-muted">
              <span className="mr-1.5 text-foundry-teal" aria-hidden="true">✓</span>
              {item}
            </li>
          ))}
        </ul>
      ) : summary.heading === "Done" ? (
        <p className="text-[13px] leading-6 text-foundry-amber">not verified — the work was written but not exercised</p>
      ) : null}

      {summary.failedChecks.map((item, index) => (
        <p key={`failed-check-${index}`} className="text-[13px] leading-6 text-red-300">
          <span className="mr-1.5" aria-hidden="true">✕</span>
          {item}
        </p>
      ))}

      {summary.watchFor.length ? (
        <div className="grid gap-1">
          {summary.watchFor.map((item, index) => (
            <p key={`watch-for-${index}`} className="text-[13px] leading-6 text-foundry-subtle">
              {summary.heading === "Failed" ? "failure" : summary.heading === "Blocked" ? "waiting on" : "watch for"}: {item}
            </p>
          ))}
        </div>
      ) : null}

      {summary.engineeringReport ? (
        <EngineeringReport report={summary.engineeringReport} lifecycle={summary.lifecycle ?? []} />
      ) : null}

      {suggestions.length ? (
        <div className="mt-1 grid" role="list" aria-label="Suggested next steps">
          {suggestions.slice(0, 3).map((recommendation) => (
            <button
              key={recommendation.id}
              type="button"
              role="listitem"
              onClick={() => onSuggestion(recommendation)}
              className="w-full rounded px-1 py-1 text-left text-[14px] leading-6 text-foundry-muted transition hover:bg-overlay/[0.03] hover:text-foundry-ink"
              title={recommendation.why || undefined}
            >
              <span className="mr-2 text-foundry-subtle" aria-hidden="true">↳</span>
              {recommendation.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EngineeringReport({ report, lifecycle }: { report: NonNullable<CanvasSummary["engineeringReport"]>; lifecycle: NonNullable<CanvasSummary["lifecycle"]> }) {
  const publication = operationalLine("Publication", report.publication);
  const monitoring = operationalLine("Monitoring", report.monitoring);
  return (
    <details className="max-w-3xl rounded-lg border border-foundry-line/70 bg-overlay/[0.015] px-3 py-2 text-[13px] text-foundry-muted">
      <summary className="cursor-pointer select-none font-medium text-foundry-ink">
        Engineering report · {report.completion.highest.replace(/-/g, " ")}
      </summary>
      <div className="mt-3 grid gap-3 leading-6">
        <ReportSection label="Lifecycle" items={lifecycle.map((phase) => `${phase.label}: ${phase.status}${phase.reason ? ` — ${phase.reason}` : ""}`)} />
        {report.issue ? <ReportSection label="Issue" items={[report.issue]} /> : null}
        {report.rootCause ? <ReportSection label="Root cause" items={[report.rootCause]} /> : null}
        <ReportSection label="Actions taken" items={report.actionsTaken} empty="No mutating action was recorded." />
        <ReportSection label="Files changed" items={report.filesChanged} empty="No project files changed." mono />
        <ReportSection
          label="Commands executed"
          items={report.commandsExecuted.map((command) => `${command.command} → exit ${command.exitCode ?? "unknown"}`)}
          empty="No shell commands were required."
          mono
        />
        <ReportSection label="Browser validation" items={[operationalLine("Browser", report.browserValidation)]} />
        <ReportSection label="Operations" items={[publication, monitoring]} />
        <ReportSection label="Remaining issues" items={report.remainingIssues} empty="None recorded." />
        <ReportSection label="Recommendations" items={report.recommendations} empty="No follow-up recommendation." />
      </div>
    </details>
  );
}

function ReportSection({ label, items, empty, mono = false }: { label: string; items: string[]; empty?: string; mono?: boolean }) {
  const visible = items.filter(Boolean);
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foundry-subtle">{label}</p>
      {visible.length ? (
        <ul className={`mt-0.5 grid gap-0.5 ${mono ? "font-mono text-[12px]" : ""}`}>
          {visible.map((item, index) => <li key={`${label}-${index}`} className="break-words">{item}</li>)}
        </ul>
      ) : empty ? <p className="mt-0.5 text-foundry-subtle">{empty}</p> : null}
    </section>
  );
}

function operationalLine(label: string, value: NonNullable<CanvasSummary["engineeringReport"]>["publication"]): string {
  const evidence = value.evidence.length ? ` — ${value.evidence.join("; ")}` : "";
  return `${label}: ${value.status.replace(/-/g, " ")}${evidence}`;
}
