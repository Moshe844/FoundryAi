"use client";

import { ChevronDown, Code2, FolderTree, History, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { MissionRecommendation } from "@/lib/ai/mission/recommendations";
import type { CommandPermissionCategory } from "@/lib/ai/mission/command-permissions";
import { useModelMode } from "@/lib/ai/model-mode";
import type { FactoryExecutionEvent, FactoryExistingProjectRequest, FactoryProjectResult } from "@/lib/factory/types";
import type { MissionState } from "@/lib/mission-engine";
import { deriveMissionDisplayStatus, projectBriefFromMission, projectTitleFor } from "@/lib/mission/status";
import { answerTaskFor, buildMissionVM } from "@/lib/canvas/adapter";
import type { CanvasDotState, CanvasMissionVM } from "@/lib/canvas/model";
import { dotStateOf, latestLiveEvent, needsRepairAction } from "@/lib/canvas/model";
import type { BlockedCommandAction } from "@/components/execution/ApprovalPrompt";
import { CanvasComposer } from "@/components/canvas/CanvasComposer";
import { CollapsedMissionRow } from "@/components/canvas/CollapsedMissionRow";
import { MissionBlock } from "@/components/canvas/MissionBlock";
import { isStalled, useElapsedSince } from "@/components/canvas/LiveActivityRow";
import { useMissionRecommendations } from "@/components/canvas/useMissionRecommendations";
import { EngineeringWorkspacePanel } from "@/components/execution/PreviewPanel";

type ApprovalResponse = FactoryExistingProjectRequest["approvalResponse"];

/**
 * The Mission Canvas (docs/mission-canvas-ux-spec.md) — the project workspace. One
 * scrolling timeline (prior missions as rows, the active mission expanded), a single
 * live indicator, blocking cards at the live edge, a real preview dock on the right,
 * and the always-present composer. Replaces ProjectBriefView/ProjectWorkConversation.
 */
export function MissionCanvas({
  mission,
  brief,
  execution,
  connectedPath,
  localConnector,
  workspaceFiles,
  queuedTask,
  onStartProject,
  onViewFiles,
  onExecute,
  onRetry,
  onUndo,
  onPreviewStateChange,
  onApproveCategory,
  onApproveCommand,
}: {
  mission: MissionState;
  brief: string;
  execution: FactoryProjectResult | null;
  connectedPath: string;
  localConnector?: { url: string; token?: string; rootLabel: string };
  workspaceFiles: FactoryProjectResult["files"];
  queuedTask?: string;
  onStartProject: () => void;
  onViewFiles: () => void;
  onExecute: (task: string, approvalResponse?: ApprovalResponse, evidenceFiles?: File[]) => void;
  onRetry?: (task: string, executionId: string) => void;
  onUndo?: (executionId: string) => void;
  onPreviewStateChange?: (preview: Pick<FactoryProjectResult, "previewState" | "previewUrl" | "previewPlatform" | "previewReason">) => void;
  onApproveCategory?: (category: string) => void;
  onApproveCommand?: (command: string) => void;
}) {
  const [task, setTask] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);

  // Unsent composer drafts must survive in-project navigation (the canvas unmounts
  // when the user visits Journal/Settings) — sessionStorage, keyed per mission.
  const draftKey = `foundry-composer-draft:${mission.missionId}`;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) setTask((current) => current || saved);
    } catch { /* storage unavailable — drafts just don't persist */ }
  }, [draftKey]);
  useEffect(() => {
    try {
      if (task) sessionStorage.setItem(draftKey, task);
      else sessionStorage.removeItem(draftKey);
    } catch { /* storage unavailable — drafts just don't persist */ }
  }, [task, draftKey]);
  const [expandedPriorId, setExpandedPriorId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revealEventIds, setRevealEventIds] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const liveEdgeRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [liveEdgeVisible, setLiveEdgeVisible] = useState(true);
  const [missedEvents, setMissedEvents] = useState(0);
  const [turnAccepted, setTurnAccepted] = useState(false);
  const [environment, setEnvironment] = useState(execution?.environment);

  useEffect(() => setEnvironment(execution?.environment), [execution?.environment]);

  const missionStatus = deriveMissionDisplayStatus(mission);
  const activeExecution = missionStatus.activeExecutionMission;
  const projectDeleted = Boolean(execution?.projectDeleted);

  const priorVMs = useMemo(
    () =>
      mission.executionMissions
        .filter((item) => item.id !== activeExecution?.id)
        .map((item) => buildMissionVM(item, mission, execution, false)),
    [mission, activeExecution?.id, execution],
  );
  const activeVM: CanvasMissionVM | null = useMemo(
    () => (activeExecution ? buildMissionVM(activeExecution, mission, execution, true) : null),
    [activeExecution, mission, execution],
  );

  // §7.1 — the newest real event drives the live row; the engine's own turn-state
  // strings (real state set at send time) cover the gap before the first timeline event.
  const liveEvent = useMemo(() => {
    if (!activeExecution) return null;
    return latestLiveEvent(activeExecution.timeline);
  }, [activeExecution]);

  // A failed or interrupted run must leave a one-click path back to the same task —
  // the composer alone reads as a dead end after a provider failure (test A08).
  const retryableTask = !missionStatus.isBusy
    && activeExecution
    && (activeExecution.state === "failed" || activeExecution.state === "cancelled")
    && !projectDeleted
    ? (activeExecution.source_requirements[0] || activeExecution.title || "").trim() || null
    : null;
  const retryWillRepair = Boolean(activeExecution && needsRepairAction(activeExecution));

  const silenceMs = useElapsedSince(liveEvent?.timestamp, missionStatus.isBusy);
  const stalled = missionStatus.isBusy && isStalled(silenceMs);
  const dotState: CanvasDotState = stalled ? "idle" : dotStateOf(missionStatus.state, missionStatus.isBusy);

  // Preview dock: only a really-started surface can open it (§8).
  const [recoveredPreview, setRecoveredPreview] = useState<Partial<FactoryProjectResult> | null>(null);
  const connectedFolderName = connectedPath.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || "";
  // Generated projects are sometimes reopened through the local-folder execution path, whose
  // execution id is prefixed with `local-`. Preview recovery, however, is intentionally rooted in
  // Foundry's managed projects directory and therefore needs the real folder id. Keeping those two
  // identities separate made the visible Preview button silently request a nonexistent folder.
  const connectedProjectId = /[\\/]projects[\\/][^\\/]+[\\/]*$/i.test(connectedPath)
    ? connectedFolderName
    : execution?.projectId || connectedFolderName;
  const recoveredExecutionBase: FactoryProjectResult | null = connectedProjectId ? {
    projectId: connectedProjectId,
    projectName: projectTitleFor(mission),
    projectPath: connectedPath,
    briefPath: "",
    stack: execution?.stack ?? "",
    template: execution?.template ?? "custom",
    status: execution?.status ?? "passed",
    supported: execution?.supported ?? true,
    events: execution?.events ?? [],
    files: execution?.files ?? workspaceFiles,
    commands: execution?.commands ?? [],
  } : null;
  const applicableRecoveredPreview = recoveredPreview?.projectId === connectedProjectId ? recoveredPreview : null;
  const effectiveExecution = applicableRecoveredPreview && recoveredExecutionBase
    ? { ...recoveredExecutionBase, ...execution, ...applicableRecoveredPreview }
    : execution;
  const previewAvailable = effectiveExecution?.previewState === "ready"
    && Boolean(effectiveExecution.previewUrl || effectiveExecution.artifact || effectiveExecution.previewPlatform === "desktop");
  const previewFailureReason = effectiveExecution?.previewState === "error"
    ? effectiveExecution.previewReason || "The real preview failed its readiness check."
    : undefined;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFullScreen, setPreviewFullScreen] = useState(false);
  const [previewWidthPct, setPreviewWidthPct] = useState(45);
  const autoOpenedForRef = useRef<string | null>(null);
  const middleRowRef = useRef<HTMLDivElement | null>(null);
  const connectorUrl = localConnector?.url;
  const connectorToken = localConnector?.token;
  const connectorRootLabel = localConnector?.rootLabel;
  const previewConnector = useMemo(() => connectorUrl && connectorRootLabel ? {
    url: connectorUrl,
    token: connectorToken,
    rootLabel: connectorRootLabel,
  } : undefined, [connectorUrl, connectorToken, connectorRootLabel]);
  const hasExecution = Boolean(execution);
  const onPreviewStateChangeRef = useRef(onPreviewStateChange);
  useEffect(() => {
    onPreviewStateChangeRef.current = onPreviewStateChange;
  }, [onPreviewStateChange]);

  async function togglePreview() {
    if (previewOpen) {
      setPreviewOpen(false);
      setPreviewFullScreen(false);
      return;
    }
    if (!connectedProjectId) return;
    if (effectiveExecution?.previewState === "ready" && (effectiveExecution.artifact || effectiveExecution.previewPlatform === "desktop")) {
      setPreviewOpen(true);
      return;
    }
    setPreviewLoading(true);
    try {
      const response = await fetch("/api/factory/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: connectedProjectId, action: "refresh", localConnector: previewConnector }),
      });
      const status = (await response.json().catch(() => null)) as Partial<FactoryProjectResult> | null;
      const ready = Boolean(response.ok && status?.previewState === "ready"
        && (status.previewUrl || status.artifact || status.previewPlatform === "desktop"));
      if (status) {
        const reconciled = ready ? status : { ...status, previewUrl: undefined, artifact: undefined };
        setRecoveredPreview({ ...reconciled, projectId: connectedProjectId });
        if (status.previewState && status.previewState !== execution?.previewState) onPreviewStateChangeRef.current?.(status);
      }
      setPreviewOpen(ready);
    } catch {
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    // Opening a project is itself a preview trigger. Retry a persisted preview error once during
    // project reconciliation so a repaired Local Agent or newly available runtime recovers without
    // making the user press Retry preview first.
    if (projectDeleted || !connectedProjectId) return;
    // Keep the last proven preview mounted while an edit is running. Clearing it here made the app
    // disappear exactly when users need to watch their changes land, then reappear only at completion.
    if (missionStatus.isBusy && hasExecution) return;
    let cancelled = false;
    setPreviewLoading(true);
    void fetch("/api/factory/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: connectedProjectId, action: "refresh", localConnector: previewConnector }),
    }).then((response) => response.ok ? response.json() : null).then((preview) => {
      if (cancelled) return;
      if (preview?.previewState === "ready") setRecoveredPreview({ ...preview, projectId: connectedProjectId });
      else setRecoveredPreview({ ...preview, projectId: connectedProjectId, previewState: preview?.previewState ?? "unavailable", previewUrl: undefined, artifact: undefined });
      if (preview?.previewState && preview.previewState !== execution?.previewState) onPreviewStateChangeRef.current?.(preview);
    }).catch(() => undefined).finally(() => {
      if (!cancelled) setPreviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [connectedProjectId, execution?.previewState, hasExecution, previewConnector, missionStatus.isBusy, projectDeleted]);

  useEffect(() => {
    const previewIdentity = connectedProjectId
      ? `${connectedProjectId}:${effectiveExecution?.previewUrl ?? effectiveExecution?.artifact?.downloadUrl ?? effectiveExecution?.previewPlatform ?? "preview"}:${activeExecution?.id ?? "result"}`
      : null;
    if (effectiveExecution?.previewState === "ready" && previewIdentity && autoOpenedForRef.current !== previewIdentity) {
      autoOpenedForRef.current = previewIdentity;
      setPreviewOpen(true);
    }
    if (!previewAvailable && !missionStatus.isBusy) setPreviewOpen(false);
  }, [connectedProjectId, effectiveExecution?.previewState, effectiveExecution?.previewUrl, effectiveExecution?.artifact?.downloadUrl, effectiveExecution?.previewPlatform, activeExecution?.id, previewAvailable, missionStatus.isBusy]);

  // §6.1 auto-follow: stay pinned while the user is at the live edge; any real upward
  // scroll breaks the follow, and nothing moves the viewport until they return.
  const contentVersion = `${activeExecution?.timeline.length ?? 0}:${mission.messages.length}:${missionStatus.state}:${activeVM?.groups.length ?? 0}`;
  const previousTimelineLengthRef = useRef(activeExecution?.timeline.length ?? 0);

  const scrollToLiveEdge = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    followingRef.current = true;
    setFollowing(true);
    setMissedEvents(0);
  }, []);

  useEffect(() => {
    const nextLength = activeExecution?.timeline.length ?? 0;
    const delta = Math.max(0, nextLength - previousTimelineLengthRef.current);
    previousTimelineLengthRef.current = nextLength;
    if (followingRef.current) {
      scrollToLiveEdge();
    } else if (delta > 0) {
      setMissedEvents((current) => current + delta);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentVersion, scrollToLiveEdge]);

  useEffect(() => {
    const container = scrollRef.current;
    const sentinel = liveEdgeRef.current;
    if (!container || !sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setLiveEdgeVisible(entry.isIntersecting),
      { root: container, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  function handleScroll() {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nowFollowing = distanceFromBottom <= 120;
    if (nowFollowing !== followingRef.current) {
      followingRef.current = nowFollowing;
      setFollowing(nowFollowing);
      if (nowFollowing) setMissedEvents(0);
    }
  }

  // Ctrl+. — graceful stop, mirroring the composer's Stop control.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.key === "." && missionStatus.isBusy) {
        event.preventDefault();
        onExecute("stop");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionStatus.isBusy]);

  useEffect(() => {
    if (!projectDeleted) composerRef.current?.focus();
  }, [missionStatus.isBusy, missionStatus.state, projectDeleted]);

  // §10 — suggestions exist only after a really-finished mission (or a mock pause).
  const { mode: modelMode } = useModelMode();
  const recommendationsKey =
    turnAccepted || missionStatus.isBusy || !execution || projectDeleted
      ? ""
      : activeExecution?.pending_mock_review
        ? `mock:${activeExecution.id}:${activeExecution.pending_mock_review.message}`
        : execution.status === "passed" &&
            missionStatus.state === "complete" &&
            (execution.checklist ?? []).every((item) => item.status === "completed" || item.status === "skipped")
          ? `final:${execution.projectPath}:${execution.objective ?? ""}:${execution.files.length}`
          : "";
  const { recommendations } = useMissionRecommendations(execution, projectBriefFromMission(mission), recommendationsKey, modelMode);

  useEffect(() => {
    if (missionStatus.isBusy || missionStatus.isPausedForApproval || missionStatus.isPausedForUser) setTurnAccepted(false);
  }, [missionStatus.isBusy, missionStatus.isPausedForApproval, missionStatus.isPausedForUser, activeExecution?.id]);

  const editingTarget = useMemo(() => {
    const localPath = brief.match(/^Local project path:\s*(.+)$/im)?.[1]?.trim() ?? "";
    const browserFolderName = brief.match(/^Browser folder name:\s*(.+)$/im)?.[1]?.trim() ?? "";
    return browserFolderName || localPath || connectedPath || execution?.projectPath || "";
  }, [brief, connectedPath, execution?.projectPath]);

  function send() {
    if (projectDeleted) return;
    const trimmed = task.trim();
    if (!trimmed && !evidenceFiles.length) return;
    const nextTask = trimmed || "Continue working on this project";
    setTask("");
    setTurnAccepted(true);
    const files = evidenceFiles;
    setEvidenceFiles([]);
    setExpandedPriorId(null);
    setHistoryOpen(false);
    setRevealEventIds([]);
    scrollToLiveEdge("auto");
    onExecute(nextTask, undefined, files);
  }

  function handleAnswer(answers: Array<{ question: string; answer: string }>) {
    if (!activeVM?.blocking || activeVM.blocking.kind !== "question") return;
    onExecute(answerTaskFor(activeVM.blocking, answers, mission.pendingClarification));
  }

  function handleApprove(event: FactoryExecutionEvent, action: BlockedCommandAction) {
    const command = event.command ?? event.title;
    const category = event.details?.category as CommandPermissionCategory | undefined;
    if (action === "skip") {
      onExecute(
        `Denied approval to run "${command}" - mark the checklist item that needed it as skipped (not blocked) and continue with every other item that can still be verified safely.`,
        { requestedCommand: command, decision: "deny" },
      );
      return;
    }
    if (action === "approve-category" && category) onApproveCategory?.(category);
    if (action === "approve-command") onApproveCommand?.(command);
    const decision = action === "approve-once" ? "approve-once" : action === "approve-category" ? "approve-category" : "approve-command";
    onExecute(`Approved: run ${command}`, { requestedCommand: command, decision, category: decision === "approve-category" ? category : undefined });
  }

  function handleEvidenceClick(eventIds: string[]) {
    if (!eventIds.length) return;
    setRevealEventIds(eventIds);
    window.requestAnimationFrame(() => {
      const row = document.getElementById(`canvas-evt-${eventIds[0]}`);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("canvas-flash");
      window.setTimeout(() => row.classList.remove("canvas-flash"), 1200);
    });
  }

  function handleSuggestion(recommendation: MissionRecommendation) {
    setTurnAccepted(true);
    setExpandedPriorId(null);
    setHistoryOpen(false);
    setRevealEventIds([]);
    scrollToLiveEdge("auto");
    onExecute(recommendation.task);
  }

  function beginPreviewResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const row = middleRowRef.current;
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    function onMove(moveEvent: PointerEvent) {
      const fromRight = rowRect.right - moveEvent.clientX;
      const pct = (fromRight / rowRect.width) * 100;
      setPreviewWidthPct(Math.min(60, Math.max(30, pct)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const canUndo = !projectDeleted && Boolean(activeExecution?.timeline.some((event) =>
    !event.internal
    && event.kind === "edit"
    && event.status === "completed"
    && Boolean(event.filePath),
  ));
  const showStatusStrip = Boolean(activeExecution) && !liveEdgeVisible && (missionStatus.isBusy || missionStatus.isPausedForApproval || missionStatus.isPausedForUser);
  const dockOpen = previewAvailable && previewOpen;
  const visibleFileCount = workspaceFiles.length || execution?.files.length || 0;

  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border border-overlay/10 bg-foundry-surface/95 shadow-workspace">
      {/* Project Bar (§1.1) — the only place status lives when the live edge is off-screen. */}
      <header className="flex h-12 items-center gap-3 border-b border-overlay/8 px-4 sm:px-5">
        <StatusDot state={dotState} />
        <h1 className="min-w-0 truncate text-sm font-bold text-foundry-ink">{projectTitleFor(mission)}</h1>
        {editingTarget ? <span className="hidden min-w-0 truncate font-mono text-[11px] text-foundry-subtle md:inline">{editingTarget}</span> : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onViewFiles}
            disabled={projectDeleted}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold text-foundry-subtle transition hover:bg-overlay/[0.05] hover:text-foundry-ink disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:bg-transparent disabled:hover:text-foundry-subtle"
            title={projectDeleted ? "This project folder was deleted" : "Browse project files"}
          >
            <FolderTree size={14} />
            {projectDeleted ? "Project deleted" : visibleFileCount ? `${visibleFileCount} ${visibleFileCount === 1 ? "file" : "files"}` : "Files"}
          </button>
          {connectedProjectId && !projectDeleted ? (
            <button
              type="button"
              onClick={() => void togglePreview()}
              disabled={previewLoading}
              aria-pressed={dockOpen}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold text-foundry-subtle transition hover:bg-overlay/[0.05] hover:text-foundry-ink disabled:cursor-wait disabled:opacity-70"
              title={previewLoading ? "Starting the project preview" : previewFailureReason ? `Preview failed: ${previewFailureReason}` : dockOpen ? "Close the preview" : "Open the preview"}
            >
              {dockOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              {previewLoading ? "Starting preview..." : previewFailureReason ? "Preview failed" : "Preview"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onStartProject}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold text-foundry-subtle transition hover:bg-overlay/[0.05] hover:text-foundry-ink"
          >
            <Code2 size={14} />
            New Project
          </button>
        </div>
      </header>

      <div ref={middleRowRef} className="flex min-h-0 min-w-0 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          style={dockOpen ? { flexBasis: `${100 - previewWidthPct}%` } : undefined}
        >
          <div className={`w-full px-6 py-6 ${dockOpen ? "" : "mx-auto max-w-[856px]"}`}>
            {previewFailureReason ? (
              <div role="alert" className="mx-auto mb-4 flex max-w-[760px] items-start justify-between gap-4 rounded-lg border border-red-400/30 bg-red-400/[0.08] px-4 py-3 text-sm text-foundry-ink">
                <div>
                  <p className="font-extrabold">Preview failed</p>
                  <p className="mt-1 text-[12px] leading-5 text-foundry-muted">{previewFailureReason}</p>
                </div>
                <button type="button" onClick={() => void togglePreview()} className="shrink-0 rounded-md border border-overlay/15 px-2.5 py-1 text-[11px] font-bold text-foundry-ink hover:bg-overlay/[0.06]">
                  Retry preview
                </button>
              </div>
            ) : null}
            <div className="mx-auto max-w-[760px]">
              {mission.compaction ? (
                <p className="mb-3 text-[11px] leading-5 text-foundry-subtle">Earlier project activity compacted into project memory.</p>
              ) : null}
              {priorVMs.length ? (
                <section className="mb-8 overflow-hidden rounded-lg border border-overlay/8 bg-overlay/[0.018]" aria-label="Previous messages">
                  <button
                    type="button"
                    aria-expanded={historyOpen}
                    onClick={() => {
                      setHistoryOpen((current) => !current);
                      if (historyOpen) setExpandedPriorId(null);
                    }}
                    className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] font-semibold text-foundry-muted transition hover:bg-overlay/[0.035] hover:text-foundry-ink"
                  >
                    <History size={14} className="text-foundry-subtle" aria-hidden="true" />
                    <span>Previous messages</span>
                    <span className="rounded-full bg-overlay/[0.055] px-2 py-0.5 font-mono text-[10px] text-foundry-subtle">{priorVMs.length}</span>
                    <ChevronDown size={14} className={`ml-auto text-foundry-subtle transition-transform ${historyOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {historyOpen ? (
                    <div className="canvas-enter border-t border-overlay/8 px-1.5 py-1.5">
                      {priorVMs.map((vm) => (
                        <CollapsedMissionRow
                          key={vm.id}
                          vm={vm}
                          expanded={expandedPriorId === vm.id}
                          onToggle={() => setExpandedPriorId((current) => (current === vm.id ? null : vm.id))}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {activeVM ? (
                <MissionBlock
                  vm={activeVM}
                  revealEventIds={revealEventIds}
                  liveActivity={liveEvent ? { id: liveEvent.id, text: liveEvent.text, elapsedMs: silenceMs } : null}
                  suggestions={recommendations}
                  onAnswer={handleAnswer}
                  onApprove={handleApprove}
                  onEvidenceClick={handleEvidenceClick}
                  onSuggestion={handleSuggestion}
                />
              ) : (
                <IdleConnectLine brief={brief} editingTarget={editingTarget} fileCount={workspaceFiles.length || execution?.files.length || 0} />
              )}

              {environment && environment.status !== "ready" ? (
                <EnvironmentSetup
                  environment={environment}
                  onEnvironmentChange={setEnvironment}
                  onEnvironmentReady={() => onExecute("Continue")}
                />
              ) : null}

              <div ref={liveEdgeRef} className="h-6" aria-hidden="true" />
            </div>
          </div>

          {!following && missedEvents > 0 ? (
            <button
              type="button"
              onClick={() => scrollToLiveEdge()}
              className="canvas-enter sticky bottom-4 left-full mr-4 flex items-center gap-2 rounded-full border border-overlay/15 bg-foundry-raised px-3.5 py-1.5 text-[12px] font-bold text-foundry-ink shadow-lg transition hover:border-foundry-teal/40"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-foundry-teal" aria-hidden="true" />
              {missedEvents} new event{missedEvents === 1 ? "" : "s"} ↓
            </button>
          ) : null}
        </div>

        {dockOpen ? (
          <>
            {!previewFullScreen ? <div
              role="separator"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={beginPreviewResize}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") setPreviewWidthPct((value) => Math.min(60, value + 4));
                if (event.key === "ArrowRight") setPreviewWidthPct((value) => Math.max(30, value - 4));
              }}
              className="w-1.5 shrink-0 cursor-col-resize bg-overlay/5 transition hover:bg-foundry-teal/40 focus:bg-foundry-teal/40 focus:outline-none"
              aria-label="Resize the preview"
            /> : null}
            <div
              className={previewFullScreen
                ? "fixed inset-3 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-overlay/15 bg-foundry-bg shadow-2xl"
                : "flex min-h-0 min-w-0 flex-col border-l border-overlay/10 bg-shade/10"}
              style={previewFullScreen ? undefined : { flexBasis: `${previewWidthPct}%` }}
            >
              <EngineeringWorkspacePanel
                execution={effectiveExecution}
                fullScreen={previewFullScreen}
                onToggleFullScreen={() => setPreviewFullScreen((value) => !value)}
                onCollapse={() => { setPreviewOpen(false); setPreviewFullScreen(false); }}
              />
            </div>
          </>
        ) : null}
      </div>

      <div>
        {retryableTask ? (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-overlay/8 bg-shade/20 px-4 py-2 sm:px-6">
            <span className="text-[12px] text-foundry-muted">
              {activeExecution?.state === "cancelled"
                ? "The last run was interrupted before it finished."
                : retryWillRepair
                  ? "The implementation is on disk, but verification found issues that still need repair."
                  : "The last run didn't finish."}
            </span>
            <button
              type="button"
              className="rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-2.5 py-1 text-[12px] font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2]"
              onClick={() => activeExecution && (onRetry ? onRetry(retryableTask, activeExecution.id) : onExecute(retryableTask))}
            >
              {retryWillRepair ? "Fix verified issues" : "Retry this task"}
            </button>
          </div>
        ) : null}
        {showStatusStrip ? (
          <button
            type="button"
            onClick={() => scrollToLiveEdge()}
            className="flex h-8 w-full items-center gap-2.5 border-t border-overlay/8 bg-shade/30 px-4 text-left sm:px-6"
            aria-label="Jump to the live edge"
          >
            <StatusDot state={dotState} />
            <span className="text-[11px] font-bold text-foundry-muted">{missionStatus.label}</span>
            {missionStatus.isPausedForApproval || missionStatus.isPausedForUser ? (
              <span className="min-w-0 truncate text-[12px] text-foundry-amber">waiting on you — jump to the decision ↓</span>
            ) : liveEvent ? (
              <span className="min-w-0 truncate font-mono text-[12px] text-foundry-subtle">{liveEvent.text}</span>
            ) : null}
          </button>
        ) : null}
        <CanvasComposer
          inputRef={composerRef}
          value={task}
          isBusy={missionStatus.isBusy}
          pausedForApproval={missionStatus.isPausedForApproval}
          pausedForQuestion={missionStatus.isPausedForUser}
          queuedTask={queuedTask}
          canUndo={canUndo}
          projectUnavailable={projectDeleted}
          evidenceFiles={evidenceFiles}
          onChange={setTask}
          onSend={send}
          onStop={() => onExecute("stop")}
          onUndo={() => activeExecution && (onUndo ? onUndo(activeExecution.id) : onExecute("Undo the last file change"))}
          onAddEvidence={(files) => {
            if (!files) return;
            setEvidenceFiles((current) => [...current, ...Array.from(files)]);
          }}
          onRemoveEvidence={(index) => setEvidenceFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))}
          onClearEvidence={() => setEvidenceFiles([])}
        />
      </div>
    </section>
  );
}

function EnvironmentSetup({
  environment,
  onEnvironmentChange,
  onEnvironmentReady,
}: {
  environment: NonNullable<FactoryProjectResult["environment"]>;
  onEnvironmentChange: (environment: NonNullable<FactoryProjectResult["environment"]>) => void;
  onEnvironmentReady: () => void;
}) {
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function prepare(requirement: NonNullable<FactoryProjectResult["environment"]>["requirements"][number]) {
    if (!requirement.approvalCommand || preparingId) return;
    setPreparingId(requirement.id);
    setError("");
    try {
      const response = await fetch("/api/factory/environment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "install", toolchainId: requirement.id, approvedCommand: requirement.approvalCommand }),
      });
      const result = (await response.json()) as { ok?: boolean; requirement?: typeof requirement; error?: string };
      if (!response.ok || !result.ok || !result.requirement) throw new Error(result.error || "Environment preparation did not complete.");
      const requirements = environment.requirements.map((item) => (item.id === result.requirement?.id ? result.requirement : item));
      const status = requirements.every((item) => item.status === "ready")
        ? "ready" as const
        : requirements.some((item) => item.status === "missing" && item.canInstall)
          ? "needs-setup" as const
          : "unsupported" as const;
      const next = { ...environment, status, requirements };
      onEnvironmentChange(next);
      if (status === "ready") onEnvironmentReady();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Environment preparation failed.");
    } finally {
      setPreparingId(null);
    }
  }

  return (
    <section className="mt-5 border-l border-foundry-amber/40 pl-4" aria-label="Project environment setup">
      <p className="text-[13px] font-semibold leading-6 text-foundry-ink">Prepare this computer</p>
      <p className="max-w-2xl text-[12px] leading-5 text-foundry-subtle">
        This project needs a local toolchain before Foundry can build and verify it. Windows may show its normal security confirmation for machine-level changes.
      </p>
      <div className="mt-2 grid gap-2">
        {environment.requirements.filter((item) => item.status !== "ready").map((requirement) => (
          <div key={requirement.id} className="flex flex-wrap items-center gap-2 text-[12px] leading-5">
            <span className="text-foundry-muted">{requirement.label} — {requirement.reason || requirement.purpose}</span>
            {requirement.canInstall && requirement.approvalCommand ? (
              <button
                type="button"
                onClick={() => void prepare(requirement)}
                disabled={Boolean(preparingId)}
                className="rounded border border-foundry-amber/35 px-2.5 py-1 font-semibold text-foundry-amber transition hover:bg-foundry-amber/10 disabled:cursor-wait disabled:opacity-60"
              >
                {preparingId === requirement.id ? "Preparing…" : `Install ${requirement.label}`}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {error ? <p className="mt-2 text-[12px] leading-5 text-red-300">{error}</p> : null}
    </section>
  );
}

/** §7 — four states, no continuous animation. Hollow = idle (or a real stall). */
function StatusDot({ state }: { state: CanvasDotState }) {
  const cls =
    state === "working"
      ? "bg-foundry-teal"
      : state === "waiting"
        ? "bg-foundry-amber"
        : state === "failed"
          ? "bg-red-400"
          : "border border-foundry-subtle bg-transparent";
  return <span role="status" aria-label={state} className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

/** §13.1 — the idle line for a project with no missions yet: real inspection facts only. */
function IdleConnectLine({ brief, editingTarget, fileCount }: { brief: string; editingTarget: string; fileCount: number }) {
  const isExisting = /^Mode:\s*Work on existing project/im.test(brief);
  return (
    <p className="max-w-[70ch] text-[15px] leading-[1.6] text-foundry-muted">
      {isExisting
        ? `Connected to ${editingTarget || "the project"}${fileCount ? ` — ${fileCount} ${fileCount === 1 ? "file" : "files"} readable` : ""}. Ask a question to inspect without edits, or describe a change.`
        : "This project is empty. Describe the first thing to build."}
    </p>
  );
}
