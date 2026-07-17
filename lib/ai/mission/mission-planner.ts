import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import type { FactoryObjectiveChecklistItem } from "@/lib/factory/types";
import { isConcreteDebugRequest } from "@/lib/ai/mission/debug-intent";
import { extractAtomicUserRequirements, requiresPolishedUiAcceptance } from "@/lib/ai/mission/requirement-contract";
import { routingContext } from "@/lib/ai/routing/request-context";
import type { DynamicTaskAssessment } from "@/lib/ai/routing/types";

export type MissionPlan = {
  checklist: FactoryObjectiveChecklistItem[];
  /** Plain-language questions the planner needs answered before proceeding safely — contradictions between requirements, or between a requirement and the existing project. Empty when nothing conflicts. */
  conflicts: string[];
  usage?: RuntimeUsageRecord;
};

const PLAN_TOOL: NeutralTool = {
  name: "set_checklist",
  description: "Decompose the user's request into a concrete, independently verifiable checklist grouped into phases, and flag any contradictions that need the user's input before work can safely start.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            phase: { type: "string" },
          },
          required: ["id", "label", "phase"],
        },
      },
      conflicts: {
        type: "array",
        items: { type: "string" },
        description: "Plain-language questions for the user about contradictory or ambiguous requirements. Empty array if nothing conflicts.",
      },
    },
    required: ["items", "conflicts"],
  },
};

/** A request is "multi-part" when it reads like a requirements list rather than one or two asks — numbered/bulleted lines, or just a lot of distinct clauses. Full extraction (not milestone compression) applies here. */
export function isMultiPartRequest(task: string): boolean {
  const listLines = (task.match(/(^|\n)\s*(?:[-*•]|\d+[.):])\s+\S/g) ?? []).length;
  const andChains = (task.match(/\band\b/gi) ?? []).length;
  return extractAtomicUserRequirements(task).length > 1 || listLines >= 5 || task.length > 900 || andChains >= 8;
}

/** A request that reshapes how the project is built rather than what it does — a rewrite, migration, conversion, or full architecture change — generalized across any stack/framework/language pairing, never tied to a specific example like "WinForms to WPF". Deliberately matches "convert this to another language" without requiring the source to be named, since the user doesn't have to say what they're converting from. */
const highRiskArchitecturePattern =
  /\b(migrat(?:e|ion)|re-?writ(?:e|ing)|re-?architect(?:ure)?|re-?implement|overhaul|moderni[sz]e|rebuild (?:this|the|our) (?:app|project|codebase|system)|port (?:this|the|it) (?:app|project|code)?\s*(?:from|to)|convert (?:this|the|it) (?:app|project|code)?\s*(?:from|to|into)|switch (?:this|the) (?:app|project)?\s*(?:from|to)|replace .{1,40} with (?:a |an )?(?:new )?(?:stack|framework|language|architecture|backend|frontend|database))\b/i;

export function isHighRiskArchitectureRequest(task: string): boolean {
  return highRiskArchitecturePattern.test(task);
}

/** Finds a number the user explicitly attached to a count of requirements/features/items in their own words — generalized, not tied to any specific number or wording the way "40 requirements" might suggest. Returns undefined when the request doesn't name a count at all. */
function extractStatedRequirementCount(task: string): number | undefined {
  const match = task.match(/\b(\d+)\s+(?:distinct\s+|separate\s+|different\s+)?(?:requirements?|features?|items?|things?|changes?|tasks?|fixes?|bugs?)\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 1 ? value : undefined;
}

export async function planMission(input: {
  objective: string;
  task: string;
  intent?: "question" | "status" | "analyze" | "build" | "edit" | "debug" | "undo" | "deploy";
  projectSnapshot: string;
  apiKey: string;
  workspaceId?: string;
  userId?: string;
  canRunCommands?: boolean;
  canBrowserValidate?: boolean;
  provider?: ProviderId;
  /** Defaults to "builder" — this function's fixed tier before quality-aware routing existed. A quality-aware caller passes tierForStage("plan", quality, complexity) (lib/ai/mission/orchestration.ts) instead. */
  tier?: ModelTier;
  routingAssessment?: DynamicTaskAssessment;
}): Promise<MissionPlan> {
  const canRunCommands = input.canRunCommands ?? true;
  if (input.intent === "debug" || (input.intent === undefined && isConcreteDebugRequest(input.task))) {
    return { checklist: debugInvestigationChecklist(input.task, canRunCommands), conflicts: [] };
  }
  const atomicRequirements = extractAtomicUserRequirements(input.task);
  const multiPart = isMultiPartRequest(input.task);
  const highRisk = isHighRiskArchitectureRequest(input.task);
  // provider defaults to "openai" — matches this function's behavior before the provider abstraction
  // existed; the caller (lib/factory/runtime.ts) doesn't pass one yet.
  const provider: ProviderId = input.provider ?? "openai";
  const planningTier = input.tier ?? "builder";
  const { model, effort } = resolveModelForTier(planningTier, { provider });

  const system = [
    multiPart
      ? "This request reads like a requirements list, not one or two asks. Extract EVERY distinct requirement it contains — do not compress, merge, or drop any of them to keep the list short. Only combine two clauses into one item when they describe the exact same piece of work (e.g. 'add a name field, required' is one item, not two)."
      : "Break the user's request into the small number of milestone-level phases a senior engineer would naturally check off — not a line-by-line decomposition of every clause. Group closely related requirements into a single milestone. Produce roughly 3 to 6 items regardless of how many individual details the request mentions. Only exceed that if the request genuinely contains that many unrelated, independently-shippable pieces of work.",
    "Assign every item a `phase`: a short label for the natural engineering stage it belongs to (e.g. \"Foundation\", \"Feature: checkout\", \"Feature: admin editor\", \"Polish & verification\"). Items in the same phase should be worked together; order phases the way an engineer would sequence the work (setup/foundation first, polish/verification last). Use the same phase label verbatim for every item in that phase.",
    highRisk
      ? "This request is a large-scope rewrite, migration, conversion, or architecture change. Break it into real milestone phases: first inventory the existing project's actual features and behavior (not its file layout), then build the target implementation feature-by-feature, then a final phase. This is feature parity, not a line-by-line translation — a feature should be re-expressed the way it's idiomatically done in the target stack, not transliterated statement-by-statement from the old one. That final phase must contain items that each verify one specific piece of the existing project's real behavior still works after the change — derive those items from what this specific project actually does (its real screens, routes, or features), never a generic 'test everything' item."
      : "",
    "Each item must still be independently verifiable — something that can be confirmed true or false by reading real files or command output later — avoid vague items like 'improve the code'.",
    input.canBrowserValidate
      ? "The executor can validate the owned local preview in a real browser. For user-facing UI work, include a rendered desktop/mobile interaction check when it is needed to prove the requested outcome."
      : "",
    canRunCommands
      ? "The executor can only read/write files and run shell commands — it cannot open a browser, click through a UI, or inspect DevTools. Never write an item that can only be confirmed by doing those things (e.g. 'check the Console/Network tab', 'visually confirm in the browser'). If a requirement can only be verified that way, verify what the file contents and command output actually support instead, and phrase the item around that."
      : "The executor can only read and write files in this environment — it cannot run any shell commands (no build, no test, no runtime check, no git). Never write an item that can only be verified by running something (e.g. 'run the tests', 'confirm it builds', 'commit the change', 'check the console'). Every item must be verifiable purely by reading file contents.",
    input.canBrowserValidate
      ? "The browser capability above is authoritative: the executor can open and exercise the owned local preview. Include that real rendered check for UI outcomes instead of limiting verification to source inspection."
      : "",
    "Do not invent requirements the user did not ask for. Do not add generic housekeeping items.",
    "For concrete bug reports, errors, stack traces, failed uploads, parse errors, failed builds, or broken behavior, do not add product-design questions, README updates, logging tasks, reproduction scripts, or tests unless the user explicitly asked. Start with inspecting the existing code path, then the smallest repair, then direct verification.",
    "Give each item a short kebab-case id and a concise label written the way an engineer would describe the work, not a sub-task.",
    "If two requirements contradict each other (e.g. asking for two different databases, two different auth schemes for the same flow), or a requirement contradicts what the project snapshot shows already exists, do not silently pick one. Add a plain-language question describing the contradiction to `conflicts` instead, and still include a best-guess checklist so work isn't blocked entirely — the caller decides whether to pause on conflicts.",
    "A missing implementation detail is not a contradiction. Never ask whether a requested prototype should use mock/local behavior or production persistence, which visual style to use, or where ordinary state should live when the current project and request support a reasonable implementation. Infer the smallest complete behavior that matches the existing stack and proceed.",
    "The project snapshot below is real, current data already gathered from this exact project — a file listing and, when this is a Node project, its actual package.json scripts. Before adding anything to `conflicts`, check whether the snapshot already answers it: a single package.json with one relevant script means there is exactly one app and one way to run it — don't ask which one, or invent a generic multi-service question ('frontend, backend, or all?') that doesn't match what's actually there. Only ask about something the snapshot and task genuinely leave undetermined.",
    "Always call set_checklist with your answer. Do not respond with plain text.",
  ].join("\n");

  const userText = [`Objective: ${input.objective}`, `Task: ${input.task}`, "", "Current project snapshot:", input.projectSnapshot || "(empty or unknown project structure)"].join("\n");

  const result = await callManagedModel(
    {
      provider,
      model,
      effort: effort ?? "low",
      system,
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
      tools: [PLAN_TOOL],
      toolChoice: "auto",
      maxOutputTokens: multiPart ? 4000 : 1800,
      routing: routingContext(input.task, "plan", planningTier, input.workspaceId, input.routingAssessment),
    },
    { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 4 },
  );

  const call = result.toolCalls.find((item) => item.name === "set_checklist");
  const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;
  const rawItems = parsed?.items ?? [];
  const conflicts = Array.isArray(parsed?.conflicts)
    ? parsed.conflicts.map((item) => String(item).trim()).filter((item) => isGroundedRequirementConflict(input.task, item))
    : [];

  const seen = new Set<string>();
  const checklist: FactoryObjectiveChecklistItem[] = rawItems
    .map((item, index) => ({ id: item.id?.trim() || `item-${index + 1}`, label: item.label?.trim() || "", phase: item.phase?.trim() || undefined }))
    .filter((item) => item.label)
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
    .map((item) => ({ id: item.id, label: item.label, status: "pending" as const, phase: item.phase }));

  const foundationPhase = checklist[0]?.phase;
  if (isDynamicFieldConfigurationRequest(input.task)) {
    prependMissingChecklistItems(checklist, [
      { id: "inspect-current-ux", label: "Inspect the current field UI and styling before changing it", status: "pending", phase: foundationPhase },
      { id: "persist-field-config", label: "Persist editable fields in a config file instead of backend code", status: "pending", phase: foundationPhase },
      { id: "server-dynamic-fields", label: "Server reads saved field configuration for transaction/upload mapping", status: "pending", phase: foundationPhase },
      { id: "field-manager-ui", label: "Polished UI lets users add, edit, require, and remove fields", status: "pending", phase: foundationPhase },
      { id: "frontend-dynamic-form", label: "Frontend test form is generated from saved field configuration", status: "pending", phase: foundationPhase },
      { id: "field-config-verified", label: "Re-read changed files and verify the dynamic field behavior path", status: "pending", phase: foundationPhase },
    ]);
  } else if (isUserFacingUiRequest(input.task)) {
    prependMissingChecklistItems(checklist, [
      { id: "inspect-current-ux", label: "Inspect the current UI structure and styling before editing", status: "pending", phase: foundationPhase },
      {
        id: "polished-ui",
        label: requiresPolishedUiAcceptance(input.task)
          ? "Requested UI is content-rich, responsive, intentionally structured, and visibly more than placeholder text or raw controls"
          : "User-facing UI is intentionally designed and aligned",
        status: "pending",
        phase: foundationPhase,
      },
      ...(input.canBrowserValidate ? [{
        id: "verify-rendered-ux",
        label: requiresPolishedUiAcceptance(input.task)
          ? "Exercise the finished experience in real desktop and mobile browser viewports"
          : "Exercise the affected user flow in the real browser preview",
        status: "pending" as const,
        phase: "Polish & verification",
      }] : []),
    ]);
  }

  if (atomicRequirements.length > 1) {
    checklist.unshift(...atomicRequirements.map((label, index) => ({
      id: `user-requirement-${index + 1}`,
      label: `User requirement: ${label}`,
      status: "pending" as const,
      phase: "Requested behavior",
    })));
  }

  const numberedRequirements = extractNumberedRequirements(input.task);
  if (numberedRequirements.length > 1 && checklist.length <= 1) {
    checklist.splice(0, checklist.length, ...numberedRequirements.map((label, index) => ({
      id: `requirement-${index + 1}`,
      label,
      status: "pending" as const,
      phase: `Phase ${Math.floor(index / 10) + 1}`,
    })));
  }

  if (!checklist.length) {
    checklist.push({ id: "complete-request", label: `Complete: ${input.task}`, status: "pending" });
  }

  const explicitDecisions = extractExplicitDecisionQuestions(input.task);
  if (explicitDecisions.length) {
    const explicitSubjects = explicitDecisions.map(normalizeDecisionSubject);
    const unrelatedModelConflicts = conflicts.filter((conflict) => {
      const subject = normalizeDecisionSubject(conflict);
      return !explicitSubjects.some((explicit) => explicit.includes(subject) || subject.includes(explicit));
    });
    conflicts.splice(0, conflicts.length, ...explicitDecisions, ...unrelatedModelConflicts);
  }

  const statedCount = extractStatedRequirementCount(input.task);
  if (statedCount && Math.abs(statedCount - checklist.length) >= 2) {
    conflicts.push(
      `You mentioned ${statedCount} requirements, but I found ${checklist.length} distinct, independently-verifiable item(s) — some of your points may describe the same piece of work grouped together, or the count may not match what I extracted. Here's the breakdown: ${checklist
        .map((item) => `"${item.label}"`)
        .join(", ")}. Let me know if anything should be split apart or was missed before I start.`,
    );
  }

  const phaseOrder: string[] = [];
  for (const item of checklist) {
    if (item.phase && !phaseOrder.includes(item.phase)) phaseOrder.push(item.phase);
  }
  if (highRisk && phaseOrder.length >= 2 && !conflicts.length) {
    conflicts.push(
      `This is a large-scope change spanning ${phaseOrder.length} phases: ${phaseOrder
        .map((label, index) => `Phase ${index + 1}: ${label}`)
        .join("; ")}. I'll work through them in order, checkpoint after each one, and keep the existing implementation in place until you approve replacing it. Confirm this scope before I start, or tell me what to adjust.`,
    );
  }

  return { checklist, conflicts, usage: result.usage };
}

function prependMissingChecklistItems(checklist: FactoryObjectiveChecklistItem[], items: FactoryObjectiveChecklistItem[]) {
  const existing = new Set(checklist.map((item) => item.id));
  checklist.unshift(...items.filter((item) => !existing.has(item.id)));
}

function debugInvestigationChecklist(task: string, canRunCommands: boolean): FactoryObjectiveChecklistItem[] {
  const target = debugTargetNoun(task);
  return [
    {
      id: "trace-failing-path",
      label: `Inspect the existing ${target} path that matches the reported failure`,
      status: "pending",
      phase: "Investigate",
    },
    {
      id: "identify-root-cause",
      label: "Identify the concrete mismatch or failing assumption from code evidence",
      status: "pending",
      phase: "Investigate",
    },
    {
      id: "apply-smallest-fix",
      label: "Apply the smallest code change that matches the existing project design",
      status: "pending",
      phase: "Repair",
    },
    {
      id: "verify-debug-fix",
      label: canRunCommands ? "Verify the repaired path with the most direct available check" : "Re-read changed files and verify the repaired path from code evidence",
      status: "pending",
      phase: "Verify",
    },
  ];
}

function debugTargetNoun(task: string) {
  if (/\b(upload|excel|spreadsheet|xlsx?|csv|file)\b/i.test(task)) return "upload";
  if (/\b(api|request|response|route|endpoint|fetch)\b/i.test(task)) return "API";
  if (/\b(build|compile|typecheck|lint)\b/i.test(task)) return "build";
  if (/\b(login|auth|session|token)\b/i.test(task)) return "authentication";
  return "failing";
}

function isDynamicFieldConfigurationRequest(task: string) {
  return /\b(dynamic|configurable|configured|configuration|hardcoded|hard-coded)\b[^.\n]{0,60}\b(fields?|columns?|mapping)\b/i.test(task) ||
    /\b(add|edit|remove|required|optional)\b[^.\n]{0,40}\b(fields?|columns?)\b/i.test(task) ||
    /\b(excel|spreadsheet|upload|payload)\b[^.\n]{0,60}\b(field|column|mapping|schema)\b/i.test(task);
}

function isUserFacingUiRequest(task: string) {
  return /\b(ui|ux|frontend|screen|page|form|dashboard|polish|design|layout|visual|ugly|basic|professional)\b/i.test(task);
}

function safeJsonParse(value: string): { items?: Array<{ id?: string; label?: string; phase?: string }>; conflicts?: unknown[] } | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function extractNumberedRequirements(task: string) {
  return task
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+[.)]\s+(.+?)\s*$/)?.[1]?.trim() ?? "")
    .filter(Boolean);
}

function extractExplicitDecisionQuestions(task: string) {
  const questions: string[] = [];
  // A period inside a filename/domain (legacy-app.js, api.example.com) is not a sentence boundary.
  // Stop only at punctuation that is followed by the next instruction, a newline, or end-of-input.
  const pattern = /\bask(?:\s+me)?\s+whether\s+(.+?)(?=[?!](?:\s|$)|[.;](?=\s+(?:after|then|before|next|finally|once|when|do|please|ask)\b)|\n|$)/gi;
  for (const match of task.matchAll(pattern)) {
    const subject = match[1].trim().replace(/[?.!]+$/, "").replace(/^the\s+user\s+/i, "");
    if (subject) questions.push(`${subject.charAt(0).toUpperCase()}${subject.slice(1)}?`);
  }
  return questions;
}

function normalizeDecisionSubject(question: string) {
  return question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isGroundedRequirementConflict(task: string, conflict: string) {
  if (/\bask(?:\s+me)?\s+whether\b/i.test(task)) return true;
  return /\b(?:contradict(?:s|ory|ion)?|incompatible|mutually exclusive|cannot both|can't both)\b/i.test(conflict);
}
