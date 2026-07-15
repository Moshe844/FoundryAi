"use client";

import { CheckCircle2, ChevronDown, ChevronUp, Circle, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { ExecutionMission } from "@/lib/mission-engine";
import { missionStateLabel } from "@/lib/mission/status";
import type { FactoryExecutionEvent, FactoryObjectiveChecklistItem } from "@/lib/factory/types";

function clean(value: string) {
  return value.replace(/^Model\s*·\s*/i, "Using ").replace(/\s+/g, " ").trim();
}

function latestNarrative(timeline: FactoryExecutionEvent[]) {
  return timeline
    .filter((event) => !event.internal && (event.tier === "finding" || event.tier === "decision" || event.tier === "flag" || event.kind === "reasoning"))
    .map((event) => clean(event.output || event.title))
    .filter(Boolean)
    .at(-1);
}

function activeItem(plan: FactoryObjectiveChecklistItem[]) {
  return plan.find((item) => item.status === "running") ?? plan.find((item) => item.status === "pending" || item.status === "blocked");
}

export function MissionFocus({ mission, request }: { mission: ExecutionMission; request: string }) {
  const [expanded, setExpanded] = useState(!["complete", "failed", "blocked", "cancelled", "waiting_for_approval", "waiting_for_user"].includes(mission.state));
  const plan = mission.plan ?? [];
  const current = activeItem(plan);
  const completed = plan.filter((item) => item.status === "completed" || item.status === "skipped");
  const remaining = plan.filter((item) => item.status === "pending" || item.status === "running" || item.status === "blocked");
  const working = ["understanding", "planning", "executing", "verifying", "undoing"].includes(mission.state);
  const narrative = latestNarrative(mission.timeline) || defaultNarrative(mission.state, current?.label);
  const heading = compactMissionHeading(mission.title, request);

  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(145deg,rgba(28,37,38,.9),rgba(11,15,16,.95))] shadow-[0_18px_60px_rgba(0,0,0,.2)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-foundry-subtle">Active mission</p>
          <h2 className="mt-1 text-base font-extrabold leading-6 text-foundry-ink">{heading}</h2>
          {expanded && clean(request) !== clean(heading) ? (
            <details className="mt-2 max-w-3xl">
              <summary className="cursor-pointer text-xs font-bold text-foundry-subtle transition hover:text-foundry-ink">View request details</summary>
              <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-white/8 bg-black/20 p-3 text-xs font-normal leading-5 text-foundry-muted">{request}</p>
            </details>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-foundry-teal/25 bg-foundry-teal/[0.08] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-foundry-teal">
            {working ? <Loader2 size={11} className="animate-spin" /> : <Circle size={9} />}{missionStateLabel(mission)}
          </span>
          <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-foundry-subtle transition hover:border-white/25 hover:text-foundry-ink" aria-label={expanded ? "Collapse active mission" : "Expand active mission"} aria-expanded={expanded}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </header>

      {expanded ? <div className="grid gap-4 px-4 py-4 sm:px-5">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-foundry-subtle">What I’m doing</p>
          <p aria-live="polite" className="mt-1.5 max-w-3xl text-sm leading-6 text-foundry-ink">{narrative}</p>
          {current ? <p className="mt-1 text-xs leading-5 text-foundry-muted">Current task: {current.label}</p> : null}
        </div>

        {plan.length > 3 ? (
          <div className="grid gap-2 border-t border-white/8 pt-3 sm:grid-cols-2">
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.09em] text-foundry-subtle"><CheckCircle2 size={12} className="text-foundry-teal" />Completed</p>
              <p className="mt-1 text-xs leading-5 text-foundry-muted">{completed.length ? completed.slice(-2).map((item) => item.label).join(" · ") : "Nothing completed yet."}</p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.09em] text-foundry-subtle"><Circle size={11} />Remaining</p>
              <p className="mt-1 text-xs leading-5 text-foundry-muted">{remaining.length ? `${remaining.length} item${remaining.length === 1 ? "" : "s"}` : "No planned work remains."}</p>
            </div>
          </div>
        ) : null}

        {mission.state === "verifying" || mission.state === "complete" ? (
          <div className="flex items-start gap-2 border-t border-white/8 pt-3 text-xs leading-5 text-foundry-muted">
            <ShieldCheck size={14} className={mission.verification_status === "passed" ? "mt-0.5 shrink-0 text-foundry-teal" : "mt-0.5 shrink-0 text-foundry-amber"} />
            <span>{mission.verification_status === "passed" ? "Verified with project evidence." : mission.verification_status === "partially-verified" ? "Source verified; runtime validation was unavailable in this environment." : mission.state === "verifying" ? "Checking the project continuously before handoff." : "This work still needs verification evidence."}</span>
          </div>
        ) : null}
      </div> : null}
    </section>
  );
}

function compactMissionHeading(title: string, request: string) {
  const source = clean(title || request);
  const project = source.match(/Create Project:\s*(.+?)(?=\s+(?:Template|Intelligent Project Discovery|Mode|Project source|Planned path|Project description|Project type|Selected stack|Alternative stacks|Architecture|Main features|Data model|Key facts|Confidence map)\b|$)/i)?.[1]?.trim();
  if (project) return `Create ${project}`;
  const firstLine = (title || request).split(/\r?\n/).map((line) => clean(line)).find(Boolean) ?? "Project mission";
  return firstLine.length > 96 ? `${firstLine.slice(0, 93)}…` : firstLine;
}

function defaultNarrative(state: ExecutionMission["state"], current?: string) {
  if (state === "understanding") return "I’m mapping the relevant project structure and constraints before changing anything.";
  if (state === "planning") return "I understand the affected area and I’m choosing the smallest safe implementation path.";
  if (state === "executing") return current ? `I’m implementing ${current.toLowerCase()} and checking the result as I go.` : "I’m implementing the agreed change and checking the project as I go.";
  if (state === "verifying") return "The implementation is in place. I’m proving the affected behavior still works before handing it back.";
  if (state === "waiting_for_approval") return "I’m paused. Nothing else will execute until you decide.";
  if (state === "waiting_for_user") return "I’m paused at the one decision that materially changes the implementation.";
  if (state === "complete") return "The requested work is complete.";
  if (state === "failed" || state === "blocked") return "I stopped at a concrete blocker rather than claiming the work is complete.";
  if (state === "cancelled") return "This mission was stopped. Its history and completed changes remain available.";
  return "I’m ready to continue this project.";
}
