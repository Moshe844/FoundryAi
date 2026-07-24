export const discoverySourceValues = ["inferred", "observed", "defaulted", "user-confirmed"] as const;
export type DiscoverySource = (typeof discoverySourceValues)[number];

/**
 * Values Foundry invents when the request yields nothing parseable. They exist so a brief is never
 * empty — but they are Foundry's guesses, not the user's words, and they must never be laundered into
 * "user-confirmed" facts. A creative-agency site was presented with "Primary workspace / Core
 * create/edit workflow / List/detail view / Settings" and entities "Item, User, Record" at 100%
 * confidence, captioned as capabilities the user had selected, while the same screen still asked
 * "What kind of tool or product is this?".
 */
export const GENERIC_FEATURE_PLACEHOLDERS = ["Primary workspace", "Core create/edit workflow", "List/detail view", "Settings or configuration area"];
export const GENERIC_ENTITY_PLACEHOLDERS = ["Item", "User", "Record"];

export function isGenericPlaceholderValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return [...GENERIC_FEATURE_PLACEHOLDERS, ...GENERIC_ENTITY_PLACEHOLDERS].some((placeholder) => placeholder.toLowerCase() === normalized);
}

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

/** Returns the technology the user explicitly named, without inferring a different stack. */
export function explicitStackFromPrompt(prompt: string): string | undefined {
  const choices: Array<[RegExp, string]> = [
    [/\b(?:plain|static|vanilla)\s+html\b[^.\n]{0,40}\bcss\b[^.\n]{0,40}\b(?:javascript|java\s*script|js)\b|\bhtml\s*(?:\+|\/|,|and)\s*css\s*(?:\+|\/|,|and)\s*(?:javascript|java\s*script|js)\b/i, "Static HTML + CSS + JavaScript"],
    [/\bnext\.?js\b[^.\n]{0,40}\btypescript\b|\btypescript\b[^.\n]{0,40}\bnext\.?js\b/i, "Next.js + TypeScript"],
    [/\b(?:vite\s*(?:\+|\/|and|with)?\s*)?react\b[^.\n]{0,40}\btypescript\b|\btypescript\b[^.\n]{0,40}\breact\b[^.\n]{0,25}\bvite\b/i, "Vite + React + TypeScript"],
    [/\bvue\b[^.\n]{0,40}\btypescript\b/i, "Vue + TypeScript"],
    [/\bsveltekit\b[^.\n]{0,40}\btypescript\b/i, "SvelteKit + TypeScript"],
    [/\bastro\b[^.\n]{0,40}\btypescript\b/i, "Astro + TypeScript"],
    [/\bnode\.?js\b[^.\n]{0,40}\bexpress\b[^.\n]{0,40}\btypescript\b|\bexpress\b[^.\n]{0,40}\btypescript\b/i, "Node.js + Express + TypeScript"],
    [/\bpython\b[^.\n]{0,30}\bfastapi\b|\bfastapi\b/i, "Python + FastAPI"],
    [/\bpython\b[^.\n]{0,30}\bdjango\b|\bdjango\b/i, "Python + Django"],
    [/\basp\.?net\s+core\b|\b\.net\s+(?:web\s+)?api\b/i, "ASP.NET Core"],
    [/\b\.net\s+wpf\b|\bwpf\b/i, ".NET WPF"],
    [/\breact\s+native\b[^.\n]{0,25}\bexpo\b|\bexpo\b[^.\n]{0,25}\breact\s+native\b/i, "React Native + Expo"],
    [/\belectron\b[^.\n]{0,30}\breact\b/i, "Electron + React + TypeScript"],
    [/\btauri\b[^.\n]{0,30}\breact\b/i, "Tauri + React + TypeScript"],
    [/\bphaser\b[^.\n]{0,30}\btypescript\b/i, "Phaser + TypeScript"],
    [/\bgodot\b/i, "Godot"],
    [/\bunity\b/i, "Unity"],
  ];
  return choices.find(([pattern]) => pattern.test(prompt))?.[1];
}

export function explicitPlatformFromPrompt(prompt: string): string | undefined {
  if (/\b(?:static|plain|vanilla)\s+(?:web|website|site|html)|\bbrowser(?:-based)?\b|\bweb\s+(?:app|application|site|website|dashboard)\b/i.test(prompt)) return "Web app";
  if (/\bdesktop\s+(?:app|application)|\bwindows\s+(?:app|application)|\bmacos\s+(?:app|application)\b/i.test(prompt)) return "Desktop app";
  if (/\bmobile\s+(?:app|application)|\b(?:ios|iphone|ipad|android)\b[^.\n]{0,60}\b(?:app|application)\b/i.test(prompt)) return "Mobile app";
  if (/\b(?:backend|server-only|microservice|rest\s+api|web\s+api|api\s+(?:service|server))\b/i.test(prompt)) return "Backend service";
  if (/\b(?:browser\s+game|web\s+game|desktop\s+game|mobile\s+game|game)\b/i.test(prompt)) return "Game";
  return undefined;
}

/** Returns a datastore explicitly selected by the user. It is a build constraint, not a suggestion. */
export function explicitPersistenceFromPrompt(prompt: string): string | undefined {
  const choices: Array<[RegExp, string]> = [
    [/\bpostgres(?:ql)?\b/i, "PostgreSQL"],
    [/\bmysql\b/i, "MySQL"],
    [/\bsql\s+server\b|\bmssql\b/i, "SQL Server"],
    [/\bsqlite\b/i, "SQLite"],
    [/\bmongo(?:db)?\b/i, "MongoDB"],
    [/\bsupabase\b/i, "Supabase"],
    [/\b(?:localstorage|local storage)\b/i, "localStorage"],
  ];
  return choices.find(([pattern]) => pattern.test(prompt))?.[1];
}

function normalizedBriefItem(value: string): string {
  const clean = value
    .replace(/^\s*(?:and|or)\s+/i, "")
    .replace(/^\s*(?:include|including|with|plus)\s+/i, "")
    .replace(/[.;,:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "";
}

/** Extracts user-named product capabilities without relying on a project-specific catalogue. */
export function explicitFeaturesFromPrompt(prompt: string): string[] {
  const signal = /\b(?:acceptance|accessible|assign|assignment|audit|build|cancel|complete|completion|create|dashboard|delete|deploy|edit|empty|error|feedback|filter|health|history|import|integration tests?|kpis?|loading|migration|navigation|optimistic|overdue|permissions?|preventive|responsive|roles?|schedule|search|seeded|service|sort|status|test|typecheck|update|validation|workflow)\b/i;
  const clauses = prompt
    .replace(/\r/g, "")
    .split(/(?:\n+|[.;]\s+|,\s*)/)
    .map(normalizedBriefItem)
    .filter((clause) => clause.length >= 4 && clause.length <= 180)
    .filter((clause) => signal.test(clause))
    .filter((clause) => !/^build\s+[^.]{0,100}\b(?:using|with)\b/i.test(clause));
  return Array.from(new Map(clauses.map((clause) => [clause.toLowerCase(), clause])).values()).slice(0, 24);
}

function singularEntity(value: string): string {
  const clean = value
    .replace(/^(?:a|an|the|their|its|and)\s+/i, "")
    .replace(/\b(?:records?|models?|entities?)$/i, "")
    .replace(/ies$/i, "y")
    .replace(/(?<!s)s$/i, "")
    .trim();
  return clean ? clean.split(/\s+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ") : "";
}

/** Extracts explicitly enumerated domain nouns such as "organizations contain sites, assets, and work orders". */
export function explicitEntitiesFromPrompt(prompt: string): string[] {
  const candidates: string[] = [];
  for (const match of prompt.matchAll(/\b([a-z][a-z -]{1,40}?)\s+(?:contain|contains|has|have|includes?|comprises?)\s+([^.!?\n]{3,220})/gi)) {
    candidates.push(match[1]);
    candidates.push(...match[2].split(/\s*,\s*|\s+and\s+/i));
  }
  for (const match of prompt.matchAll(/\b([a-z][a-z-]{2,})\s+(?:tables?|details?|records?|history|flows?)\b/gi)) {
    candidates.push(match[1]);
  }
  if (/\b(?:role permissions?|role-based|role-aware|roles?\s+for)\b/i.test(prompt)) candidates.push("Role");
  const ignored = /^(?:And|Core|Create|Data|Edit|Filterable|Immutable|Migration Ready|Realistic|Searchable|Service|Status|Unit|Integration|Browser Acceptance)$/i;
  return Array.from(new Map(candidates
    .map(singularEntity)
    .filter((entity) => entity.length >= 3 && entity.length <= 50 && !ignored.test(entity))
    .map((entity) => [entity.toLowerCase(), entity])).values()).slice(0, 16);
}

/** Re-applies explicit brief facts after model refinement so a lossy response cannot weaken the contract. */
export function reconcileDiscoveryWithExplicitBrief(discovery: ProjectDiscoveryResult, prompt: string): ProjectDiscoveryResult {
  const features = explicitFeaturesFromPrompt(prompt);
  const entities = explicitEntitiesFromPrompt(prompt);
  const persistence = explicitPersistenceFromPrompt(prompt);
  const canonical = (item: string) => item.toLowerCase().replace(/^(?:and|also)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const merge = (explicit: string[], proposed: string[]) => {
    const merged: string[] = [];
    for (const item of [...explicit, ...proposed]) {
      const key = canonical(item);
      if (!key || merged.some((existing) => {
        const existingKey = canonical(existing);
        return existingKey === key || (existingKey.length >= 12 && key.length >= 12 && (existingKey.includes(key) || key.includes(existingKey)));
      })) continue;
      merged.push(item);
    }
    return merged;
  };
  const mainFeatures = merge(features, discovery.mainFeatures);
  const dataModel = merge(entities, discovery.dataModel);
  const decisions = discovery.decisions.map((item) => {
    if (item.dimension === "features" && features.length) return { ...item, hypothesis: mainFeatures.join(", "), confidence: 100, source: "user-confirmed" as const, action: "silent-infer" as const, question: undefined };
    if (item.dimension === "data-shape" && entities.length) return { ...item, hypothesis: dataModel.join(", "), confidence: 100, source: "user-confirmed" as const, action: "silent-infer" as const, question: undefined };
    if (item.dimension === "auth-database-api" && persistence) return { ...item, hypothesis: `${persistence} persistence with replaceable repository and migration boundaries`, confidence: 100, source: "user-confirmed" as const, action: "silent-infer" as const, question: undefined };
    return item;
  });
  const { questions, assumptions } = deriveQuestionsAndAssumptions(decisions);
  const keyFacts = persistence
    ? merge([`${persistence} persistence`], discovery.keyFacts.filter((fact) => !/\b(?:database later|local-first|sqlite|postgres(?:ql)?|mysql|mongodb|supabase)\b/i.test(fact)))
    : discovery.keyFacts;
  const futureCapabilities = persistence
    ? discovery.futureCapabilities.filter((item) => !/\b(?:real database|add a database|database once|postgres(?:ql)? later)\b/i.test(item))
    : discovery.futureCapabilities;
  return { ...discovery, mainFeatures, dataModel, decisions, questions, assumptions, keyFacts, futureCapabilities };
}

export type UserProductSignal = { productSignal: string; starterTitle?: string };

/** Preserves user-selected product scope without relying on a product-specific catalogue. */
export function reconcileDiscoveryWithUserProductSignal(
  discovery: ProjectDiscoveryResult,
  { productSignal, starterTitle }: UserProductSignal,
): ProjectDiscoveryResult {
  const signal = productSignal.replace(/\s+/g, " ").trim();
  if (!signal || /^(?:other\s*\/?\s*custom|other|general|custom|none|misc(?:ellaneous)?)$/i.test(signal)) return discovery;

  const platformWords = /\b(?:ios|android|mobile|desktop|web|website|app|application|game|api|service)\b/gi;
  const concepts = signal.split(/\s*[,;]\s*|\s+and\s+/i)
    .map((part) => normalizedBriefItem(part.replace(platformWords, " ")))
    .filter((part) => part.length >= 3)
    .slice(0, 12);
  if (!concepts.length) return discovery;

  const canonical = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const merge = (authoritative: string[], proposed: string[]) => Array.from(new Map(
    [...authoritative, ...proposed].filter(Boolean).map((item) => [canonical(item), item]),
  ).values());
  // Foundry's own placeholders must not ride along into a "user-confirmed" list.
  const mainFeatures = merge(concepts, discovery.mainFeatures.filter((item) => !isGenericPlaceholderValue(item) && !/^(?:home\/?dashboard screen|primary workflow(?: with offline-first state)?|core workflow|main workflow)$/i.test(item.trim())));
  const dataModel = merge(concepts.map(singularEntity).filter(Boolean), discovery.dataModel.filter((item) => !isGenericPlaceholderValue(item) && !/^(?:item\/?record|activity\/?event|resource|record|entity)$/i.test(item.trim())));
  const architecture = canonical(discovery.architecture).includes(canonical(signal))
    ? discovery.architecture
    : `${signal} built with ${discovery.recommendedStack}, organized around ${concepts.join(", ")}. ${discovery.architecture}`.trim();
  const decisions = discovery.decisions.map((item) => {
    if (item.dimension === "domain") return { ...item, hypothesis: signal, confidence: 100, source: "user-confirmed" as const, action: "silent-infer" as const, rationale: "The product scope comes directly from the user's selected subtype.", question: undefined };
    // Only claim "user-confirmed" when something the user actually said survives. With no real concepts
    // the value is Foundry's default, and it must keep its inferred/defaulted provenance and say so —
    // presenting a guess at 100% confidence as the user's own choice is the dishonest part.
    if (item.dimension === "features") return mainFeatures.length && !mainFeatures.every(isGenericPlaceholderValue)
      ? { ...item, hypothesis: mainFeatures.join(", "), confidence: 100, source: "user-confirmed" as const, action: "silent-infer" as const, rationale: "The leading capabilities preserve the user's selected product concepts.", question: undefined }
      : { ...item, hypothesis: mainFeatures.join(", "), rationale: "Foundry's default starting features for this category — not taken from your description. Edit them before building." };
    if (item.dimension === "data-shape") return dataModel.length && !dataModel.every(isGenericPlaceholderValue)
      ? { ...item, hypothesis: dataModel.join(", "), confidence: 100, source: "user-confirmed" as const, action: "silent-infer" as const, rationale: "The primary entities are derived from the user's selected product concepts.", question: undefined }
      : { ...item, hypothesis: dataModel.join(", "), rationale: "Foundry's default entities for this category — not taken from your description. Edit them before building." };
    if (item.dimension === "architecture") return { ...item, hypothesis: architecture, confidence: 100, source: "user-confirmed" as const, action: "silent-infer" as const, rationale: "The architecture is anchored to the selected product scope and starter stack.", question: undefined };
    return item;
  });
  const { questions, assumptions } = deriveQuestionsAndAssumptions(decisions);
  const keyFacts = merge([`User-selected product scope: ${signal}`], discovery.keyFacts.filter((fact) => !/^user-selected product scope:/i.test(fact)));
  return {
    ...discovery,
    prompt: [signal, starterTitle, discovery.prompt].filter(Boolean).join(". "),
    projectType: signal,
    architecture,
    mainFeatures,
    dataModel,
    decisions,
    questions,
    assumptions,
    keyFacts,
  };
}

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
    id: "pos",
    label: "Point-of-sale app",
    patterns: [/\b(point[ -]of[ -]sale|pos app|retail pos|restaurant pos|register terminal|checkout register)\b/i],
    stack: "Next.js",
    architecture:
      "Touch-first register application with an explicit transaction state machine, local-first cart and held-sale state, catalog and inventory boundaries, receipt generation, and auditable payment/refund records.",
    architectureRationale: "A transaction state machine prevents partial tenders, duplicate completion, and refunds from becoming ambiguous UI-only state.",
    style: "Dense register UI with large touch targets, keyboard and barcode-scanner paths, persistent totals, clear tender status, and restrained color reserved for exceptions.",
    styleRationale: "Cashiers need speed and error resistance, so the sell flow keeps totals and the next safe action continuously visible.",
    features: ["SKU/barcode product lookup", "Cart quantity, discounts, and tax", "Cash/card tender and change due", "Held cart restore", "Receipt generation", "Transaction history and refunds", "Low-stock visibility"],
    entities: ["Product/SKU", "Cart line", "Sale", "Payment/tender", "Receipt", "Register shift", "Refund", "Inventory movement"],
    users: "Cashiers, store managers, and retail operators.",
    platform: "Web app optimized for a touch register",
    complexity: "Transactional business application",
    growth: ["Hardware barcode and receipt-printer integration", "Multi-register shift reconciliation", "Offline transaction queue", "Role-based approvals", "Payment-provider integration"],
  },
  {
    id: "project-management",
    label: "Project management application",
    patterns: [/\b(project management|project tracker|project planning|kanban|task board|team workload|resource planning|project health)\b/i],
    stack: "Next.js + TypeScript",
    architecture:
      "Next.js App Router application with a typed project/task domain, reusable dashboard and kanban surfaces, local-first persistence for the initial runnable version, and clean service boundaries for later team sync or a database.",
    architectureRationale: "Project, task, status, assignment, and workload state belong to one coherent domain so board moves and dashboard totals cannot drift apart.",
    style: "Polished creative-operations workspace with a clear information hierarchy, restrained status color, fast filters, responsive board/list views, and accessible light and dark themes.",
    styleRationale: "Agency teams switch rapidly between portfolio health, individual tasks, and workload, so the interface must stay scannable without flattening everything into a generic table.",
    features: ["Project health dashboard", "Searchable and filterable project portfolio", "Kanban task board with status changes", "Team workload and assignment view", "Notifications and activity", "Workspace settings", "Responsive navigation", "Persistent local changes"],
    entities: ["Project", "Task", "Team member", "Assignment", "Status", "Milestone", "Notification", "Workspace setting"],
    users: "Creative-agency project managers, team leads, and contributors.",
    platform: "Web app",
    complexity: "Multi-screen collaborative business application",
    growth: ["Real-time team synchronization", "Role-based permissions", "Client portal", "Time tracking and budgets", "Calendar and external integrations"],
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
    // Ordinary ways people describe a presentation site. Requiring the literal word "website" sent a
    // creative-agency brief to the generic CRUD fallback. "Portfolio" alone stays ambiguous
    // (creative vs. investment portfolio) and still needs site/website/personal to disambiguate.
    patterns: [/\b(blog|website|web site|portfolio (site|website)|personal portfolio|landing page|marketing site|docs site|content site|agency (?:site|website|portfolio)|studio (?:site|website|portfolio)|brochure|showcase|case stud(y|ies)|our work)\b/i],
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

export type DiscoverySeed = {
  /** Domain label, e.g. "Inventory management system" — same vocabulary discoverProject() uses for projectType. */
  domainGuess: string;
  /** Stable id for the matched profile ("inventory", "game", "custom", ...) — a coarse category hint, not a final stack/category decision. */
  categoryGuess: string;
  confidence: "low" | "medium";
};

/**
 * Stage A of the Discovery Engine (lib/discovery/engine.ts's seedDiscovery()) — a fast, synchronous,
 * zero-authored-prose guess used only to populate the DiscoveryRail instantly on card click/keystroke,
 * before the mandatory LLM pass (Stage B, /api/factory/discover) produces the real analysis. Reuses
 * the same profile-matching table discoverProject() still uses today for its fuller (soon-to-shrink)
 * heuristic result — kept as one function so the domain-matching logic isn't duplicated.
 */
export function guessDomainSeed(prompt: string): DiscoverySeed {
  const normalized = prompt.trim();
  const profile = chooseProfile(normalized);
  return {
    domainGuess: profile?.label ?? deriveTarget(normalized),
    categoryGuess: profile?.id ?? "custom",
    confidence: profile ? "medium" : "low",
  };
}

export function actionForDecision(confidence: number, stakes: DiscoveryStakes): DiscoveryAction {
  const highConfidence = confidence >= HIGH_CONFIDENCE;
  if (highConfidence && stakes === "low") return "silent-infer";
  if (highConfidence && stakes === "high") return "disclose";
  if (!highConfidence && stakes === "high") return "ask";
  return "default-disclose";
}

/**
 * The starter the user explicitly picked is authoritative for the domain profile. Profile matching used
 * to read the prompt alone, so "Northstar for creative agency" matched none of the content profile's
 * literal keywords (website|blog|landing page|marketing site|portfolio site) and fell through to the
 * generic custom fallback — a Website starter was handed CRUD-app defaults ("Primary workspace", "Core
 * create/edit workflow", entities "Item, User, Record"). The user already told us what this is.
 */
const STARTER_PROFILE_IDS: Record<string, string> = {
  website: "content",
  dashboard: "dashboard",
  commerce: "commerce",
  inventory: "inventory",
  pos: "pos",
  api: "api",
  game: "game",
  mobile: "mobile",
  desktop: "desktop",
};

export function discoverProject(prompt: string, starterId?: string): ProjectDiscoveryResult {
  const normalized = prompt.trim();
  const starterProfile = starterId ? profiles.find((item) => item.id === STARTER_PROFILE_IDS[starterId]) : undefined;
  const profile = chooseProfile(normalized) ?? starterProfile;
  const ambiguity = ambiguityScore(normalized, profile);
  const words = normalized.split(/\s+/).filter(Boolean).length;
  const explicitSignals = [
    explicitStackFromPrompt(normalized),
    explicitPlatformFromPrompt(normalized),
    /\b(?:include|including|must|needs?|features?|requirements?)\b/i.test(normalized) ? "requirements" : undefined,
    /\b(?:database|prisma|sqlite|postgres|mysql|auth|login|api|localstorage|local storage)\b/i.test(normalized) ? "data" : undefined,
  ].filter(Boolean).length;
  const measuredSpecificity = Math.floor(words / 3) + explicitSignals * 9;
  const customSpecificity = Math.min(46, explicitStackFromPrompt(normalized) && words >= 14 ? Math.max(40, measuredSpecificity) : measuredSpecificity);
  const baseConfidence = profile ? Math.max(42, 92 - ambiguity) : Math.max(25, Math.min(94, 48 + customSpecificity - ambiguity));
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

  return reconcileDiscoveryWithExplicitBrief({
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
  }, normalized);
}

function chooseProfile(prompt: string) {
  const rankedMatches = (value: string) => profiles
    .map((profile) => ({ profile, score: profile.patterns.reduce((score, pattern) => score + (pattern.test(value) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  // Classify the product the user named, not a secondary capability in a later feature list.
  // "Build a repair-shop operations app. Include parts inventory" is a repair-shop product,
  // not an inventory starter. The real discovery model still reasons over the full brief; this
  // zero-cost seed is deliberately conservative so it cannot anchor that model or the UI wrongly.
  const primaryClause = prompt
    .split(/(?:[.!?]\s+|\b(?:include|including|features?|featuring|it (?:also )?needs?|with support for)\b)/i, 1)[0]
    ?.trim() ?? prompt.trim();
  const primaryMatch = rankedMatches(primaryClause)[0]?.profile;
  if (primaryMatch) return primaryMatch;

  const hasSecondaryFeatureList = primaryClause.length + 8 < prompt.trim().length;
  if (hasSecondaryFeatureList) return undefined;
  return rankedMatches(prompt)[0]?.profile;
}

function defaultProfile(prompt: string): SignalProfile {
  const label = deriveTarget(prompt);
  const explicitStack = explicitStackFromPrompt(prompt);
  const explicitPlatform = explicitPlatformFromPrompt(prompt);
  const featureClauses = prompt
    .replace(/\r/g, "")
    .split(/(?:\n\s*[-*\u2022]?\s*|[.;]\s*|,\s*)/i)
    .map((clause) => clause.replace(/^.*?\b(?:include|including|features?|must|needs?|should)\b\s*:?[ ]*/i, "").trim())
    .filter((clause) => clause.length >= 5 && clause.length <= 120)
    .filter((clause) => /\b(?:add|allow|calendar|create|dashboard|delete|edit|filter|form|import|manage|pin|report|search|show|support|track|update|workflow)\b/i.test(clause))
    .slice(0, 10)
    .map((clause) => clause.charAt(0).toUpperCase() + clause.slice(1).replace(/[.,;:]$/, ""));
  const meaningfulFeatureClauses = featureClauses.length > 1
    ? featureClauses.filter((clause) => !/^create\b[^.]{0,80}\b(?:app|application|website|service|project)\b/i.test(clause))
    : featureClauses;
  const features = meaningfulFeatureClauses.length
    ? Array.from(new Set(meaningfulFeatureClauses))
    : [...GENERIC_FEATURE_PLACEHOLDERS];
  const platform = explicitPlatform ?? (/\b(?:fastapi|express|asp\.?net|api)\b/i.test(explicitStack ?? "") ? "Backend service" : "Web app");
  const architecture = explicitStack
    ? `${explicitStack} project organized around the requested workflows, with typed domain boundaries where the stack supports them and a runnable build, test, and preview path.`
    : "Application with an editable first version, explicit domain boundaries, and a runnable verification path; persistence and integrations remain clean seams until the brief requires them.";
  const actionEntities = Array.from(prompt.matchAll(/\b(?:add|create|delete|edit|filter|find|manage|pin|schedule|search|show|track|update|cancel)(?:\s*\/\s*(?:add|create|delete|edit|filter|find|manage|pin|schedule|search|show|track|update|cancel))*\s+(?:a|an|new|the|their)?\s*([a-z][a-z-]{2,})/gi)).map((match) => match[1]);
  const surfaceEntities = Array.from(prompt.matchAll(/\b([a-z][a-z-]{2,})\s+(?:table|detail|records?|flows?|catalog|directory|history|search|filters?)\b/gi)).map((match) => match[1]);
  const entityCandidates = [...actionEntities, ...surfaceEntities]
    .map((entity) => entity.replace(/ies$/i, "y").replace(/s$/i, ""))
    .filter((entity) => !/^(?:and|app|application|business|data|detail|favorite|filter|logic|medium-complexity|new|project|state|statu|status|with|workflow)$/i.test(entity))
    .map((entity) => entity.charAt(0).toUpperCase() + entity.slice(1).toLowerCase());
  const entities = Array.from(new Set(entityCandidates)).slice(0, 8);
  return {
    id: "custom",
    label,
    patterns: [],
    stack: explicitStack ?? "Next.js + TypeScript",
    architecture,
    architectureRationale: explicitStack ? "The user named the implementation stack, so discovery preserves it and plans verification around its native toolchain." : "A runnable, testable boundary avoids locking in technology the user did not request.",
    style: "Clean, practical product UI until a stronger brand or audience signal is provided.",
    styleRationale: "Without a stronger signal on brand or audience, a clean neutral baseline is safer to build on than guessing at a specific aesthetic.",
    features,
    entities: entities.length ? entities : ["Item", "User", "Record"],
    users: "The target users are not specific yet.",
    platform,
    complexity: features.length >= 6 || /\b(?:production-ready|multi-tenant|roles?|permissions?|audit|integration|prisma|database)\b/i.test(prompt) ? "Feature-rich production application" : "Focused custom application",
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
  const detailed = words.length >= 18 || Boolean(explicitStackFromPrompt(prompt)) || /\b(?:include|including|must|needs?|requirements?|features?)\b/i.test(prompt);
  return (detailed ? 0 : 24) + (vague ? 28 : 0) + (veryShort ? 14 : 0);
}

function authConfidence(prompt: string, profile: SignalProfile) {
  if (/\b(login|auth|account|user accounts?|database|db|api|backend|server|persist|save data|local\s*storage|localstorage|payments?|checkout|prisma|postgres(?:ql)?|mysql|sqlite|mongodb)\b/i.test(prompt)) return 92;
  // A recognized domain profile is enough for Foundry to commit to a sensible default
  // without asking — only a genuinely unmatched (custom) domain stays uncertain here.
  if (profile.id === "custom") return 58;
  return 78;
}

function authSource(prompt: string): DiscoverySource {
  return /\b(login|auth|account|database|api|backend|server|persist|save data|local\s*storage|localstorage|prisma|postgres(?:ql)?|mysql|sqlite|mongodb)\b/i.test(prompt) ? "observed" : "defaulted";
}

function authDataApiFor(prompt: string, profile: SignalProfile) {
  if (profile.id === "auth-page") return "Email/password plus Google and GitHub OAuth, JWT sessions in httpOnly cookies, and a password-reset flow with expiring tokens.";
  if (/\b(?:pax|poslink|payment terminal|licensed sdk|sandbox transaction|do not simulate (?:hardware|payments?))\b/i.test(prompt)) return "Durable local catalog/cart state plus a real licensed terminal-SDK boundary; payment, device discovery, and transaction outcomes must be verified rather than mocked.";
  if (/\b(login|auth|account)\b/i.test(prompt)) return "Account/auth-ready UI wired to a real session model, not just a static form.";
  if (/\b(?:local\s*storage|localstorage)\b/i.test(prompt)) return "Browser-local persistence for the first version, with serialization isolated from the UI so it can be replaced by a service later.";
  if (/\b(database|db|persist|save data|prisma|postgres(?:ql)?|mysql|sqlite|mongodb)\b/i.test(prompt)) return "A persistent data boundary (typed models, migration-ready) rather than local-only state.";
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

export function explicitProjectNameFromPrompt(prompt: string): string | undefined {
  const named = prompt.match(/\b(?:called|named)\s+["']?([A-Za-z0-9][A-Za-z0-9 _-]{1,79}?)["']?(?=[.,;]|\s+(?:using|with|that|which)\b|$)/i)?.[1];
  const buildAs = prompt.match(/^\s*(?:build|create|make|develop)\s+(?:me\s+)?["']?(.{2,80}?)["']?\s+(?:as|using|with)\b/i)?.[1];
  const value = (named || buildAs)?.replace(/\s+/g, " ").trim();
  if (!value || value.split(/\s+/).length > 8) return undefined;
  return value;
}

function deriveTarget(prompt: string) {
  const explicitName = explicitProjectNameFromPrompt(prompt);
  if (explicitName) return explicitName;
  const primary = prompt
    .split(/(?:\n|[.!?]\s+|\b(?:using|built with|in)\s+(?:plain |static |vanilla )?(?:html|react|next\.?js|vue|svelte|astro|node|python|\.net)|\b(?:include|including|features?|must|needs?|with support for)\b)/i, 1)[0]
    ?.slice(0, 100) ?? prompt;
  const target = primary
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
