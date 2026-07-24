import { explicitPersistenceFromPrompt, explicitStackFromPrompt, type ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import { taxonomyEntryFor } from "./taxonomy";
import type { Platform, ProductCapabilities, ProductProfile } from "./types";

const matches = (text: string, pattern: RegExp) => pattern.test(text);
const allPlatforms = (): Record<Platform, boolean> => ({ web:false, api:false, android:false, ios:false, windows:false, macos:false, linux:false, game:false, cli:false });

export function extractProductProfile(prompt: string, discovery?: ProjectDiscoveryResult): ProductProfile {
  // Only user-originated evidence may create architecture-changing requirements. Discovery features
  // and data-model suggestions are useful downstream design hints, but allowing them back into this
  // classifier made a model-invented dashboard/database self-confirm and escalated a marketing site
  // to Next.js + PostgreSQL. The project type may help taxonomy matching; capabilities come from the
  // user's prompt alone.
  const taxonomyText = [prompt, discovery?.projectType].filter(Boolean).join(" ").toLowerCase();
  const text = prompt.toLowerCase().replace(/\b(?:no|without|not|never)\s+(?:a\s+|an\s+|any\s+)?(?:login|authentication|auth|accounts?|database|backend|server|payments?)(?:\s+(?:or|and)\s+(?:a\s+|an\s+)?(?:login|authentication|auth|accounts?|database|backend|server|payments?))*/g, "");
  const taxonomy = taxonomyEntryFor(taxonomyText);
  const platforms = allPlatforms();
  for (const platform of taxonomy?.entry.platforms ?? ["web"]) platforms[platform] = true;
  if (matches(text, /\bandroid|rugged device|google play\b/)) platforms.android = true;
  if (matches(text, /\bios\b|iphone|ipad|apple platform/)) platforms.ios = true;
  if (matches(text, /\bwindows\b|wpf|winforms/)) platforms.windows = true;
  if (matches(text, /\bmacos\b|mac app/)) platforms.macos = true;
  if (matches(text, /\bapi\b|backend|webhook|microservice/)) platforms.api = true;
  if (matches(text, /\bgame\b|platformer|simulation/)) platforms.game = true;
  if (matches(text, /\bcli\b|command[- ]line/)) platforms.cli = true;
  if (matches(text, /\bweb\b|website|browser|dashboard|portal|saas|store|marketplace/)) platforms.web = true;
  if (platforms.ios && !matches(text, /\bandroid\b|both ios and android|cross[- ]platform/)) platforms.android = false;
  if (platforms.android && !matches(text, /\bios\b|iphone|ipad|both ios and android|cross[- ]platform/)) platforms.ios = false;
  if (platforms.api && !matches(text, /\bweb\b|website|browser|frontend|dashboard|portal/)) platforms.web = false;

  const capabilities: ProductCapabilities = {
    multiUser: matches(text, /multi[- ]user|team|staff|customer|employee|seller|admin/),
    authentication: matches(text, /auth|login|account|member|portal|saas/),
    roleBasedAccess: matches(text, /role|permission|admin|manager|staff/),
    relationalData: matches(text, /inventory|order|booking|billing|crm|erp|purchase|supplier|transaction|relational|postgres|sql/),
    offlineMode: matches(text, /offline|local[- ]first|without (?:a )?connection|sync queue/),
    realTime: matches(text, /real[- ]time|websocket|presence|live collaboration/),
    barcodeScanning: matches(text, /barcode|scanner|qr code/), camera: matches(text, /camera|photo|video/),
    bluetooth: matches(text, /bluetooth|ble\b/), nfc: matches(text, /\bnfc\b/),
    notifications: matches(text, /notification|push|alert/), payments: matches(text, /payment|checkout|billing|subscription|pos\b|merchant/),
    reporting: matches(text, /report|analytics|dashboard|kpi/), fileUploads: matches(text, /upload|document|media|file/),
    auditHistory: matches(text, /audit|history|transaction|inventory|payment/), backgroundJobs: matches(text, /background|scheduled|queue|worker|etl|pipeline/),
    threeDimensional: matches(text, /\b3d\b|vr\b|virtual showroom|advanced simulation/),
    ...taxonomy?.entry.capabilities,
  };
  const needsQuestion = (taxonomy?.score ?? 0) < 2 && !Object.values(platforms).some(Boolean);
  const explicitStack = explicitStackFromPrompt(prompt);
  const persistence = explicitPersistenceFromPrompt(prompt);
  return {
    projectFamily: taxonomy?.entry.family ?? "unclassified",
    projectSubtype: taxonomy?.entry.subtype ?? discovery?.projectType ?? "unclassified project",
    primaryUsers: taxonomy?.entry.users ?? [], platforms, capabilities,
    scale: matches(text, /enterprise|global|large[- ]scale|millions/) ? "large" : matches(text, /single[- ]user|small|personal/) ? "small" : taxonomy?.entry.scale ?? "medium",
    securityRisk: capabilities.payments || matches(text, /health|medical|financial|identity/) ? "high" : capabilities.authentication ? "medium" : taxonomy?.entry.securityRisk ?? "low",
    dataSensitivity: capabilities.payments || matches(text, /medical|health|financial|personal data/) ? "high" : capabilities.authentication ? "medium" : "low",
    deploymentPreference: matches(text, /local[- ]only|desktop|offline/) ? "local" : matches(text, /self[- ]host/) ? "self-hosted" : matches(text, /cloud|hosted|saas/) ? "managed-cloud" : "unspecified",
    existingTechnologyConstraints: [explicitStack, persistence].filter((item): item is string => Boolean(item)),
    userPreferences: explicitStack ? [explicitStack] : [],
    ambiguities: needsQuestion ? ["The target product and platform are not specific enough to choose an architecture safely."] : [],
    confidence: Math.max(0.35, Math.min(0.98, 0.5 + (taxonomy?.score ?? 0) / 20 + (explicitStack ? 0.15 : 0))),
    sourceEvidence: [prompt, ...(discovery?.keyFacts ?? [])].filter(Boolean).slice(0, 12),
  };
}
