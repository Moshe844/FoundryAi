import type { VerificationCommand, VerificationProfile } from "@/lib/verification/types";

/**
 * Checking generated source while the batch that wrote it is still running.
 *
 * Verification used to happen only after a whole batch returned. That meant a batch could write ten
 * files introducing eight independent type errors, hand them all to a repair loop at once, and the loop
 * would fix them one paid call at a time — observed live, sixteen consecutive repairs, each one landing
 * on a genuinely different error, and the build still red when the budget ran out.
 *
 * Every one of those errors was cheap to fix at the moment it was written and expensive afterwards. The
 * model had the file in front of it, knew what it meant to write, and was three lines from the mistake.
 * By the time the batch ended it had moved on, and each repair had to rediscover the context first.
 *
 * So the gate moves inside the batch. Same evidence, same compiler, just asked while the answer is
 * still cheap.
 */

/**
 * The fastest command that proves the source is correct.
 *
 * Typecheck is preferred over build for one reason: it fails on the same errors and returns far sooner,
 * and this runs several times per batch. A compile is accepted when a stack has no separate typecheck,
 * and a full build only as a last resort — anything slower than that is not worth running mid-batch.
 */
export function inBatchCorrectnessGate(profile: VerificationProfile | undefined): VerificationCommand | undefined {
  if (!profile?.commands.length) return undefined;
  const usable = profile.commands.filter((command) => !command.longRunning);
  return usable.find((command) => command.stage === "typecheck")
    ?? usable.find((command) => command.stage === "compile")
    ?? usable.find((command) => command.stage === "build");
}

export type InBatchCheck = {
  /** Normalized identity of the failure, so a repeat is recognisable. */
  fingerprint: string;
  /** Whether the model changed anything in response to it. */
  addressed: boolean;
};

export type InBatchVerdict = {
  /** Whether to hand the failure back to the model rather than ending the batch. */
  repairInBatch: boolean;
  reason: string;
};

/**
 * Whether a failure is worth handing back inside the batch.
 *
 * The batch is the cheap place to fix things, not a place to get stuck. Handing the same unaddressed
 * failure back twice would be the retry loop this design exists to avoid, so the batch ends and the
 * mission's own repair stages take over with their larger budget and stronger models.
 */
export function shouldRepairInBatch(input: {
  checks: InBatchCheck[];
  currentFingerprint: string;
  maxChecks: number;
}): InBatchVerdict {
  const { checks, currentFingerprint, maxChecks } = input;

  if (checks.length >= maxChecks) {
    return { repairInBatch: false, reason: `The batch already corrected ${checks.length} failures; the remaining one goes to the mission's repair stages.` };
  }

  const previous = checks[checks.length - 1];
  if (previous && previous.fingerprint === currentFingerprint) {
    return { repairInBatch: false, reason: "The same failure survived an in-batch correction, so a stronger repair stage should take it." };
  }

  return { repairInBatch: true, reason: "The batch just wrote this code, so it is the cheapest place to correct it." };
}

/**
 * What the model is told about its own failure.
 *
 * Phrased as its own work to finish rather than a verdict on it: the batch is not over, nothing has
 * been rejected, and the fix is expected here rather than deferred to something else later.
 */
export function inBatchRepairNote(input: { command: string; diagnostic: string; attempt: number }): string {
  return [
    `The files you just wrote do not pass ${input.command}.`,
    input.attempt > 1 ? `This is correction ${input.attempt} in this batch.` : "",
    "Fix these errors now, in the files you just wrote, before writing anything else — you have them in front of you and this is far cheaper than repairing them later.",
    "Change only what the errors name; do not rewrite working files or start the next feature yet.",
    "",
    input.diagnostic,
  ].filter(Boolean).join(" ").replace(" \n", "\n");
}
