import { describe, expect, it } from "vitest";
import { executionIdempotencyKey, planFingerprint, plannerRecoveryAttempts } from "./planner-recovery-policy";

const request = {
  objective: "Update app",
  localPath: "/project",
  operations: [
    { id: "read", kind: "read_file" as const, title: "Read", target: "app.ts", dependsOn: [] },
    { id: "write", kind: "write_file" as const, title: "Write", target: "app.ts", input: { content: "export const ok = true;" }, dependsOn: ["read"] },
  ],
};

describe("planner recovery policy", () => {
  it("keeps recovery bounded and avoids premium tiers by default", () => {
    const attempts = plannerRecoveryAttempts("builder", { maxPaidCalls: 3, maxTotalOutputTokens: 18000, allowPremiumEscalation: false });
    expect(attempts).toHaveLength(3);
    expect(attempts.map((attempt) => attempt.tier)).toEqual(["builder", "architect", "architect"]);
    expect(attempts.reduce((sum, attempt) => sum + attempt.maxOutputTokens, 0)).toBeLessThanOrEqual(18000);
    expect(attempts.some((attempt) => attempt.tier === "enterprise-architect" || attempt.tier === "super-reasoning")).toBe(false);
  });

  it("creates stable fingerprints for semantically identical plans", () => {
    const first = planFingerprint(request);
    const second = planFingerprint({ ...request, operations: request.operations.map((operation) => ({ ...operation })) });
    expect(second).toBe(first);
  });

  it("uses control ids as the strongest duplicate-execution key", () => {
    expect(executionIdempotencyKey({ controlId: "control-1", projectIdentity: "project", task: "edit" })).toBe("control:control-1");
    expect(executionIdempotencyKey({ projectIdentity: "project", task: "  Edit   app " }))
      .toBe(executionIdempotencyKey({ projectIdentity: "project", task: "edit app" }));
  });
});
