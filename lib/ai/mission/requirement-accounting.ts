import type { ModelTier } from "@/lib/ai/model-router";
import { extractRequirements } from "@/lib/ai/mission/requirement-extraction";
import {
  assessCompletion,
  createLedger,
  type LedgerRequirement,
  type RequirementLedger,
} from "@/lib/ai/mission/requirement-ledger";
import { loadRequirementLedger, saveRequirementLedger } from "@/lib/ai/mission/requirement-ledger-store";
import { reconcileRequirements, type MissionEvidence } from "@/lib/ai/mission/requirement-reconciliation";
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
  openQuestions: string[];
  note?: string;
};

export async function openRequirementLedger(input: {
  missionId: string;
  request: string;
  apiKey: string;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
  tier?: ModelTier;
  attachments?: Array<{ fileName: string; excerpt: string }>;
}): Promise<OpenedLedger | undefined> {
  try {
    // A resumed mission must not re-open its ledger from scratch: statuses and evidence already
    // recorded against a stage that finished are exactly what must survive into the next window.
    const existing = await loadRequirementLedger(input.missionId);
    if (existing?.requirements.length) {
      return {
        ledger: existing,
        gating: true,
        requirementCount: assessCompletion(existing).total,
        openQuestions: [],
        note: "Resumed the existing requirement ledger for this mission.",
      };
    }

    const extraction = await extractRequirements({
      request: input.request,
      apiKey: input.apiKey,
      provider: input.provider,
      workspaceId: input.workspaceId,
      userId: input.userId,
      tier: input.tier,
    });
    if (!extraction.requirements.length) return undefined;

    const ledger = createLedger(input.missionId, extraction.requirements);
    await saveRequirementLedger(ledger);
    return {
      ledger,
      gating: extraction.source === "model",
      requirementCount: assessCompletion(ledger).total,
      openQuestions: extraction.openQuestions,
      note: extraction.note,
    };
  } catch {
    // Requirement accounting is a safeguard over the mission, not the mission itself. If it cannot
    // start, the mission still runs — it simply loses this particular protection, and the caller
    // reports no requirement accounting rather than a false all-clear.
    return undefined;
  }
}

export type RequirementGate =
  /** No usable mapping — the ledger says nothing about this mission's completeness either way. */
  | { outcome: "unchecked"; note: string }
  /** Every requirement has a final status. */
  | { outcome: "satisfied"; ledger: RequirementLedger; summary: string }
  /** Everything was attempted, but some results are unproven. Honest completion, with warnings. */
  | { outcome: "unproven"; ledger: RequirementLedger; unverified: LedgerRequirement[]; warning: string }
  /** Requirements the mission never reached. Reporting this as done would be false. */
  | { outcome: "unmet"; ledger: RequirementLedger; unattempted: LedgerRequirement[]; blocker: string };

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
        blocker: `${reconciliation.unattempted.length} of ${completion.total} requested item(s) were not addressed: ${reconciliation.unattempted.map((requirement) => requirement.text).join("; ")}. Everything else is preserved — tell me to continue and I will pick up from these.`,
      };
    }
    if (reconciliation.unverified.length) {
      return {
        outcome: "unproven",
        ledger: reconciliation.ledger,
        unverified: reconciliation.unverified,
        warning: `Implemented but not independently proven: ${reconciliation.unverified.map((requirement) => requirement.text).join("; ")}.`,
      };
    }
    return {
      outcome: "satisfied",
      ledger: reconciliation.ledger,
      summary: `All ${completion.total} requested item(s) are accounted for with recorded evidence.`,
    };
  } catch {
    return { outcome: "unchecked", note: "Requirement-level completion could not be checked for this mission." };
  }
}
