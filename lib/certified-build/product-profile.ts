import { explicitPersistenceFromPrompt, explicitStackFromPrompt, type ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import { taxonomyEntryFor } from "./taxonomy";
import type { Platform, ProductCapabilities, ProductProfile } from "./types";
import { technologyConstraintFromPrompt } from "./technology-constraint";

const matches = (text: string, pattern: RegExp) => pattern.test(text);
const allPlatforms = (): Record<Platform, boolean> => ({ web:false, api:false, android:false, ios:false, windows:false, macos:false, linux:false, game:false, cli:false });

function authoritativeFamilyFromPrompt(text: string) {
  if (/\bdesktop (?:app|application)\b|\b(?:windows|macos)\s+(?:app|application)\b/.test(text)) return "desktop-applications";
  if (/\bmobile app\b|\b(?:android|ios|iphone|ipad)\b[^.\n]{0,50}\b(?:app|application|scanner)\b/.test(text)) return "mobile-applications";
  if (/\bplayable games?\b|\b(?:2d|3d|survival|platformer|puzzle|strategy|rhythm|open[- ]world)\b[^.\n]{0,60}\bgames?\b|\bgames?\b[^.\n]{0,60}\b(?:2d|3d|survival|platformer|puzzle|strategy|rhythm|open[- ]world)\b/.test(text)) return "games-interactive";
  if (/\bapi service\b|\b(?:rest|graphql|public|private|internal)?\s*api\b|\bwebhook service\b|\bmicroservice\b/.test(text)) return "backend-services";
  if (/\bai application\b|\bai-powered\b|\b(?:rag|ai|llm)\s+(?:assistant|agent|app|application|tool)\b/.test(text)) return "data-ai";
  if (/\bresponsive website\b/.test(text)) return "websites-content";
  if (/\boperational dashboard\b/.test(text)) return "web-applications-saas";
  if (/\bpoint-of-sale app\b|\be-commerce store\b|\bpos\b|\bcheckout\b/.test(text)) return "commerce-payments";
  if (/\binventory management system\b|\bwarehouse inventory\b|\binventory system\b/.test(text)) return "inventory-logistics";
  return undefined;
}

function platformsForTaxonomy(family: string | undefined, subtype: string | undefined): Platform[] {
  const value = subtype?.toLowerCase() ?? "";
  if (family === "mobile-applications") {
    if (/\bandroid\b/.test(value) && !/\b(?:ios|cross-platform)\b/.test(value)) return ["android"];
    if (/\b(?:ios|iphone|ipad)\b/.test(value) && !/\b(?:android|cross-platform)\b/.test(value)) return ["ios"];
    return ["android", "ios"];
  }
  if (family === "desktop-applications") {
    if (/\b(?:windows|wpf|winforms)\b/.test(value)) return ["windows"];
    if (/\bmacos\b|\bmac app\b/.test(value)) return ["macos"];
    return ["windows", "macos", "linux"];
  }
  if (family === "developer-tools") {
    if (/\bbrowser extension\b/.test(value)) return ["web"];
    if (/\b(?:desktop helper|log viewer)\b/.test(value)) return ["windows", "macos", "linux"];
    return ["cli"];
  }
  if (family === "infrastructure-operations") {
    if (/\b(?:dashboard|monitoring system|logging stack)\b/.test(value)) return ["web", "api"];
    return ["cli"];
  }
  return [];
}

export function extractProductProfile(prompt: string, discovery?: ProjectDiscoveryResult): ProductProfile {
  // Only user-originated evidence may create architecture-changing requirements. Discovery features
  // and data-model suggestions are useful downstream design hints, but allowing them back into this
  // classifier made a model-invented dashboard/database self-confirm and escalated a marketing site
  // to Next.js + PostgreSQL. The project type may help taxonomy matching; capabilities come from the
  // user's prompt alone.
  const taxonomyText = [prompt, discovery?.projectType].filter(Boolean).join(" ").toLowerCase();
  const text = prompt.toLowerCase().replace(/\b(?:no|without|not|never)\s+(?:a\s+|an\s+|any\s+)?(?:login|authentication|auth|accounts?|database|backend|server|payments?)(?:\s+(?:or|and)\s+(?:a\s+|an\s+)?(?:login|authentication|auth|accounts?|database|backend|server|payments?))*/g, "");
  const taxonomyMatch = taxonomyEntryFor(taxonomyText);
  // A zero-score taxonomy result is not evidence. Treating the first catalogue entry as a match
  // made vague custom requests silently become websites and poisoned every downstream stack score.
  const taxonomy = taxonomyMatch && taxonomyMatch.score > 0 ? taxonomyMatch : undefined;
  const authoritativeFamily = authoritativeFamilyFromPrompt(text);
  const platforms = allPlatforms();
  const taxonomyPlatforms = platformsForTaxonomy(taxonomy?.entry.family, taxonomy?.entry.subtype);
  for (const platform of taxonomyPlatforms.length ? taxonomyPlatforms : taxonomy?.entry.platforms ?? []) platforms[platform] = true;
  if (matches(text, /\bandroid|rugged device|google play\b/)) platforms.android = true;
  if (matches(text, /\bios\b|iphone|ipad|apple platform/)) platforms.ios = true;
  if (matches(text, /\bwindows\b|wpf|winforms/)) platforms.windows = true;
  if (matches(text, /\bmacos\b|mac app/)) platforms.macos = true;
  if (matches(text, /\bapi\b|backend|webhook|microservice/)) platforms.api = true;
  if (matches(text, /\bgames?\b|platformer|simulation/)) platforms.game = true;
  if (matches(text, /\bcli\b|command[- ]line/)) platforms.cli = true;
  const resetPlatforms = (...enabled: Platform[]) => {
    Object.keys(platforms).forEach((platform) => { platforms[platform as Platform] = false; });
    enabled.forEach((platform) => { platforms[platform] = true; });
  };
  if (authoritativeFamily === "websites-content") resetPlatforms("web");
  if (authoritativeFamily === "web-applications-saas" || authoritativeFamily === "commerce-payments" || authoritativeFamily === "inventory-logistics" || authoritativeFamily === "data-ai") resetPlatforms("web","api");
  if (authoritativeFamily === "backend-services") resetPlatforms("api");
  if (authoritativeFamily === "games-interactive") resetPlatforms("game");
  if (authoritativeFamily === "desktop-applications") {
    resetPlatforms();
    if (matches(text, /\bwindows\b|wpf|winforms|(?:^|[^\w])\.net\b|\bdotnet\b/)) platforms.windows = true;
    else if (matches(text, /\bmacos\b|mac app/)) platforms.macos = true;
    else { platforms.windows = true; platforms.macos = true; platforms.linux = true; }
  }
  if (authoritativeFamily === "mobile-applications") {
    resetPlatforms();
    if (matches(text, /\bandroid\b/) && !matches(text, /\bios\b|iphone|ipad|cross[- ]platform/)) platforms.android = true;
    else if (matches(text, /\bios\b|iphone|ipad/) && !matches(text, /\bandroid\b|cross[- ]platform/)) platforms.ios = true;
    else { platforms.android = true; platforms.ios = true; }
  }
  // Generic subtype nouns such as "dashboard app" must not add a web target to a mobile or desktop
  // starter. Add platforms from the prompt only when they are explicit delivery-surface language.
  if (matches(text, /\bweb\b(?!\s+api)|\bwebsite\b|\bweb\s+(?:app|application)\b|browser[- ]based|customer portal|saas|online store|marketplace/)) platforms.web = true;
  const explicitlyAndroid = matches(text, /\bandroid\b|google play/);
  const explicitlyIos = matches(text, /\bios\b|iphone|ipad|apple platform/);
  const explicitWebSurface = matches(text, /\bweb\b(?!\s+api)|\bwebsite\b|\bweb\s+(?:app|application)\b|browser[- ]based|customer portal|saas|online store|marketplace/);
  const explicitApiSurface = matches(text, /\b(?:rest|graphql|public|private|internal)?\s*api\b|\bwebhook\b|\bmicroservice\b|\bbackend\b/);
  if (explicitlyAndroid && !explicitlyIos && !explicitWebSurface && matches(text, /\b(?:scanner|mobile|handheld|device|field|warehouse)\b/)) resetPlatforms("android");
  if (explicitlyIos && !explicitlyAndroid && !explicitWebSurface) resetPlatforms("ios");
  if (explicitApiSurface && !explicitWebSurface && !matches(text, /\b(?:mobile|android|ios|iphone|desktop|game)\b/)) resetPlatforms("api");
  if (explicitlyIos && !explicitlyAndroid && !matches(text, /both ios and android|cross[- ]platform/)) platforms.android = false;
  if (explicitlyAndroid && !explicitlyIos && !matches(text, /both ios and android|cross[- ]platform/)) platforms.ios = false;
  // An API capability inside a business product does not make the product API-only. Previously every
  // inventory, commerce, POS, and SaaS taxonomy entry lost its web surface here because those families
  // quite correctly include an API. Only explicit service-only language may remove a known UI.
  const explicitServiceOnly = matches(text, /\bapi[- ]only\b|\bbackend[- ]only\b|\bservice[- ]only\b|\bno (?:web )?(?:ui|frontend)\b/)
    || (matches(text, /\bservice\b/) && !matches(text, /\bweb\b|website|browser|frontend|dashboard|portal|\bui\b/));
  const authoritativeUiProduct = authoritativeFamily === "web-applications-saas"
    || authoritativeFamily === "commerce-payments"
    || authoritativeFamily === "inventory-logistics";
  if (platforms.api && explicitServiceOnly && !authoritativeUiProduct) platforms.web = false;
  const dataServiceWithoutUi = matches(text, /\b(?:etl|data pipeline|data cleaning|batch processing|import[- ]export)\b/)
    && !matches(text, /\b(?:dashboard|portal|web app|website|browser|frontend|\bui\b|ai|assistant|agent|rag|semantic|model|llm)\b/);
  if (dataServiceWithoutUi) resetPlatforms("api");

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
  const technologyConstraint = technologyConstraintFromPrompt(prompt);
  const persistence = explicitPersistenceFromPrompt(prompt);
  const authoritativeSubtype = authoritativeFamily === "desktop-applications"
    ? platforms.windows && !platforms.macos && !platforms.linux ? "Windows desktop application"
      : platforms.macos && !platforms.windows && !platforms.linux ? "macOS desktop application"
        : "cross-platform desktop application"
    : authoritativeFamily === "mobile-applications"
      ? platforms.android && !platforms.ios ? "Android application"
        : platforms.ios && !platforms.android ? "iOS application"
          : "cross-platform mobile application"
      : undefined;
  return {
    projectFamily: authoritativeFamily ?? taxonomy?.entry.family ?? "unclassified",
    projectSubtype: authoritativeSubtype ?? taxonomy?.entry.subtype ?? discovery?.projectType ?? "unclassified project",
    primaryUsers: taxonomy?.entry.users ?? [], platforms, capabilities,
    scale: matches(text, /enterprise|global|large[- ]scale|millions/) ? "large" : matches(text, /single[- ]user|small|personal/) ? "small" : taxonomy?.entry.scale ?? "medium",
    securityRisk: capabilities.payments || matches(text, /health|medical|financial|identity/) ? "high" : capabilities.authentication ? "medium" : taxonomy?.entry.securityRisk ?? "low",
    dataSensitivity: capabilities.payments || matches(text, /medical|health|financial|personal data/) ? "high" : capabilities.authentication ? "medium" : "low",
    deploymentPreference: matches(text, /local[- ]only|desktop|offline/) ? "local" : matches(text, /self[- ]host/) ? "self-hosted" : matches(text, /cloud|hosted|saas/) ? "managed-cloud" : "unspecified",
    existingTechnologyConstraints: [explicitStack, persistence].filter((item): item is string => Boolean(item)),
    technologyConstraint,
    userPreferences: explicitStack ? [explicitStack] : [],
    ambiguities: needsQuestion ? ["The target product and platform are not specific enough to choose an architecture safely."] : [],
    confidence: Math.max(0.35, Math.min(0.98, 0.5 + (taxonomy?.score ?? 0) / 20 + (explicitStack ? 0.15 : 0))),
    sourceEvidence: [prompt, ...(discovery?.keyFacts ?? [])].filter(Boolean).slice(0, 12),
  };
}
