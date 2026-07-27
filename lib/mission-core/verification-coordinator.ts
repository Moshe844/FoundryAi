import type { MissionRecord, VerificationResult } from "./model";
import { allRequirementsSatisfied } from "./requirement-ledger";

export type VerificationProbe = {
  id: string;
  name: string;
  required: boolean;
  run: () => Promise<{ passed: boolean; summary: string; evidence?: string[]; warning?: boolean }>;
};

export type VerificationSummary = {
  passed: boolean;
  warnings: string[];
  failures: string[];
  results: VerificationResult[];
};

export class VerificationCoordinator {
  async verify(mission: MissionRecord, probes: VerificationProbe[]): Promise<VerificationSummary> {
    const results: VerificationResult[] = [];
    for (const probe of probes) {
      const createdAt = new Date().toISOString();
      try {
        const outcome = await probe.run();
        results.push({
          id: probe.id,
          missionId: mission.id,
          name: probe.name,
          status: outcome.passed ? (outcome.warning ? "warning" : "passed") : "failed",
          summary: outcome.summary,
          evidence: outcome.evidence ?? [],
          createdAt,
        });
      } catch (error) {
        results.push({
          id: probe.id,
          missionId: mission.id,
          name: probe.name,
          status: "failed",
          summary: error instanceof Error ? error.message : "Verification probe failed.",
          evidence: [],
          createdAt,
        });
      }
    }

    const requiredIds = new Set(probes.filter((probe) => probe.required).map((probe) => probe.id));
    const failures = results.filter((result) => requiredIds.has(result.id) && result.status === "failed").map((result) => result.summary);
    const warnings = results.filter((result) => result.status === "warning").map((result) => result.summary);
    if (!allRequirementsSatisfied({ ...mission, verification: [...mission.verification, ...results] })) {
      failures.push("One or more mission requirements remain open or blocked.");
    }
    return { passed: failures.length === 0, warnings, failures, results };
  }
}
