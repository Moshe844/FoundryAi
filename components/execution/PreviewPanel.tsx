"use client";

import { ExternalLink, Loader2, PanelRightClose } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FactoryProjectResult } from "@/lib/factory/types";

/**
 * Relocated verbatim from components/BuildDashboard.tsx (execution-canvas rebuild, step 5) — no
 * behavior change, only moved so the artifact/preview surface has its own file instead of living
 * inside one 6,000+ line component.
 */
export function PreviewPanel({ execution, fill = false }: { execution: FactoryProjectResult; fill?: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const previousUrlRef = useRef(execution.previewUrl);
  const wrap = fill ? "" : "mt-4";

  useEffect(() => {
    if (execution.previewUrl && execution.previewUrl !== previousUrlRef.current) {
      previousUrlRef.current = execution.previewUrl;
      setRefreshKey((current) => current + 1);
    }
  }, [execution.previewUrl]);

  if (execution.previewState === "starting") {
    return (
      <div className={`${wrap} flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs leading-5 text-foundry-subtle`}>
        <Loader2 size={16} className="animate-spin text-foundry-teal" />
        <p>Starting the preview server…</p>
      </div>
    );
  }

  if (execution.previewState === "error") {
    return (
      <div className={`${wrap} flex flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center text-xs leading-5 text-foundry-amber`}>
        <p className="font-bold">Preview couldn&apos;t start.</p>
        <p className="text-foundry-subtle">{execution.previewReason || "Check the command timeline for what failed."}</p>
      </div>
    );
  }

  if (!execution.previewState || execution.previewState === "unavailable") {
    return execution.previewReason ? (
      <p className={`${wrap} rounded-md border border-dashed border-white/15 px-3 py-2 text-xs leading-5 text-foundry-subtle`}>Preview: {execution.previewReason}</p>
    ) : null;
  }

  if (execution.previewUrl && execution.previewPlatform === "api") {
    return <ApiPlayground baseUrl={execution.previewUrl} fill={fill} />;
  }

  if (execution.previewUrl) {
    return fill ? (
      <iframe key={refreshKey} src={execution.previewUrl} className="h-full w-full flex-1 border-0 bg-white" title="Live preview" />
    ) : (
      <div className="mt-4 overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal">Live Preview</span>
          <span className="truncate font-mono text-[10.5px] text-foundry-subtle">{execution.previewUrl}</span>
        </div>
        <iframe key={refreshKey} src={execution.previewUrl} className="h-72 w-full border-0 bg-white" title="Live preview" />
      </div>
    );
  }

  return <p className={`${wrap} rounded-md border border-dashed border-white/15 px-3 py-2 text-xs leading-5 text-foundry-subtle`}>{execution.previewReason || "Open index.html from the project folder to preview this static project."}</p>;
}

export function EngineeringWorkspacePanel({ execution, onCollapse }: { execution: FactoryProjectResult | null; onCollapse: () => void }) {
  const previewUrl = execution?.previewUrl;
  const canPopOut = Boolean(previewUrl) && execution?.previewPlatform !== "api";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal">
            {execution?.previewPlatform === "api" ? "API Playground" : "Live Preview"}
          </span>
          {execution?.previewState === "ready" ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-foundry-teal" /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canPopOut && previewUrl ? (
            <button
              type="button"
              onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}
              className="rounded p-1.5 text-foundry-subtle transition hover:bg-white/[0.06] hover:text-foundry-ink"
              title="Open in a new window"
            >
              <ExternalLink size={14} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCollapse}
            className="rounded p-1.5 text-foundry-subtle transition hover:bg-white/[0.06] hover:text-foundry-ink"
            title="Collapse preview"
          >
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {execution ? <PreviewPanel execution={execution} fill /> : null}
      </div>
    </div>
  );
}

export function ApiPlayground({ baseUrl, fill = false }: { baseUrl: string; fill?: boolean }) {
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/");
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<{ status: number; body: string } | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    setError("");
    setResponse(null);
    try {
      const url = `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
      const init: RequestInit = { method };
      if (method !== "GET" && method !== "HEAD" && body.trim()) {
        init.headers = { "content-type": "application/json" };
        init.body = body;
      }
      const result = await fetch(url, init);
      const text = await result.text();
      setResponse({ status: result.status, body: text });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed — the preview server may not allow cross-origin requests from this page.");
    } finally {
      setSending(false);
    }
  }

  const fields = (
    <div className="grid gap-2 p-3">
      <div className="flex gap-2">
        <select
          className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs font-bold text-foundry-ink"
          value={method}
          onChange={(event) => setMethod(event.target.value)}
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <input
          className="flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-1.5 font-mono text-xs text-foundry-ink outline-none focus:border-foundry-teal/40"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="/api/resource"
        />
        <button
          className="rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-1.5 text-xs font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2] disabled:opacity-50"
          type="button"
          disabled={sending}
          onClick={send}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      {method !== "GET" && method !== "HEAD" ? (
        <textarea
          className="min-h-[3rem] resize-y rounded-md border border-white/10 bg-black/20 p-2 font-mono text-xs text-foundry-ink outline-none focus:border-foundry-teal/40"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder='{"key": "value"}'
        />
      ) : null}
      {error ? <p className="text-xs leading-5 text-red-300">{error}</p> : null}
      {response ? (
        <div className="rounded-md border border-white/10 bg-black/30 p-2">
          <p className="font-mono text-[11px] font-bold text-foundry-teal">Status: {response.status}</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foundry-muted">{response.body}</pre>
        </div>
      ) : null}
    </div>
  );

  if (fill) return fields;

  return (
    <div className="mt-4 overflow-hidden rounded-md border border-white/10">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-1.5">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal">API Playground</span>
        <span className="truncate font-mono text-[10.5px] text-foundry-subtle">{baseUrl}</span>
      </div>
      {fields}
    </div>
  );
}
