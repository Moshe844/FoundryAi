"use client";

import { AlertTriangle, FolderX, ShieldCheck } from "lucide-react";
import type { FactoryExecutionEvent } from "@/lib/factory/types";
import { type BlockedCommandAction } from "@/components/execution/timelineUtils";

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
  return <BlockedCommandLine event={event} onApprove={onApprove} />;
}

export function BlockedCommandLine({ event, onApprove }: { event: FactoryExecutionEvent; onApprove?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void }) {
  if (event.details?.actionKind === "delete-project") return <ProjectDeletionApproval event={event} onApprove={onApprove} />;
  if (event.details?.actionKind === "delete-project-lock") return <ProjectLockDeletionApproval event={event} onApprove={onApprove} />;
  const reason = (event.details?.reason as string | undefined) || event.output || "Foundry needs approval before continuing.";
  const category = event.details?.category as string | undefined;
  const command = event.command || event.title;
  const isFileAction = /^(?:write|delete)\s/i.test(command);
  const projectScopeLabel = category === "deletes"
    ? "Allow all deletions in this project"
    : category === "environment-changes"
      ? "Allow environment-file changes in this project"
      : "Allow this category in this project";
  const scopeExplanation = category === "deletes"
    ? "Project approval allows deletion of any file in this project. Exact-action approval allows only the file shown above."
    : isFileAction
      ? "Project approval applies to this action category across this project. Exact-action approval applies only to the action shown above."
      : "Project approval allows this command category in this project. Exact-command approval applies only to the command shown above.";
  return (
    <section className="my-3 overflow-hidden rounded-xl border border-foundry-amber/30 bg-[linear-gradient(145deg,rgba(120,83,26,0.18),rgba(17,22,23,0.96)_58%)] shadow-[0_16px_45px_rgba(0,0,0,0.28)]">
      <div className="grid gap-4 p-5">
        <div className="flex items-start gap-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-foundry-amber/30 bg-foundry-amber/10 text-foundry-amber">
            <ShieldCheck size={19} />
          </span>
          <div className="min-w-0">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.13em] text-foundry-amber">Execution paused</p>
            <h3 className="mt-1 text-base font-extrabold text-foundry-ink">Foundry needs your permission</h3>
            <p className="mt-1.5 text-sm leading-6 text-foundry-muted">{reason}</p>
          </div>
        </div>

        <div className="rounded-lg border border-overlay/10 bg-shade/25 p-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-foundry-subtle">Requested action</p>
          <code className="mt-2 block whitespace-pre-wrap break-all font-mono text-[12.5px] leading-6 text-foundry-ink">{command}</code>
          <p className="mt-2 text-xs leading-5 text-foundry-subtle">{scopeExplanation}</p>
        </div>

        {onApprove ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="min-h-10 rounded-lg border border-foundry-amber/40 bg-foundry-amber/15 px-3.5 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-amber/25"
              onClick={() => onApprove(event, "approve-once")}
            >
              Allow once
            </button>
            {category ? (
              <button
                type="button"
                className="min-h-10 rounded-lg border border-overlay/15 bg-overlay/[0.045] px-3.5 text-sm font-bold text-foundry-muted transition hover:bg-overlay/[0.08] hover:text-foundry-ink"
                onClick={() => onApprove(event, "approve-category")}
              >
                {projectScopeLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="min-h-10 rounded-lg border border-overlay/15 bg-overlay/[0.045] px-3.5 text-sm font-bold text-foundry-muted transition hover:bg-overlay/[0.08] hover:text-foundry-ink"
              onClick={() => onApprove(event, "approve-command")}
            >
              Always allow this exact {isFileAction ? "action" : "command"}
            </button>
            <button
              type="button"
              className="min-h-10 rounded-lg px-3.5 text-sm font-bold text-foundry-subtle transition hover:bg-overlay/[0.06] hover:text-foundry-ink"
              onClick={() => onApprove(event, "skip")}
            >
              Deny
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProjectLockDeletionApproval({ event, onApprove }: { event: FactoryExecutionEvent; onApprove?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void }) {
  const projectPath = String(event.details?.projectPath || event.filePath || "Unknown project path");
  const lockOwners = Array.isArray(event.details?.lockOwners) ? event.details.lockOwners.map(String) : [];
  return (
    <section className="my-3 overflow-hidden rounded-xl border border-red-300/30 bg-[linear-gradient(145deg,rgba(127,29,29,0.22),rgba(17,22,23,0.96)_55%)] shadow-[0_18px_55px_rgba(0,0,0,0.35)]">
      <div className="grid gap-5 p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-red-300/25 bg-red-400/10 text-red-200"><AlertTriangle size={21} /></span>
          <div className="min-w-0">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-red-200/80">Application lock · approval required</p>
            <h3 className="mt-1.5 text-lg font-extrabold text-foundry-ink">Close the locking application and delete?</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foundry-muted">Windows will not delete this project while another application uses it as a working directory. Foundry can close the identified application, then continue deletion automatically.</p>
          </div>
        </div>
        <div className="rounded-lg border border-overlay/10 bg-shade/25 p-4">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-foundry-subtle">Lock owner</p>
          <p className="mt-2 text-sm font-bold text-foundry-ink">{lockOwners.join(", ") || "An external application"}</p>
          <code className="mt-2 block break-all font-mono text-[12px] leading-5 text-foundry-subtle">{projectPath}</code>
        </div>
        <div className="flex items-start gap-2.5 rounded-lg border border-red-300/20 bg-red-400/[0.07] px-3.5 py-3 text-sm leading-5 text-red-100/90">
          <AlertTriangle className="mt-0.5 shrink-0" size={16} />
          <p>Save work first. Force-closing the application can discard unsaved changes. Foundry will stop only the exact process shown above.</p>
        </div>
        {onApprove ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" className="min-h-11 rounded-lg border border-red-300/35 bg-red-400/15 px-4 text-sm font-extrabold text-red-100 transition hover:border-red-200/55 hover:bg-red-400/25" onClick={() => onApprove(event, "approve-once")}>Close app and delete project</button>
            <button type="button" className="min-h-11 rounded-lg border border-overlay/15 bg-overlay/[0.045] px-4 text-sm font-bold text-foundry-muted transition hover:bg-overlay/[0.08] hover:text-foundry-ink" onClick={() => onApprove(event, "skip")}>Keep app open</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProjectDeletionApproval({ event, onApprove }: { event: FactoryExecutionEvent; onApprove?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void }) {
  const projectPath = String(event.details?.projectPath || event.filePath || "Unknown project path");
  const topLevelEntries = typeof event.details?.topLevelEntries === "number" ? event.details.topLevelEntries : undefined;
  const discoveredFiles = typeof event.details?.discoveredFiles === "number" ? event.details.discoveredFiles : undefined;

  return (
    <section className="my-3 overflow-hidden rounded-xl border border-red-300/30 bg-[linear-gradient(145deg,rgba(127,29,29,0.22),rgba(17,22,23,0.96)_55%)] shadow-[0_18px_55px_rgba(0,0,0,0.35)]">
      <div className="grid gap-5 p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-red-300/25 bg-red-400/10 text-red-200">
            <FolderX size={21} />
          </span>
          <div className="min-w-0">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-red-200/80">Destructive action · approval required</p>
            <h3 className="mt-1.5 text-lg font-extrabold text-foundry-ink">Delete this project?</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foundry-muted">
              Foundry understood your request as deleting the connected project folder and everything inside it. Nothing has been deleted yet.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-overlay/10 bg-shade/25 p-4">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-foundry-subtle">
            <ShieldCheck size={14} /> Exact deletion target
          </div>
          <code className="mt-2 block break-all font-mono text-[13px] leading-6 text-foundry-ink">{projectPath}</code>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-foundry-subtle">
            <span>Scope: entire project folder</span>
            {topLevelEntries !== undefined ? <span>{topLevelEntries} top-level {topLevelEntries === 1 ? "item" : "items"}</span> : null}
            {discoveredFiles !== undefined ? <span>{discoveredFiles} discovered {discoveredFiles === 1 ? "file" : "files"}</span> : null}
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-lg border border-red-300/20 bg-red-400/[0.07] px-3.5 py-3 text-sm leading-5 text-red-100/90">
          <AlertTriangle className="mt-0.5 shrink-0" size={16} />
          <p>This permanently removes the folder, including nested and hidden project contents. Foundry cannot undo this action.</p>
        </div>

        {onApprove ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              className="min-h-11 rounded-lg border border-red-300/35 bg-red-400/15 px-4 text-sm font-extrabold text-red-100 transition hover:border-red-200/55 hover:bg-red-400/25"
              onClick={() => onApprove(event, "approve-once")}
            >
              Delete project permanently
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-overlay/15 bg-overlay/[0.045] px-4 text-sm font-bold text-foundry-muted transition hover:bg-overlay/[0.08] hover:text-foundry-ink"
              onClick={() => onApprove(event, "skip")}
            >
              Keep project
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
