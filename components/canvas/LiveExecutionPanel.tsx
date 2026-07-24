"use client";

import type { CanvasBrowserStep, CanvasVerificationCheck } from "@/lib/canvas/model";

/**
 * The live gates and browser steps as a calm two-column card. Each column renders only when it has real
 * content; nothing is invented. Rows update in place as the mission progresses (a running step shows a
 * pulsing marker, then resolves to ✓ / ✕). Used inside the Current-focus banner and the active mission
 * block so "what is happening right now" is visible without scrolling to the bottom of the trail.
 */
export function LiveExecutionPanel({ checks, steps }: { checks: CanvasVerificationCheck[]; steps: CanvasBrowserStep[] }) {
  const columns = Number(checks.length > 0) + Number(steps.length > 0);
  if (!columns) return null;
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
