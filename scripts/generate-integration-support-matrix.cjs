const fs = require("node:fs");
const path = require("node:path");

const endpoint = process.env.FOUNDRY_URL || "http://127.0.0.1:3001";
const output = path.join(process.cwd(), "docs", "integration-support-matrix.md");
const FULL = "✅ Fully implemented";
const PARTIAL = "⚠ Partially implemented";
const NONE = "❌ Not implemented";

function statusFor(definition) {
  const adapter = definition.maturity === "adapter";
  const credentialAdapter = adapter && definition.executionKind !== "hardware";
  const fields = definition.fields || [];
  const hasCredentials = fields.length > 0;
  const oauth = Boolean(definition.oauthProvider) || definition.preferredAuthenticationMethod === "oauth" || definition.preferredAuthenticationMethod === "oidc";
  const apiKey = definition.preferredAuthenticationMethod === "api-key";
  const appPassword = definition.preferredAuthenticationMethod === "app-password";
  return {
    detection: adapter ? FULL : PARTIAL,
    environment: hasCredentials ? (adapter ? FULL : PARTIAL) : NONE,
    guidedSetup: adapter ? FULL : PARTIAL,
    oauth: oauth ? (definition.oauthProvider ? FULL : PARTIAL) : NONE,
    apiKey: apiKey ? (adapter ? FULL : PARTIAL) : NONE,
    appPassword: appPassword ? (adapter ? FULL : PARTIAL) : NONE,
    connection: credentialAdapter ? FULL : definition.executionKind === "hardware" ? PARTIAL : NONE,
    runtime: credentialAdapter && hasCredentials ? FULL : adapter ? PARTIAL : hasCredentials ? PARTIAL : NONE,
    secretManagement: hasCredentials ? (adapter ? FULL : PARTIAL) : NONE,
    deployment: hasCredentials ? PARTIAL : NONE,
    local: adapter ? FULL : PARTIAL,
    cloud: credentialAdapter && hasCredentials ? FULL : hasCredentials ? PARTIAL : NONE,
    browser: adapter ? FULL : PARTIAL,
    localAgent: definition.localAgentTest ? FULL : NONE,
    tests: adapter ? PARTIAL : NONE,
    live: NONE,
    certification: definition.certification?.certifiedAt ? FULL : NONE,
  };
}

async function main() {
  const response = await fetch(`${endpoint}/api/integrations/catalog`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Catalog request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  const integrations = payload.integrations || [];
  const full = integrations.filter((item) => item.certification?.certifiedAt).length;
  const partial = integrations.filter((item) => item.maturity === "adapter" && !item.certification?.certifiedAt).length;
  const metadata = integrations.filter((item) => item.maturity === "metadata").length;
  const executableCredentials = integrations.filter((item) => item.executionKind === "credential").length;
  const hardwareDiagnostics = integrations.filter((item) => item.executionKind === "hardware").length;
  const rows = integrations
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((item) => {
      const s = statusFor(item);
      return `| ${item.name.replaceAll("|", "\\|")} | ${item.id} | ${item.pack} | ${s.detection} | ${s.environment} | ${s.guidedSetup} | ${s.oauth} | ${s.apiKey} | ${s.appPassword} | ${s.connection} | ${s.runtime} | ${s.secretManagement} | ${s.deployment} | ${s.local} | ${s.cloud} | ${s.browser} | ${s.localAgent} | ${s.tests} | ${s.live} | ${s.certification} |`;
    });
  const report = `# Foundry Integration Support Matrix

Generated from the running registry and the current implementation on 2026-07-21. This report describes implemented behavior, not architectural potential.

## Totals

| Measure | Count |
| --- | ---: |
| Total integrations in catalog | ${integrations.length} |
| Fully implemented and certified | ${full} |
| Partially implemented adapters | ${partial} |
| Executable credential adapters | ${executableCredentials} |
| Payment hardware diagnostic families | ${hardwareDiagnostics} |
| Sandbox E2E validated | 0 |
| Hardware validated | 0 |
| Production certified | 0 |
| Metadata only | ${metadata} |

“Fully implemented” requires a completed certification record. The current registry contains no certification records, so the fully implemented count is zero.

## Evidence rules

- **Detection:** ✅ only for hand-authored adapter definitions; generated metadata rules are ⚠.
- **Environment variables:** ✅ only for hand-authored adapter schemas; generated/inferred schemas are ⚠. Integrations without credential variables are ❌ for this capability.
- **Guided setup/browser setup:** ✅ for executable adapters using the real setup UI; generic metadata profiles are ⚠.
- **OAuth:** ✅ only for the implemented Google, Microsoft, GitHub, and Slack OAuth routes. Metadata declaring OAuth/OIDC is ⚠.
- **Connection testing:** ✅ where an executable credential adapter performs an authenticated provider request, SDK identity operation, or database query. Hardware diagnostics remain ⚠ until a device is present.
- **Runtime support:** ✅ for executable credential adapters because verified, exactly scoped credentials are injected into owned local and Local Agent preview processes. Metadata profiles are ⚠ because they have no executable provider adapter.
- **Deployment:** ⚠ for credential adapters: permission-gated Vercel and Netlify writers are implemented, but other hosting targets remain unavailable.
- **Cloud:** ✅ for executable credential adapters through the authenticated remote encrypted-vault API; metadata profiles remain ⚠.
- **Local Agent:** ✅ only when the registry declares an implemented Local Agent provider probe or payment-device diagnostic.
- **Automated tests:** ⚠ only where the current test files contain integration-specific detection or mocked connection evidence. No provider has a complete certification suite.
- **Live end-to-end:** ❌ for every integration. The UI has been live-validated, but no real provider credential was used to complete a provider-side functional workflow.
- **Certification:** ✅ only when all credential, connection, failure, recovery, security, and functional checks have recorded passing evidence. None currently do.

## Complete matrix

| Integration | Registry ID | Pack | Detection | Env detection | Guided setup | OAuth | API key | App password | Connection test | Runtime | Secret management | Deployment | Local | Cloud | Browser setup | Local Agent | Automated tests | Live E2E | Certification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

## Implementation evidence

- Registry/catalog: \`lib/integrations/catalog.ts\`, \`lib/integrations/ecosystem.ts\`, \`lib/integrations/registry.ts\`
- Detection: \`lib/integrations/detection.ts\`
- Executable adapter registration: \`lib/integrations/adapter-registry.ts\`
- Provider connection branches: \`lib/integrations/adapters.ts\`
- OAuth: \`lib/integrations/oauth.ts\` and \`app/api/integrations/oauth/*\`
- Secret storage and scoping: \`lib/integrations/secret-store.ts\`, \`lib/integrations/manager.ts\`
- Deployment abstraction: \`app/api/integrations/deployment/route.ts\`
- Setup UI: \`components/integrations/CredentialsSettings.tsx\`
- Automated evidence: \`lib/integrations/*.test.ts\`
- Certification gate: \`lib/integrations/certification.ts\`
`;
  fs.writeFileSync(output, report, "utf8");
  console.log(JSON.stringify({ output, total: integrations.length, full, partial, metadata }));
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

module.exports = { statusFor };
