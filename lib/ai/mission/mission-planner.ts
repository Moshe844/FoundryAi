import { callOpenAIResponsesManaged, type RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { modelForProfile } from "@/lib/ai/model-router";
import type { FactoryObjectiveChecklistItem } from "@/lib/factory/types";

export type MissionPlan = {
  checklist: FactoryObjectiveChecklistItem[];
  /** Plain-language questions the planner needs answered before proceeding safely — contradictions between requirements, or between a requirement and the existing project. Empty when nothing conflicts. */
  conflicts: string[];
  usage?: RuntimeUsageRecord;
};

const PLAN_TOOL = {
  type: "function",
  name: "set_checklist",
  strict: true,
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
} as const;

type PlanOutputItem = {
  type?: string;
  name?: string;
  arguments?: string;
};

/** A request is "multi-part" when it reads like a requirements list rather than one or two asks — numbered/bulleted lines, or just a lot of distinct clauses. Full extraction (not milestone compression) applies here. */
export function isMultiPartRequest(task: string): boolean {
  const listLines = (task.match(/(^|\n)\s*(?:[-*•]|\d+[.):])\s+\S/g) ?? []).length;
  const andChains = (task.match(/\band\b/gi) ?? []).length;
  return listLines >= 5 || task.length > 900 || andChains >= 8;
}

/** A request that reshapes how the project is built rather than what it does — a rewrite, migration, or full architecture change — generalized across any stack/framework pairing, never tied to a specific example like "WinForms to WPF". */
const highRiskArchitecturePattern =
  /\b(migrat(?:e|ion)|re-?writ(?:e|ing)|re-?architect(?:ure)?|re-?implement|overhaul|moderni[sz]e|rebuild (?:this|the|our) (?:app|project|codebase|system)|port (?:this|the|it) (?:app|project|code)?\s*(?:from|to)|convert (?:this|the|it) (?:app|project)?\s*from|switch (?:this|the) (?:app|project)? from|replace .{1,40} with (?:a |an )?(?:new )?(?:stack|framework|language|architecture|backend|frontend|database))\b/i;

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
  projectSnapshot: string;
  apiKey: string;
  workspaceId?: string;
  userId?: string;
  canRunCommands?: boolean;
}): Promise<MissionPlan> {
  const canRunCommands = input.canRunCommands ?? true;
  if (isConcreteDebugRequest(input.task)) {
    return { checklist: debugInvestigationChecklist(input.task, canRunCommands), conflicts: [] };
  }
  const multiPart = isMultiPartRequest(input.task);
  const highRisk = isHighRiskArchitectureRequest(input.task);
  const body = JSON.stringify({
    model: modelForProfile("standard").model,
    reasoning: { effort: "low" },
    tools: [PLAN_TOOL],
    tool_choice: "auto",
    max_output_tokens: multiPart ? 4000 : 1800,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              multiPart
                ? "This request reads like a requirements list, not one or two asks. Extract EVERY distinct requirement it contains — do not compress, merge, or drop any of them to keep the list short. Only combine two clauses into one item when they describe the exact same piece of work (e.g. 'add a name field, required' is one item, not two)."
                : "Break the user's request into the small number of milestone-level phases a senior engineer would naturally check off — not a line-by-line decomposition of every clause. Group closely related requirements into a single milestone. Produce roughly 3 to 6 items regardless of how many individual details the request mentions. Only exceed that if the request genuinely contains that many unrelated, independently-shippable pieces of work.",
              "Assign every item a `phase`: a short label for the natural engineering stage it belongs to (e.g. \"Foundation\", \"Feature: checkout\", \"Feature: admin editor\", \"Polish & verification\"). Items in the same phase should be worked together; order phases the way an engineer would sequence the work (setup/foundation first, polish/verification last). Use the same phase label verbatim for every item in that phase.",
              highRisk
                ? "This request is a large-scope rewrite, migration, or architecture change. Break it into real milestone phases (e.g. inspect/inventory existing behavior, build the new implementation piece by piece, then a final phase). That final phase must contain items that each verify one specific piece of the existing project's real behavior still works after the change — derive those items from what this specific project actually does (its real screens, routes, or features), never a generic 'test everything' item."
                : "",
              "Each item must still be independently verifiable — something that can be confirmed true or false by reading real files or command output later — avoid vague items like 'improve the code'.",
              canRunCommands
                ? "The executor can only read/write files and run shell commands — it cannot open a browser, click through a UI, or inspect DevTools. Never write an item that can only be confirmed by doing those things (e.g. 'check the Console/Network tab', 'visually confirm in the browser'). If a requirement can only be verified that way, verify what the file contents and command output actually support instead, and phrase the item around that."
                : "The executor can only read and write files in this environment — it cannot run any shell commands (no build, no test, no runtime check, no git). Never write an item that can only be verified by running something (e.g. 'run the tests', 'confirm it builds', 'commit the change', 'check the console'). Every item must be verifiable purely by reading file contents.",
              "Do not invent requirements the user did not ask for. Do not add generic housekeeping items.",
              "For concrete bug reports, errors, stack traces, failed uploads, parse errors, failed builds, or broken behavior, do not add product-design questions, README updates, logging tasks, reproduction scripts, or tests unless the user explicitly asked. Start with inspecting the existing code path, then the smallest repair, then direct verification.",
              "Give each item a short kebab-case id and a concise label written the way an engineer would describe the work, not a sub-task.",
              "If two requirements contradict each other (e.g. asking for two different databases, two different auth schemes for the same flow), or a requirement contradicts what the project snapshot shows already exists, do not silently pick one. Add a plain-language question describing the contradiction to `conflicts` instead, and still include a best-guess checklist so work isn't blocked entirely — the caller decides whether to pause on conflicts.",
              "Always call set_checklist with your answer. Do not respond with plain text.",
            ].join("\n"),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `Objective: ${input.objective}`,
              `Task: ${input.task}`,
              "",
              "Current project snapshot:",
              input.projectSnapshot || "(empty or unknown project structure)",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const result = await callOpenAIResponsesManaged<{ output?: PlanOutputItem[] }>({
    apiKey: input.apiKey,
    body,
    workspaceId: input.workspaceId,
    userId: input.userId,
    maxAttempts: 4,
  });

  const call = result.data.output?.find((item) => item.type === "function_call" && item.name === "set_checklist");
  const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;
  const rawItems = parsed?.items ?? [];
  const conflicts = Array.isArray(parsed?.conflicts) ? parsed.conflicts.map((item) => String(item).trim()).filter(Boolean) : [];

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
      { id: "polished-ui", label: "User-facing UI is intentionally designed and aligned", status: "pending", phase: foundationPhase },
    ]);
  }

  if (!checklist.length) {
    checklist.push({ id: "complete-request", label: `Complete: ${input.task}`, status: "pending" });
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

function isConcreteDebugRequest(task: string) {
  return (
    /\b(getting|seeing|hit|hitting|throws?|throwing|fails?|failing|failed|broken|crash(?:es|ing)?|bug|issue|problem|diagnose|debug)\b.{0,120}\b(error|exception|failure|failed|parse|parser|json|upload|request|response|stack|trace|console|terminal|build|compile)\b/i.test(task) ||
    /\b(error|exception|failure|failed|parse|parser|json|upload|request|response|stack trace|traceback|console error|terminal error)\b.{0,120}\b(when|while|after|during|on|in|at)\b/i.test(task) ||
    /\b(upload failed|json parse|unexpected character|syntaxerror|typeerror|referenceerror|uncaught|stack trace|traceback|build failed|compile failed|500|404|403|401)\b/i.test(task)
  );
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
  return /\b(fields?|columns?|excel|spreadsheet|upload|mapping|transaction|tx|payload)\b/i.test(task) &&
    /\b(dynamic|config|configuration|frontend|ui|edit|add|remove|required|optional|hardcoded|hard-coded|server\.js)\b/i.test(task);
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
