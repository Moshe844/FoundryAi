export const supportLevels = [0, 1, 2, 3, 4] as const;
export type SupportLevel = (typeof supportLevels)[number];
export type Platform = "web" | "api" | "android" | "ios" | "windows" | "macos" | "linux" | "game" | "cli";
export type Risk = "low" | "medium" | "high";

export type ProductCapabilities = {
  multiUser: boolean; authentication: boolean; roleBasedAccess: boolean; relationalData: boolean;
  offlineMode: boolean; realTime: boolean; barcodeScanning: boolean; camera: boolean; bluetooth: boolean;
  nfc: boolean; notifications: boolean; payments: boolean; reporting: boolean; fileUploads: boolean;
  auditHistory: boolean; backgroundJobs: boolean; threeDimensional: boolean;
};

export type ProductProfile = {
  projectFamily: string;
  projectSubtype: string;
  primaryUsers: string[];
  platforms: Record<Platform, boolean>;
  capabilities: ProductCapabilities;
  scale: "small" | "medium" | "large";
  securityRisk: Risk;
  dataSensitivity: Risk;
  deploymentPreference: "local" | "managed-cloud" | "self-hosted" | "unspecified";
  existingTechnologyConstraints: string[];
  userPreferences: string[];
  ambiguities: string[];
  confidence: number;
  sourceEvidence: string[];
};

export type StackOperations = {
  create: boolean; inspect: boolean; edit: boolean; install: boolean; run: boolean; build: boolean;
  test: boolean; lint: boolean; debug: boolean; preview: boolean; package: boolean; export: boolean; deploy: boolean;
};

export type StackManifest = {
  stackId: string;
  version: number;
  displayName: string;
  status: "recognized" | "editable" | "buildable" | "provisional" | "certified";
  supportLevel: SupportLevel;
  supportedPlatforms: Platform[];
  bestFor: string[];
  avoidFor: string[];
  requiredCapabilities: string[];
  supportedProjectFamilies: string[];
  toolchain: { required: string[]; optional: string[] };
  operations: StackOperations;
  commands: { install: string[]; development: string[]; build: string[]; test: string[]; lint: string[]; package: string[] };
  artifacts: string[];
  supportedDatabases: string[];
  supportedAuth: string[];
  supportedDeploymentTargets: string[];
  knownLimitations: string[];
  traits: string[];
  certification: { testSuiteVersion: string; lastPassedAt: string; environment: string[]; passRate: number };
};

export type EnvironmentCapabilities = {
  os: "windows" | "macos" | "linux" | "unknown";
  availableToolchains: string[];
  unavailableToolchains: string[];
  remoteMacBuilder: boolean;
};
export type ExecutionReadinessState = "ready_local" | "installable_by_foundry" | "requires_user_license" | "requires_remote_builder" | "export_ready" | "unavailable";

export type StackEnvironmentStatus = {
  stackId: string;
  state: ExecutionReadinessState;
  readyOperations: Array<keyof StackOperations>;
  deferredOperations: Array<keyof StackOperations>;
  missingToolchains: string[];
  plainLanguage: string;
  actions: Array<"install_for_me" | "connect_mac" | "use_cloud_build" | "export_project" | "show_remaining_steps" | "open_license_setup">;
  remoteBuilder?: { platform: "macos" | "windows" | "linux"; connected: boolean; label: string };
};

export type ScoreBreakdown = {
  architecturalFit: number; platformFit: number; featureFit: number; hardwareFit: number; offlineFit: number;
  dataFit: number; securityFit: number; deploymentFit: number; foundrySupport: number; environmentReadiness: number;
  maintainability: number; futureGrowth: number; userPreferenceFit: number; totalScore: number;
};

export type StackCandidate = { manifest: StackManifest; eligible: boolean; disqualifiers: string[]; scores: ScoreBreakdown };
export type StackRecommendation = {
  selectedStackId: string | null;
  selectedStack: StackManifest | null;
  alternatives: Array<{ stackId: string; displayName: string; score: number; limitations: string[] }>;
  reasons: string[];
  requirementsMatched: string[];
  tradeoffs: string[];
  limitations: string[];
  environmentRequirements: string[];
  confidence: number;
  candidates: StackCandidate[];
  question?: string;
};

export type TaxonomyEntry = {
  family: string; subtype: string; users: string[]; platforms: Platform[]; capabilities: Partial<ProductCapabilities>;
  integrations: string[]; securityRisk: Risk; offline: "unlikely" | "possible" | "likely"; hardware: string[];
  scale: "small" | "medium" | "large"; deployments: string[]; discoveryQuestions: string[];
  incompatibleAssumptions: string[]; architecturalTraits: string[]; keywords: string[];
};
