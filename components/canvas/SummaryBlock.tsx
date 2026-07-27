"use client";

import type { MissionRecommendation } from "@/lib/ai/mission/recommendations";
import type { CanvasSummary } from "@/lib/canvas/model";
import { formatDuration } from "@/lib/canvas/model";

export function SummaryBlock({
  summary,
  suggestions,
  onEvidenceClick,
  onSuggestion,
  onOpenProductionConnections,
}: {
  summary: CanvasSummary;
  suggestions: MissionRecommendation[];
  onEvidenceClick: (eventIds: string[]) => void;
  onSuggestion: (recommendation: MissionRecommendation) => void;
  onOpenProductionConnections?: () => void;
}) {
  const completed = summary.whatChanged
    .map((line) => ({ ...line, text: humanize(line.text) }))
    .filter((line) => isDeliveredProjectWork(line.text));
  const verified = summary.verified.map(humanize);
  const failedChecks = summary.failedChecks.map(humanize);
  const remaining = unique([
    ...summary.watchFor,
    ...(summary.engineeringReport?.remainingIssues ?? []),
  ].map(humanize));
  const status = statusPresentation(summary.heading, completed.length);
  const providerSpentWithoutOutput = completed.length === 0 && (summary.modelUsage?.estimatedCostUsd ?? 0) > 0;

  return (
    <section className="canvas-enter mt-5 grid max-w-4xl gap-4" aria-label="Mission result">
      <header className={`rounded-xl border p-4 ${status.container}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${status.badge}`}>
            {status.label}
          </span>
          {summary.elapsedMs ? <span className="text-[12px] text-foundry-subtle">{formatDuration(summary.elapsedMs)}</span> : null}
        </div>
        <h2 className="mt-3 text-[18px] font-semibold leading-7 text-foundry-ink">{status.title}</h2>
        {summary.outcome ? <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-6 text-foundry-muted">{humanize(summary.outcome)}</p> : null}
      </header>

      {providerSpentWithoutOutput ? (
        <section className="rounded-xl border border-red-300/30 bg-red-300/[0.045] p-4" role="alert">
          <h3 className="text-[14px] font-semibold text-foundry-ink">No project output was created</h3>
          <p className="mt-1 text-[13px] leading-5 text-foundry-muted">
            Model-provider usage was recorded, but Foundry did not create or edit an application file. Foundry will not present planning, routing, requirement extraction, or a saved brief as completed project work.
          </p>
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <ResultSection title="Project output" count={completed.length} tone={completed.length ? "success" : "warning"} empty="No application source or user-facing feature was created.">
          {completed.map((line) => (
            <ResultRow key={line.text} icon="✓" tone="success">
              <button
                type="button"
                onClick={() => onEvidenceClick(line.evidenceEventIds)}
                disabled={!line.evidenceEventIds.length}
                className="text-left leading-5 text-foundry-ink enabled:hover:underline disabled:cursor-default"
                title={line.evidenceEventIds.length ? "Show the work behind this change" : undefined}
              >
                {line.text}
              </button>
            </ResultRow>
          ))}
        </ResultSection>

        <ResultSection title="Verification" count={verified.length + failedChecks.length} tone={failedChecks.length ? "danger" : verified.length ? "success" : "warning"} empty="No build, test, or browser check was completed.">
          {verified.map((item, index) => <ResultRow key={`verified-${index}`} icon="✓" tone="success">{item}</ResultRow>)}
          {failedChecks.map((item, index) => <ResultRow key={`failed-${index}`} icon="!" tone="danger">{item}</ResultRow>)}
          {!verified.length && !failedChecks.length && summary.heading === "Done" ? (
            <ResultRow icon="○" tone="warning">The files were written, but the product was not exercised.</ResultRow>
          ) : null}
        </ResultSection>
      </div>

      {remaining.length ? (
        <ResultSection title="Still needs work" count={remaining.length} tone="warning">
          {remaining.map((item, index) => <ResultRow key={`remaining-${index}`} icon="→" tone="warning">{item}</ResultRow>)}
        </ResultSection>
      ) : null}

      {summary.productionConnections?.length && onOpenProductionConnections ? (
        <section className="rounded-xl border border-foundry-teal/25 bg-foundry-teal/[0.045] p-4">
          <h3 className="text-[14px] font-semibold text-foundry-ink">Production connections</h3>
          <p className="mt-1 text-[13px] leading-5 text-foundry-muted">
            Local verification used development-safe settings. Connect {summary.productionConnections.join(", ")} before production launch.
          </p>
          <button
            type="button"
            onClick={onOpenProductionConnections}
            className="mt-3 rounded-lg bg-foundry-teal px-3 py-2 text-xs font-extrabold text-slate-950"
          >
            Connect production services
          </button>
        </section>
      ) : null}

      {summary.engineeringReport ? <EngineeringDetails report={summary.engineeringReport} lifecycle={summary.lifecycle ?? []} /> : null}
      {summary.modelUsage ? <CostDetails usage={summary.modelUsage} /> : null}

      {suggestions.length ? (
        <section className="rounded-xl border border-foundry-line/70 bg-overlay/[0.015] p-3" aria-label="Suggested next steps">
          <p className="px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foundry-subtle">Next steps</p>
          <div className="mt-1 grid">
            {suggestions.slice(0, 3).map((recommendation) => (
              <button
                key={recommendation.id}
                type="button"
                onClick={() => onSuggestion(recommendation)}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-[14px] leading-5 text-foundry-muted transition hover:bg-overlay/[0.04] hover:text-foundry-ink"
                title={recommendation.why || undefined}
              >
                <span className="mt-0.5 text-foundry-teal" aria-hidden="true">→</span>
                <span>{recommendation.label}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function ResultSection({
  title,
  count,
  tone,
  empty,
  children,
}: {
  title: string;
  count?: number;
  tone: "success" | "warning" | "danger";
  empty?: string;
  children?: React.ReactNode;
}) {
  const border = tone === "danger" ? "border-red-300/25" : tone === "warning" ? "border-foundry-amber/25" : "border-foundry-teal/20";
  return (
    <section className={`rounded-xl border ${border} bg-overlay/[0.018] p-4`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-foundry-ink">{title}</h3>
        {typeof count === "number" ? <span className="rounded-full bg-overlay/[0.05] px-2 py-0.5 text-[11px] text-foundry-subtle">{count}</span> : null}
      </div>
      <div className="mt-2 grid gap-2">
        {children || <p className="text-[13px] leading-5 text-foundry-subtle">{empty}</p>}
      </div>
    </section>
  );
}

function ResultRow({ icon, tone, children }: { icon: string; tone: "success" | "warning" | "danger"; children: React.ReactNode }) {
  const color = tone === "danger" ? "text-red-300" : tone === "warning" ? "text-foundry-amber" : "text-foundry-teal";
  return (
    <div className="flex items-start gap-2 text-[13px] leading-5 text-foundry-muted">
      <span className={`mt-[1px] shrink-0 font-mono ${color}`} aria-hidden="true">{icon}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

function EngineeringDetails({ report, lifecycle }: { report: NonNullable<CanvasSummary["engineeringReport"]>; lifecycle: NonNullable<CanvasSummary["lifecycle"]> }) {
  return (
    <details className="rounded-xl border border-foundry-line/70 bg-overlay/[0.015] p-4 text-[13px] text-foundry-muted">
      <summary className="cursor-pointer select-none font-semibold text-foundry-ink">Technical details</summary>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <DetailList title="Project checks" items={report.verification.map((item) => `${friendlyCheck(item.check_type)} — ${item.result === "pass" ? "passed" : item.result === "fail" ? "failed" : "not run"}: ${humanize(item.evidence)}`)} />
        <DetailList title="Files changed" items={report.filesChanged} mono empty="No project file change was recorded." />
        <DetailList title="Commands run" items={report.commandsExecuted.map((command) => `${command.command} — ${command.exitCode === 0 ? "passed" : `exit ${command.exitCode ?? "unknown"}`}`)} mono empty="No command was required." />
        <DetailList title="Work stages" items={lifecycle.map((phase) => `${phase.label} — ${phase.status}${phase.reason ? `: ${humanize(phase.reason)}` : ""}`)} />
        {report.rootCause ? <DetailList title="Root cause" items={[humanize(report.rootCause)]} /> : null}
        <DetailList title="Actions taken" items={report.actionsTaken.map(humanize)} empty="No source-changing action was recorded." />
        <DetailList title="Browser check" items={[friendlyOperationalStatus(report.browserValidation)]} />
        <DetailList title="Recommendations" items={report.recommendations.map(humanize)} empty="No additional recommendation." />
      </div>
    </details>
  );
}

function CostDetails({ usage }: { usage: NonNullable<CanvasSummary["modelUsage"]> }) {
  return (
    <details className="rounded-xl border border-foundry-line/70 bg-overlay/[0.015] p-4 text-[13px] text-foundry-muted">
      <summary className="cursor-pointer select-none font-semibold text-foundry-ink">Usage and cost</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Metric label="Model requests" value={String(usage.paidCalls)} />
        <Metric label="Provider-estimated usage" value={`$${usage.estimatedCostUsd.toFixed(2)}`} />
        <Metric label="Customer charge" value={`$${usage.customerChargeUsd.toFixed(2)}`} />
        <Metric label="Tokens" value={`${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`} />
      </div>
      {usage.nonBillableProviderUsageUsd > 0 ? (
        <p className="mt-3 text-[12px] leading-5 text-foundry-subtle">Foundry did not charge this incomplete mission. The model provider may still charge the account that supplied the API key for requests it processed.</p>
      ) : null}
    </details>
  );
}

function DetailList({ title, items, empty, mono = false }: { title: string; items: string[]; empty?: string; mono?: boolean }) {
  const visible = unique(items.filter(Boolean).map(humanize));
  return (
    <section>
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-foundry-subtle">{title}</p>
      {visible.length ? (
        <ul className={`mt-1 grid gap-1.5 ${mono ? "font-mono text-[12px]" : ""}`}>
          {visible.map((item, index) => <li key={`${title}-${index}`} className="break-words leading-5">{item}</li>)}
        </ul>
      ) : <p className="mt-1 text-foundry-subtle">{empty}</p>}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-overlay/[0.035] px-3 py-2"><p className="text-[11px] text-foundry-subtle">{label}</p><p className="mt-0.5 font-medium text-foundry-ink">{value}</p></div>;
}

function statusPresentation(heading: CanvasSummary["heading"], completedCount: number) {
  if (heading === "Done") return { label: "Completed", title: "The requested work is complete.", container: "border-foundry-teal/25 bg-foundry-teal/[0.045]", badge: "bg-foundry-teal/15 text-foundry-teal" };
  if (heading === "Blocked" || heading === "Verification blocked") return { label: "Needs input", title: "Foundry preserved the work and needs one external decision.", container: "border-foundry-amber/25 bg-foundry-amber/[0.035]", badge: "bg-foundry-amber/15 text-foundry-amber" };
  if (heading === "Stopped") return { label: "Paused", title: "The work is saved and can continue from here.", container: "border-foundry-line bg-overlay/[0.02]", badge: "bg-overlay/[0.06] text-foundry-muted" };
  if (completedCount === 0) return { label: "No output", title: "Foundry did not create usable project output.", container: "border-red-300/25 bg-red-300/[0.035]", badge: "bg-red-300/10 text-red-300" };
  return { label: "Needs repair", title: "Foundry created part of the project, but the project checks are not green yet.", container: "border-red-300/25 bg-red-300/[0.035]", badge: "bg-red-300/10 text-red-300" };
}

function friendlyCheck(type: string) {
  return ({ typecheck: "Type check", lint: "Lint", build: "Production build", test: "Tests", preview: "Browser flow", command: "Command", checklist: "Requirements", "file-read": "File verification", "manual-evidence": "Manual verification" } as Record<string, string>)[type] ?? type;
}

function friendlyOperationalStatus(value: NonNullable<CanvasSummary["engineeringReport"]>["browserValidation"]) {
  const evidence = value.evidence.length ? ` — ${value.evidence.map(humanize).join("; ")}` : "";
  const status = value.status === "verified" ? "Passed" : value.status === "failed" ? "Failed" : value.status === "waiting-approval" ? "Waiting for approval" : value.status === "not-requested" ? "Not requested" : "Not verified";
  return `${status}${evidence}`;
}

function isDeliveredProjectWork(value: string) {
  const text = value.toLowerCase();
  if (/\b(?:planning|routed|model|requirements?|ledger|brief|assessment|deciding|approach|provider|token|stage)\b/.test(text)) return false;
  return /\b(?:created|edited|updated|saved|wrote|written|implemented|added|removed|fixed|changed)\b/.test(text)
    && /(?:\.[a-z0-9]{1,8}\b|\b(?:page|screen|route|component|feature|website|application|app|api|database|test|style|layout|form|navigation)\b)/.test(text);
}

function humanize(value: string) {
  return value
    .replace(/durable mutation/gi, "verified source change")
    .replace(/provider call/gi, "model request")
    .replace(/distinct failure/gi, "different error")
    .replace(/repair attempt/gi, "repair")
    .replace(/deterministic verification gate/gi, "project check")
    .replace(/generated source was rejected/gi, "the generated code did not pass the project checks")
    .replace(/without a passing build/gi, "while the build was still failing")
    .replace(/SOURCE_BATCH_READY_FOR_DETERMINISTIC_VERIFICATION/gi, "The source batch is ready for project checks")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
