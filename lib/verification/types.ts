export type VerificationStage =
  | "structure"
  | "dependencies"
  | "configuration"
  | "format"
  | "lint"
  | "typecheck"
  | "compile"
  | "build"
  | "unit-test"
  | "integration-test"
  | "smoke-test"
  | "security"
  | "startup"
  | "health"
  | "live-validation"
  | "regression"
  | "disk";

export type VerificationCommand = {
  id: string;
  stage: VerificationStage;
  command: string;
  required: boolean;
  source: string;
  longRunning?: boolean;
};

export type ProjectEvidence = {
  rootEntries: string[];
  files: Record<string, string | undefined>;
  platform: "win32" | "linux" | "darwin";
};

export type EcosystemAdapter = {
  id: string;
  label: string;
  detect(evidence: ProjectEvidence): number;
  buildProfile(evidence: ProjectEvidence): Omit<VerificationProfile, "adapterId" | "ecosystem" | "detectedFrom">;
};

export type VerificationProfile = {
  adapterId: string;
  ecosystem: string;
  detectedFrom: string[];
  packageManager?: string;
  commands: VerificationCommand[];
  preview?: { command: string; expectedUrl?: string };
  limitations: string[];
};

export type VerificationStatus = "verified" | "partially-verified" | "not-verified";

export type VerificationReport = {
  status: VerificationStatus;
  passed: VerificationCommand[];
  failed: VerificationCommand[];
  skipped: VerificationCommand[];
  limitations: string[];
};
