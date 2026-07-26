import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  activeRequirements,
  isFinalStatus,
  type LedgerRequirement,
  type RequirementLedger,
} from "@/lib/ai/mission/requirement-ledger";

/**
 * Durable staging for a large specification.
 *
 * A specification too big for one execution window has to be divided into stages that survive the
 * window boundary, and picking the work back up requires knowing which stages finished, which one is
 * current, what is still pending, and the exact next action. The failure this prevents is the user
 * having to resend their original specification because Foundry lost track of it.
 *
 * Deliberately, this module stores only two things: the verbatim specification and the stage
 * structure. Everything dynamic is derived at read time — statuses from the Requirement Ledger,
 * decisions and changed files from the Execution Journal. Copying those into a third store would
 * create a second version of the truth that drifts, and a stage marked complete next to a requirement
 * still marked open is worse than no staging at all.
 */

export type StageStatus = "pending" | "in-progress" | "complete" | "blocked";

export type MissionStage = {
  id: string;
  /** 1-based position in the implementation sequence. */
  ordinal: number;
  title: string;
  /** Ledger requirement ids this stage delivers. */
  requirementIds: string[];
  /** The checks that prove this stage, carried over from each requirement's own verification plan. */
  verificationPlan: string[];
};

export type MissionStagePlan = {
  missionId: string;
  /**
   * The complete request, stored exactly as received. This is the copy that makes resending
   * unnecessary, so it is never summarized, trimmed, or regenerated.
   */
  specification: string;
  stages: MissionStage[];
  /**
   * Every execution that has worked on this specification, oldest first. A specification spanning
   * several windows has journal evidence filed under each of their ids, so resuming needs all of them
   * to see what was already done.
   */
  executionIds: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Requirements a stage cannot exceed before the work is split again.
 *
 * This is a capacity bound on one execution window, not a judgment about the request. It is generous
 * enough that ordinary multi-part work stays in a single stage, and low enough that a long
 * specification is divided before it runs out of room mid-implementation.
 */
export const DEFAULT_MAX_REQUIREMENTS_PER_STAGE = 8;

/**
 * Build the implementation sequence from the ledger's declared dependencies.
 *
 * Stages are dependency layers: everything with no unmet prerequisite can be worked together, then
 * everything that depended only on that, and so on. The ordering is structural — it comes from what
 * the requirements say about each other, so no model call and no assumed vocabulary is involved.
 */
export function buildStagePlan(input: {
  missionId: string;
  specification: string;
  ledger: RequirementLedger;
  maxRequirementsPerStage?: number;
  executionIds?: string[];
}): MissionStagePlan {
  const now = new Date().toISOString();
  const requirements = activeRequirements(input.ledger);
  const limit = Math.max(1, input.maxRequirementsPerStage ?? DEFAULT_MAX_REQUIREMENTS_PER_STAGE);
  const layers = dependencyLayers(requirements);

  const stages: MissionStage[] = [];
  for (const layer of layers) {
    for (let offset = 0; offset < layer.length; offset += limit) {
      const slice = layer.slice(offset, offset + limit);
      const ordinal = stages.length + 1;
      stages.push({
        id: `stage-${ordinal}`,
        ordinal,
        title: stageTitle(slice),
        requirementIds: slice.map((requirement) => requirement.id),
        verificationPlan: slice
          .map((requirement) => requirement.verification?.trim())
          .filter((check): check is string => Boolean(check)),
      });
    }
  }

  return { missionId: input.missionId, specification: input.specification, stages, executionIds: input.executionIds ?? [], createdAt: now, updatedAt: now };
}

/**
 * Dependency layers, with every requirement guaranteed to appear exactly once.
 *
 * A model-declared dependency graph can contain a cycle or point at a requirement that was never
 * extracted. Neither may cost a requirement its place in the plan — when no further progress can be
 * made, whatever is left is emitted as one final layer rather than being silently dropped.
 */
function dependencyLayers(requirements: LedgerRequirement[]): LedgerRequirement[][] {
  const known = new Set(requirements.map((requirement) => requirement.id));
  const remaining = new Map(requirements.map((requirement) => [requirement.id, requirement] as const));
  const placed = new Set<string>();
  const layers: LedgerRequirement[][] = [];

  while (remaining.size) {
    const layer = [...remaining.values()].filter((requirement) => requirement.dependsOn
      // A dependency on something that does not exist in this ledger cannot be waited for.
      .filter((id) => known.has(id) && id !== requirement.id)
      .every((id) => placed.has(id)));

    if (!layer.length) {
      // Cyclic or otherwise unsatisfiable: keep the remainder together instead of losing it.
      layers.push([...remaining.values()]);
      break;
    }

    for (const requirement of layer) {
      placed.add(requirement.id);
      remaining.delete(requirement.id);
    }
    layers.push(layer);
  }

  return layers;
}

function stageTitle(requirements: LedgerRequirement[]): string {
  const [first, ...rest] = requirements;
  if (!first) return "Empty stage";
  return rest.length ? `${first.text} (+${rest.length} more)` : first.text;
}

export type StageProgress = {
  stage: MissionStage;
  status: StageStatus;
  requirements: LedgerRequirement[];
  finalized: number;
  /** Requirements in this stage that still need work. */
  outstanding: LedgerRequirement[];
  /**
   * Requirements that have a final answer but that answer is "could not be done". They are finalized,
   * so they never hold the ledger open — but a stage carrying one has not been completed either, and
   * calling it complete would report a wall as a finish line.
   */
  blocked: LedgerRequirement[];
};

export type StagePlanProgress = {
  stages: StageProgress[];
  completed: StageProgress[];
  /** The stage work should continue in, or undefined when every stage is finished. */
  current?: StageProgress;
  pending: StageProgress[];
  /** The precise instruction a resumed execution window should act on. */
  nextExactAction: string;
};

/**
 * Where the mission stands, derived from the ledger rather than stored alongside it.
 *
 * A stage is complete only when every requirement in it has a final status, which means stage
 * progress inherits the ledger's refusal to count written-but-unchecked work as done.
 */
export function stagePlanProgress(plan: MissionStagePlan, ledger: RequirementLedger): StagePlanProgress {
  const byId = new Map(ledger.requirements.map((requirement) => [requirement.id, requirement] as const));

  const stages: StageProgress[] = plan.stages.map((stage) => {
    const requirements = stage.requirementIds
      .map((id) => byId.get(id))
      .filter((requirement): requirement is LedgerRequirement => Boolean(requirement));
    const outstanding = requirements.filter((requirement) => !isFinalStatus(requirement.status));
    const blocked = requirements.filter((requirement) => requirement.status === "blocked");
    const finalized = requirements.length - outstanding.length;

    const status: StageStatus = outstanding.length
      // Nothing has started yet only when every remaining requirement is still merely identified and
      // nothing in the stage has been finalized either.
      ? (!finalized && outstanding.every((requirement) => requirement.status === "identified") ? "pending" : "in-progress")
      : blocked.length
        ? "blocked"
        : requirements.length
          ? "complete"
          : "pending";

    return { stage, status, requirements, finalized, outstanding, blocked };
  });

  const completed = stages.filter((entry) => entry.status === "complete");
  // Sequence order decides where the mission stands, so the current stage is simply the first one that
  // is not finished. A blocked stage stays current: that is the exact point work stopped, and skipping
  // past it would report progress the mission has not made.
  const current = stages.find((entry) => entry.status !== "complete");
  const pending = stages.filter((entry) => entry !== current && entry.status !== "complete");

  return { stages, completed, current, pending, nextExactAction: nextExactAction(stages, current) };
}

function nextExactAction(stages: StageProgress[], current: StageProgress | undefined): string {
  if (!stages.length) return "No staged plan exists for this mission; work the request directly.";
  if (!current) return "Every stage is finished. Report the outcome — do not start new work.";

  const position = `stage ${current.stage.ordinal} of ${stages.length}`;
  const target = current.outstanding[0];

  if (!target) {
    const blocker = current.blocked[0];
    return blocker
      ? `${position} (${current.stage.title}) is blocked on "${blocker.text}": ${blocker.statusDetail} Resolve that before continuing.`
      : `Verify and close ${position} (${current.stage.title}).`;
  }
  if (target.status === "implemented") {
    return `In ${position}, verify "${target.text}"${target.verification ? ` by checking: ${target.verification}` : ""}.`;
  }
  return `In ${position}, implement "${target.text}"${target.verification ? `, then prove it by checking: ${target.verification}` : ""}.`;
}

/**
 * The mission's durable context as the model sees it on resume.
 *
 * The specification is included verbatim and first: a continuation window that has lost the original
 * request will reconstruct a plausible one instead, and building a plausible request is precisely the
 * scope loss this staging exists to prevent.
 */
export function formatStagePlanForModel(plan: MissionStagePlan, ledger: RequirementLedger): string {
  const progress = stagePlanProgress(plan, ledger);

  const stageLines = progress.stages.map((entry) => {
    const marker = entry === progress.current ? "→" : entry.status === "complete" ? "✓" : " ";
    return `${marker} Stage ${entry.stage.ordinal}/${progress.stages.length} [${entry.status}] ${entry.stage.title} — ${entry.finalized}/${entry.requirements.length} finalized`;
  });

  const currentDetail = progress.current
    ? [
      `Current stage ${progress.current.stage.ordinal} outstanding requirements:`,
      ...progress.current.outstanding.map((requirement) => `- (${requirement.status}) ${requirement.text}${requirement.verification ? ` — proof required: ${requirement.verification}` : ""}`),
    ].join("\n")
    : "No stage is outstanding.";

  return [
    "Authoritative specification for this mission (complete and verbatim — never work from a summary of it):",
    plan.specification,
    "",
    "Staged implementation sequence:",
    ...stageLines,
    "",
    currentDetail,
    "",
    `Next exact action: ${progress.nextExactAction}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

const plansRoot = path.join(process.cwd(), ".foundry-data", "mission-stages");

function planPathFor(missionId: string) {
  const cleanId = missionId.replace(/[^a-zA-Z0-9-]/g, "_") || "mission";
  return path.join(plansRoot, `${cleanId}.json`);
}

export async function saveStagePlan(plan: MissionStagePlan): Promise<void> {
  const filePath = planPathFor(plan.missionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  // Write-then-rename: a plan truncated by a crash would read back as a shorter specification and
  // fewer stages, which is the exact scope loss this file exists to prevent.
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ ...plan, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  await rename(temporaryPath, filePath);
}

export async function loadStagePlan(missionId: string): Promise<MissionStagePlan | undefined> {
  const filePath = planPathFor(missionId);
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<MissionStagePlan>;
    if (!parsed.missionId || !Array.isArray(parsed.stages) || typeof parsed.specification !== "string") return undefined;
    return {
      missionId: parsed.missionId,
      specification: parsed.specification,
      stages: parsed.stages,
      executionIds: Array.isArray(parsed.executionIds) ? parsed.executionIds.filter((id): id is string => typeof id === "string") : [],
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}
