export type DiscoverySource = "inferred" | "observed" | "defaulted" | "user-confirmed";
export type DiscoveryStakes = "low" | "high";
export type DiscoveryAction = "silent-infer" | "disclose" | "ask" | "default-disclose";
export type DiscoveryDimension =
  | "domain"
  | "likely-users"
  | "complexity"
  | "platform"
  | "data-shape"
  | "architecture"
  | "features"
  | "style"
  | "navigation"
  | "auth-database-api";

export type DiscoveryDecision = {
  dimension: DiscoveryDimension;
  hypothesis: string;
  confidence: number;
  stakes: DiscoveryStakes;
  source: DiscoverySource;
  rationale: string;
  action: DiscoveryAction;
  question?: string;
};

export type ProjectDiscoveryResult = {
  prompt: string;
  projectType: string;
  recommendedStack: string;
  architecture: string;
  mainFeatures: string[];
  styleDirection: string;
  dataModel: string[];
  assumptions: string[];
  questions: string[];
  decisions: DiscoveryDecision[];
};

type SignalProfile = {
  id: string;
  label: string;
  patterns: RegExp[];
  stack: string;
  architecture: string;
  style: string;
  features: string[];
  entities: string[];
  users: string;
  platform: string;
  complexity: string;
};

const HIGH_CONFIDENCE = 72;

const profiles: SignalProfile[] = [
  {
    id: "game",
    label: "Game",
    patterns: [/\b(game|kids? math|quiz game|arcade|puzzle|platformer|level|score|sprite|phaser|unity|godot)\b/i],
    stack: "Phaser",
    architecture: "Browser-playable game loop with scenes, input handling, scoring, and asset-ready state.",
    style: "Playful, responsive, high-contrast game UI with clear feedback and motion.",
    features: ["Start/play screen", "Core gameplay loop", "Score/progress feedback", "Levels or rounds", "Win/try-again states"],
    entities: ["Player", "Level", "Challenge", "Score", "Game session"],
    users: "Players; if the prompt mentions kids, prioritize child-friendly pacing and feedback.",
    platform: "Web game",
    complexity: "Interactive prototype",
  },
  {
    id: "inventory",
    label: "Inventory management system",
    patterns: [/\b(inventory|stock|sku|warehouse|barcode|products?|purchase orders?|reorder|suppliers?)\b/i],
    stack: "Next.js",
    architecture: "Full-stack business app with typed UI, local-first data model unless persistence/auth is requested.",
    style: "Professional SaaS/operations interface optimized for scanning tables and repeated workflows.",
    features: ["Product catalog", "Stock counts", "Low-stock alerts", "Supplier tracking", "Inventory adjustments", "Import/export-ready tables"],
    entities: ["Product", "SKU", "Location", "Supplier", "Stock movement", "Purchase order"],
    users: "Business operators, managers, and inventory staff.",
    platform: "Web app",
    complexity: "Multi-screen business tool",
  },
  {
    id: "commerce",
    label: "E-commerce store",
    patterns: [/\b(e-?commerce|online store|shop|cart|checkout|product catalog|storefront)\b/i],
    stack: "Next.js",
    architecture: "Storefront plus admin-ready product/catalog structure.",
    style: "Polished commercial storefront with product-forward browsing and clear conversion paths.",
    features: ["Product listing", "Product detail", "Cart", "Checkout-ready flow", "Order summary"],
    entities: ["Product", "Customer", "Cart item", "Order", "Category"],
    users: "Customers and store administrators.",
    platform: "Web app",
    complexity: "Customer-facing commerce app",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    patterns: [/\b(dashboard|analytics|metrics|kpi|reporting|charts?|admin panel)\b/i],
    stack: "Next.js",
    architecture: "Data dashboard with reusable metrics, filters, tables, and drill-down surfaces.",
    style: "Quiet operational UI with dense, readable data and restrained visual hierarchy.",
    features: ["Metric overview", "Charts", "Filterable table", "Detail panels", "Export-ready reporting"],
    entities: ["Metric", "Report", "Filter", "User", "Data source"],
    users: "Operators, managers, and analysts.",
    platform: "Web app",
    complexity: "Data-heavy business interface",
  },
  {
    id: "mobile",
    label: "Mobile app",
    patterns: [/\b(mobile app|ios|android|react native|flutter|phone app)\b/i],
    stack: "React Native",
    architecture: "Cross-platform mobile app with screen navigation, device-sized layouts, and local state first.",
    style: "Mobile-native interface with thumb-friendly controls and clear screen hierarchy.",
    features: ["Home screen", "Primary workflow", "Settings/profile", "Empty/loading states", "Navigation shell"],
    entities: ["User", "Screen state", "Item", "Activity"],
    users: "Mobile users in the target workflow.",
    platform: "Mobile",
    complexity: "Multi-screen mobile product",
  },
  {
    id: "desktop",
    label: "Desktop app",
    patterns: [/\b(desktop|windows app|wpf|winforms|electron|tauri|installer)\b/i],
    stack: ".NET WPF",
    architecture: "Desktop-first application with local data and native-window workflows.",
    style: "Practical desktop UI with efficient forms, tables, and predictable navigation.",
    features: ["Main workspace", "Local data workflow", "Settings", "File/import actions"],
    entities: ["Record", "User setting", "Local file", "Workspace"],
    users: "Desktop users who need a focused local tool.",
    platform: "Windows desktop",
    complexity: "Desktop utility/application",
  },
  {
    id: "content",
    label: "Content website",
    patterns: [/\b(blog|website|portfolio|landing page|marketing site|docs site|content site)\b/i],
    stack: "Next.js",
    architecture: "Content-oriented website with reusable sections/pages and static-friendly rendering.",
    style: "Editorial, brand-forward responsive web design.",
    features: ["Homepage", "Content listing", "Detail page", "Navigation", "Responsive layout"],
    entities: ["Page", "Post", "Author", "Category"],
    users: "Visitors and content readers.",
    platform: "Web",
    complexity: "Multi-page website",
  },
  {
    id: "auth-page",
    label: "Login/auth page",
    patterns: [/\b(login|sign in|signin|signup|sign up|auth page|authentication page)\b/i],
    stack: "Next.js",
    architecture: "Focused auth UI surface with validation-ready form state.",
    style: "Clean trust-building product UI with accessible forms and clear error states.",
    features: ["Login form", "Validation states", "Forgot password link", "Signup link", "Responsive layout"],
    entities: ["User", "Credential", "Auth session"],
    users: "Users accessing a product account.",
    platform: "Web",
    complexity: "Focused UI page",
  },
  {
    id: "api",
    label: "Backend/API service",
    patterns: [/\b(api|backend|server|service|rest|graphql|webhook|microservice)\b/i],
    stack: "Node/Express",
    architecture: "Typed API service with routes, validation, and persistence boundary left explicit.",
    style: "API-first project with minimal admin/status UI if needed.",
    features: ["Health endpoint", "Resource routes", "Validation", "Error handling", "Configuration"],
    entities: ["Resource", "Request", "Response", "User", "Integration"],
    users: "Developers and client applications.",
    platform: "Backend service",
    complexity: "Service/API",
  },
];

export function actionForDecision(confidence: number, stakes: DiscoveryStakes): DiscoveryAction {
  const highConfidence = confidence >= HIGH_CONFIDENCE;
  if (highConfidence && stakes === "low") return "silent-infer";
  if (highConfidence && stakes === "high") return "disclose";
  if (!highConfidence && stakes === "high") return "ask";
  return "default-disclose";
}

export function discoverProject(prompt: string): ProjectDiscoveryResult {
  const normalized = prompt.trim();
  const profile = chooseProfile(normalized);
  const ambiguity = ambiguityScore(normalized, profile);
  const baseConfidence = profile ? Math.max(42, 92 - ambiguity) : Math.max(25, 48 - ambiguity);
  const fallback = defaultProfile(normalized);
  const selected = profile ?? fallback;

  const decisions: DiscoveryDecision[] = [
    decision("domain", selected.label, baseConfidence, "high", profile ? "inferred" : "defaulted", profile ? `Matched product/domain language in "${normalized}".` : "The request is broad, so the domain needs confirmation."),
    decision("likely-users", selected.users, Math.min(88, baseConfidence + 2), "low", "inferred", "Likely users follow from the inferred product category."),
    decision("complexity", selected.complexity, Math.min(86, baseConfidence), "low", "inferred", "Complexity is estimated from the requested product surface."),
    decision("platform", selected.platform, Math.min(90, baseConfidence + 4), "high", "inferred", "Platform choice affects stack, preview, and execution path."),
    decision("data-shape", selected.entities.join(", "), Math.min(82, baseConfidence - 4), selected.entities.length ? "high" : "low", selected.entities.length ? "inferred" : "defaulted", "Entities are inferred from the product category and can be edited before build."),
    decision("architecture", selected.architecture, Math.min(86, baseConfidence - 2), "high", "inferred", "Architecture determines how Foundry structures the generated project."),
    decision("features", selected.features.join(", "), Math.min(84, baseConfidence - 3), "high", "inferred", "Initial features are chosen from common workflows for this category."),
    decision("style", selected.style, Math.min(88, baseConfidence), "low", "inferred", "Style direction follows the domain and expected audience."),
    decision("navigation", navigationFor(selected), Math.min(78, baseConfidence - 7), "low", "defaulted", "Navigation can be safely adjusted after the first build."),
    decision("auth-database-api", authDataApiFor(normalized, selected), authConfidence(normalized, selected), "high", authSource(normalized), "Auth, database, and API choices can change implementation scope."),
  ];

  const questions = decisions.filter((item) => item.action === "ask").map((item) => item.question ?? questionFor(item));
  const assumptions = decisions.filter((item) => item.action === "disclose" || item.action === "default-disclose").map((item) => `${item.dimension}: ${item.hypothesis}`);

  return {
    prompt: normalized,
    projectType: selected.label,
    recommendedStack: selected.stack,
    architecture: selected.architecture,
    mainFeatures: selected.features,
    styleDirection: selected.style,
    dataModel: selected.entities,
    assumptions,
    questions: questions.slice(0, 3),
    decisions,
  };
}

function chooseProfile(prompt: string) {
  const matches = profiles
    .map((profile) => ({ profile, score: profile.patterns.reduce((score, pattern) => score + (pattern.test(prompt) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return matches[0]?.profile;
}

function defaultProfile(prompt: string): SignalProfile {
  const label = deriveTarget(prompt);
  return {
    id: "custom",
    label,
    patterns: [],
    stack: "Next.js",
    architecture: "Web app with a simple, editable first version and room to add backend/persistence once the workflow is clear.",
    style: "Clean, practical product UI until a stronger brand or audience signal is provided.",
    features: ["Primary workspace", "Core create/edit workflow", "List/detail view", "Settings or configuration area"],
    entities: ["Item", "User", "Record"],
    users: "The target users are not specific yet.",
    platform: "Web app",
    complexity: "Ambiguous tool/product",
  };
}

function decision(dimension: DiscoveryDimension, hypothesis: string, confidence: number, stakes: DiscoveryStakes, source: DiscoverySource, rationale: string): DiscoveryDecision {
  const bounded = Math.max(0, Math.min(100, Math.round(confidence)));
  const partial: DiscoveryDecision = { dimension, hypothesis, confidence: bounded, stakes, source, rationale, action: actionForDecision(bounded, stakes) };
  return partial.action === "ask" ? { ...partial, question: questionFor(partial) } : partial;
}

function questionFor(decision: Pick<DiscoveryDecision, "dimension" | "hypothesis">) {
  if (decision.dimension === "domain") return "What kind of tool or product is this, and who is it for?";
  if (decision.dimension === "platform") return "Should this be web, mobile, desktop, game, or backend/API?";
  if (decision.dimension === "auth-database-api") return "Does this need login, persistent database storage, or an external API in the first version?";
  if (decision.dimension === "data-shape") return "What main things should the app store or manage?";
  if (decision.dimension === "architecture") return "Should this be a simple prototype or a production-ready app structure?";
  if (decision.dimension === "features") return "What are the must-have first-version features?";
  return `Please confirm ${decision.dimension}: ${decision.hypothesis}`;
}

function ambiguityScore(prompt: string, profile?: SignalProfile) {
  const words = prompt.toLowerCase().split(/\s+/).filter(Boolean);
  const vague = /\b(tool|app|thing|system|platform|software|project)\b/i.test(prompt) && words.length <= 6;
  const veryShort = words.length <= 4;
  return (profile ? 0 : 24) + (vague ? 28 : 0) + (veryShort ? 14 : 0);
}

function authConfidence(prompt: string, profile: SignalProfile) {
  if (/\b(login|auth|account|user accounts?|database|db|api|backend|server|persist|save data|payments?|checkout)\b/i.test(prompt)) return 86;
  if (profile.id === "game" || profile.id === "content" || profile.id === "auth-page") return 58;
  if (profile.id === "inventory" || profile.id === "commerce" || profile.id === "dashboard") return 68;
  return 46;
}

function authSource(prompt: string): DiscoverySource {
  return /\b(login|auth|account|database|api|backend|server|persist|save data)\b/i.test(prompt) ? "observed" : "defaulted";
}

function authDataApiFor(prompt: string, profile: SignalProfile) {
  if (/\b(login|auth|account)\b/i.test(prompt)) return "Include account/auth-ready UI.";
  if (/\b(database|db|persist|save data)\b/i.test(prompt)) return "Include persistent data boundary.";
  if (/\b(api|backend|server)\b/i.test(prompt)) return "Include API/backend structure.";
  if (profile.id === "inventory" || profile.id === "commerce" || profile.id === "dashboard") return "Start with local/mock data, keep database/auth/API seams explicit.";
  return "Default to local state/mock data for the first version.";
}

function navigationFor(profile: SignalProfile) {
  if (profile.id === "game") return "Start screen, play scene, results/retry screen.";
  if (profile.id === "content") return "Home, listing, detail, about/contact as needed.";
  if (profile.id === "auth-page") return "Single auth surface with secondary account links.";
  if (profile.id === "api") return "API routes plus a minimal status/docs surface.";
  return "Dashboard/home, list/table, detail/edit, settings.";
}

function deriveTarget(prompt: string) {
  const target = prompt
    .replace(/\b(build|create|make|me|please|a|an|the|new|project|app|software)\b/gi, " ")
    .replace(/[^\w\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return titleCase(target || "Custom software project");
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}
