import type { MissionExecutorResult } from "@/lib/ai/mission/executor";
import { approvalScopeLabel } from "@/lib/ai/mission/command-permissions";
import type { ExecutionMissionApproval, ExecutionMissionCommandRun, ExecutionMissionFileTouch, MissionAction } from "@/lib/mission/reducer";

/**
 * The only place server vocabulary (MissionExecutorResult.status, lib/ai/mission/executor.ts) is
 * translated into canonical mission actions. No component or hook should read a MissionExecutorResult
 * directly — always go through here so there is exactly one mapping from the executor's 5 statuses to
 * the 12-state mission machine, instead of the ad-hoc re-derivation executionMissionFromResult()
 * (components/WorkspaceShell.tsx) does today.
 *
 * blockedStep (lib/ai/mission/executor.ts) is populated at all three awaiting-approval finalize()
 * call sites; the string-parsing fallback below only matters for results produced before that field
 * existed (e.g. cached/replayed data) and can be deleted once nothing depends on it anymore.
 */
export function actionsFromExecutorResult(threadId: string, missionId: string, result: MissionExecutorResult): MissionAction[] {
  const actions: MissionAction[] = [];

  for (const event of result.timeline) {
    actions.push({ type: "TIMELINE_APPENDED", threadId, missionId, event });
  }
  for (const command of result.commands) {
    const run: ExecutionMissionCommandRun = {
      ...command,
      approval_scope_label: approvalScopeLabel(command.approvalScope),
    };
    actions.push({ type: "COMMAND_RECORDED", threadId, missionId, run });
  }
  for (const path of result.changedFiles) {
    const touch: ExecutionMissionFileTouch = { path, verified: true, status: "edited" };
    actions.push({ type: "FILE_TOUCHED", threadId, missionId, touch });
  }
  if (result.verification.length) {
    const status = result.verification.some((item) => item.result === "fail")
      ? "failed"
      : result.verification.some((item) => item.result === "pass")
        ? "passed"
        : "none";
    actions.push({ type: "VERIFICATION_RECORDED", threadId, missionId, verification: result.verification, status });
  }

  switch (result.status) {
    case "passed":
      actions.push({ type: "MISSION_COMPLETED", threadId, missionId, summary: result.sessionSummary?.outcome ?? "Complete." });
      break;

    case "failed":
      actions.push({ type: "MISSION_FAILED", threadId, missionId, error: result.blocker ?? "The mission failed without a specific reason." });
      break;

    case "stopped":
      actions.push({ type: "MISSION_CANCELLED", threadId, missionId });
      break;

    case "awaiting-approval":
      actions.push({ type: "APPROVAL_REQUESTED", threadId, missionId, approval: approvalFromResult(result) });
      break;

    case "awaiting-mock-approval":
      actions.push({ type: "MISSION_STATUS_SET", threadId, missionId, status: "waiting_for_user" });
      break;

    default:
      break;
  }

  return actions;
}

function approvalFromResult(result: MissionExecutorResult): ExecutionMissionApproval {
  if (result.blockedStep) {
    return {
      id: `${Date.now()}`,
      command: result.blockedStep.target,
      category: (result.blockedStep.category as ExecutionMissionApproval["category"]) ?? "unrecognized",
      reason: result.blocker ?? `Waiting for your approval to ${result.blockedStep.kind}: ${result.blockedStep.target}`,
      requestedAt: new Date().toISOString(),
    };
  }
  const blocker = result.blocker ?? "Waiting for your approval.";
  const commandMatch = blocker.match(/to (?:run|write|delete):\s*(.+)$/i);
  return {
    id: `${Date.now()}`,
    command: commandMatch?.[1]?.trim() ?? blocker,
    category: "unrecognized",
    reason: blocker,
    requestedAt: new Date().toISOString(),
  };
}
