"use client";

import { File, Paperclip, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  onRemoveEvidence,
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
  onAddEvidence: (files: FileList | File[] | null) => void;
  onRemoveEvidence: (index: number) => void;
  onClearEvidence: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="border-t border-overlay/8 bg-shade/20 px-4 pb-4 pt-3 sm:px-6">
      {projectUnavailable ? (
        <p className="mb-2 text-[12px] leading-5 text-foundry-subtle">This project folder was deleted. Its verified mission record remains here; start a new project to continue working.</p>
      ) : pausedForApproval ? (
        <p className="mb-2 text-[12px] leading-5 text-foundry-amber">Foundry is waiting on the approval above — decide there before sending new work.</p>
      ) : pausedForQuestion ? (
        <p className="mb-2 text-[12px] leading-5 text-foundry-subtle">Foundry is waiting on a decision — answer above, or type it here.</p>
      ) : queuedTask ? (
        <p className="mb-2 text-[12px] leading-5 text-foundry-subtle">queued — will pick this up next: “{queuedTask}”</p>
      ) : null}

      <div className="mx-auto flex w-full max-w-[760px] items-end gap-2">
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-overlay/12 bg-shade/30 transition focus-within:border-foundry-teal/45">
          {evidenceFiles.length ? (
            <div className="border-b border-overlay/8 bg-overlay/[0.025] p-2.5">
              <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
                <span className="text-[11px] font-semibold text-foundry-muted">
                  {evidenceFiles.length} file{evidenceFiles.length === 1 ? "" : "s"} attached
                </span>
                <button type="button" onClick={onClearEvidence} className="text-[11px] text-foundry-subtle transition hover:text-foundry-ink">
                  Remove all
                </button>
              </div>
              <div className={`grid gap-2 ${evidenceFiles.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
                {evidenceFiles.map((file, index) => (
                  <StagedFile
                    key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
                    file={file}
                    index={index}
                    single={evidenceFiles.length === 1}
                    onRemove={onRemoveEvidence}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex min-h-[52px] items-end">
          <textarea
            ref={inputRef}
            value={value}
            rows={1}
            disabled={projectUnavailable}
            onChange={(event) => onChange(event.target.value)}
            onPaste={(event) => {
              const pastedImages = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file));
              if (!pastedImages.length) return;
              event.preventDefault();
              onAddEvidence(pastedImages);
            }}
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
            title="Attach files or images"
            disabled={projectUnavailable}
            onClick={() => fileInputRef.current?.click()}
            className="mb-2.5 mr-2 rounded p-1.5 text-foundry-subtle transition hover:bg-overlay/[0.06] hover:text-foundry-ink"
          >
            <Paperclip size={15} />
          </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
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
            className="inline-flex h-[52px] shrink-0 items-center gap-2 rounded-lg border border-overlay/15 bg-overlay/[0.04] px-4 text-xs font-bold text-foundry-muted transition hover:border-red-300/40 hover:text-red-200"
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

function StagedFile({
  file,
  index,
  single,
  onRemove,
}: {
  file: File;
  index: number;
  single: boolean;
  onRemove: (index: number) => void;
}) {
  const [source, setSource] = useState("");
  const isImage = file.type.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);

  useEffect(() => {
    if (!isImage) {
      setSource("");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSource(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  return (
    <figure className={`group relative overflow-hidden rounded-lg border border-overlay/12 bg-shade/35 ${single ? "max-w-[460px]" : ""}`}>
      {isImage && source ? (
        // This short-lived local Object URL previews an unsent clipboard or file attachment.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt={file.name || "Screenshot ready to send"} className={`w-full object-contain ${single ? "max-h-52" : "h-28"}`} />
      ) : (
        <div className={`flex flex-col items-center justify-center gap-2 px-3 text-center text-foundry-muted ${single ? "h-40" : "h-28"}`}>
          <File size={single ? 30 : 24} />
          <span className="max-w-full truncate text-[11px] font-semibold">{file.name || "Attached file"}</span>
          <span className="text-[10px] text-foundry-subtle">{formatFileSize(file.size)}</span>
        </div>
      )}
      <figcaption className="truncate border-t border-overlay/8 px-2.5 py-1.5 text-[10px] text-foundry-subtle">{file.name || "Pasted screenshot"}</figcaption>
      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label={`Remove ${file.name || "screenshot"}`}
        className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full border border-overlay/15 bg-shade/75 text-overlay/75 opacity-90 shadow-lg transition hover:border-overlay/30 hover:bg-black hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
      >
        <X size={13} />
      </button>
    </figure>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
