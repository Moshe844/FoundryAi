import type { FactoryExecutionEvent, FactoryExecutionEventKind, FactoryObjectiveChecklistItem, MissionClarification } from "@/lib/factory/types";
import type { ExecutionMission, ExecutionMissionState, ExecutionMissionVerificationStatus } from "@/lib/mission/model";

/**
 * Mission Canvas view-model — the single contract between the rendering layer
 * (components/canvas/*) and the engine. Every field here must originate from a real
 * engineering event; the adapter (lib/canvas/adapter.ts) derives what it can from the
 * current engine output, and engine work that deepens these fields plugs in there
 * without touching the components.
 *
 * Spec: docs/mission-canvas-ux-spec.md. The invariants that matter most:
 *  - No simulated content: a row exists only because its event happened.
 *  - Single-status law: exactly one live indicator; everything else is past tense.
 *  - Anti-shift: on-screen content never moves except by user action.
 */

/** One real work event, rendered as a 13px mono row: verb + object + real outcome. */
export type CanvasWorkEvent = {
  id: string;
  kind: FactoryExecutionEventKind;
  status: "running" | "completed" | "warning" | "error" | "skipped";
  /** Full row text built from the real event, e.g. `ran pnpm test → 41 passed · 8.2s`. */
  text: string;
  timestamp: string;
  filePath?: string;
  command?: string;
  /** Raw stdout/stderr/diff payload, expandable in place. Never paraphrased away. */
  output?: string;
  durationMs?: number;
};

/**
 * A voice line (a sentence Foundry said, caused by a real decision/finding) plus the
 * work events it caused. Groups with no voice are the implicit leading group.
 */
export type CanvasVoiceGroup = {
  id: string;
  voice?: string;
  voiceTimestamp?: string;
  events: CanvasWorkEvent[];
};

/** Real plan phase. Exists only if the real plan produced it — never decorative. */
export type CanvasPhase = {
  /** Phase label from the plan ("" for the single implicit group of unphased items). */
  label: string;
  index: number;
  items: FactoryObjectiveChecklistItem[];
  done: number;
  total: number;
  failed: number;
  /** The one phase currently being executed. At most one per mission. */
  isLive: boolean;
};

export type CanvasBlocking =
  | {
      kind: "question";
      question: string;
      options: string[];
      /** All pending questions, answered one at a time (multi-question clarifications). */
      queue: MissionClarification[];
      /** How the answer must be packaged for the engine (see adapter.answerTaskFor). */
      source: "clarification-questions" | "pending-clarification" | "mock-review";
    }
  | {
      kind: "approval";
      /** Canonical blocked event carrying the exact command, reason, and category. */
      event: FactoryExecutionEvent;
    };

export type CanvasSummaryLine = {
  text: string;
  /** Timeline event ids backing this claim — click scrolls to the evidence. */
  evidenceEventIds: string[];
};

/** Terminal block. Rendered only after the real final event. */
export type CanvasSummary = {
  heading: "Done" | "Failed" | "Stopped" | "Blocked";
  verificationStatus: ExecutionMissionVerificationStatus;
  /** Real claims: files touched, with evidence links. ≤ 5 lines. */
  whatChanged: CanvasSummaryLine[];
  /** Only things actually exercised. Empty ⇒ the explicit unverified label renders. */
  verified: string[];
  failedChecks: string[];
  /** Present only if real uncertainty exists (blocked reason, warnings, flags). */
  watchFor: string[];
  elapsedMs?: number;
};

export type CanvasTier = "tiny" | "medium" | "large" | "huge";

export type CanvasMissionVM = {
  id: string;
  /** The user's real request text. */
  request: string;
  requestedAt: string;
  state: ExecutionMissionState;
  stateLabel: string;
  tier: CanvasTier;
  groups: CanvasVoiceGroup[];
  phases: CanvasPhase[];
  blocking?: CanvasBlocking;
  summary?: CanvasSummary;
  /** Outcome phrase for the collapsed one-line row (real summary's first sentence). */
  outcome: string;
  isBusy: boolean;
  updatedAt: string;
};

export type CanvasDotState = "idle" | "working" | "waiting" | "failed";

const voiceKinds: FactoryExecutionEventKind[] = ["reasoning", "planning", "summary"];

/** A voice event is one whose text is a sentence Foundry says; everything else is a work row. */
export function isVoiceEvent(event: FactoryExecutionEvent): boolean {
  if (event.internal) return false;
  if (event.tier === "finding" || event.tier === "decision" || event.tier === "flag") return true;
  return voiceKinds.includes(event.kind);
}

export function voiceTextOf(event: FactoryExecutionEvent): string {
  return (event.rationale || event.output || event.title || "").replace(/\s+/g, " ").trim();
}

/** Row text for a work event: verb + object + real outcome. Nothing predictive. */
export function workEventText(event: FactoryExecutionEvent): string {
  const duration = typeof event.durationMs === "number" && event.durationMs > 0 ? ` · ${formatDuration(event.durationMs)}` : "";
  if (event.kind === "command" || event.kind === "build") {
    const command = event.command ?? event.title;
    const outcome = event.status === "running" ? "" : typeof event.exitCode === "number" ? ` → exit ${event.exitCode}` : event.status === "error" ? " → failed" : "";
    return `ran ${command}${outcome}${duration}`;
  }
  if (event.kind === "file") return `${event.status === "running" ? "writing" : "wrote"} ${event.filePath ?? event.fileName ?? event.title}${duration}`;
  if (event.kind === "edit") return `${event.status === "running" ? "editing" : "edited"} ${event.filePath ?? event.fileName ?? event.title}${duration}`;
  if (event.kind === "folder") return `created ${event.filePath ?? event.title}`;
  if (event.kind === "inspection") return `read ${event.filePath ?? event.fileName ?? event.title}`;
  if (event.kind === "preview") return event.title;
  if (event.kind === "fix") return event.title;
  return event.title;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * Tier comes from the real plan (and the engine's own size call when present), never
 * from message-length heuristics. A mission may upgrade mid-flight as the real work grows.
 */
export function tierOf(mission: ExecutionMission): CanvasTier {
  if (mission.size === "huge") return "huge";
  if (mission.size === "large") return "large";
  if (mission.size === "tiny" || mission.size === "small") return sizeFromPlan(mission, "tiny");
  if (mission.size === "medium") return sizeFromPlan(mission, "medium");
  return sizeFromPlan(mission, undefined);
}

function sizeFromPlan(mission: ExecutionMission, engineSize: CanvasTier | undefined): CanvasTier {
  const plan = mission.plan ?? [];
  const phaseCount = new Set(plan.map((item) => item.phase ?? "")).size;
  if (phaseCount > 1 || plan.length > 6) return "large";
  if (plan.length >= 3) return engineSize === "tiny" ? "medium" : engineSize ?? "medium";
  if (plan.length === 0 && !engineSize) return mission.timeline.filter((event) => !event.internal).length > 8 ? "medium" : "tiny";
  return engineSize ?? "medium";
}

/** Real phases from the real plan. Unphased plans yield one implicit phase with label "". */
export function phasesOf(plan: FactoryObjectiveChecklistItem[]): CanvasPhase[] {
  if (!plan.length) return [];
  const order: string[] = [];
  const byPhase = new Map<string, FactoryObjectiveChecklistItem[]>();
  plan.forEach((item) => {
    const key = item.phase ?? "";
    if (!byPhase.has(key)) {
      byPhase.set(key, []);
      order.push(key);
    }
    byPhase.get(key)!.push(item);
  });
  let liveAssigned = false;
  return order.map((label, index) => {
    const items = byPhase.get(label)!;
    const done = items.filter((item) => item.status === "completed" || item.status === "skipped").length;
    const failed = items.filter((item) => item.status === "blocked").length;
    const isLive = !liveAssigned && items.some((item) => item.status === "running" || item.status === "pending" || item.status === "needs-approval");
    if (isLive) liveAssigned = true;
    return { label, index: index + 1, items, done, total: items.length, failed, isLive };
  });
}

/**
 * Voice/work grouping: walk the real timeline; each voice event opens a group, work
 * events attach to the most recent group. Dead ends stay — the trail is the actual hunt.
 */
export function groupTimeline(timeline: FactoryExecutionEvent[]): CanvasVoiceGroup[] {
  const groups: CanvasVoiceGroup[] = [];
  let current: CanvasVoiceGroup | null = null;

  timeline
    .filter((event) => !event.internal && event.kind !== "blocked")
    .forEach((event) => {
      if (isVoiceEvent(event)) {
        const voice = voiceTextOf(event);
        if (!voice) return;
        const previousGroup = groups.at(-1);
        if (previousGroup?.voice === voice && previousGroup.events.length === 0) return;
        current = { id: event.id, voice, voiceTimestamp: event.timestamp, events: [] };
        groups.push(current);
        return;
      }
      if (!current) {
        current = { id: `lead-${event.id}`, events: [] };
        groups.push(current);
      }
      const nextEvent: CanvasWorkEvent = {
        id: event.id,
        kind: event.kind,
        status: event.status,
        text: workEventText(event),
        timestamp: event.timestamp,
        filePath: event.filePath,
        command: event.command,
        output: rawPayloadOf(event),
        durationMs: event.durationMs,
      };
      const lifecycleKey = `${event.kind}:${event.filePath ?? ""}:${event.command ?? ""}`;
      const previousIndex = current.events.findIndex((candidate) =>
        candidate.status === "running"
        && `${candidate.kind}:${candidate.filePath ?? ""}:${candidate.command ?? ""}` === lifecycleKey,
      );
      if (event.status !== "running" && previousIndex >= 0 && (event.filePath || event.command)) {
        current.events.splice(previousIndex, 1, nextEvent);
      } else {
        current.events.push(nextEvent);
      }
    });

  return groups;
}

/** The raw payload behind a row (stdout/stderr/diff), preserved verbatim for expansion. */
function rawPayloadOf(event: FactoryExecutionEvent): string | undefined {
  const parts = [event.output, event.stdout, event.stderr].filter((part): part is string => Boolean(part && part.trim()));
  if (!parts.length) return undefined;
  return parts.join("\n").trim();
}

/** §7 status dot: exactly four states, driven only by the real mission state. */
export function dotStateOf(state: ExecutionMissionState | "idle", isBusy: boolean): CanvasDotState {
  if (state === "waiting_for_user" || state === "waiting_for_approval") return "waiting";
  if (state === "failed" || state === "blocked") return "failed";
  if (isBusy) return "working";
  return "idle";
}

/** The most recent real event, rendered verbatim in the live activity row (§7.1). */
export function latestLiveEvent(timeline: FactoryExecutionEvent[]): { text: string; timestamp: string } | null {
  const last = timeline.filter((event) => !event.internal).at(-1);
  if (!last) return null;
  const text = isVoiceEvent(last) ? voiceTextOf(last) : workEventText(last);
  return text ? { text, timestamp: last.timestamp } : null;
}

/** Past-tense outcome phrase for a collapsed mission row: the real summary's first sentence. */
export function outcomeOf(mission: ExecutionMission): string {
  const source = mission.summary || mission.blocked_reason || "";
  const first = source.split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
  if (first) return first.length > 140 ? `${first.slice(0, 137)}…` : first;
  if (mission.state === "cancelled") return "stopped before completion";
  if (mission.state === "failed" || mission.state === "blocked") return "stopped at a blocker";
  if (mission.state === "complete") return "completed";
  return "";
}
