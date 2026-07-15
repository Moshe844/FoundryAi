import type { FactoryExecutionEvent, FactoryProjectResult, MissionClarification } from "@/lib/factory/types";
import type { ExecutionMission, MissionState, PendingClarification } from "@/lib/mission-engine";
import { missionStateLabel, pendingApprovalOf, busyMissionStates } from "@/lib/mission/model";
import type { CanvasBlocking, CanvasMissionVM, CanvasSummary, CanvasSummaryLine } from "@/lib/canvas/model";
import { groupTimeline, outcomeOf, phasesOf, tierOf } from "@/lib/canvas/model";

/**
 * Builds the Mission Canvas view-model from real engine output. This is the seam the
 * engine plugs into: everything the components render comes through here, and nothing
 * in here invents content — every VM field is traceable to a persisted engine event.
 */

export function buildMissionVM(
  execution: ExecutionMission,
  mission: MissionState,
  factoryResult: FactoryProjectResult | null,
  isActive: boolean,
): CanvasMissionVM {
  const requestMessage = execution.request_message_id ? mission.messages.find((message) => message.id === execution.request_message_id) : undefined;
  const request = firstDisplayableRequest(requestMessage?.body) ?? execution.source_requirements[0] ?? execution.title;
  const isBusy = busyMissionStates.includes(execution.state);
  const terminal = execution.state === "complete" || execution.state === "failed" || execution.state === "blocked" || execution.state === "cancelled";
  // A read-only Q&A turn is recorded as a complete mission whose whole content is the
  // answer text in `summary` (no timeline, no files). Its real content is a voice line,
  // not a "Done" terminal block.
  const isPlainAnswer =
    execution.state === "complete" && !execution.timeline.length && !(execution.plan ?? []).length && !execution.files_touched.length && Boolean(execution.summary);
  const groups = isPlainAnswer
    ? [{ id: `answer-${execution.id}`, voice: execution.summary, voiceTimestamp: execution.updated_at, events: [] }]
    : groupTimeline(execution.timeline);

  return {
    id: execution.id,
    request,
    requestedAt: execution.created_at,
    state: execution.state,
    stateLabel: missionStateLabel(execution),
    tier: tierOf(execution),
    groups,
    phases: phasesOf(execution.plan ?? []),
    blocking: isActive ? blockingOf(execution, mission, factoryResult) : undefined,
    summary: terminal && !isPlainAnswer ? summaryOf(execution) : undefined,
    outcome: outcomeOf(execution),
    isBusy,
    updatedAt: execution.updated_at,
  };
}

/**
 * The long brief for a brand-new project is a structured document ("Mode: …\nProject
 * description: …"); the user message shown on the canvas should be the human ask inside
 * it, not the whole memo. Follow-ups pass through untouched.
 */
function firstDisplayableRequest(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const description = body.match(/^Project description:\s*(.+)$/im)?.[1]?.trim();
  if (description && /^(Mode|Create Project):/im.test(body)) return description;
  const instructions = body.match(/^Custom instructions:\s*(.+)$/im)?.[1]?.trim();
  if (instructions && /^(Mode|Create Project):/im.test(body) && !/^none\b/i.test(instructions)) return instructions;
  const project = body.match(/^Create Project:\s*(.+)$/im)?.[1]?.trim();
  if (project) return `Build ${project}`;
  return body;
}

/** §4 blocking derivation, strict precedence: approval outranks questions. */
function blockingOf(execution: ExecutionMission, mission: MissionState, factoryResult: FactoryProjectResult | null): CanvasBlocking | undefined {
  if (execution.state === "waiting_for_approval") {
    const event = approvalEventFromMission(execution, execution.timeline, factoryResult);
    if (event) return { kind: "approval", event };
  }

  if (execution.state === "waiting_for_user") {
    if (factoryResult?.status === "needs-clarification" && factoryResult.clarificationQuestions?.length) {
      const [first, ...rest] = factoryResult.clarificationQuestions;
      return { kind: "question", question: first.question, options: first.options ?? [], queue: rest, source: "clarification-questions" };
    }
    if (execution.pending_mock_review) {
      return {
        kind: "question",
        question: execution.pending_mock_review.message,
        options: ["Looks good — continue building"],
        queue: [],
        source: "mock-review",
      };
    }
  }

  if (mission.pendingClarification) {
    return {
      kind: "question",
      question: mission.pendingClarification.question,
      options: mission.pendingClarification.options ?? [],
      queue: [],
      source: "pending-clarification",
    };
  }

  return undefined;
}

/**
 * Packages a blocking-card answer into the exact task string the engine expects for
 * that pause. The user's click/typed text becomes a real message through the normal
 * send path — resuming the same mission, never forking a new one.
 */
export function answerTaskFor(
  blocking: Extract<CanvasBlocking, { kind: "question" }>,
  answers: Array<{ question: string; answer: string }>,
  pendingClarification: PendingClarification | undefined,
): string {
  if (blocking.source === "pending-clarification" && pendingClarification) {
    const answer = answers[0]?.answer ?? "";
    return `${answer}\n\n(This answers your question — "${pendingClarification.question}" — about my earlier request: ${pendingClarification.originalTask})`;
  }
  if (blocking.source === "clarification-questions") {
    return [
      "Resolved project decisions:",
      ...answers.map((item) => `- ${item.question}\n  Answer: ${item.answer}`),
      "Continue the same mission using these decisions and carry the existing plan through implementation and verification.",
    ].join("\n");
  }
  return answers[0]?.answer ?? "";
}

/** All questions a single blocking card must collect before answering (multi-question clarifications). */
export function questionQueueOf(blocking: Extract<CanvasBlocking, { kind: "question" }>): MissionClarification[] {
  return [{ question: blocking.question, options: blocking.options.length ? blocking.options : undefined }, ...blocking.queue];
}

/** §9: terminal block built only from recorded evidence. */
function summaryOf(execution: ExecutionMission): CanvasSummary {
  const heading = execution.state === "complete" ? "Done" : execution.state === "cancelled" ? "Stopped" : execution.state === "blocked" ? "Blocked" : "Failed";

  const whatChanged: CanvasSummaryLine[] = execution.files_touched.slice(0, 5).map((file) => ({
    // The detailed diff remains attached to the evidence event and opens on click. Rendering it
    // inline here can turn a successful one-file build into thousands of characters of raw HTML,
    // crowding out the actual outcome and live preview.
    text: `${file.status === "created" ? "created" : "edited"} ${file.path}`,
    evidenceEventIds: execution.timeline.filter((event) => !event.internal && event.filePath === file.path).map((event) => event.id),
  }));

  // Verification can be reported by more than one layer (for example, completion
  // and browser validation). The terminal handoff is a concise account of distinct
  // evidence, not a raw event log.
  const verified = uniqueEvidence(execution.verification.filter((item) => item.result === "pass").map((item) => item.evidence));
  const failedChecks = uniqueEvidence(execution.verification.filter((item) => item.result === "fail").map((item) => item.evidence));

  const watchFor: string[] = [];
  if (execution.blocked_reason) watchFor.push(execution.blocked_reason);
  execution.timeline
    .filter((event) => !event.internal && event.tier === "flag" && event.kind !== "blocked" && event.status !== "running")
    .slice(-3)
    .forEach((event) => {
      const text = (event.rationale || event.title).trim();
      if (text && !watchFor.includes(text)) watchFor.push(text);
    });

  const started = Date.parse(execution.created_at);
  const ended = Date.parse(execution.updated_at);
  const elapsedMs = Number.isFinite(started) && Number.isFinite(ended) && ended > started ? ended - started : undefined;

  return { heading, verificationStatus: execution.verification_status, whatChanged, verified, failedChecks, watchFor, elapsedMs };
}

function uniqueEvidence(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const normalized = item.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * Canonical pending-approval event. Current executors persist one blocked event; older
 * saved missions emitted warnings instead — recover the exact action from the persisted
 * blocker so a refresh repairs the card rather than locking the user out. (Relocated
 * from BuildDashboard.tsx with the canvas rebuild; same recovery behavior.)
 */
export function approvalEventFromMission(
  mission: ExecutionMission | undefined,
  timeline: FactoryExecutionEvent[],
  execution: FactoryProjectResult | null,
): FactoryExecutionEvent | undefined {
  const approval = mission ? pendingApprovalOf(mission) : undefined;
  if (!approval) return approvalEventFromExecution(timeline, execution);
  const recorded = timeline.find((event) => event.id === approval.id)
    ?? [...timeline].reverse().find((event) => event.kind === "blocked" && event.command === approval.command);
  if (recorded) return recorded;
  return {
    id: approval.id,
    timestamp: approval.requestedAt,
    tier: "flag" as const,
    kind: "blocked" as const,
    status: "warning" as const,
    title: `Permission needed: ${approval.command}`,
    command: approval.command,
    output: approval.reason,
    details: { reason: approval.reason, category: approval.category },
  };
}

function approvalEventFromExecution(timeline: FactoryExecutionEvent[], execution: FactoryProjectResult | null): FactoryExecutionEvent | undefined {
  const canonical = timeline.filter((event) => event.kind === "blocked" && event.command).at(-1);
  if (canonical) return canonical;
  if (execution?.status !== "awaiting-approval") return undefined;

  const permissionEvidence = timeline
    .filter((event) => event.status === "warning" && /^Permission needed:/i.test(event.title))
    .at(-1);
  const blocker = execution.blocker ?? "Waiting for your approval.";
  const blockerAction = blocker.match(/to\s+(run|write|delete):\s*(.+)$/i);
  const titleAction = permissionEvidence?.title.match(/^Permission needed:\s*(.+)$/i)?.[1]?.trim();
  const command = blockerAction
    ? `${blockerAction[1].toLowerCase() === "run" ? "" : `${blockerAction[1].toLowerCase()} `}${blockerAction[2].trim()}`
    : titleAction;
  if (!command) return undefined;

  return {
    id: `recovered-approval-${permissionEvidence?.id ?? "legacy"}`,
    timestamp: permissionEvidence?.timestamp ?? new Date().toISOString(),
    tier: "flag",
    kind: "blocked",
    status: "warning",
    title: `Permission needed: ${command}`,
    command,
    details: {
      reason: (permissionEvidence?.details?.reason as string | undefined) ?? blocker,
      category: (permissionEvidence?.details?.category as string | undefined) ?? "unrecognized",
    },
  };
}
