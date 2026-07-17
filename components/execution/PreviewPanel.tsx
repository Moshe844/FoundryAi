"use client";

import { Download, ExternalLink, Gamepad2, Maximize2, Minimize2, Monitor, PanelRightClose, Play, RefreshCw, Smartphone, Tablet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FactoryProjectResult } from "@/lib/factory/types";

/**
 * Relocated verbatim from components/BuildDashboard.tsx (execution-canvas rebuild, step 5) — no
 * behavior change, only moved so the artifact/preview surface has its own file instead of living
 * inside one 6,000+ line component.
 */
export function PreviewPanel({ execution, fill = false }: { execution: FactoryProjectResult; fill?: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const latestReadyEventId = [...(execution.timeline ?? [])].reverse().find((event) => event.kind === "preview" && event.status === "completed" && /preview ready/i.test(event.title))?.id ?? "";
  const previewGeneration = `${execution.previewUrl ?? ""}|${latestReadyEventId}`;
  const previousGenerationRef = useRef(previewGeneration);
  const wrap = fill ? "" : "mt-4";

  useEffect(() => {
    if (execution.previewUrl && execution.previewState === "ready" && previewGeneration !== previousGenerationRef.current) {
      setRefreshKey((current) => current + 1);
    }
    previousGenerationRef.current = previewGeneration;
  }, [execution.previewState, execution.previewUrl, previewGeneration]);

  if (execution.previewState === "starting") {
    return (
      <div className={`${wrap} flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs leading-5 text-foundry-subtle`}>
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
      <p className={`${wrap} rounded-md border border-dashed border-overlay/15 px-3 py-2 text-xs leading-5 text-foundry-subtle`}>Preview: {execution.previewReason}</p>
    ) : null;
  }

  if (execution.previewUrl && execution.previewPlatform === "api") {
    return <ApiPlayground baseUrl={execution.previewUrl} fill={fill} />;
  }

  if (execution.artifact || execution.previewPlatform === "desktop") {
    return <div className={fill ? "p-3" : ""}><PreviewCompletionCard execution={execution} /></div>;
  }

  if (execution.previewUrl) {
    const frameWidth = viewport === "mobile" ? "390px" : viewport === "tablet" ? "768px" : "100%";
    return (
      <div className={`${fill ? "flex min-h-0 flex-1 flex-col" : "mt-4 overflow-hidden rounded-md border border-overlay/10"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-overlay/10 bg-shade/20 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal">{execution.previewPlatform === "game" ? "Playable Preview" : "Local Preview"}</span>
            <a href={execution.previewUrl} target="_blank" rel="noreferrer" title={`Open ${execution.previewUrl}`} className="min-w-0 truncate font-mono text-[10.5px] text-foundry-subtle underline decoration-overlay/20 underline-offset-2 transition hover:text-foundry-ink">{execution.previewUrl}</a>
          </div>
          <div className="flex items-center gap-1">
            {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as const).map(([size, Icon]) => (
              <button key={size} type="button" title={`${size} preview`} onClick={() => setViewport(size)} className={`rounded p-1.5 transition ${viewport === size ? "bg-foundry-teal/[0.16] text-foundry-teal" : "text-foundry-subtle hover:bg-overlay/[0.06] hover:text-foundry-ink"}`}>
                <Icon size={13} />
              </button>
            ))}
            <button type="button" title="Reload preview" onClick={() => setRefreshKey((current) => current + 1)} className="rounded p-1.5 text-foundry-subtle transition hover:bg-overlay/[0.06] hover:text-foundry-ink"><RefreshCw size={13} /></button>
            <button type="button" title="Open preview in a new tab" onClick={() => window.open(execution.previewUrl, "_blank", "noopener,noreferrer")} className="rounded p-1.5 text-foundry-subtle transition hover:bg-overlay/[0.06] hover:text-foundry-ink"><ExternalLink size={13} /></button>
          </div>
        </div>
        <div className={`${fill ? "min-h-0 flex-1" : "h-72"} overflow-auto bg-foundry-bg p-2`}>
          <iframe key={refreshKey} src={execution.previewUrl} className="mx-auto h-full max-w-full border-0 bg-white transition-[width] duration-200" style={{ width: frameWidth }} title="Interactive live preview" />
        </div>
      </div>
    );
  }

  return <p className={`${wrap} rounded-md border border-dashed border-overlay/15 px-3 py-2 text-xs leading-5 text-foundry-subtle`}>{execution.previewReason || "Open index.html from the project folder to preview this static project."}</p>;
}

export function PreviewCompletionCard({ execution }: { execution: FactoryProjectResult }) {
  const [launchState, setLaunchState] = useState<"idle" | "launching" | "launched" | "error">("idle");
  const [launchError, setLaunchError] = useState("");
  const platform = execution.previewPlatform ?? "web";
  const ready = execution.previewState === "ready" || execution.previewState === "starting";
  const label = previewActionLabel(platform);
  async function launchDesktop() {
    setLaunchState("launching");
    setLaunchError("");
    try {
      const response = await fetch("/api/factory/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: execution.projectId, projectPath: execution.projectPath, action: "launch-desktop" }) });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (response.ok && result.ok) {
        setLaunchState("launched");
      } else {
        setLaunchError(result.error || "Windows did not accept the desktop launch request.");
        setLaunchState("error");
      }
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : "Foundry could not reach its desktop launcher.");
      setLaunchState("error");
    }
  }
  return (
    <section className="mt-3 rounded-md border border-foundry-teal/25 bg-foundry-teal/[0.05] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-extrabold text-foundry-ink">{platform === "game" ? <Gamepad2 size={14} className="text-foundry-teal" /> : <Play size={14} className="text-foundry-teal" />}{ready ? previewReadyTitle(platform) : "Preview availability"}</p>
          <p className="mt-1 break-all text-xs leading-5 text-foundry-subtle">{execution.previewUrl ? `Running at ${execution.previewUrl}` : execution.previewReason || "No interactive preview is available for this build yet."}</p>
        </div>
        {execution.previewUrl ? <a href={execution.previewUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 text-xs font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.22]"><ExternalLink size={14} />{label}</a> : platform === "desktop" && ready ? <button type="button" onClick={launchDesktop} disabled={launchState === "launching"} className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 text-xs font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.22] disabled:opacity-60"><Play size={14} />{launchState === "launching" ? "Launching..." : launchState === "launched" ? "App launched" : "Launch desktop app"}</button> : null}
      </div>
      {launchState === "error" ? <p className="mt-2 text-xs text-foundry-amber">Desktop launch failed: {launchError}</p> : null}
      {execution.artifact ? (
        <div className="mt-3 border-t border-foundry-teal/20 pt-3">
          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <ArtifactField label="Application" value={execution.projectName} />
            <ArtifactField label="Platform" value={execution.artifact.platform} />
            <ArtifactField label="Version" value={execution.artifact.version} />
            <ArtifactField label="File" value={`${execution.artifact.name} · ${execution.artifact.fileType}`} />
            <ArtifactField label="Size" value={formatArtifactSize(execution.artifact.sizeBytes)} />
            <ArtifactField label="Build status" value="Verified on disk" />
            <ArtifactField label="Created" value={new Date(execution.artifact.createdAt).toLocaleString()} />
          </div>
          <a href={execution.artifact.downloadUrl} download className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 text-xs font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.22]">
            <Download size={14} />Download for {execution.artifact.platform.toLowerCase().startsWith("win") ? "Windows" : execution.artifact.platform}
          </a>
        </div>
      ) : null}
    </section>
  );
}

function ArtifactField({ label, value }: { label: string; value: string }) {
  return <p className="min-w-0"><span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-foundry-subtle">{label}</span><span className="mt-0.5 block break-all font-bold text-foundry-ink">{value}</span></p>;
}

function formatArtifactSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function previewActionLabel(platform: FactoryProjectResult["previewPlatform"]) {
  if (platform === "api") return "Open API playground";
  if (platform === "desktop") return "Open desktop app";
  if (platform === "mobile" || platform === "android") return "Open mobile preview";
  if (platform === "game") return "Play game";
  if (platform === "report") return "Open report";
  return "Open preview";
}

function previewReadyTitle(platform: FactoryProjectResult["previewPlatform"]) {
  if (platform === "api") return "API server is running";
  if (platform === "game") return "Playable build is ready";
  if (platform === "desktop") return "Desktop build is ready";
  return "Interactive preview is ready";
}

export function EngineeringWorkspacePanel({ execution, onCollapse, fullScreen = false, onToggleFullScreen }: { execution: FactoryProjectResult | null; onCollapse: () => void; fullScreen?: boolean; onToggleFullScreen?: () => void }) {
  const previewUrl = execution?.previewUrl;
  const canPopOut = Boolean(previewUrl) && execution?.previewPlatform !== "api";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-overlay/10 bg-shade/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal">
            {execution?.previewPlatform === "api" ? "API Playground" : execution?.previewPlatform === "game" ? "Playable Preview" : "Local Interactive Preview"}
          </span>
          {execution?.previewState === "ready" ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foundry-teal" /> : null}
          {previewUrl ? <a href={previewUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-[10px] text-foundry-subtle underline decoration-overlay/20 underline-offset-2 transition hover:text-foundry-ink" title={`Open ${previewUrl}`}>{previewUrl}</a> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canPopOut && previewUrl ? (
            <a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-bold text-foundry-teal transition hover:bg-foundry-teal/[0.1]" title="Open preview in a new tab"><ExternalLink size={14} />Open</a>
          ) : null}
          {onToggleFullScreen ? (
            <button
              type="button"
              onClick={onToggleFullScreen}
              className="rounded p-1.5 text-foundry-subtle transition hover:bg-overlay/[0.06] hover:text-foundry-ink"
              title={fullScreen ? "Exit full-screen preview" : "Full-screen preview"}
            >
              {fullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCollapse}
            className="rounded p-1.5 text-foundry-subtle transition hover:bg-overlay/[0.06] hover:text-foundry-ink"
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
          className="rounded-md border border-overlay/10 bg-shade/20 px-2 py-1.5 text-xs font-bold text-foundry-ink"
          value={method}
          onChange={(event) => setMethod(event.target.value)}
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <input
          className="flex-1 rounded-md border border-overlay/10 bg-shade/20 px-2 py-1.5 font-mono text-xs text-foundry-ink outline-none focus:border-foundry-teal/40"
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
          className="min-h-[3rem] resize-y rounded-md border border-overlay/10 bg-shade/20 p-2 font-mono text-xs text-foundry-ink outline-none focus:border-foundry-teal/40"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder='{"key": "value"}'
        />
      ) : null}
      {error ? <p className="text-xs leading-5 text-red-300">{error}</p> : null}
      {response ? (
        <div className="rounded-md border border-overlay/10 bg-shade/30 p-2">
          <p className="font-mono text-[11px] font-bold text-foundry-teal">Status: {response.status}</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foundry-muted">{response.body}</pre>
        </div>
      ) : null}
    </div>
  );

  if (fill) return fields;

  return (
    <div className="mt-4 overflow-hidden rounded-md border border-overlay/10">
      <div className="flex items-center justify-between gap-2 border-b border-overlay/10 bg-shade/20 px-3 py-1.5">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal">API Playground</span>
        <span className="truncate font-mono text-[10.5px] text-foundry-subtle">{baseUrl}</span>
      </div>
      {fields}
    </div>
  );
}
