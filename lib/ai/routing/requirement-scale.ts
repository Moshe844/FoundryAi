import type { ModelTier } from "@/lib/ai/routing/types";

/**
 * Letting the Requirement Ledger correct the router's estimate of how big a build is.
 *
 * Routing happens before anything is built, so the tier is chosen from an estimate: the shape of the
 * request, a guess at how many files it will touch. That estimate is made without knowing what the
 * request actually contains.
 *
 * The ledger does know. By the time implementation starts it holds the extracted requirements — the
 * real, counted scope of the work. Observed live: a brief carrying eleven separate features routed as
 * an ordinary build, wrote most of an application in one pass, and then spent its entire remaining
 * budget repairing the type errors that came with writing that much at once. The estimate was wrong,
 * and the ledger had the correct number the whole time.
 *
 * This is deliberately one-directional. A ledger that counts few requirements says nothing about how
 * hard they are — a single requirement can be the hardest thing in a mission — so a small count never
 * lowers a tier that was chosen for some other reason. Only an undercount is corrected.
 */

const TIER_ORDER: ModelTier[] = ["fast", "builder", "architect", "enterprise-architect", "super-reasoning"];

/**
 * How many separate requirements make a mission architect-scale.
 *
 * Not a tuned number. It is the point at which a build stops being a feature and becomes an
 * application: enough distinct pieces that they have to agree with each other, which is the work that
 * a stronger model is actually better at.
 */
export const ARCHITECT_SCALE_REQUIREMENTS = 8;

export type RequirementScaleRouting = {
  tier: ModelTier;
  /** Whether the ledger's count moved the tier, so the decision can be reported rather than assumed. */
  raised: boolean;
  reason: string;
};

/**
 * The tier to implement at, given what the router chose and what the ledger counted.
 */
export function tierForRequirementScale(input: { estimatedTier: ModelTier; requirementCount: number }): RequirementScaleRouting {
  const { estimatedTier, requirementCount } = input;

  if (requirementCount < ARCHITECT_SCALE_REQUIREMENTS) {
    return { tier: estimatedTier, raised: false, reason: `${requirementCount} requirements is within what ${estimatedTier} handles well.` };
  }

  if (TIER_ORDER.indexOf(estimatedTier) >= TIER_ORDER.indexOf("architect")) {
    return { tier: estimatedTier, raised: false, reason: `Already routed at ${estimatedTier}, which is at or above the scale this count calls for.` };
  }

  return {
    tier: "architect",
    raised: true,
    reason: `The ledger counted ${requirementCount} separate requirements, which is an application rather than a feature; ${estimatedTier} was estimated before the request had been read.`,
  };
}
