import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import {
  activeRequirements,
  recordOutcome,
  type LedgerRequirement,
  type RequirementEvidence,
  type RequirementEvidenceKind,
  type RequirementLedger,
} from "@/lib/ai/mission/requirement-ledger";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import { routingContext } from "@/lib/ai/routing/request-context";

/**
 * Reconciles the Requirement Ledger against what a mission actually did.
 *
 * A mission ends holding real evidence — files it wrote, commands it ran and their exit codes,
 * verification gates that passed or failed — but that evidence is organised by *check*, not by
 * *requirement*. Nothing in the pipeline could previously answer "which of the eight things the user
 * asked for does this evidence actually cover?", which is exactly how a mission delivering five of
 * eight reports Done.
 *
 * This is the mapping step. The model reads the evidence and says which requirement each piece
 * supports; the ledger's own guards decide what that permits Foundry to claim.
 */

export type MissionEvidence = {
  changedFiles: string[];
  /** exitCode is null for a command that was killed or never returned one. */
  commands: Array<{ command: string; exitCode?: number | null }>;
  verification: Array<{ checkType: string; result: string; evidence: string }>;
  checklist: Array<{ label: string; status: string; evidence?: string }>;
  /** Deterministic outcome-compliance summary, when one could be derived. */
  complianceSummary?: string;
  blocker?: string;
};

export type ReconciliationResult = {
  ledger: RequirementLedger;
  /** "unavailable" means no mapping was produced, so the ledger must not gate the mission's verdict. */
  source: "model" | "unavailable";
  /** Requirements the mission's own evidence does not touch at all. */
  unattempted: LedgerRequirement[];
  /** Requirements that were built but that nothing proved. */
  unverified: LedgerRequirement[];
  note?: string;
  usage?: RuntimeUsageRecord;
};

const RECONCILE_TOOL: NeutralTool = {
  name: "reconcile_requirements",
  description: "Assign each requirement the outcome that the mission's recorded evidence actually supports.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      outcomes: {
        type: "array",
        maxItems: 80,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", description: "The requirement id exactly as given." },
            outcome: {
              type: "string",
              enum: ["verified", "implemented", "blocked", "excluded", "not-attempted"],
              description: "verified: evidence proves it works. implemented: changed but nothing proves it. blocked: could not be done and the reason is recorded. excluded: deliberately not done. not-attempted: the evidence does not touch this requirement.",
            },
            evidence_kind: {
              type: "string",
              enum: ["file-change", "command", "compiler", "test", "browser", "screenshot", "user-confirmation"],
              description: "The kind of recorded evidence supporting this outcome. Omit meaning by choosing the closest kind only when evidence exists.",
            },
            evidence_detail: { type: "string", description: "The specific recorded evidence this outcome rests on. Quote it. Leave empty when there is none." },
            evidence_reference: { type: "string", description: "File path, command, or check name the evidence came from." },
          },
          required: ["id", "outcome", "evidence_detail"],
        },
      },
    },
    required: ["outcomes"],
  },
};

const RECONCILE_SYSTEM_PROMPT = [
  "You audit a finished software mission against the requirements it was given.",
  "For every requirement id you are shown, report the outcome that the recorded evidence actually supports.",
  "You are auditing, not advocating. Evidence that a file changed is not evidence that a requirement works.",
  "Use 'verified' only when a specific recorded check demonstrates the requirement is satisfied, and quote that check in evidence_detail.",
  "Use 'implemented' when the work plainly happened but no recorded check demonstrates the result.",
  "A passing typecheck or build proves the code compiles. On its own that is 'implemented', never 'verified'.",
  "Use 'not-attempted' when nothing in the evidence relates to the requirement. This is the expected answer for requirements the mission never reached — do not stretch unrelated evidence to cover them.",
  "Use 'blocked' only when the evidence records a concrete reason the requirement could not be done.",
  "Use 'excluded' only when the requirement was a deliberate non-goal.",
  "Constraints and exclusions are verified by evidence that the forbidden change did NOT happen. Absence of any relevant evidence is 'not-attempted', not 'verified'.",
  "Never invent evidence. An empty evidence_detail is the correct answer when there is none.",
  "Report every id you are given, exactly once.",
].join("\n");

export async function reconcileRequirements(input: {
  ledger: RequirementLedger;
  request: string;
  evidence: MissionEvidence;
  apiKey: string;
  tier?: ModelTier;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
}): Promise<ReconciliationResult> {
  const open = activeRequirements(input.ledger);
  if (!open.length) {
    return { ledger: input.ledger, source: "model", unattempted: [], unverified: [] };
  }

  const provider: ProviderId = input.provider ?? "openai";
  // One call per mission, at the moment a false "Done" would otherwise be sent. A cheaper tier saves
  // a fraction of a cent and buys back the exact failure this whole mechanism exists to prevent, so
  // the default is the balanced coding tier rather than the fastest one.
  const tier = input.tier ?? "builder";
  const { model, effort } = resolveModelForTier(tier, { provider });

  const result = await callManagedModel(
    {
      provider,
      model,
      effort: effort ?? "medium",
      system: [RECONCILE_SYSTEM_PROMPT, "Always call reconcile_requirements with your answer. Do not respond with plain text."].join("\n"),
      messages: [{ role: "user", content: [{ type: "text", text: [
        `Original request:\n${input.request}`,
        `Requirements to account for:\n${open.map((requirement) => `${requirement.id} [${requirement.kind}] ${requirement.text}`).join("\n")}`,
        formatEvidence(input.evidence),
      ].join("\n\n") }] }],
      tools: [RECONCILE_TOOL],
      toolChoice: "auto",
      maxOutputTokens: 2_000,
      routing: routingContext(input.request, "verify", tier, input.workspaceId),
    },
    { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 3 },
  );

  const call = result.toolCalls.find((item) => item.name === "reconcile_requirements");
  const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;
  const outcomes = Array.isArray(parsed?.outcomes) ? parsed.outcomes : [];

  if (!outcomes.length) {
    // Without a mapping, the ledger has nothing to say about this mission's completeness. Reporting
    // that honestly is required: a caller must not read silence as either success or failure.
    return {
      ledger: input.ledger,
      source: "unavailable",
      unattempted: [],
      unverified: [],
      note: result.errorMessage
        ? `Requirement reconciliation was unavailable (${result.errorMessage}); requirement-level completion was not checked.`
        : "Requirement reconciliation returned nothing usable; requirement-level completion was not checked.",
      usage: result.usage,
    };
  }

  const byId = new Map(outcomes.filter((item) => typeof item?.id === "string").map((item) => [String(item.id), item] as const));
  let ledger = input.ledger;
  const now = new Date().toISOString();

  for (const requirement of open) {
    const reported = byId.get(requirement.id);
    // A requirement the auditor skipped is not a requirement that passed. Silence maps to
    // not-attempted, which keeps it unresolved rather than letting an omission become a pass.
    const outcome = reported && isReportedOutcome(reported.outcome) ? reported.outcome : "not-attempted";
    const detail = typeof reported?.evidence_detail === "string" ? reported.evidence_detail.trim() : "";

    if (outcome === "not-attempted") continue;

    const evidence: RequirementEvidence[] = detail
      ? [{
        kind: isEvidenceKind(reported?.evidence_kind) ? reported.evidence_kind : "file-change",
        detail,
        reference: typeof reported?.evidence_reference === "string" && reported.evidence_reference.trim() ? reported.evidence_reference.trim() : undefined,
        recordedAt: now,
      }]
      : [];

    const applied = recordOutcome(ledger, requirement.id, outcome, detail || `Recorded as ${outcome} from the mission's evidence.`, evidence);
    if (applied.ok) ledger = applied.ledger;
  }

  const settled = activeRequirements(ledger);
  return {
    ledger,
    source: "model",
    unattempted: settled.filter((requirement) => requirement.status === "identified" || requirement.status === "planned"),
    unverified: settled.filter((requirement) => requirement.status === "implemented" || requirement.status === "in-progress"),
    usage: result.usage,
  };
}

function formatEvidence(evidence: MissionEvidence): string {
  const sections = [
    `Files changed (${evidence.changedFiles.length}):\n${evidence.changedFiles.slice(0, 60).map((file) => `- ${file}`).join("\n") || "- none"}`,
    `Commands run:\n${evidence.commands.slice(0, 40).map((command) => `- ${command.command} → exit ${command.exitCode ?? "unknown"}`).join("\n") || "- none"}`,
    `Verification gates:\n${evidence.verification.slice(0, 40).map((check) => `- ${check.checkType}: ${check.result} — ${truncate(check.evidence, 300)}`).join("\n") || "- none"}`,
    `Plan items:\n${evidence.checklist.slice(0, 40).map((item) => `- ${item.label}: ${item.status}${item.evidence ? ` — ${truncate(item.evidence, 200)}` : ""}`).join("\n") || "- none"}`,
  ];
  if (evidence.complianceSummary) sections.push(`Deterministic outcome check:\n${truncate(evidence.complianceSummary, 600)}`);
  if (evidence.blocker) sections.push(`Recorded blocker:\n${truncate(evidence.blocker, 600)}`);
  return `Recorded mission evidence:\n\n${sections.join("\n\n")}`;
}

type ReportedOutcome = "verified" | "implemented" | "blocked" | "excluded";

type ParsedReconciliation = {
  outcomes?: Array<{ id?: unknown; outcome?: unknown; evidence_kind?: unknown; evidence_detail?: unknown; evidence_reference?: unknown }>;
};

function isReportedOutcome(value: unknown): value is ReportedOutcome {
  return value === "verified" || value === "implemented" || value === "blocked" || value === "excluded";
}

function isEvidenceKind(value: unknown): value is RequirementEvidenceKind {
  return value === "file-change" || value === "command" || value === "compiler" || value === "test"
    || value === "browser" || value === "screenshot" || value === "user-confirmation";
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function safeJsonParse(value: string): ParsedReconciliation | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
