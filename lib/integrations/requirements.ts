import { integrationCatalog } from "@/lib/integrations/catalog";
import type { IntegrationDefinition } from "@/lib/integrations/types";

export type IntegrationRequirement = {
  id: string;
  category: string;
  reason: string;
  candidates: IntegrationDefinition[];
};

const credentialBacked = (definition: IntegrationDefinition) =>
  definition.maturity === "adapter"
  && definition.executionKind !== "hardware"
  && definition.auth !== "none"
  && definition.auth !== "local-provider"
  && (definition.auth === "oauth" || definition.auth === "oidc" || definition.fields.some((field) => field.secret));

const externallyRequired = (definition: IntegrationDefinition) => credentialBacked(definition)
  || (definition.maturity === "adapter" && definition.executionKind === "hardware");

const genericCapabilities: Array<{ id: string; category: string; pattern: RegExp; reason: string; candidateIds?: string[] }> = [
  { id: "transactional-email", category: "email", pattern: /\b(?:transactional email|send emails?|email delivery|forgot|reset)\s+(?:my\s+)?password\b|\b(?:email verification|verify (?:an? )?email|magic[- ]link)\b/i, reason: "The requested workflow must deliver email." },
  { id: "payments", category: "payments", pattern: /\b(?:accept|process|take|collect)\s+payments?\b|\b(?:checkout|subscription billing|payment gateway|card payments?)\b/i, reason: "The project must authenticate with a payment processor." },
  { id: "sms", category: "communications", pattern: /\b(?:send|deliver)\s+(?:an?\s+)?(?:sms|text messages?)\b|\b(?:sms verification|phone verification|otp by (?:sms|text))\b/i, reason: "The requested workflow must deliver SMS messages.", candidateIds: ["twilio", "vonage", "telnyx", "plivo"] },
  { id: "ai-provider", category: "ai", pattern: /\b(?:llm|generative ai|ai assistant|chatbot|text generation|image generation|embeddings?)\b/i, reason: "The project requires a hosted AI model provider.", candidateIds: ["openai", "anthropic", "gemini"] },
  { id: "authentication", category: "authentication", pattern: /\b(?:user authentication|sign[ -]?in|log[ -]?in|sign[ -]?up|single sign-on|sso|saml|openid connect|social login|identity provider)\b/i, reason: "The project needs a real identity and session provider." },
  { id: "push-notifications", category: "communications", pattern: /\b(?:push notifications?|mobile notifications?|notification delivery)\b/i, reason: "The requested workflow must deliver push notifications.", candidateIds: ["firebase-cloud-messaging", "onesignal"] },
  { id: "hosted-database", category: "relational-database", pattern: /\b(?:hosted|cloud|shared|production)\s+(?:sql\s+)?database\b|\bmulti-device sync\b/i, reason: "The application requires a remotely reachable shared data store." },
  { id: "cloud-platform", category: "cloud", pattern: /\b(?:deploy|host|run)\s+(?:it\s+)?(?:on|in)\s+(?:the\s+)?cloud\b|\bcloud infrastructure\b/i, reason: "The project requires a cloud runtime and deployment identity." },
  { id: "monitoring", category: "monitoring", pattern: /\b(?:crash reporting|error monitoring|application monitoring|observability|production alerts?)\b/i, reason: "The project requires an external monitoring service." },
  { id: "source-control", category: "source-control", pattern: /\b(?:connect|sync|publish)\s+(?:to\s+)?(?:a\s+)?(?:git repository|source control)\b/i, reason: "The workflow needs authenticated source-control access." },
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function explicitlyExcluded(text: string, definition: IntegrationDefinition) {
  const names = [definition.name, definition.id].map(normalize).filter((name) => name.length > 2);
  return names.some((name) => new RegExp(`\\b(?:no|without|do not use|don't use)\\s+${name.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
}

function explicitlyNames(text: string, definition: IntegrationDefinition) {
  const normalizedText = normalize(text);
  const names = [definition.name, definition.id, ...definition.packages]
    .map(normalize)
    .filter((name) => name.length >= 3 && !/^(?:api|sdk|mail|email|auth|cloud)$/.test(name));
  if (names.some((name) => new RegExp(`(?:^|\\s)${name.replace(/\s+/g, "\\s+")}(?:$|\\s)`, "i").test(normalizedText))) return true;
  return definition.fields.flatMap((field) => field.env).some((name) => new RegExp(`\\b${name}\\b`, "i").test(text));
}

function candidatesForCategory(category: string, candidateIds?: string[]) {
  return integrationCatalog.filter((definition) => credentialBacked(definition)
    && (candidateIds ? candidateIds.includes(definition.id) : definition.category === category));
}

/** Infers only externally credentialed services. Local databases, libraries, and SDK-only tooling
 * stay in the normal toolchain preflight and never trigger a secret prompt. */
export function integrationRequirementsForBrief(text: string): IntegrationRequirement[] {
  const requirements = new Map<string, IntegrationRequirement>();
  for (const definition of integrationCatalog.filter(externallyRequired)) {
    if (definition.executionKind === "hardware" && /\b(?:simulator[- ]only|use (?:a )?simulator instead|build (?:a )?(?:simulated|mock) (?:terminal|device)|mock hardware|without (?:a )?(?:terminal|device))\b/i.test(text)) continue;
    if (!explicitlyExcluded(text, definition) && explicitlyNames(text, definition)) {
      requirements.set(`provider:${definition.id}`, {
        id: `provider:${definition.id}`,
        category: definition.category,
        reason: `The brief explicitly requires ${definition.name}.`,
        candidates: [definition],
      });
    }
  }
  for (const capability of genericCapabilities) {
    // A terminal SDK determines which processor/middleware routes are actually supported. Do not
    // guess Stripe/PayPal/etc. from the word "checkout" before inspecting the licensed hardware
    // package and specifications; named processor requirements are already preserved above.
    if (capability.id === "payments" && [...requirements.values()].some((requirement) => requirement.candidates.some((candidate) => candidate.executionKind === "hardware"))) continue;
    if (!capability.pattern.test(text) || new RegExp(`\\b(?:no|without)\\s+(?:${capability.id.replace(/-/g, "|")})\\b`, "i").test(text)) continue;
    const candidates = candidatesForCategory(capability.category, capability.candidateIds);
    if (!candidates.length) continue;
    const alreadyCovered = [...requirements.values()].some((requirement) => requirement.candidates.some((candidate) => candidates.some((item) => item.id === candidate.id)));
    if (!alreadyCovered) requirements.set(capability.id, { ...capability, candidates });
  }
  return [...requirements.values()];
}

export function missingIntegrationRequirements(requirements: IntegrationRequirement[], verifiedProviders: string[]) {
  const verified = new Set(verifiedProviders);
  return requirements.filter((requirement) => !requirement.candidates.some((candidate) => verified.has(candidate.id)));
}

/** Finds hardware providers backed by actual imported SDK/specification evidence. A workflow
 * answer alone is intentionally insufficient; callers pass file paths/names or supplied content. */
export function integrationProvidersFromEvidence(requirements: IntegrationRequirement[], evidenceItems: string[]) {
  const evidence = evidenceItems.map(normalize).filter(Boolean);
  return requirements
    .flatMap((requirement) => requirement.candidates)
    .filter((candidate) => candidate.executionKind === "hardware" && evidence.some((item) =>
      [candidate.id, candidate.name, ...candidate.packages, ...candidate.sourcePatterns]
        .map(normalize)
        .some((term) => term.length >= 3 && item.includes(term))))
    .map((candidate) => candidate.id)
    .filter((id, index, all) => all.indexOf(id) === index);
}

export function integrationRequirementPrompt(requirement: IntegrationRequirement) {
  const hardware = requirement.candidates.find((candidate) => candidate.executionKind === "hardware");
  if (hardware) return {
    question: `${requirement.reason} Foundry needs to inspect the licensed ${hardware.name} SDK/specifications and run a Local Agent hardware diagnostic before it can claim device execution. Select the existing SDK folder or upload its ZIP/AAR/JAR and documentation; Foundry will derive supported processor and middleware routes from that evidence instead of guessing. A simulator-only build remains explicitly unvalidated on hardware.`,
    options: ["Locate SDK files with Local Agent", "Upload SDK or specification files", `Connect Local Agent and ${hardware.name} device`, "Build simulator-only mode"],
  };
  const candidates = requirement.candidates.slice(0, 6);
  const choices = candidates.map((candidate) => `${candidate.name} — ${candidate.preferredAuthenticationMethod.replace(/-/g, " ")}`);
  return {
    question: `${requirement.reason} Connect and verify one provider in Settings → Credentials & Integrations before Foundry builds the dependent behavior. Secrets remain scoped to this project and environment.`,
    options: choices.length ? choices : ["Open Credentials & Integrations"],
  };
}
