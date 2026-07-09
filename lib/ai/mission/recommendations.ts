export type MissionRecommendation = {
  id: string;
  label: string;
  why: string;
  estimatedMinutes: number;
  task: string;
};

export type RecommendationContext = {
  brief: string;
  objective: string;
  stack: string;
  changedFiles: string[];
  checklistLabels: string[];
};

/**
 * Domain-blind fallback used before the LLM call resolves and whenever it fails or no API key
 * is configured. Deliberately generic (never names a specific business domain) — the LLM path is
 * what produces domain-aware picks like "Add KPI cards" for an inventory app; this heuristic only
 * has to be true of software in general, so it stays honest instead of guessing a domain wrong.
 */
export function genericRecommendations(stack: string): MissionRecommendation[] {
  const isApi = /\b(api|express|fastapi|django|flask|backend|microservice)\b/i.test(stack);
  const isDesktop = /\b(electron|wpf|winforms|tauri|desktop)\b/i.test(stack);

  if (isApi) {
    return [
      rec("api-validation", "Add request validation", "Unvalidated input is the most common source of production bugs in a new API.", 6, "Add request validation (types, required fields, sane limits) to every endpoint and return clear 400 errors."),
      rec("api-errors", "Standardize error responses", "Consistent error shapes make the API predictable for anyone building against it.", 5, "Standardize error responses across all endpoints into one consistent JSON shape with status codes."),
      rec("api-tests", "Add endpoint tests", "A few request/response tests catch regressions before they ship.", 8, "Add automated tests covering the core endpoints' success and failure paths."),
      rec("api-docs", "Document the endpoints", "Undocumented endpoints slow down anyone else who needs to use this API.", 5, "Write brief endpoint documentation (method, path, request/response shape) for the API."),
      rec("api-auth", "Add rate limiting / auth", "Public endpoints without limits are an easy target once this is live.", 7, "Add basic rate limiting and, if not already present, an auth check on write endpoints."),
    ];
  }

  if (isDesktop) {
    return [
      rec("desktop-errors", "Add error dialogs", "Unhandled exceptions in a desktop app crash silently with no user feedback.", 6, "Add user-facing error dialogs for the operations that can currently fail silently."),
      rec("desktop-persist", "Persist window/app state", "Users expect a desktop app to remember where they left off.", 5, "Persist window size/position and last-used state between launches."),
      rec("desktop-shortcuts", "Add keyboard shortcuts", "Power users expect keyboard shortcuts for the most common actions.", 5, "Add keyboard shortcuts for the most frequently used actions."),
      rec("desktop-empty", "Polish empty & loading states", "First-run and empty-data screens are usually the least polished part of a new app.", 4, "Polish the empty-state and loading-state screens so first launch feels finished."),
    ];
  }

  return [
    rec("web-empty", "Polish loading & empty states", "First impressions come from empty and loading screens more than the happy path.", 4, "Polish the loading and empty-state screens across the app."),
    rec("web-search", "Add search and filtering", "Any list of records benefits from being searchable once there's more than a handful.", 6, "Add search and basic filtering to the main list/table view."),
    rec("web-responsive", "Make it responsive on mobile", "The layout should hold up below tablet width, not just on desktop.", 7, "Audit and fix the layout for mobile widths down to 375px."),
    rec("web-errors", "Add error handling", "Right now a failed request likely fails silently with no feedback to the user.", 5, "Add visible error handling and retry affordances for failed requests."),
    rec("web-a11y", "Improve accessibility", "Keyboard navigation and labels are usually missing from a first pass.", 6, "Improve keyboard navigation and add accessible labels to interactive elements."),
    rec("web-darkmode", "Add dark mode", "A dark theme is a common, low-risk polish request once the core UI is stable.", 8, "Add a dark mode theme toggle."),
  ];
}

function rec(id: string, label: string, why: string, estimatedMinutes: number, task: string): MissionRecommendation {
  return { id, label, why, estimatedMinutes, task };
}

const TOOL_NAME = "suggest_improvements";
const MIN_VALID_RECOMMENDATIONS = 3;

export const SUGGEST_IMPROVEMENTS_TOOL = {
  type: "function",
  name: TOOL_NAME,
  strict: true,
  description: "Suggest the highest-value next improvements for the project that was just built or modified.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      recommendations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            why: { type: "string" },
            estimated_minutes: { type: "integer", minimum: 1, maximum: 60 },
            task: { type: "string" },
          },
          required: ["label", "why", "estimated_minutes", "task"],
        },
      },
    },
    required: ["recommendations"],
  },
} as const;

export function buildRecommendationsRequestBody(context: RecommendationContext, model: string) {
  return {
    model,
    reasoning: { effort: "low" },
    tools: [SUGGEST_IMPROVEMENTS_TOOL],
    tool_choice: { type: "function", name: TOOL_NAME },
    max_output_tokens: 1500,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You are a senior engineer who just finished a piece of work on a real project. You now proactively suggest the highest-value next improvements, the way a good engineer flags follow-up work without being asked.",
              "You are given the project brief, the objective just completed, the stack, and the files that were changed.",
              "Ground every recommendation in the ACTUAL project domain from the brief — never generic placeholders. If this is an inventory system, suggest inventory-specific things (barcode scanning, supplier management, stock alerts). If it's a game, suggest game-specific things (scoring, levels, sound). Reason from the real domain every time, never fall back to a generic label.",
              "Return 5-8 recommendations, ordered by business value (highest first).",
              "label: 2-4 words, title case, like a button (e.g. 'Add KPI Cards').",
              "why: one short sentence explaining why this specific project benefits from it. No filler.",
              "estimated_minutes: a realistic engineering estimate for a focused single task (1-60).",
              "task: the exact instruction Foundry's execution engine should run if the user clicks this recommendation — specific enough to act on directly, written as an imperative sentence.",
              "Always call suggest_improvements. Do not answer in prose.",
            ].join("\n"),
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(context, null, 2) }],
      },
    ],
  };
}

export function parseRecommendations(rawArguments: string | undefined, fallback: MissionRecommendation[]): MissionRecommendation[] {
  if (!rawArguments) return fallback;

  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments);
  } catch {
    return fallback;
  }

  if (!raw || typeof raw !== "object") return fallback;
  const list = (raw as Record<string, unknown>).recommendations;
  if (!Array.isArray(list)) return fallback;

  const cleaned: MissionRecommendation[] = [];
  for (const [index, item] of list.entries()) {
    const parsed = parseOne(item, index);
    if (parsed) cleaned.push(parsed);
  }

  return cleaned.length >= MIN_VALID_RECOMMENDATIONS ? cleaned : fallback;
}

function parseOne(raw: unknown, index: number): MissionRecommendation | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const task = typeof value.task === "string" ? value.task.trim() : "";
  if (!label || !task) return null;

  const why = typeof value.why === "string" ? value.why.trim() : "";
  const estimatedMinutesRaw = typeof value.estimated_minutes === "number" && Number.isFinite(value.estimated_minutes) ? value.estimated_minutes : 5;
  const estimatedMinutes = Math.max(1, Math.min(60, Math.round(estimatedMinutesRaw)));

  return { id: `rec-${index}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`, label, why, estimatedMinutes, task };
}
