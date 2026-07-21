"use client";

import { useEffect, useRef, useState } from "react";
import type { FactoryExecutionEvent } from "@/lib/factory/types";
import type { CanvasBlocking } from "@/lib/canvas/model";
import { questionQueueOf } from "@/lib/canvas/adapter";
import { ApprovalGate, type BlockedCommandAction } from "@/components/execution/ApprovalPrompt";

/**
 * §4 — the one surface that stops a mission. Rendered in-flow at the live edge; the
 * Status Strip pins a condensed copy when this scrolls away. A question exists only
 * because the work reached a real fork; an approval only because a real consequential
 * action is queued. While either is open, no work events render — nothing is happening.
 */
export function BlockingCard({
  blocking,
  onAnswer,
  onApprove,
  onUpload,
  onLocateSdk,
}: {
  blocking: CanvasBlocking;
  onAnswer: (answers: Array<{ question: string; answer: string }>) => void;
  onApprove: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void;
  onUpload?: (files: File[]) => void;
  onLocateSdk?: () => void;
}) {
  if (blocking.kind === "approval") {
    const deletionPath = blocking.event.details?.actionKind === "delete-project" || blocking.event.details?.actionKind === "delete-project-lock"
      ? String(blocking.event.details?.projectPath || blocking.event.filePath || "the connected project")
      : "";
    return (
      <div className="canvas-enter" role="alertdialog" aria-live="assertive" aria-label={deletionPath ? `Approval required to delete project at ${deletionPath}` : `Approval required: ${blocking.event.command ?? blocking.event.title}`}>
        <ApprovalGate event={blocking.event} onApprove={onApprove} />
      </div>
    );
  }
  return <QuestionCard blocking={blocking} onAnswer={onAnswer} onUpload={onUpload} onLocateSdk={onLocateSdk} />;
}

function QuestionCard({
  blocking,
  onAnswer,
  onUpload,
  onLocateSdk,
}: {
  blocking: Extract<CanvasBlocking, { kind: "question" }>;
  onAnswer: (answers: Array<{ question: string; answer: string }>) => void;
  onUpload?: (files: File[]) => void;
  onLocateSdk?: () => void;
}) {
  const queue = questionQueueOf(blocking);
  const [index, setIndex] = useState(0);
  const [collected, setCollected] = useState<Array<{ question: string; answer: string }>>([]);
  const [custom, setCustom] = useState("");
  const sdkInputRef = useRef<HTMLInputElement | null>(null);
  const current = queue[index];
  const remaining = queue.length - index - 1;

  // A new fork replaces the card wholesale; restart the queue rather than answering the
  // old question into the new one.
  useEffect(() => {
    setIndex(0);
    setCollected([]);
    setCustom("");
  }, [blocking.question, blocking.source]);

  if (!current) return null;
  const activeQuestion = current;
  const acceptsSdkEvidence = /\b(?:sdk|documentation|licensed package|local agent|hardware diagnostic)\b/i.test(activeQuestion.question);

  function submit(answer: string) {
    const trimmed = answer.trim();
    if (!trimmed) return;
    const resolved = [...collected, { question: activeQuestion.question, answer: trimmed }];
    if (remaining > 0) {
      setCollected(resolved);
      setIndex((value) => value + 1);
      setCustom("");
      return;
    }
    onAnswer(resolved);
    setCustom("");
  }

  return (
    <section
      className="canvas-enter my-4 w-full rounded-lg bg-overlay/[0.045] p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
      aria-live="assertive"
      role="group"
      aria-label="Foundry is waiting on your decision"
    >
      <p className="text-[15px] leading-[1.6] text-foundry-ink">{current.question}</p>
      {current.options?.length ? (
        <div className="mt-4 grid gap-1.5" role="radiogroup" aria-label="Answer options">
          {current.options.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked="false"
              onClick={() => submit(option)}
              className="min-h-[44px] w-full rounded-md border border-overlay/10 bg-overlay/[0.02] px-3.5 py-2 text-left text-sm font-medium leading-5 text-foundry-ink transition hover:border-foundry-teal/40 hover:bg-foundry-teal/[0.06]"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      {acceptsSdkEvidence && onUpload ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => sdkInputRef.current?.click()} className="min-h-[44px] rounded-md border border-foundry-teal/30 bg-foundry-teal/[0.08] px-3.5 py-2 text-left text-sm font-semibold text-foundry-ink hover:bg-foundry-teal/[0.14]">
            Upload SDK or specification files
          </button>
          {onLocateSdk ? <button type="button" onClick={onLocateSdk} className="min-h-[44px] rounded-md border border-foundry-teal/30 bg-foundry-teal/[0.08] px-3.5 py-2 text-left text-sm font-semibold text-foundry-ink hover:bg-foundry-teal/[0.14]">Search the connected Local Agent folder</button> : null}
          <button type="button" onClick={() => { sdkInputRef.current?.setAttribute("webkitdirectory", ""); sdkInputRef.current?.click(); }} className="min-h-[44px] rounded-md border border-overlay/12 bg-overlay/[0.025] px-3.5 py-2 text-left text-sm font-semibold text-foundry-ink hover:border-foundry-teal/35">
            Select an existing SDK folder
          </button>
          <input
            ref={sdkInputRef}
            type="file"
            multiple
            accept=".zip,.aar,.jar,.dll,.so,.pdf,.doc,.docx,.txt,.md,.html,.xml,.json,.yaml,.yml"
            className="hidden"
            onClick={(event) => {
              if (!(event.currentTarget as HTMLInputElement).hasAttribute("webkitdirectory")) event.currentTarget.removeAttribute("webkitdirectory");
            }}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) onUpload(files);
              event.target.value = "";
              event.target.removeAttribute("webkitdirectory");
            }}
          />
        </div>
      ) : null}
      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit(custom);
        }}
      >
        <input
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          placeholder={current.options?.length ? "or tell me something else…" : "Type your answer…"}
          className="min-h-10 flex-1 rounded-md border border-overlay/12 bg-shade/30 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/50"
          aria-label="Custom answer"
        />
        <button
          type="submit"
          disabled={!custom.trim()}
          className="min-h-10 shrink-0 rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-4 text-xs font-bold text-foundry-ink transition hover:bg-foundry-teal/[0.22] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Answer
        </button>
      </form>
      {remaining > 0 ? (
        <p className="mt-3 text-[12px] leading-5 text-foundry-subtle">
          {remaining} more {remaining === 1 ? "question" : "questions"} after this one.
        </p>
      ) : null}
    </section>
  );
}
