import type { FactoryBuildStatus } from "@/lib/factory/types";
import type { ExecutionMissionState, ExecutionMissionVerification, ExecutionMissionVerificationStatus } from "@/lib/mission-engine";

/**
 * Single source of truth for a mission's state and verification status. Both server (after
 * verifyCompletion()) and client must call this instead of independently re-deriving either value —
 * that duplication is what let the UI show contradictory states for the same mission.
 */
export function computeMissionState(input: {
  rawStatus: FactoryBuildStatus;
  blocker?: string;
  verification: ExecutionMissionVerification[];
}): { state: ExecutionMissionState; verification_status: ExecutionMissionVerificationStatus } {
  const { rawStatus, blocker, verification } = input;
  const verificationStatus = verificationStatusFrom(verification);

  // A pending approval is a hard pause, checked before anything else — nothing about verification
  // evidence should ever be able to override it.
  if (rawStatus === "awaiting-approval") return { state: "waiting_for_approval", verification_status: verificationStatus };
  if (rawStatus === "needs-clarification" || rawStatus === "awaiting-mock-approval") return { state: "waiting_for_user", verification_status: verificationStatus };
  if (rawStatus === "stopped") return { state: "cancelled", verification_status: verificationStatus };
  if (rawStatus === "failed" || rawStatus === "unsupported") {
    return { state: blocker ? "blocked" : "failed", verification_status: verificationStatus };
  }
  if (rawStatus === "passed") {
    // "complete" is computed, never asserted: only real when there is at least one passing
    // verification entry and nothing contradicts it. No evidence at all still renders as
    // "Complete (unverified)", never plain "Complete".
    return { state: "complete", verification_status: verification.length ? verificationStatus : "unverified" };
  }
  if (rawStatus === "running" || rawStatus === "created") return { state: "executing", verification_status: verificationStatus };
  return { state: "idle", verification_status: verificationStatus };
}

/** Summarizes a verification array into pass/fail/none, with no notion of mission state — used both by computeMissionState() and to backfill legacy persisted records that predate the verification_status field. */
export function verificationStatusFrom(verification: ExecutionMissionVerification[]): ExecutionMissionVerificationStatus {
  if (verification.some((item) => item.result === "fail")) return "failed";
  if (verification.some((item) => item.result === "pass")) return "passed";
  return "none";
}
