import type { ModelTier } from "@/lib/ai/model-router";
import { extractRequirements, type OpenQuestion } from "@/lib/ai/mission/requirement-extraction";
import {
  assessCompletion,
  createLedger,
  type LedgerRequirement,
  type RequirementLedger,
} from "@/lib/ai/mission/requirement-ledger";
import { loadRequirementLedger, saveRequirementLedger } from "@/lib/ai/mission/requirement-ledger-store";
import { buildStagePlan, formatStagePlanForModel, loadStagePlan, saveStagePlan, stagePlanProgress, type MissionStagePlan } from "@/lib/ai/mission/mission-stages";
import { reconcileRequirements, type MissionEvidence } from "@/lib/ai/mission/requirement-reconciliation";
import { journalDigest } from "@/lib/factory/execution-journal";
import type { ProviderId } from "@/lib/ai/providers/types";

/**
 * The mission-facing entry points for requirement accounting: open a ledger when the request is
 * understood, close it against the evidence before a verdict is reported.
 *
 * Both mission paths — new project creation and work on an existing project — go through here, so the
 * rule about when the ledger may change a verdict is written once instead of drifting between two
 * copies.
 */

export type OpenedLedger = {
  ledger: RequirementLedger;
  /**
   * Whether this ledger is trustworthy enough to change a mission's verdict. False when requirements
   * came from the degraded deterministic split, which cannot see constraints or exclusions and would
   * fail missions over requirements it never understood in the first place.
   */
  gating: boolean;
  requirementCount: number;
  openQuestions: OpenQuestion[];
  /**
   * Contradictions only. The mission must stop and ask about these, because guessing could deliver the
   * opposite of what the user asked for. Undecided details stay out — they are recorded, then inferred.
   */
  blockingQuestions: string[];
  /** The staged implementation sequence, with the specification preserved verbatim inside it. */
  plan: MissionStagePlan;
  /**
   * The specification, stage position and next exact action, ready to append to the executor's task.
   * This is what makes a continuation window pick up where the last one stopped instead of
   * reconstructing a plausible version of the request.
   */
  missionContext: string;
  /** How many stages the work was divided into. */
  stageCount: number;
  note?: string;
};

export async function openRequirementLedger(input: {
  /**
   * The mission *thread* this specification belongs to — stable across execution windows, so a
   * continuation finds the ledger the previous window left behind. A per-run id would create a fresh
   * ledger on every turn and make resuming impossible.
   */
  missionId: string;
  /** This single run. Recorded on the plan so journal evidence from every window can be found later. */
  executionId: string;
  /** Where the Execution Journal for this thread lives, used to recover progress from a lost window. */
  projectId?: string;
  request: string;
  /**
   * Whether the caller has established that this turn continues existing work. Only a continuation may
   * resume a stored ledger; an unrelated new request must never inherit another specification's
   * requirements.
   */
  continuation?: boolean;
  apiKey: string;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
  tier?: ModelTier;
  attachments?: Array<{ fileName: string; excerpt: string }>;
}): Promise<OpenedLedger | undefined> {
  try {
    const resumed = input.continuation ? await resumeLedger(input) : undefined;
    if (resumed) return resumed;

    const extraction = await extractRequirements({
      request: input.request,
      apiKey: input.apiKey,
      provider: input.provider,
      workspaceId: input.workspaceId,
      userId: input.userId,
      tier: input.tier,
      attachments: input.attachments,
    });
    if (!extraction.requirements.length) return undefined;

    const ledger = createLedger(input.missionId, extraction.requirements);
    const plan = buildStagePlan({
      missionId: input.missionId,
      specification: input.request,
      ledger,
      executionIds: [input.executionId],
    });
    await Promise.all([saveRequirementLedger(ledger), saveStagePlan(plan)]);
    return {
      ledger,
      gating: extraction.source === "model",
      requirementCount: assessCompletion(ledger).total,
      openQuestions: extraction.openQuestions,
      blockingQuestions: extraction.openQuestions.filter((item) => item.kind === "contradiction").map((item) => item.question),
      plan,
      missionContext: formatStagePlanForModel(plan, ledger),
      stageCount: plan.stages.length,
      note: extraction.note,
    };
  } catch {
    // Requirement accounting is a safeguard over the mission, not the mission itself. If it cannot
    // start, the mission still runs — it simply loses this particular protection, and the caller
    // reports no requirement accounting rather than a false all-clear.
    return undefined;
  }
}

/**
 * Pick a specification back up where the last window left it.
 *
 * Two things have to be recovered. The specification and stage sequence come straight off disk — the
 * stored plan holds the approved contract, and rebuilding it from this turn's text would replace that
 * contract with whatever the user just typed. Progress is the harder half: requirement statuses are
 * written when a mission closes, so a window that died mid-implementation left a ledger claiming
 * nothing was done next to a journal full of files it demonstrably wrote. Reconciling against that
 * journal is what stops a resumed mission from starting the finished work over.
 *
 * Returns undefined when there is nothing to resume, or when the stored ledger is already fully
 * finalized — a settled contract must not silently absorb a new request's requirements.
 */
async function resumeLedger(input: {
  missionId: string;
  executionId: string;
  projectId?: string;
  request: string;
  apiKey: string;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
  tier?: ModelTier;
}): Promise<OpenedLedger | undefined> {
  const stored = await loadRequirementLedger(input.missionId);
  if (!stored?.requirements.length) return undefined;
  if (assessCompletion(stored).complete) return undefined;

  const storedPlan = await loadStagePlan(input.missionId);
  const plan: MissionStagePlan = {
    ...(storedPlan ?? buildStagePlan({ missionId: input.missionId, specification: input.request, ledger: stored })),
    executionIds: [...new Set([...(storedPlan?.executionIds ?? []), input.executionId])],
  };

  let ledger = stored;
  let recovered = "";

  if (input.projectId && plan.executionIds.length > 1) {
    // Only worth a call when a previous window actually recorded something. The digest is scoped to
    // this specification's own executions so unrelated project history cannot be read as progress.
    const digest = await journalDigest(input.projectId, { missionIds: plan.executionIds });
    if (!digest.empty && (digest.filesChanged.length || digest.commands.length)) {
      const reconciliation = await reconcileRequirements({
        ledger: stored,
        request: plan.specification,
        evidence: {
          changedFiles: digest.filesChanged.map((file) => file.filePath),
          commands: digest.commands,
          verification: [],
          checklist: [],
          complianceSummary: digest.decisions.map((decision) => `${decision.title}: ${decision.rationale}`).join("\n") || undefined,
          blocker: digest.blockers.join("\n") || undefined,
        },
        apiKey: input.apiKey,
        provider: input.provider,
        workspaceId: input.workspaceId,
        userId: input.userId,
        tier: input.tier,
      });
      if (reconciliation.source === "model") {
        ledger = reconciliation.ledger;
        const closed = assessCompletion(ledger);
        recovered = ` Recovered progress from ${plan.executionIds.length - 1} earlier window(s): ${closed.finalized}/${closed.total} requirement(s) already finalized.`;
      }
    }
  }

  await Promise.all([saveRequirementLedger(ledger), saveStagePlan(plan)]);
  return {
    ledger,
    gating: true,
    requirementCount: assessCompletion(ledger).total,
    openQuestions: [],
    // A resumed specification was already understood in an earlier window; re-asking a question the
    // user has moved past would stall the continuation they just requested.
    blockingQuestions: [],
    plan,
    missionContext: formatStagePlanForModel(plan, ledger),
    stageCount: plan.stages.length,
    note: `Resumed the stored specification and staged plan for this mission.${recovered} ${stagePlanProgress(plan, ledger).nextExactAction}`,
  };
}

export type RequirementGate =
  /** No usable mapping — the ledger says nothing about this mission's completeness either way. */
  | { outcome: "unchecked"; note: string }
  /** Every requirement has a final status. */
  | { outcome: "satisfied"; ledger: RequirementLedger; summary: string; unrequested: string[] }
  /** Everything was attempted, but some results are unproven. Honest completion, with warnings. */
  | { outcome: "unproven"; ledger: RequirementLedger; unverified: LedgerRequirement[]; warning: string; unrequested: string[] }
  /** Requirements the mission never reached. Reporting this as done would be false. */
  | { outcome: "unmet"; ledger: RequirementLedger; unattempted: LedgerRequirement[]; blocker: string; unrequested: string[] };

export async function closeRequirementLedger(input: {
  opened: OpenedLedger;
  request: string;
  evidence: MissionEvidence;
  apiKey: string;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
  tier?: ModelTier;
}): Promise<RequirementGate> {
  try {
    const reconciliation = await reconcileRequirements({
      ledger: input.opened.ledger,
      request: input.request,
      evidence: input.evidence,
      apiKey: input.apiKey,
      provider: input.provider,
      workspaceId: input.workspaceId,
      userId: input.userId,
      tier: input.tier,
    });
    await saveRequirementLedger(reconciliation.ledger);

    if (reconciliation.source === "unavailable") {
      return { outcome: "unchecked", note: reconciliation.note ?? "Requirement-level completion was not checked." };
    }
    if (!input.opened.gating) {
      return {
        outcome: "unchecked",
        note: "Requirements were only split mechanically for this mission, so they were recorded but not used to judge completion.",
      };
    }

    const completion = assessCompletion(reconciliation.ledger);
    if (reconciliation.unattempted.length) {
      return {
        outcome: "unmet",
        ledger: reconciliation.ledger,
        unattempted: reconciliation.unattempted,
        unrequested: reconciliation.unrequested,
        blocker: `${reconciliation.unattempted.length} of ${completion.total} requested item(s) were not addressed: ${reconciliation.unattempted.map((requirement) => requirement.text).join("; ")}. Everything else is preserved — tell me to continue and I will pick up from these.`,
      };
    }
    if (reconciliation.unverified.length) {
      return {
        outcome: "unproven",
        ledger: reconciliation.ledger,
        unverified: reconciliation.unverified,
        unrequested: reconciliation.unrequested,
        warning: `Implemented but not independently proven: ${reconciliation.unverified.map((requirement) => requirement.text).join("; ")}.`,
      };
    }
    return {
      outcome: "satisfied",
      ledger: reconciliation.ledger,
      unrequested: reconciliation.unrequested,
      summary: `All ${completion.total} requested item(s) are accounted for with recorded evidence.`,
    };
  } catch {
    return { outcome: "unchecked", note: "Requirement-level completion could not be checked for this mission." };
  }
}
