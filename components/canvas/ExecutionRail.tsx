"use client";

import { useState } from "react";
import type { CanvasExecutionUnit } from "@/lib/canvas/model";
import { formatDuration } from "@/lib/canvas/model";

/**
 * ExecutionRail — the secondary execution stream. It renders the grouped execution units
 * (groupExecutionUnits) as one compact inline rail beneath a voice line, instead of a stacked list of
 * raw file-operation rows. Same-file reads/edits/saves already fold into one "Updated auth.ts" unit
 * upstream; here, multiple touched files further collapse into a single "Changed N files" chip. Every
 * chip expands in place to its exact low-level steps and raw payload — details available, never forced.
 */
type StatusKey = CanvasExecutionUnit["status"];

function StatusDot({ status }: { status: StatusKey }) {
  const map: Record<StatusKey, { glyph: string; className: string }> = {
    running: { glyph: "◌", className: "text-foundry-teal animate-pulse" },
    completed: { glyph: "✓", className: "text-foundry-teal" },
    warning: { glyph: "!", className: "text-amber-400" },
    error: { glyph: "!", className: "text-red-300" },
    skipped: { glyph: "–", className: "text-foundry-subtle" },
  };
  const { glyph, className } = map[status];
  return <span className={`shrink-0 font-mono text-[11px] ${className}`} aria-hidden="true">{glyph}</span>;
}

function statusWord(unit: CanvasExecutionUnit): string {
  if (unit.status === "running") return "running";
  if (unit.status === "error") return "failed";
  if (unit.status === "warning") return "warning";
  if (unit.status === "skipped") return "skipped";
  return unit.kind === "command" ? "passed" : "done";
}

function Payload({ text }: { text: string }) {
  return (
    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-overlay/8 bg-shade/30 p-2.5 font-mono text-[12px] leading-5 text-foundry-muted">{text}</pre>
  );
}

/** One expandable low-level step inside a unit's detail panel (e.g. "read lines 20–90"). */
function SubStepRow({ step }: { step: CanvasExecutionUnit["subSteps"][number] }) {
  const [open, setOpen] = useState(false);
  const failed = step.status === "error";
  return (
    <li className="leading-6">
      {step.output ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={`text-left font-mono text-[12px] ${failed ? "text-red-300" : "text-foundry-subtle"} transition hover:text-foundry-ink`}
        >
          {step.text}
        </button>
      ) : (
        <span className={`font-mono text-[12px] ${failed ? "text-red-300" : "text-foundry-subtle"}`}>{step.text}</span>
      )}
      {open && step.output ? <Payload text={step.output} /> : null}
    </li>
  );
}

function UnitDetail({ unit }: { unit: CanvasExecutionUnit }) {
  return (
    <div className="mt-1.5 grid gap-1.5 rounded-md border border-overlay/8 bg-overlay/[0.02] p-2.5">
      {unit.subSteps.length > 1 || unit.subSteps[0]?.text !== unit.label ? (
        <ul className="grid gap-0.5">
          {unit.subSteps.map((step) => <SubStepRow key={step.id} step={step} />)}
        </ul>
      ) : null}
      {unit.output ? <Payload text={unit.output} /> : null}
    </div>
  );
}

function Chip({ unit, open, onToggle }: { unit: CanvasExecutionUnit; open: boolean; onToggle: () => void }) {
  const expandable = unit.subSteps.length > 1 || Boolean(unit.output);
  const duration = unit.durationMs && unit.durationMs > 0 ? formatDuration(unit.durationMs) : "";
  const body = (
    <span className="inline-flex items-baseline gap-1.5">
      <StatusDot status={unit.status} />
      <span className={unit.status === "error" ? "text-red-300" : "text-foundry-muted"}>{unit.label}</span>
      {unit.detail ? <span className="text-foundry-subtle">· {unit.detail}</span> : null}
      {unit.kind === "command" && unit.status !== "running" ? <span className="text-foundry-subtle">· {statusWord(unit)}</span> : null}
      {duration ? <span className="text-foundry-subtle">· {duration}</span> : null}
      {expandable ? <span className="text-foundry-subtle/60" aria-hidden="true">{open ? "▾" : "▸"}</span> : null}
    </span>
  );
  return expandable ? (
    <button type="button" aria-expanded={open} onClick={onToggle} className="rounded px-1 py-0.5 text-left transition hover:bg-overlay/[0.04]">{body}</button>
  ) : (
    <span className="px-1 py-0.5">{body}</span>
  );
}

/** Fold ≥2 file units into one "Changed N files" unit whose detail panel lists each file unit. */
function fileAggregate(fileUnits: CanvasExecutionUnit[]): CanvasExecutionUnit {
  const created = fileUnits.every((unit) => unit.label.startsWith("Created"));
  const updated = fileUnits.every((unit) => unit.label.startsWith("Updated"));
  const verb = created ? "Created" : updated ? "Edited" : "Changed";
  const status: StatusKey = fileUnits.some((u) => u.status === "running")
    ? "running"
    : fileUnits.some((u) => u.status === "error")
      ? "error"
      : "completed";
  return {
    id: "unit-files-aggregate",
    kind: "file",
    label: `${verb} ${fileUnits.length} files`,
    status,
    durationMs: fileUnits.reduce((sum, unit) => sum + (unit.durationMs ?? 0), 0),
    subSteps: fileUnits.map((unit) => ({
      id: unit.id,
      kind: "file" as const,
      status: unit.status,
      text: unit.detail ? `${unit.label} · ${unit.detail}` : unit.label,
      output: unit.output,
    })),
  };
}

export function ExecutionRail({ units }: { units: CanvasExecutionUnit[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!units.length) return null;

  const fileUnits = units.filter((unit) => unit.kind === "file");
  const otherUnits = units.filter((unit) => unit.kind !== "file");
  const railUnits: CanvasExecutionUnit[] = fileUnits.length > 1
    ? [fileAggregate(fileUnits), ...otherUnits]
    : units;

  return (
    <div className="mt-2 pl-5">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 font-mono text-[12px] leading-6">
        {railUnits.map((unit, index) => (
          <span key={unit.id} className="inline-flex items-baseline">
            {index > 0 ? <span className="mx-1 text-foundry-subtle/40" aria-hidden="true">·</span> : null}
            <Chip unit={unit} open={openId === unit.id} onToggle={() => setOpenId((current) => (current === unit.id ? null : unit.id))} />
          </span>
        ))}
      </div>
      {railUnits.filter((unit) => openId === unit.id).map((unit) => <UnitDetail key={unit.id} unit={unit} />)}
    </div>
  );
}
