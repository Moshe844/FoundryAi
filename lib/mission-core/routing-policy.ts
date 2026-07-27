export type IntelligenceTier = "fast" | "builder" | "architect" | "enterprise-architect" | "super-reasoning";
export type ExecutionDepth = "quick" | "standard" | "thorough" | "production";

export type MissionAssessment = {
  expectedFiles: number;
  expectedSubsystems: number;
  ambiguity: number;
  difficulty: number;
  risk: number;
  visualOutcome: boolean;
  releaseCritical: boolean;
  repeatedFailureCount: number;
  readOnly: boolean;
};

export type RoutingPolicyDecision = {
  intelligence: IntelligenceTier;
  depth: ExecutionDepth;
  reasons: string[];
};

export function chooseRoutingPolicy(assessment: MissionAssessment): RoutingPolicyDecision {
  const reasons: string[] = [];
  let intelligence: IntelligenceTier = "builder";
  let depth: ExecutionDepth = "standard";

  const tiny = assessment.expectedFiles <= 2 && assessment.expectedSubsystems === 1 && assessment.difficulty <= 0.35 && assessment.risk <= 0.25 && assessment.ambiguity <= 0.35;
  const architectural = assessment.expectedSubsystems >= 3 || assessment.difficulty >= 0.72 || assessment.risk >= 0.58 || assessment.ambiguity >= 0.7;
  const broad = assessment.expectedFiles >= 15 || assessment.expectedSubsystems >= 4;
  const critical = assessment.risk >= 0.82 && assessment.difficulty >= 0.82 && (assessment.repeatedFailureCount >= 2 || broad);

  if (critical) { intelligence = "super-reasoning"; reasons.push("critical risk and difficult failure evidence"); }
  else if (broad && architectural) { intelligence = "enterprise-architect"; reasons.push("broad multi-subsystem architecture work"); }
  else if (architectural || assessment.repeatedFailureCount > 0) { intelligence = "architect"; reasons.push("material architecture, ambiguity, risk, or failure evidence"); }
  else if (tiny) { intelligence = "fast"; reasons.push("bounded low-risk working set"); }
  else reasons.push("normal implementation complexity");

  if (assessment.releaseCritical || assessment.risk >= 0.75) { depth = "production"; reasons.push("release-critical or high-risk outcome needs production evidence"); }
  else if (assessment.visualOutcome || assessment.repeatedFailureCount > 0 || assessment.difficulty >= 0.65) { depth = "thorough"; reasons.push("behavioral or repeated-failure verification required"); }
  else if (tiny || assessment.readOnly) { depth = "quick"; reasons.push("small or read-only outcome needs bounded verification"); }

  return { intelligence, depth, reasons };
}
