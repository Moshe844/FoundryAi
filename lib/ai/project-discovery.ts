export const discoverySourceValues = ["inferred", "observed", "defaulted", "user-confirmed"] as const;
export type DiscoverySource = (typeof discoverySourceValues)[number];

export const discoveryStakesValues = ["low", "high"] as const;
export type DiscoveryStakes = (typeof discoveryStakesValues)[number];

export type DiscoveryAction = "silent-infer" | "disclose" | "ask" | "default-disclose";

export const discoveryDimensions = [
  "domain",
  "likely-users",
  "complexity",
  "platform",
  "data-shape",
  "architecture",
  "features",
  "style",
  "navigation",
  "auth-database-api",
] as const;
export type DiscoveryDimension = (typeof discoveryDimensions)[number];

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
  keyFacts: string[];
  futureCapabilities: string[];
};

type SignalProfile = {
  id: string;
  label: string;
  patterns: RegExp[];
  stack: string;
  architecture: string;
  architectureRationale: string;
  style: string;
  styleRationale: string;
  features: string[];
  entities: string[];
  users: string;
  platform: string;
  complexity: string;
  growth: string[];
};

const HIGH_CONFIDENCE = 72;

const profiles: SignalProfile[] = [
  {
    id: "game",
    label: "Game",
    // "level" and "score" alone are too generic (skill level, credit score) — dropped as
    // standalone triggers; "high score" is kept since it's unambiguously game language.
    patterns: [/\b(game|kids? math|quiz game|arcade|puzzle|platformer|sprite|phaser|unity|godot|high score)\b/i],
    stack: "Phaser",
    architecture:
      "Browser-playable game loop built on Phaser 3 scenes, with a state machine for menu/play/pause states, keyboard and pointer input handling, collision detection, and a scoring system persisted to local storage.",
    architectureRationale: "A scene-based state machine keeps menu, play, and pause states from bleeding into each other as the game grows past a single level.",
    style:
      "Playful, high-contrast game UI with juicy feedback: screen shake and particle bursts on scoring, animated scene transitions, and chunky, readable HUD text.",
    styleRationale: "Juicy feedback (shake, particles, sound cues) is what makes a simple game feel satisfying to replay, not just functional.",
    features: ["Start/menu screen", "Core gameplay loop with win/lose conditions", "Score and combo tracking", "Level or wave progression", "Pause/resume state", "Win/try-again screen with animated feedback"],
    entities: ["Player", "Level/wave", "Challenge/obstacle", "Score entry", "Game session", "High score"],
    users: "Players; if the prompt mentions kids, prioritize forgiving difficulty curves, large tap targets, and encouraging feedback over punishing failure states.",
    platform: "Web game (Phaser canvas)",
    complexity: "Interactive prototype with a real scoring loop",
    growth: ["Level editor or custom-level sharing", "Persistent accounts and leaderboards", "Additional sound design and music layers", "Touch controls for mobile play"],
  },
  {
    id: "inventory",
    label: "Inventory management system",
    // Bare "products?" is too generic — almost any business prompt mentions a "product" —
    // so it was dropped; the remaining words are all specifically inventory language.
    patterns: [/\b(inventory|stock levels?|sku|warehouse|barcode|purchase orders?|reorder|suppliers?)\b/i],
    stack: "Next.js",
    architecture:
      "Next.js App Router with Server Actions for CRUD, a typed data layer, optimistic UI updates for stock adjustments, and a local-first SQLite/JSON store until a real database is requested.",
    architectureRationale: "Server Actions keep stock-adjustment writes close to the data layer, which matters once multiple staff are editing counts concurrently.",
    style:
      "Professional SaaS operations interface: dense sortable/filterable tables, sticky headers, keyboard-friendly row actions, and color-coded stock-level badges (low/critical/healthy).",
    styleRationale: "Inventory users spend hours inside dense tables, so efficiency and scanability matter far more than decoration.",
    features: [
      "Product & SKU catalog with barcode-ready fields",
      "Real-time stock counts by location",
      "Low-stock threshold alerts",
      "Supplier directory with reorder history",
      "Inventory adjustment log with reason codes",
      "CSV import/export",
    ],
    entities: ["Product", "SKU", "Location/warehouse", "Supplier", "Stock movement", "Purchase order", "Adjustment reason"],
    users: "Business operators, managers, and inventory staff.",
    platform: "Web app",
    complexity: "Multi-screen business tool",
    growth: ["Purchase orders and vendor management", "Inventory movement history and audit trail", "Barcode/SKU scanning", "Role-based permissions for staff vs. managers", "Multi-location reporting and analytics"],
  },
  {
    id: "commerce",
    label: "E-commerce store",
    // Bare "shop" is too generic (coffee shop, tattoo shop, workshop) — dropped as a
    // standalone trigger in favor of unambiguous commerce phrases.
    patterns: [/\b(e-?commerce|online store|online shop|shopping cart|checkout|product catalog|storefront)\b/i],
    stack: "Next.js",
    architecture:
      "Next.js storefront with server-rendered product pages for SEO, optimistic client-side cart state, checkout scaffolding ready for a payment provider, and an admin-ready product/catalog data layer.",
    architectureRationale: "Server-rendered product pages are the difference between a store that ranks and one that doesn't, so SEO is treated as an architecture concern, not an afterthought.",
    style:
      "Polished commercial storefront: large product photography, a clear pricing hierarchy, a sticky add-to-cart action, and a frictionless checkout flow with visible trust signals.",
    styleRationale: "Every extra step between a customer and checkout is measurable lost revenue, so friction is designed out of the primary path first.",
    features: ["Product listing with filters/sort", "Product detail with variant selection", "Cart with quantity/line-item editing", "Checkout-ready flow (shipping, payment placeholder)", "Order confirmation/summary", "Category/collection browsing"],
    entities: ["Product", "Variant", "Customer", "Cart item", "Order", "Category", "Discount/coupon"],
    users: "Customers and store administrators.",
    platform: "Web app",
    complexity: "Customer-facing commerce app",
    growth: ["Discount codes and a promotions engine", "Customer accounts with order history", "Reviews and ratings", "Multi-currency / multi-region support"],
  },
  {
    id: "dashboard",
    label: "Dashboard",
    // Bare "chart(s)" is too generic (flow chart, org chart) — dropped as a standalone trigger.
    patterns: [/\b(dashboard|analytics|metrics|kpi|reporting|admin panel)\b/i],
    stack: "Next.js",
    architecture:
      "Next.js data dashboard with a reusable metric-card and chart component library, server-side data fetching with caching, filter state synced to the URL, and drill-down routes per metric.",
    architectureRationale: "Syncing filter state to the URL makes every view shareable and bookmarkable, which operators expect from a reporting tool.",
    style: "Quiet operational UI: dense typography, restrained color reserved for status/alerts, sparkline-driven metric cards, and a filter bar that stays in view while scrolling.",
    styleRationale: "Color is reserved for status and alerts so it stays meaningful — a dashboard that's colorful everywhere teaches users to ignore color entirely.",
    features: ["KPI overview with trend sparklines", "Interactive charts with date-range filters", "Filterable, sortable data table", "Detail drill-down panels", "Export-ready reporting (CSV/PDF)", "Saved views/filters"],
    entities: ["Metric", "Report", "Filter/saved view", "User", "Data source/integration"],
    users: "Operators, managers, and analysts.",
    platform: "Web app",
    complexity: "Data-heavy business interface",
    growth: ["Custom report builder", "Role-based dashboards per team", "Scheduled email reports", "Alerting on metric thresholds", "Third-party data source integrations"],
  },
  {
    id: "mobile",
    label: "Mobile app",
    patterns: [/\b(mobile app|ios|android|react native|flutter|phone app)\b/i],
    stack: "React Native",
    architecture:
      "React Native app with file-based navigation, a shared design-token system for consistent spacing and typography, local-first state before any backend sync, and platform-aware safe-area handling.",
    architectureRationale: "Local-first state means the app stays usable the moment it opens instead of blocking on a network round trip.",
    style: "Mobile-native interface: thumb-reachable primary actions, gesture-friendly navigation, native-feeling transitions, and platform-specific affordances where iOS and Android diverge.",
    styleRationale: "Primary actions sit within thumb reach because that's where a phone is actually held, not where a desktop layout would put them.",
    features: ["Home/dashboard screen", "Primary workflow with offline-first state", "Settings/profile screen", "Empty, loading, and error states for every screen", "Bottom-tab or drawer navigation shell", "Pull-to-refresh"],
    entities: ["User", "Screen state", "Item/record", "Activity/event", "Sync queue"],
    users: "Mobile users in the target workflow.",
    platform: "Mobile",
    complexity: "Multi-screen mobile product",
    growth: ["Push notifications", "Offline sync conflict resolution", "Deep linking and share sheets", "Biometric login"],
  },
  {
    id: "desktop",
    label: "Desktop app",
    patterns: [/\b(desktop|windows app|wpf|winforms|electron|tauri|installer)\b/i],
    stack: ".NET WPF",
    architecture:
      "WPF (.NET) app using MVVM with data-binding, a local SQLite database, dependency injection for services, and a native installer planned after the prototype.",
    architectureRationale: "MVVM keeps the UI and business logic testable independently, which pays off the first time a screen's behavior needs to change without touching its layout.",
    style: "Practical desktop UI: sidebar navigation, dense data grids with inline editing, keyboard shortcuts for power users, and consistent modal dialogs for confirmations.",
    styleRationale: "Desktop power users live in keyboard shortcuts and dense grids — a touch-optimized layout would just slow them down.",
    features: ["Main workspace with a data grid", "Local-first CRUD workflow", "Settings/preferences window", "File import/export actions", "Undo/redo for destructive actions", "Autosave with a recovery file"],
    entities: ["Record", "User setting", "Local file", "Workspace/project file", "Undo history entry"],
    users: "Desktop users who need a focused local tool.",
    platform: "Windows desktop",
    complexity: "Desktop utility/application",
    growth: ["Auto-update pipeline", "Cloud sync/backup", "Multi-window support", "A plugin/extension system"],
  },
  {
    id: "content",
    label: "Content website",
    // Bare "portfolio" is ambiguous (personal/creative portfolio vs. investment/financial
    // portfolio) — requires "site"/"website" or "personal" to disambiguate toward content.
    patterns: [/\b(blog|website|portfolio (site|website)|personal portfolio|landing page|marketing site|docs site|content site)\b/i],
    stack: "Next.js",
    architecture:
      "Next.js content site with static generation for pages and posts, MDX-based content authoring, and a component library of reusable sections (hero, feature grid, testimonials, CTA).",
    architectureRationale: "Static generation means every page loads instantly and ranks well, with no server cost per visitor.",
    style: "Editorial, brand-forward responsive design: a strong type scale, generous whitespace, scroll-triggered reveals, and consistent section rhythm across pages.",
    styleRationale: "Generous whitespace and a strong type scale read as credibility — visitors judge a brand's quality from the page before they read a word of copy.",
    features: ["Homepage with hero + feature sections", "Content listing (blog/portfolio grid)", "Detail page with rich content rendering", "Primary + footer navigation", "Responsive images with lazy loading", "SEO metadata per page"],
    entities: ["Page", "Post/project", "Author", "Category/tag", "Media asset"],
    users: "Visitors and content readers.",
    platform: "Web",
    complexity: "Multi-page website",
    growth: ["CMS-backed authoring for non-developers", "Newsletter/email capture", "Multi-language content", "Deeper analytics and SEO tooling"],
  },
  {
    id: "todo",
    label: "Task/to-do list app",
    patterns: [/\b(to-?do list|to-?do app|task list|task manager|task tracker|checklist app)\b/i],
    stack: "Next.js",
    architecture:
      "Next.js App Router with Server Actions for create/update/delete, optimistic UI so checking off a task feels instant, and local-first storage (localStorage or SQLite) until multi-device sync is requested.",
    architectureRationale: "Optimistic updates matter most here — checking off a task has to feel instant, with the real write happening invisibly behind it.",
    style: "Calm, focused productivity UI: a single fast input for capturing a task, generous whitespace, satisfying check-off micro-interactions, and unobtrusive completed-task styling (strikethrough, faded).",
    styleRationale: "A to-do list lives or dies on how fast you can capture a thought and how satisfying it feels to clear it — any friction here kills daily use.",
    features: ["Add/edit/delete tasks", "Mark complete with instant feedback", "Due dates", "Priority levels", "Categories or tags", "Filter by status (active/completed/all)", "Drag-to-reorder"],
    entities: ["Task", "Category/tag", "Due date", "Priority", "List (optional, for multiple lists)"],
    users: "Individuals organizing their own day-to-day work or errands; assume they want speed and low friction over configurability.",
    platform: "Web app",
    complexity: "Focused single-purpose productivity tool",
    growth: ["Shared/collaborative lists", "Recurring tasks", "Subtasks within a task", "Reminders and notifications", "Calendar view"],
  },
  {
    id: "auth-page",
    label: "Login/auth page",
    patterns: [/\b(login|log ?in|sign ?in|auth page|authentication page|forgot password|password reset)\b/i, /\bsign ?up\b(?=.*\b(account|password|email|username|credentials|authentication)\b)/i],
    stack: "Next.js",
    architecture:
      "Next.js App Router with Server Actions for form submissions, JWT-based sessions in secure httpOnly cookies, middleware-enforced route protection, password hashing via bcrypt/argon2, and a pluggable auth-provider abstraction ready for OAuth.",
    architectureRationale: "A pluggable auth-provider abstraction means adding Google or GitHub sign-in later is a config change, not a rewrite.",
    style:
      "Premium SaaS trust-building aesthetic: a glassmorphism card over a subtly animated gradient background, dark-mode-first palette, smooth micro-transitions, accessible forms with inline validation, and clear loading/error states.",
    styleRationale: "An auth screen is the first real impression of the product's quality bar, so it's held to a higher visual standard than an average form.",
    features: [
      "Email/password sign-in",
      "Google OAuth",
      "GitHub OAuth",
      "Magic-link sign-in option",
      "Remember-me / persistent session",
      "Forgot-password flow with reset token",
      "Signup with email verification",
      "MFA-ready session model",
    ],
    entities: ["User", "Credential", "OAuth account", "Auth session", "Password reset token", "MFA device (planned)"],
    users: "People signing in to a product account; assume they expect modern conveniences like social login and magic-link even if not explicitly requested.",
    platform: "Web",
    complexity: "Focused UI surface backed by real session/security decisions",
    growth: ["Multi-factor authentication", "Team/organization accounts with roles", "Session and login audit log", "SSO for enterprise customers"],
  },
  {
    id: "api",
    label: "Backend/API service",
    // Bare "server" and "service" are too generic (game server, customer service business) —
    // dropped as standalone triggers in favor of unambiguous backend/API language.
    patterns: [/\b(api|backend|rest api|graphql|webhook|microservice)\b/i],
    stack: "Node/Express",
    architecture:
      "Node/Express (TypeScript) service with a layered structure (routes, controllers, services), schema-based request validation, centralized error-handling middleware, and a persistence boundary left explicit until a database is chosen.",
    architectureRationale: "Schema-based validation at the boundary means bad input fails loudly and early instead of corrupting data three layers deep.",
    style: "API-first project: consistent JSON error shapes, versioned routes, OpenAPI-ready documentation, and a minimal health/status endpoint for uptime checks.",
    styleRationale: "Consistent error shapes and versioned routes are what let client integrations trust the API enough to build on it long-term.",
    features: ["Health/status endpoint", "Resource CRUD routes", "Request validation with typed schemas", "Centralized error handling", "Environment-based configuration", "Structured request logging"],
    entities: ["Resource", "Request/response envelope", "Client/API key", "Integration", "Rate limit bucket"],
    users: "Developers and client applications.",
    platform: "Backend service",
    complexity: "Service/API",
    growth: ["API key management and rate limiting", "Webhook delivery with retries", "Versioned endpoints as the contract evolves", "Usage analytics per client"],
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
    decision("architecture", selected.architecture, Math.min(86, baseConfidence - 2), "high", "inferred", selected.architectureRationale),
    decision("features", selected.features.join(", "), Math.min(84, baseConfidence - 3), "high", "inferred", "Initial features are chosen from common workflows for this category."),
    decision("style", selected.style, Math.min(88, baseConfidence), "low", "inferred", selected.styleRationale),
    decision("navigation", navigationFor(selected), Math.min(78, baseConfidence - 7), "low", "defaulted", "Navigation can be safely adjusted after the first build."),
    decision("auth-database-api", authDataApiFor(normalized, selected), authConfidence(normalized, selected), "high", authSource(normalized), "Auth, database, and API choices can change implementation scope."),
  ];

  const { questions, assumptions } = deriveQuestionsAndAssumptions(decisions);

  return {
    prompt: normalized,
    projectType: selected.label,
    recommendedStack: selected.stack,
    architecture: selected.architecture,
    mainFeatures: selected.features,
    styleDirection: selected.style,
    dataModel: selected.entities,
    assumptions,
    questions,
    decisions,
    keyFacts: keyFactsFor(selected, normalized),
    futureCapabilities: selected.growth,
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
    architectureRationale: "Starting simple and leaving the persistence layer as a clean seam avoids locking in a database decision before the real workflow is clear.",
    style: "Clean, practical product UI until a stronger brand or audience signal is provided.",
    styleRationale: "Without a stronger signal on brand or audience, a clean neutral baseline is safer to build on than guessing at a specific aesthetic.",
    features: ["Primary workspace", "Core create/edit workflow", "List/detail view", "Settings or configuration area"],
    entities: ["Item", "User", "Record"],
    users: "The target users are not specific yet.",
    platform: "Web app",
    complexity: "Ambiguous tool/product",
    growth: ["A real database once the data model stabilizes", "User accounts and permissions", "Usage analytics", "Integrations with other tools you rely on"],
  };
}

function tag(text: string, maxWords = 7): string {
  const clean = text.trim();
  const colonIdx = clean.indexOf(":");
  if (colonIdx > 4 && colonIdx < 60) return clean.slice(0, colonIdx).trim();
  const words = clean.split(/\s+/);
  if (words.length <= maxWords) return clean.replace(/[.,;]$/, "");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

function platformTag(platform: string): string {
  return /\b(app|application|service|game|canvas)\b/i.test(platform) ? platform : `${platform} application`;
}

function keyFactsFor(selected: SignalProfile, normalized: string): string[] {
  return [
    selected.complexity,
    tag(selected.users, 6),
    platformTag(selected.platform),
    tag(selected.style),
    tag(selected.architecture),
    tag(authDataApiFor(normalized, selected), 8),
  ]
    .map((item) => item.replace(/\.$/, "").trim())
    .filter(Boolean);
}

function decision(dimension: DiscoveryDimension, hypothesis: string, confidence: number, stakes: DiscoveryStakes, source: DiscoverySource, rationale: string): DiscoveryDecision {
  const bounded = Math.max(0, Math.min(100, Math.round(confidence)));
  const partial: DiscoveryDecision = { dimension, hypothesis, confidence: bounded, stakes, source, rationale, action: actionForDecision(bounded, stakes) };
  return partial.action === "ask" ? { ...partial, question: questionFor(partial) } : partial;
}

export function deriveQuestionsAndAssumptions(decisions: DiscoveryDecision[]) {
  const questions = decisions.filter((item) => item.action === "ask").map((item) => item.question ?? questionFor(item)).slice(0, 3);
  const assumptions = decisions.filter((item) => item.action === "disclose" || item.action === "default-disclose").map((item) => `${item.dimension}: ${item.hypothesis}`);
  return { questions, assumptions };
}

export function questionFor(decision: Pick<DiscoveryDecision, "dimension" | "hypothesis">) {
  if (decision.dimension === "domain") return "What kind of tool or product is this, and who is it for?";
  if (decision.dimension === "platform") return "Should this be web, mobile, desktop, game, or backend/API?";
  if (decision.dimension === "auth-database-api") return "Does this need login, persistent database storage, or an external API in the first version?";
  if (decision.dimension === "data-shape") return "What main things should the app store or manage?";
  if (decision.dimension === "architecture") return "Should this be a simple prototype or a production-ready app structure?";
  if (decision.dimension === "features") return "What are the must-have first-version features?";
  return `Please confirm ${decision.dimension}: ${decision.hypothesis}`;
}

function ambiguityScore(prompt: string, profile?: SignalProfile) {
  // A matched domain profile is strong direct evidence on its own — don't also
  // penalize it for being tersely phrased (e.g. "Inventory management system" is
  // short and contains "system", but the match itself is confident).
  if (profile) return 0;
  const words = prompt.toLowerCase().split(/\s+/).filter(Boolean);
  const vague = /\b(tool|app|thing|system|platform|software|project)\b/i.test(prompt) && words.length <= 6;
  const veryShort = words.length <= 4;
  return 24 + (vague ? 28 : 0) + (veryShort ? 14 : 0);
}

function authConfidence(prompt: string, profile: SignalProfile) {
  if (/\b(login|auth|account|user accounts?|database|db|api|backend|server|persist|save data|payments?|checkout)\b/i.test(prompt)) return 92;
  // A recognized domain profile is enough for Foundry to commit to a sensible default
  // without asking — only a genuinely unmatched (custom) domain stays uncertain here.
  if (profile.id === "custom") return 58;
  return 78;
}

function authSource(prompt: string): DiscoverySource {
  return /\b(login|auth|account|database|api|backend|server|persist|save data)\b/i.test(prompt) ? "observed" : "defaulted";
}

function authDataApiFor(prompt: string, profile: SignalProfile) {
  if (profile.id === "auth-page") return "Email/password plus Google and GitHub OAuth, JWT sessions in httpOnly cookies, and a password-reset flow with expiring tokens.";
  if (/\b(login|auth|account)\b/i.test(prompt)) return "Account/auth-ready UI wired to a real session model, not just a static form.";
  if (/\b(database|db|persist|save data)\b/i.test(prompt)) return "A persistent data boundary (typed models, migration-ready) rather than local-only state.";
  if (/\b(api|backend|server)\b/i.test(prompt)) return "An explicit API/backend boundary with validated request/response contracts.";
  if (profile.id === "inventory" || profile.id === "commerce" || profile.id === "dashboard") return "Start with local/mock data and keep the database/auth/API seams explicit so they're easy to wire in later.";
  return "Local state/mock data for the first version, with clear seams for a real database or auth once needed.";
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
