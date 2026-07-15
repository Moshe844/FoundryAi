"use client";

import { Paperclip, Square } from "lucide-react";
import { useRef } from "react";
import type { RefObject } from "react";
import { ComposerModelSelector } from "@/components/ModelModeSelector";
import { MissionQualitySelector } from "@/components/MissionQualitySelector";

/**
 * §1.1 — the always-present composer. It never locks: while work is running a send is
 * queued (the engine's real behavior); while an approval is pending the hint row says
 * so instead of disabling the field. Stop requests a graceful stop — status follows the
 * real stop event, not the button press.
 */
export function CanvasComposer({
  inputRef,
  value,
  isBusy,
  pausedForApproval,
  pausedForQuestion,
  queuedTask,
  canUndo,
  projectUnavailable = false,
  evidenceFiles,
  onChange,
  onSend,
  onStop,
  onUndo,
  onAddEvidence,
  onClearEvidence,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  isBusy: boolean;
  pausedForApproval: boolean;
  pausedForQuestion: boolean;
  queuedTask?: string;
  canUndo: boolean;
  projectUnavailable?: boolean;
  evidenceFiles: File[];
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onUndo: () => void;
  onAddEvidence: (files: FileList | null) => void;
  onClearEvidence: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="border-t border-white/8 bg-black/20 px-4 pb-4 pt-3 sm:px-6">
      {projectUnavailable ? (
        <p className="mb-2 text-[12px] leading-5 text-foundry-subtle">This project folder was deleted. Its verified mission record remains here; start a new project to continue working.</p>
      ) : pausedForApproval ? (
        <p className="mb-2 text-[12px] leading-5 text-foundry-amber">Foundry is waiting on the approval above — decide there before sending new work.</p>
      ) : pausedForQuestion ? (
        <p className="mb-2 text-[12px] leading-5 text-foundry-subtle">Foundry is waiting on a decision — answer above, or type it here.</p>
      ) : queuedTask ? (
        <p className="mb-2 text-[12px] leading-5 text-foundry-subtle">queued — will pick this up next: “{queuedTask}”</p>
      ) : null}

      {evidenceFiles.length ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {evidenceFiles.map((file) => (
            <span key={file.name} className="rounded border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[11px] text-foundry-muted">{file.name}</span>
          ))}
          <button type="button" onClick={onClearEvidence} className="text-[11px] text-foundry-subtle underline transition hover:text-foundry-ink">clear</button>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-[760px] items-end gap-2">
        <div className="flex min-h-[52px] flex-1 items-end rounded-lg border border-white/12 bg-black/30 transition focus-within:border-foundry-teal/45">
          <textarea
            ref={inputRef}
            value={value}
            rows={1}
            disabled={projectUnavailable}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={projectUnavailable ? "Project deleted" : isBusy ? "Tell Foundry something — it will be picked up next…" : "What should Foundry do next?"}
            className="max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-3.5 py-3.5 text-sm leading-6 text-foundry-ink outline-none placeholder:text-foundry-subtle disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Message Foundry"
          />
          <button
            type="button"
            title="Attach a screenshot or image as evidence"
            disabled={projectUnavailable}
            onClick={() => fileInputRef.current?.click()}
            className="mb-2.5 mr-2 rounded p-1.5 text-foundry-subtle transition hover:bg-white/[0.06] hover:text-foundry-ink"
          >
            <Paperclip size={15} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={projectUnavailable}
            className="hidden"
            onChange={(event) => {
              onAddEvidence(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        {isBusy ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-[52px] shrink-0 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-4 text-xs font-bold text-foundry-muted transition hover:border-red-300/40 hover:text-red-200"
            title="Request a graceful stop (Ctrl+.)"
          >
            <Square size={12} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={projectUnavailable || (!value.trim() && !evidenceFiles.length)}
            className="h-[52px] shrink-0 rounded-lg border border-foundry-teal/35 bg-foundry-teal/[0.14] px-5 text-xs font-bold text-foundry-ink transition hover:bg-foundry-teal/[0.22] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
      <div className="mx-auto mt-1.5 flex w-full max-w-[760px] flex-wrap items-center gap-x-3 gap-y-1.5">
        {!projectUnavailable ? <ComposerModelSelector /> : null}
        {!projectUnavailable ? <MissionQualitySelector /> : null}
        {canUndo && !isBusy ? (
          <button type="button" onClick={onUndo} className="ml-auto text-[11px] text-foundry-subtle transition hover:text-foundry-ink">
            Undo the last file change
          </button>
        ) : null}
      </div>
    </div>
  );
}
