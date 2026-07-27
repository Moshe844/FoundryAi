import type { ApprovalRequest, MissionRecord } from "./model";

export type DurableMissionView = {
  label: string;
  isBusy: boolean;
  isTerminal: boolean;
  blocker?: string;
  pendingApproval?: ApprovalRequest;
};

export function projectDurableMission(mission: MissionRecord | undefined): DurableMissionView | undefined {
  if (!mission) return undefined;
  const pendingApproval = mission.approvals.find((approval) => approval.status === "pending");
  const isBusy = ["understanding", "planned", "executing", "verifying", "repairing", "previewing"].includes(mission.status);
  const isTerminal = ["completed", "completed_with_warnings", "failed", "canceled"].includes(mission.status);
  return {
    label: labelForStatus(mission.status, pendingApproval),
    isBusy,
    isTerminal,
    blocker: mission.blocker,
    pendingApproval,
  };
}

export function latestDurableMission(missions: Record<string, MissionRecord>): MissionRecord | undefined {
  return Object.values(missions).sort((left, right) => {
    const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return updated || right.revision - left.revision;
  })[0];
}

function labelForStatus(status: MissionRecord["status"], pendingApproval?: ApprovalRequest) {
  if (pendingApproval) return "Waiting for approval";
  switch (status) {
    case "draft": return "Draft";
    case "understanding": return "Understanding request";
    case "awaiting_clarification": return "Waiting for clarification";
    case "planned": return "Plan ready";
    case "awaiting_approval": return pendingApproval ? "Waiting for approval" : "Blocked: approval request unavailable";
    case "executing": return "Working";
    case "verifying": return "Verifying";
    case "repairing": return "Repairing";
    case "previewing": return "Preparing preview";
    case "completed": return "Complete";
    case "completed_with_warnings": return "Complete with warnings";
    case "blocked": return "Blocked";
    case "failed": return "Failed";
    case "canceled": return "Canceled";
  }
}
