import {
  actionForDecision,
  deriveQuestionsAndAssumptions,
  discoveryDimensions,
  discoverySourceValues,
  discoveryStakesValues,
  questionFor,
} from "@/lib/ai/project-discovery";
import type { DiscoveryDecision, DiscoveryDimension, DiscoverySource, DiscoveryStakes, ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import type { NeutralTool } from "@/lib/ai/providers/types";

export type DiscoveryRefinementContext = {
  starter: { id: string; title: string };
  subtype: string;
  customSubtype: string;
  projectDescription: string;
  location: {
    choice: string;
    label: string;
    existingSourceRisky: boolean;
    existingSourceSignals: string[];
  };
};

const TOOL_NAME = "refine_project_discovery";
const MIN_VALID_DECISIONS = 3;
const MIN_VALID_STACK_OPTIONS = 2;

export type StackOption = { name: string; why: string; recommended: boolean };

/** Local safety net used only when the model's stack_options array is missing/malformed — never the primary recommendation source. */
export const FALLBACK_STACK_OPTIONS: StackOption[] = [
  { name: "Next.js", why: "A safe, broadly capable default for most web products.", recommended: true },
  { name: "Node/Express", why: "A minimal, widely-understood choice for a backend-only service.", recommended: false },
  { name: "Python/FastAPI", why: "A strong option when the work is data/AI-heavy.", recommended: false },
  { name: "Static HTML", why: "The simplest option for a page with no dynamic backend needs.", recommended: false },
];

export const REFINE_PROJECT_DISCOVERY_TOOL: NeutralTool = {
  name: TOOL_NAME,
  description: "Refine a heuristic first-pass project understanding into a sharper, more specific decision memo for the user.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      lede: { type: "string" },
      project_type: { type: "string" },
      recommended_stack: { type: "string" },
      architecture: { type: "string" },
      style_direction: { type: "string" },
      main_features: { type: "array", items: { type: "string" } },
      data_model: { type: "array", items: { type: "string" } },
      alternative_stacks: { type: "array", items: { type: "string" } },
      deployment_note: { type: "string" },
      key_facts: { type: "array", items: { type: "string" } },
      future_capabilities: { type: "array", items: { type: "string" } },
      stack_options: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            why: { type: "string" },
            recommended: { type: "boolean" },
          },
          required: ["name", "why", "recommended"],
        },
      },
      decisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            dimension: { type: "string", enum: discoveryDimensions as unknown as string[] },
            hypothesis: { type: "string" },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            stakes: { type: "string", enum: discoveryStakesValues as unknown as string[] },
            source: { type: "string", enum: discoverySourceValues as unknown as string[] },
            rationale: { type: "string" },
            question: { type: ["string", "null"] },
          },
          required: ["dimension", "hypothesis", "confidence", "stakes", "source", "rationale", "question"],
        },
      },
    },
    required: ["lede", "project_type", "recommended_stack", "architecture", "style_direction", "main_features", "data_model", "alternative_stacks", "deployment_note", "key_facts", "future_capabilities", "stack_options", "decisions"],
  },
};

export const DISCOVERY_REFINEMENT_SYSTEM_PROMPT = [
  "You are a principal software architect who has just heard a one-line project request. You've already spent an hour thinking about it in your head, and you're now writing down your understanding for the person who asked — not interviewing them. You are refining a first-pass heuristic guess for Foundry, an AI software factory.",
  "You are given a heuristic (keyword-matched) guess plus the user's actual starter choice, subtype, and any free-text description.",
  "TRUST THE ACTUAL REQUEST OVER THE HEURISTIC. The heuristic is a dumb keyword matcher and is sometimes flatly wrong — e.g. it will mislabel \"gym signup page\" or \"event registration for a workshop\" as a generic login/auth page just because the word \"signup\" appears. If the heuristic's project_type/architecture/style/features don't actually fit the real request, DISCARD them and reclassify from scratch based on what the person actually described. Never let the heuristic anchor you into the wrong category.",
  "A portfolio, landing page, marketing site, brochure site, and other public showcase are presentation experiences by default—not CRUD applications. Do not invent visible add/edit/delete forms, admin controls, localStorage content management, or optimistic mutation flows unless the user explicitly asks to manage content inside the site. Put the visitor experience first: hierarchy, work samples, storytelling, navigation, contact, accessibility, responsive composition, and visual polish.",
  "BE DECISIVE. A principal architect assumes correctly about 95% of the time and only asks about the few things that would actually change the architecture if the answer were different (e.g. single-tenant vs multi-tenant, whether auth is required, whether a specific compliance/payment requirement applies). Do not ask about things you can reasonably infer — likely users, complexity, visual style, and navigation should almost always be confident assumptions, never questions. Target at most 1-3 'ask' decisions total across all 10 dimensions, and only when the answer is genuinely architecture-changing. Every decision you don't ask about should read as a stated fact, not a hedge.",
  "RIGHT-SIZE THE STACK AND ARCHITECTURE TO THE ACTUAL PROJECT. Match the complexity of your recommendation to the real complexity of the request — a small single-user tool must not get an enterprise stack. A static page, a personal to-do/task list, a landing page, a calculator, a timer, a quiz, a portfolio, or any small client-only tool with no real multi-user backend need is best built with plain HTML/CSS/JS (or a tiny static setup) — recommending Next.js/React, an ORM, or a database for something this small is over-engineering and is the WRONG answer. Only reach for a full framework, server, ORM, or database when the project genuinely needs one: real persistence shared across users/devices, authentication, server-side workflows, or many related data entities. When in doubt for something small, prefer the simplest thing that fully does the job. Do NOT frame a genuinely simple project as 'production-ready' or lean on 'scalable enough to grow into…' to justify a heavier stack than it needs.",
  "THE FIRST BUILD MUST BE LOCALLY RUNNABLE AND VERIFIABLE. Unless the user explicitly requested an external/shared production datastore or supplied an existing service connection, prefer zero-setup persistence (SQLite, an embedded store, or local files) for the first working build and describe the seam for PostgreSQL/MySQL/hosted storage later. Never silently recommend a stack that requires DATABASE_URL, REDIS_URL, hosted-service credentials, or another secret to start. If an external service is genuinely required now, make auth-database-api an ask decision and ask whether the connection is already configured before implementation begins.",
  "Name real technologies, patterns, and providers, not categories. 'Secure authentication' is not a decision — 'JWT sessions in httpOnly cookies, bcrypt password hashing, middleware-enforced route protection, Google + GitHub OAuth, magic-link support' is. 'Responsive layout' is not a decision — 'glassmorphism card over an animated gradient, dark-mode-first palette, inline validation, skeleton loading states' is.",
  "Apply this same level of specificity across domains: for auth/accounts name providers and session/security mechanisms; for e-commerce/inventory name the data operations and table/workflow patterns; for dashboards name the chart/filter/drill-down mechanics; for games name the scene/input/scoring mechanics; for APIs name the validation/error/versioning approach; for anything else (bookings, registrations, memberships, niche tools) reason from first principles the same way — never fall back to a generic label just because it doesn't match one of these examples.",
  "For decisions: rewrite each hypothesis to be specific — 8-16 words naming real things, not a 2-3 word label. rationale must be ONE short sentence explaining WHY this is the right call for this specific project (not a generic process note like 'this can be adjusted later') — e.g. 'Chosen because inventory staff spend hours inside dense tables where speed matters more than decoration,' not 'Style follows the domain.'",
  "Set 'question' only for the rare genuinely architecture-changing dimension; otherwise use null. Phrase any question tersely, like a colleague asking a sharp clarifying question, e.g. 'Single business or multi-tenant?' not 'What kind of tool or product is this, and who is it for?'",
  "Cover all 10 dimensions: domain, likely-users, complexity, platform, data-shape, architecture, features, style, navigation, auth-database-api.",
  "lede: 3-5 sentences (fewer for a simple project), written in a confident first-person-plural voice, painting a picture of the product like an architect describing it to a colleague — not a technical restatement. For a substantial product, gesture at where it grows (e.g. 'while remaining scalable enough to grow into X, Y, Z'); for a simple tool, do the opposite — affirm that it stays small and focused, and do not invent enterprise ambitions it doesn't have. Match the tone to the real scale: a personal to-do list is 'a fast, no-friction personal task list that just works,' NOT 'a production-ready task management platform.'",
  "key_facts: 5-8 short, confident, decisive tags (3-8 words each, no percentages, no hedging language) capturing the most important things you now understand about this project — the kind of list that makes someone think 'I never told it that, but that's exactly right.' Example: 'Production-ready inventory management application', 'Business operations workflow', 'Responsive web application', 'Modern SaaS interface', 'Next.js App Router', 'Local-first development'.",
  "future_capabilities: 4-6 SPECIFIC capabilities you predict this project will need later even though they're out of scope for v1 — the kind of thing that makes the user think 'it already planned for that?'. Ground these in the actual domain (e.g. for inventory: purchase orders, vendor management, audit trail, barcode scanning, role-based permissions — not generic items like 'add more features').",
  "alternative_stacks should list 1-3 other reasonable stack choices distinct from recommended_stack.",
  "deployment_note should be one or two sentences about how this specific project would ship.",
  "stack_options: propose 3-5 concrete stacks that could ALL build the exact same architecture/features/data-model you just decided — i.e. variants of one plan, not independent guesses at different products. The set must be right-sized to the project (see the right-sizing rule above): for a genuinely simple/static/client-only project, the recommended option AND the alternatives should be lightweight (e.g. 'HTML/CSS/JS (vanilla)', 'HTML + Alpine.js', 'Astro static', 'SvelteKit') — do NOT pad the list with heavyweight framework/database stacks just to show variety, and do NOT force a JS+Python+JVM spread onto something that has no backend. Only for projects that genuinely need a backend should you span different backend languages (e.g. 'Next.js (TypeScript)', 'Python/FastAPI', 'Java/Spring Boot'), each named specifically — not just 'JavaScript'. Exactly one entry has recommended:true — your actual best pick, matching recommended_stack. Each 'why' is one short sentence on why that specific stack fits THIS project, not a generic language pitch.",
  "A stack option must be DELIVERY-COMPLETE for the stated requirements, not merely a framework name. When applicable, name the UI/runtime, API framework, datastore, ORM/migrations, authentication/session mechanism, email/jobs/cache/realtime providers or adapter seams, test framework, and deployment shape. Verify that every option covers every architecture-changing feature before recommending it. Never say a choice aligns with an existing architecture when the user is creating a new workspace with no inspected project evidence.",
  "Always call refine_project_discovery. Do not answer in prose.",
].join("\n");

export function discoveryRefinementUserText(context: DiscoveryRefinementContext, heuristic: ProjectDiscoveryResult): string {
  return JSON.stringify({ context, heuristic }, null, 2);
}

export type DiscoveryRefinementDepth = "starter-stack" | "compact-custom" | "full";

/**
 * Decides how much of the understanding the model regenerates.
 *
 * `starter-stack` only re-picks the stack and keeps the generic category template for features,
 * entities, and architecture. That is correct ONLY when the user picked a starter card and typed no
 * real description — then the template is genuinely all we know.
 *
 * The bug this fixes: selecting a starter forced `starter-stack` even when the user *also* described a
 * specific product, so a habit tracker and a delivery-driver app produced byte-identical boilerplate —
 * only the stack ever differed. When a substantive description exists, regenerate the full
 * understanding from it. The route's platform-contract reconciliation still pins the starter's stack
 * family (mobile stays React Native), so this changes the *understanding*, not the platform.
 */
export function discoveryRefinementDepth(input: {
  knownStarter: boolean;
  descriptionWordCount: number;
  /** Words of meaningful, non-generic subtype/category the user picked (0 for a placeholder subtype). */
  subtypeWordCount: number;
  highConfidenceCustom: boolean;
}): DiscoveryRefinementDepth {
  // Product signal can arrive two ways: a typed description, OR a specific subtype/category the user
  // selected. The first version of this fix only counted the typed description, so picking "Mobile App"
  // + a subtype like "Workout Trackers, Calorie Counters, Meditation Timers" with no typed sentence
  // still fell through to the generic template. A chosen subtype is real signal and must count — a
  // couple of meaningful words is enough, since a subtype is already a product category, not prose.
  const hasProductSignal = input.descriptionWordCount >= 8 || input.subtypeWordCount >= 2;
  if (input.knownStarter && !hasProductSignal) return "starter-stack";
  if (input.highConfidenceCustom) return "compact-custom";
  // A starter card plus real product signal, or an ambiguous custom brief, both get the full
  // description-driven refinement.
  return "full";
}

export type DiscoveryRefinementResult = {
  discovery: ProjectDiscoveryResult;
  alternativeStacks: string[];
  deploymentNote: string;
  lede: string;
  stackOptions: StackOption[];
};

export function hasCompleteDiscoveryRefinement(rawArguments: string | undefined): boolean {
  if (!rawArguments) return false;
  try {
    const value = JSON.parse(rawArguments) as Record<string, unknown>;
    const requiredText = ["lede", "project_type", "recommended_stack", "architecture", "style_direction", "deployment_note"];
    const requiredArrays = ["main_features", "data_model", "alternative_stacks", "key_facts", "future_capabilities", "stack_options", "decisions"];
    return Boolean(value)
      && requiredText.every((key) => typeof value[key] === "string" && Boolean((value[key] as string).trim()))
      && requiredArrays.every((key) => Array.isArray(value[key]))
      && (value.stack_options as unknown[]).length >= MIN_VALID_STACK_OPTIONS
      && (value.decisions as unknown[]).length >= MIN_VALID_DECISIONS;
  } catch {
    return false;
  }
}

/**
 * Defensively parses the model's tool-call arguments into a refined discovery result.
 * Never trusts the model for `action`/`questions`/`assumptions` — those are always
 * recomputed deterministically from (confidence, stakes) so the model cannot violate
 * the silent-infer/disclose/ask/default-disclose policy no matter what it returns.
 * Falls back field-by-field to the heuristic result on any structural problem.
 */
export function parseDiscoveryRefinement(rawArguments: string | undefined, heuristic: ProjectDiscoveryResult): DiscoveryRefinementResult {
  const fallback: DiscoveryRefinementResult = { discovery: heuristic, alternativeStacks: [], deploymentNote: "", lede: "", stackOptions: FALLBACK_STACK_OPTIONS };
  if (!rawArguments) return fallback;

  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments);
  } catch {
    return fallback;
  }

  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Record<string, unknown>;

  const decisions = parseDecisions(value.decisions, heuristic.decisions);
  const { questions, assumptions } = deriveQuestionsAndAssumptions(decisions);

  return {
    discovery: {
      prompt: heuristic.prompt,
      projectType: stringOr(value.project_type, heuristic.projectType),
      recommendedStack: stringOr(value.recommended_stack, heuristic.recommendedStack),
      architecture: stringOr(value.architecture, heuristic.architecture),
      styleDirection: stringOr(value.style_direction, heuristic.styleDirection),
      mainFeatures: stringArrayOr(value.main_features, heuristic.mainFeatures),
      dataModel: stringArrayOr(value.data_model, heuristic.dataModel),
      assumptions,
      questions,
      decisions,
      keyFacts: stringArrayOr(value.key_facts, heuristic.keyFacts),
      futureCapabilities: stringArrayOr(value.future_capabilities, heuristic.futureCapabilities),
    },
    alternativeStacks: stringArrayOr(value.alternative_stacks, []),
    deploymentNote: stringOr(value.deployment_note, ""),
    lede: stringOr(value.lede, ""),
    stackOptions: parseStackOptions(value.stack_options),
  };
}

function parseStackOptions(raw: unknown): StackOption[] {
  if (!Array.isArray(raw)) return FALLBACK_STACK_OPTIONS;

  const cleaned: StackOption[] = [];
  for (const item of raw) {
    const option = parseStackOption(item);
    if (option) cleaned.push(option);
  }
  if (cleaned.length < MIN_VALID_STACK_OPTIONS) return FALLBACK_STACK_OPTIONS;

  // Exactly one recommended option: if the model marked none or more than one, defer to the first
  // valid entry rather than showing an ambiguous or empty recommendation.
  if (cleaned.filter((option) => option.recommended).length !== 1) {
    return cleaned.map((option, index) => ({ ...option, recommended: index === 0 }));
  }
  return cleaned;
}

function parseStackOption(raw: unknown): StackOption | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return null;
  const why = typeof value.why === "string" ? value.why.trim() : "";
  return { name, why, recommended: Boolean(value.recommended) };
}

function parseDecisions(raw: unknown, fallback: DiscoveryDecision[]): DiscoveryDecision[] {
  if (!Array.isArray(raw)) return fallback;

  const cleaned: DiscoveryDecision[] = [];
  for (const item of raw) {
    const decision = parseDecision(item);
    if (decision) cleaned.push(decision);
  }

  return cleaned.length >= MIN_VALID_DECISIONS ? cleaned : fallback;
}

function parseDecision(raw: unknown): DiscoveryDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const dimension = discoveryDimensions.find((candidate) => candidate === value.dimension) as DiscoveryDimension | undefined;
  if (!dimension) return null;

  const hypothesis = typeof value.hypothesis === "string" ? value.hypothesis.trim() : "";
  if (!hypothesis) return null;

  const confidence = clampConfidence(value.confidence);
  const stakes = discoveryStakesValues.find((candidate) => candidate === value.stakes) as DiscoveryStakes | undefined ?? "low";
  const source = discoverySourceValues.find((candidate) => candidate === value.source) as DiscoverySource | undefined ?? "inferred";
  const rationale = typeof value.rationale === "string" ? value.rationale.trim() : "";

  const action = actionForDecision(confidence, stakes);
  const partial: DiscoveryDecision = { dimension, hypothesis, confidence, stakes, source, rationale, action };
  if (action !== "ask") return partial;

  const question = typeof value.question === "string" && value.question.trim() ? value.question.trim() : questionFor(partial);
  return { ...partial, question };
}

function clampConfidence(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 50;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return cleaned.length ? cleaned : fallback;
}
