import type { ExecutionMissionVerification, FactoryEngineeringReport, FactoryExecutionEvent, FactoryExecutionEventKind, FactoryLifecyclePhase, FactoryObjectiveChecklistItem, MissionClarification } from "@/lib/factory/types";
import type { DeliveredProjectFile, ExecutionMission, ExecutionMissionState, ExecutionMissionVerificationStatus } from "@/lib/mission/model";
import type { WorkspaceAttachment } from "@/lib/files";
import { stripTerminalFormatting } from "@/lib/text/terminal";

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
  /** Changed/read line range from the real event, e.g. "lines 42–67", for the compact rail. */
  lineRange?: string;
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
  heading: "Done" | "Failed" | "Stopped" | "Blocked" | "Verification blocked" | "Ready to continue";
  verificationStatus: ExecutionMissionVerificationStatus;
  /** Product-specific final handoff, preserved from the executor rather than replaced by a status word. */
  outcome?: string;
  /** Real claims: files touched, with evidence links. ≤ 5 lines. */
  whatChanged: CanvasSummaryLine[];
  /** Only things actually exercised. Empty ⇒ the explicit unverified label renders. */
  verified: string[];
  failedChecks: string[];
  /** Present only if real uncertainty exists (blocked reason, warnings, flags). */
  watchFor: string[];
  elapsedMs?: number;
  engineeringReport?: FactoryEngineeringReport;
  lifecycle?: FactoryLifecyclePhase[];
};

export type CanvasTier = "tiny" | "medium" | "large" | "huge";

export type CanvasMissionVM = {
  id: string;
  /** The user's real request text. */
  request: string;
  /** Full durable new-project brief shown on demand at execution start. */
  requestBrief?: { content: string; customInstructions?: string };
  /** Images attached to this exact request, rendered as first-class message content. */
  requestAttachments: WorkspaceAttachment[];
  requestedAt: string;
  state: ExecutionMissionState;
  stateLabel: string;
  tier: CanvasTier;
  groups: CanvasVoiceGroup[];
  deliveredFiles: DeliveredProjectFile[];
  /** Live compact verification checklist — real gates only, latest result each. */
  verification: CanvasVerificationCheck[];
  /** Live browser-validation steps from the real preview timeline. */
  browserSteps: CanvasBrowserStep[];
  phases: CanvasPhase[];
  blocking?: CanvasBlocking;
  summary?: CanvasSummary;
  /** Outcome phrase for the collapsed one-line row (real summary's first sentence). */
  outcome: string;
  isBusy: boolean;
  updatedAt: string;
};

export type CanvasDotState = "idle" | "working" | "waiting" | "failed";

/** One row of the compact verification summary — a real gate that ran, never a placeholder. */
export type CanvasVerificationCheck = { label: string; status: "pass" | "fail" | "skipped" };

/** One real browser-validation step, in order (e.g. "Signup page opened", "Form submitted"). */
export type CanvasBrowserStep = { label: string; status: "running" | "done" | "failed" };

/**
 * The live browser-validation steps, from the real preview timeline. An auth flow yields granular steps
 * (page opened → form submitted → email created → verification link); a static page yields the coarser
 * preview lifecycle. Real events only — the latest state per distinct step, most recent last.
 */
export function browserStepsOf(timeline: FactoryExecutionEvent[]): CanvasBrowserStep[] {
  const byLabel = new Map<string, CanvasBrowserStep["status"]>();
  for (const event of timeline) {
    if (event.kind !== "preview" || isInternalExecutionEvent(event)) continue;
    const label = stripTerminalFormatting(event.title || "").replace(/\s+/g, " ").trim();
    if (!label) continue;
    byLabel.set(label, event.status === "error" ? "failed" : event.status === "running" ? "running" : "done");
  }
  return [...byLabel.entries()].slice(-6).map(([label, status]) => ({ label, status }));
}

const VERIFICATION_LABELS: Partial<Record<ExecutionMissionVerification["check_type"], string>> = {
  typecheck: "Type-check",
  lint: "Lint",
  build: "Build",
  test: "Tests",
  preview: "Browser flow",
  command: "Command",
};
const VERIFICATION_ORDER: ExecutionMissionVerification["check_type"][] = ["typecheck", "lint", "build", "test", "preview", "command"];

/**
 * VerificationSummary source — collapses the real verification records into one compact live checklist,
 * latest result per gate. Only gates a person recognizes (type-check, build, tests, browser flow) render;
 * bookkeeping records (file-read, checklist, manual-evidence) never appear. Nothing is faked: a row exists
 * only because that gate actually ran.
 */
export function verificationChecksOf(verification: ExecutionMissionVerification[]): CanvasVerificationCheck[] {
  const latest = new Map<ExecutionMissionVerification["check_type"], ExecutionMissionVerification>();
  for (const item of verification) {
    if (!VERIFICATION_LABELS[item.check_type]) continue;
    latest.set(item.check_type, item);
  }
  return VERIFICATION_ORDER.filter((type) => latest.has(type)).map((type) => {
    const item = latest.get(type)!;
    let label = VERIFICATION_LABELS[type]!;
    if (type === "test") {
      const count = item.evidence.match(/(\d+)\s*(?:tests?|passed|specs?|examples?)/i);
      if (count) label = `${count[1]} tests`;
    }
    return { label, status: item.result };
  });
}

/** A repeated finding on byte-identical source is a verifier conflict, not unfinished project work. */
export function hasVerificationConflict(mission: ExecutionMission): boolean {
  return mission.state === "failed" && mission.blocked_reason?.includes("[FOUNDRY_VERIFICATION_CONFLICT]") === true;
}

/** A verified product/build defect is actionable work, not an unexplained execution crash. */
export function needsRepairAction(mission: ExecutionMission): boolean {
  if (mission.state !== "failed" || hasVerificationConflict(mission)) return false;
  const actionableChecks = new Set(["preview", "build", "test", "lint", "typecheck", "command"]);
  if (mission.verification.some((item) => item.result === "fail" && actionableChecks.has(item.check_type))) return true;
  // Missions persisted before structured verification was mandatory stored the exact gate in the
  // terminal blocker. Preserve their repair semantics after an upgrade instead of demoting them to
  // an unexplained generic retry.
  return /\b(?:browser (?:preview )?verification|real browser gate|production build|typecheck|lint|test(?:s|ing)?|command)\b[^\n]{0,160}\b(?:fail(?:ed|ure|ing)?|unresolved|did not pass|still needs repair)\b/i.test(mission.blocked_reason ?? "");
}

const voiceKinds: FactoryExecutionEventKind[] = ["reasoning", "planning", "summary"];

/** Hide internal orchestration records, including records persisted before those emitters were
 * correctly marked internal. This preserves the engineering history while removing model-routing
 * and capability-level implementation details from every user-facing timeline. */
export function isInternalExecutionEvent(event: FactoryExecutionEvent): boolean {
  const text = `${event.title ?? ""} ${event.rationale ?? ""}`.trim();
  return Boolean(event.internal)
    // Legacy runtimes persisted one stdout/stderr event per process chunk. Command terminal
    // events retain the actual output, so these bookkeeping rows are never user-facing evidence.
    || event.kind === "stdout"
    || event.kind === "stderr"
    || /^Routing:\s*(?:fast|builder|architect|enterprise-architect|super-reasoning)\b/i.test(text)
    || /\bI'm at Level\s+[1-4]\s+here\b/i.test(text)
    || /\bFull mission support here\b/i.test(text);
}

/** A voice event is one whose text is a sentence Foundry says; everything else is a work row. */
export function isVoiceEvent(event: FactoryExecutionEvent): boolean {
  if (isInternalExecutionEvent(event)) return false;
  if (event.tier === "finding" || event.tier === "decision" || event.tier === "flag") return true;
  return voiceKinds.includes(event.kind);
}

export function voiceTextOf(event: FactoryExecutionEvent): string {
  return stripTerminalFormatting(event.rationale || event.output || event.title || "").replace(/\s+/g, " ").trim();
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
  if (plan.length === 0 && !engineSize) return mission.timeline.filter((event) => !isInternalExecutionEvent(event)).length > 8 ? "medium" : "tiny";
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
 * True only for a real narrative beat — something Foundry *said*, in sentences. Status labels
 * ("Planning project", "Architecture selected", "Model · openai/gpt-5.5", "Build-model usage · …")
 * are not beats: letting each one open its own entry turned one mission into fifty near-empty boxes
 * containing two words each. Those fold into the current entry's execution rail instead.
 */
export function isNarrativeVoice(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !/\s/.test(trimmed)) return false;
  if (/^(?:model|build-model usage|execution strategy|routing|planning project|architecture selected|execution batch|checklist updated)\b/i.test(trimmed)) return false;
  // A beat is a sentence: it ends in real punctuation, or it is long enough to carry an actual thought.
  return /[.!?]$/.test(trimmed) ? trimmed.length >= 25 : trimmed.length >= 60;
}

/**
 * Voice/work grouping: walk the real timeline; each NARRATIVE voice event opens a group, work
 * events (and label-like status lines) attach to the most recent group. Dead ends stay — the trail is
 * the actual hunt.
 */
export function groupTimeline(timeline: FactoryExecutionEvent[]): CanvasVoiceGroup[] {
  const groups: CanvasVoiceGroup[] = [];
  let current: CanvasVoiceGroup | null = null;

  timeline
    .filter((event) => !isInternalExecutionEvent(event) && event.kind !== "blocked")
    .forEach((event) => {
      const voiceText = isVoiceEvent(event) ? voiceTextOf(event) : "";
      if (voiceText && isNarrativeVoice(voiceText)) {
        const previousGroup = groups.at(-1);
        // Retries frequently repeat the same narration around their work events. Keep that as one
        // narrative beat instead of presenting every retry as a new Foundry message.
        if (previousGroup?.voice === voiceText) {
          current = previousGroup;
          return;
        }
        current = { id: event.id, voice: voiceText, voiceTimestamp: event.timestamp, events: [] };
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
        // A label-like status line keeps its own words as the row text rather than being reformatted
        // into a file/command phrase it never was.
        text: voiceText || workEventText(event),
        timestamp: event.timestamp,
        filePath: event.filePath,
        command: event.command,
        output: rawPayloadOf(event),
        durationMs: event.durationMs,
        lineRange: normalizeLineRange(typeof event.details?.lineRange === "string" ? event.details.lineRange : undefined),
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

/**
 * ExecutionEventGrouper — collapses the low-level work events inside one voice group into compact
 * execution units. The raw event trail is the source of truth (kept on each unit's subSteps); this
 * layer only decides how to *present* it: read → open → edit → save → verify of one file become a single
 * "Updated auth.ts" unit, and the repeated lifecycle rows of one command become a single command unit.
 * The rail renders these units inline; each expands in place to its exact low-level steps and payloads.
 */
export type CanvasExecutionState =
  | "thinking" | "investigating" | "deciding" | "editing" | "running"
  | "testing" | "verifying" | "recovering" | "waiting-approval" | "waiting-user"
  | "completed" | "blocked";

export type CanvasExecutionSubStep = {
  id: string;
  kind: FactoryExecutionEventKind;
  status: CanvasWorkEvent["status"];
  text: string;
  output?: string;
};

export type CanvasExecutionUnit = {
  id: string;
  kind: "file" | "command" | "preview" | "misc";
  /** Compact rail label — "Updated auth.ts", "npm run build", "Restarting preview". */
  label: string;
  /** Secondary detail shown after the label — "lines 42–67", "exit 0". */
  detail?: string;
  status: CanvasWorkEvent["status"];
  durationMs?: number;
  filePath?: string;
  command?: string;
  /** Primary raw payload (diff/stdout/stderr) opened in place. */
  output?: string;
  /** The collapsed low-level events behind this unit, in order. */
  subSteps: CanvasExecutionSubStep[];
};

/** Normalize an engine line-range string ("Lines 1-658", "Lines 42-67") into a compact rail detail. */
export function normalizeLineRange(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!match) return undefined;
  const [from, to] = [Number(match[1]), Number(match[2])];
  return from === to ? `line ${from}` : `lines ${from}–${to}`;
}

/**
 * A unit's status is the latest sub-step's status (last-wins). This is what makes recovery honest: a
 * failed edit followed by a successful retry, or a running lifecycle row followed by its completion,
 * resolves to the real final state — while the earlier failure stays visible in the expanded steps and
 * never leaves the unit falsely marked failed (spec: recovered errors do not remain unresolved).
 */
function foldUnitStatus(subSteps: CanvasExecutionSubStep[]): CanvasWorkEvent["status"] {
  if (!subSteps.length) return "completed";
  return subSteps[subSteps.length - 1].status;
}

function commandLabel(command: string): string {
  return command.replace(/^(?:cmd\.exe\s+\/c\s+|powershell\s+-command\s+)/i, "").replace(/\s+/g, " ").trim();
}

export function groupExecutionUnits(events: CanvasWorkEvent[]): CanvasExecutionUnit[] {
  const units: CanvasExecutionUnit[] = [];
  const fileUnits = new Map<string, CanvasExecutionUnit>();
  const commandUnits = new Map<string, CanvasExecutionUnit>();
  const miscUnits = new Map<string, CanvasExecutionUnit>();

  const addSubStep = (unit: CanvasExecutionUnit, event: CanvasWorkEvent) => {
    unit.subSteps.push({ id: event.id, kind: event.kind, status: event.status, text: event.text, output: event.output });
    unit.durationMs = (unit.durationMs ?? 0) + (event.durationMs ?? 0);
    if (!unit.output && event.output) unit.output = event.output;
  };

  for (const event of events) {
    if (event.filePath && (event.kind === "file" || event.kind === "edit" || event.kind === "inspection" || event.kind === "folder")) {
      let unit = fileUnits.get(event.filePath);
      if (!unit) {
        unit = { id: `unit-file-${event.filePath}`, kind: "file", label: "", status: "completed", filePath: event.filePath, durationMs: 0, subSteps: [] };
        fileUnits.set(event.filePath, unit);
        units.push(unit);
      }
      addSubStep(unit, event);
      if (event.lineRange && event.kind !== "inspection") unit.detail = event.lineRange;
      else if (event.lineRange && !unit.detail) unit.detail = event.lineRange;
      continue;
    }
    if (event.kind === "command" || event.kind === "build") {
      const key = event.command ?? event.text;
      let unit = commandUnits.get(key);
      if (!unit) {
        unit = { id: `unit-cmd-${key}`, kind: "command", label: commandLabel(event.command ?? event.text), status: event.status, command: event.command, durationMs: 0, subSteps: [] };
        commandUnits.set(key, unit);
        units.push(unit);
      }
      addSubStep(unit, event);
      continue;
    }
    // Preview/misc events carry no path or command, so the lifecycle merge upstream can never pair them
    // and every repeat rendered as another identical chip ("Checking rendered project in a real
    // browser · Checking rendered project in a real browser · …"). Fold repeats of the same label into
    // one unit that keeps the latest status.
    const miscKey = `misc:${event.text}`;
    const existing = miscUnits.get(miscKey);
    if (existing) {
      addSubStep(existing, event);
      continue;
    }
    const unit: CanvasExecutionUnit = {
      id: `unit-${event.id}`,
      kind: event.kind === "preview" ? "preview" : "misc",
      label: event.text,
      status: event.status,
      durationMs: 0,
      subSteps: [],
    };
    miscUnits.set(miscKey, unit);
    units.push(unit);
    addSubStep(unit, event);
  }

  for (const unit of units) {
    unit.status = foldUnitStatus(unit.subSteps);
    if (unit.kind === "file") {
      const folderOnly = unit.subSteps.every((step) => step.kind === "folder");
      if (folderOnly) {
        // A project directory is setup progress, not a delivered file. Keeping it as a file unit
        // made the rail claim "Created 2 files" when disk contained only foundry-brief.md.
        unit.kind = "misc";
        unit.label = unit.subSteps.at(-1)?.text || "Project folder prepared";
        continue;
      }
      const basename = (unit.filePath ?? "").split("/").pop() || unit.filePath || "file";
      const verb = unit.subSteps.some((step) => step.kind === "edit")
        ? "Updated"
        : unit.subSteps.some((step) => step.kind === "file" || step.kind === "folder")
          ? "Created"
          : "Read";
      unit.label = `${verb} ${basename}`;
    }
  }

  return units;
}

/**
 * CurrentActivityController — the single, unambiguous "what Foundry is doing right now" line. Derived
 * from the real mission state and the latest non-internal event; never more than one active state.
 */
export function currentActivityOf(mission: ExecutionMission): { state: CanvasExecutionState; label: string } {
  if (mission.state === "waiting_for_approval") return { state: "waiting-approval", label: "Waiting for approval" };
  if (mission.state === "waiting_for_user") return { state: "waiting-user", label: "Waiting for your reply" };
  if (mission.state === "complete") return { state: "completed", label: "Completed" };
  if (mission.state === "failed" || mission.state === "blocked") return { state: "blocked", label: "Blocked" };

  const last = mission.timeline.filter((event) => !isInternalExecutionEvent(event)).at(-1);
  if (!last) return { state: "thinking", label: "Thinking" };
  const basename = last.filePath ? last.filePath.split("/").pop() : undefined;
  const isTest = /\b(test|vitest|jest|spec|playwright)\b/i.test(last.command ?? "");
  const isBuild = /\b(build|compile|tsc|typecheck)\b/i.test(last.command ?? "") || last.kind === "build";

  if (last.tier === "decision") return { state: "deciding", label: "Deciding on an approach" };
  if (last.tier === "flag") return { state: "recovering", label: "Handling a blocker" };
  if (last.tier === "finding") return { state: "investigating", label: "Investigating" };
  if (last.kind === "fix") return { state: "recovering", label: "Recovering" };
  if (last.kind === "inspection") return { state: "investigating", label: basename ? `Reading ${basename}` : "Investigating" };
  if (last.kind === "edit" || last.kind === "file" || last.kind === "folder") return { state: "editing", label: basename ? `Editing ${basename}` : "Editing files" };
  if (last.kind === "preview") return { state: "testing", label: "Testing in the browser" };
  if (last.kind === "command" || last.kind === "build") {
    if (isTest) return { state: "testing", label: "Running tests" };
    if (isBuild) return { state: "verifying", label: "Building and verifying" };
    return { state: "running", label: commandLabel(last.command ?? last.title) };
  }
  return { state: "thinking", label: "Thinking" };
}

/**
 * A concise "current focus" phrase for the banner — the most recent thing Foundry actually said it is
 * doing (its latest voice line, first sentence), falling back to the short activity label. Real content
 * only: it never invents a focus the timeline doesn't support.
 */
export function currentFocusOf(mission: ExecutionMission): string {
  const newest = mission.timeline.at(-1);
  // Provider-wait events stay out of the expanded history, but their titles still describe the live
  // work accurately. Never let an older voice line claim Foundry is reading after work has advanced.
  if (newest?.status === "running" && isInternalExecutionEvent(newest) && newest.title.trim()) {
    return newest.title.trim();
  }
  const voice = [...mission.timeline].reverse().find((event) => isVoiceEvent(event) && voiceTextOf(event));
  const latest = mission.timeline.filter((event) => !isInternalExecutionEvent(event)).at(-1);
  // A narrative line owns the focus only until newer concrete work begins. Otherwise an initial
  // "Reading project request" event can remain visible throughout later edits, commands, and builds.
  if (voice && (!latest || voice.id === latest.id || new Date(voice.timestamp).getTime() >= new Date(latest.timestamp).getTime())) {
    const text = voiceTextOf(voice);
    const first = text.split(/(?<=[.!?])\s+/)[0]?.trim() || text;
    return first.length > 120 ? `${first.slice(0, 117)}…` : first;
  }
  return currentActivityOf(mission).label;
}

/** The raw payload behind a row (stdout/stderr/diff), preserved verbatim for expansion. */
function rawPayloadOf(event: FactoryExecutionEvent): string | undefined {
  const parts = [event.output, event.stdout, event.stderr].filter((part): part is string => Boolean(part && part.trim()));
  if (!parts.length) return undefined;
  return stripTerminalFormatting(parts.join("\n")).trim();
}

/** §7 status dot: exactly four states, driven only by the real mission state. */
export function dotStateOf(state: ExecutionMissionState | "idle", isBusy: boolean): CanvasDotState {
  if (state === "waiting_for_user" || state === "waiting_for_approval") return "waiting";
  if (state === "failed" || state === "blocked") return "failed";
  if (isBusy) return "working";
  return "idle";
}

/** The most recent real event, rendered verbatim in the live activity row (§7.1). */
export function latestLiveEvent(timeline: FactoryExecutionEvent[]): { id: string; text: string; timestamp: string } | null {
  // A hidden provider/build wait can be newer than the last narrative line. Its concise title is
  // safe for the live banner and keeps the banner body aligned with Current focus.
  const last = [...timeline].reverse().find((event) => event.status === "running")
    ?? timeline.filter((event) => !isInternalExecutionEvent(event)).at(-1);
  if (!last) return null;
  const text = isInternalExecutionEvent(last) ? last.title : isVoiceEvent(last) ? voiceTextOf(last) : workEventText(last);
  return text ? { id: last.id, text, timestamp: last.timestamp } : null;
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
