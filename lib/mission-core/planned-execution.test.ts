import { describe, expect, it } from "vitest";
import { executionFailureEvidence } from "./planned-execution";
import type { MissionRecord } from "./model";

function failedMission(): MissionRecord {
  const now = new Date().toISOString();
  return {
    id: "mission-1",
    projectId: "project-1",
    objective: "Build the app",
    status: "failed",
    revision: 4,
    createdAt: now,
    updatedAt: now,
    blocker: "Build failed",
    requirements: [],
    approvals: [],
    verification: [],
    journal: [],
    operations: [{
      id: "build",
      missionId: "mission-1",
      kind: "verify",
      title: "Run production build",
      command: "npm run build",
      dependsOn: [],
      requirementIds: [],
      risk: "development",
      status: "failed",
      attempt: 1,
      maxAttempts: 2,
      createdAt: now,
      updatedAt: now,
      result: {
        summary: "Build failed with exit code 1.",
        evidence: ["npm run build", "exit:1"],
        error: "A use server file can only export async functions, found object.",
        completedAt: now,
      },
    }],
  };
}

describe("execution repair evidence", () => {
  it("carries the exact failed command diagnostic into the next plan", () => {
    const evidence = executionFailureEvidence(failedMission());
    expect(evidence).toContain("Run production build");
    expect(evidence).toContain("npm run build");
    expect(evidence).toContain("use server file can only export async functions");
  });
});
