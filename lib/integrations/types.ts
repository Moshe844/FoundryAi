/** Registry ids are deliberately open: integration packs and project profiles add providers at runtime. */
export type IntegrationId = string;

export type CredentialField = {
  key: string;
  label: string;
  env: string[];
  required: boolean;
  secret: boolean;
  placeholder?: string;
};

export type IntegrationDefinition = {
  id: IntegrationId;
  name: string;
  category: string;
  pack: string;
  auth: AuthenticationMethod;
  authenticationMethods: AuthenticationMethod[];
  preferredAuthenticationMethod: AuthenticationMethod;
  oauthProvider?: "google" | "microsoft" | "github" | "slack";
  fields: CredentialField[];
  packages: string[];
  imports: string[];
  sourcePatterns: string[];
  configFiles: string[];
  conventions: string[];
  help: string;
  deploymentMappings: Record<string, string>;
  troubleshooting: string[];
  maturity: "metadata" | "setup" | "adapter";
  executionKind?: "credential"|"hardware";
  localAgentTest?: boolean;
  hostingDeploymentWriter?: boolean;
  certification?: IntegrationCertification;
};

export type AuthenticationMethod = "oauth" | "oidc" | "api-key" | "access-token" | "refresh-token" | "service-account" | "connection-string" | "username-password" | "app-password" | "certificate" | "ssh-key" | "webhook-secret" | "signed-credential" | "workload-identity" | "local-provider" | "none";
export type IntegrationCertificationCheck = "credential" | "connection" | "failure" | "recovery" | "security" | "functional";
export type IntegrationCertification = { checks: Partial<Record<IntegrationCertificationCheck, { passedAt: string; suite: string }>>; certifiedAt?: string };
export type IntegrationSupportLevel = "Cataloged"|"Detected"|"Guided setup"|"Credentials validated"|"Runtime executable"|"Sandbox E2E validated"|"Hardware validated"|"Production certified";
export type ServiceCatalogState = "detected" | "configuration-required" | "credentials-required" | "connected" | "partially-configured" | "verification-failed" | "credential-expired" | "credential-revoked" | "disabled" | "not-used" | "unsupported" | "unknown-integration";
export type IntegrationPack = { id:string; name:string; version:string; enabled:boolean; source:"core"|"bundled"|"project"; integrations:IntegrationDefinition[] };

export type DetectionEvidence = { kind: "dependency" | "lockfile" | "import" | "source" | "config" | "environment" | "convention" | "docker" | "ci" | "deployment" | "infrastructure" | "runtime" | "unknown-package"; value: string; path?: string };
export type DetectedIntegration = { definition: IntegrationDefinition; evidence: DetectionEvidence[]; required: boolean; missingEnvironment: string[]; state: ServiceCatalogState; confidence:number; used:boolean };
export type CredentialScope = { userId: string; workspaceId: string; projectId: string; environment: string; provider: IntegrationId; location: "local" | "cloud" };
export type CredentialStatus = "configured" | "missing" | "expired" | "revoked" | "failed" | "unverified";
export type CredentialSummary = { provider: IntegrationId; scope: CredentialScope; status: CredentialStatus; fields: Record<string, string>; createdAt: string; updatedAt: string; lastVerifiedAt?: string; error?: string };
