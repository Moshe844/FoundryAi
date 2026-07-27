import { createHash } from "node:crypto";
import type { MissionRecord, PlannedOperation } from "./model";

export type FailureRecord = {
  fingerprint: string;
  missionId: string;
  operationId: string;
  attemptNumber: number;
  evidence: string[];
  strategiesTried: string[];
  terminal: boolean;
};

export type RecoveryDecision =
  | { action: "retry"; strategy: string; delayMs: number }
  | { action: "await_approval"; reason: string }
  | { action: "block"; reason: string };

export class RecoveryCoordinator {
  private readonly failures = new Map<string, FailureRecord>();

  record(mission: MissionRecord, operation: PlannedOperation, evidence: string[], strategy: string): FailureRecord {
    const fingerprint = failureFingerprint(operation, evidence);
    const prior = this.failures.get(fingerprint);
    const record: FailureRecord = {
      fingerprint,
      missionId: mission.id,
      operationId: operation.id,
      attemptNumber: (prior?.attemptNumber ?? 0) + 1,
      evidence: Array.from(new Set([...(prior?.evidence ?? []), ...evidence])),
      strategiesTried: Array.from(new Set([...(prior?.strategiesTried ?? []), strategy])),
      terminal: false,
    };
    this.failures.set(fingerprint, record);
    return structuredClone(record);
  }

  decide(operation: PlannedOperation, failure: FailureRecord, candidateStrategies: string[]): RecoveryDecision {
    if (operation.risk === "high_risk") {
      return { action: "await_approval", reason: "A high-risk operation failed and requires explicit approval before another strategy is attempted." };
    }
    if (failure.attemptNumber >= operation.maxAttempts) {
      return { action: "block", reason: `Operation ${operation.id} exhausted its recovery attempts.` };
    }
    const strategy = candidateStrategies.find((candidate) => !failure.strategiesTried.includes(candidate));
    if (!strategy) return { action: "block", reason: `No untried recovery strategy remains for ${operation.id}.` };
    return { action: "retry", strategy, delayMs: Math.min(2000, failure.attemptNumber * 250) };
  }

  markTerminal(fingerprint: string) {
    const current = this.failures.get(fingerprint);
    if (current) this.failures.set(fingerprint, { ...current, terminal: true });
  }

  snapshot() {
    return Array.from(this.failures.values()).map((entry) => structuredClone(entry));
  }
}

export function failureFingerprint(operation: PlannedOperation, evidence: string[]) {
  const stableEvidence = evidence.map((value) => value.replace(/\s+/g, " ").trim().toLowerCase()).sort().join("\n");
  return createHash("sha256")
    .update([operation.kind, operation.target ?? "", operation.command ?? "", stableEvidence].join("\n"))
    .digest("hex")
    .slice(0, 24);
}
