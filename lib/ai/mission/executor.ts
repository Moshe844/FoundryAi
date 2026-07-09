import { callOpenAIResponsesManaged, type RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { modelForProfile } from "@/lib/ai/model-router";
import { isSensitiveFilePath, normalizeCommandText, type ProjectAccess } from "@/lib/ai/mission/project-access";
import { approvalScopeLabel, type CommandApprovalScope } from "@/lib/ai/mission/command-permissions";
import type { ExecutionMissionVerification, FactoryExecutionEvent, FactoryExecutionEventKind, FactoryExecutionEventStatus, FactoryNarrativeObject, FactoryObjectiveChecklistItem, FactorySessionSummary, MissionParentContext } from "@/lib/factory/types";

export type MissionExecutorInput = {
  objective: string;
  task: string;
  checklist: FactoryObjectiveChecklistItem[];
  access: ProjectAccess;
  onEvent: (event: FactoryExecutionEvent) => void | Promise<void>;
  apiKey: string;
  workspaceId?: string;
  userId?: string;
  maxTurns?: number;
  maxNudges?: number;
  signal?: AbortSignal;
  /** Commands the user has just explicitly approved for this run only (e.g. via an "Approve and retry" action). Matched by exact normalized text, not a standing grant. */
  preApprovedCommands?: string[];
  /** Command categories (see CommandPermissionCategory) the user has approved for the rest of this conversation, e.g. "dependencies". */
  approvedCategories?: string[];
  /** The subset of preApprovedCommands that are real standing grants (persisted "always allow this exact command"), as opposed to a fresh one-time approval for just this run. Used only to label approval_scope correctly — matching behavior is identical either way. */
  standingApprovedCommands?: string[];
  /** Structured record of the mission this run continues, given only for continuation-style follow-ups so the model has real plan/decision state instead of needing to blindly re-investigate. */
  priorContext?: MissionParentContext;
  /** Set when the task was heuristically detected as a small, single-file change — relaxes completion verification for a single-item checklist only. */
  fastLane?: boolean;
  /** Set when the task was heuristically detected as a rewrite/migration/architecture-scale change — keeps the old implementation in place until the user approves replacing it, and checkpoints after each phase. */
  highRisk?: boolean;
  /** Set for larger new-project builds with a live-previewable stack: the first checklist phase should be a
   * minimal but real, clickable first pass of the primary screens, and the mission pauses there for the user
   * to open the preview and react before Foundry goes deeper — instead of building the whole thing unseen. */
  offerMockGate?: boolean;
};

export type MissionExecutorResult = {
  status: "passed" | "failed" | "stopped" | "awaiting-approval" | "awaiting-mock-approval";
  blocker?: string;
  checklist: FactoryObjectiveChecklistItem[];
  timeline: FactoryExecutionEvent[];
  changedFiles: string[];
  commands: Array<{ command: string; exitCode: number | null; stdout: string; stderr: string; durationMs?: number; approvalScope?: CommandApprovalScope }>;
  sessionSummary?: FactorySessionSummary;
  verification: ExecutionMissionVerification[];
  turnsUsed: number;
  usage: RuntimeUsageRecord[];
};

type MissionOutputItem = {
  type?: string;
  text?: string;
  content?: Array<{ type?: string; text?: string; refusal?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
};

type MissionOpenAIResponse = {
  output_text?: string;
  output?: MissionOutputItem[];
  error?: { message?: string; type?: string; code?: string };
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

type ConversationItem = Record<string, unknown>;

type ToolSchema = {
  type: "function";
  name: string;
  strict: boolean;
  description: string;
  parameters: {
    type: "object";
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
  };
};

const DEFAULT_MAX_TURNS = 40;
const DEFAULT_MAX_NUDGES = 6;

function toolSchemas(canRunCommands: boolean): ToolSchema[] {
  const tools: ToolSchema[] = [
    {
      type: "function",
      name: "list_dir",
      strict: true,
      description: "List immediate files and subdirectories under a path relative to the project root. Use \"\" for the root. Does not recurse.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    {
      type: "function",
      name: "read_file",
      strict: true,
      description: "Read a text file's contents relative to the project root. Large files are truncated; pass offset_bytes/limit_bytes to page through them. Use offset_bytes 0 and limit_bytes 20000 for a normal first read.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          offset_bytes: { type: "integer" },
          limit_bytes: { type: "integer" },
        },
        required: ["path", "offset_bytes", "limit_bytes"],
      },
    },
    {
      type: "function",
      name: "write_file",
      strict: true,
      description: "Create or overwrite a text file relative to the project root with the complete new file contents (never a diff/patch). path must be a real relative file path such as \"server.js\" or \"src/index.js\" — never empty, \".\", or \"/\". The write is read back from disk and verified before being reported successful.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
    {
      type: "function",
      name: "delete_file",
      strict: true,
      description: "Delete a file relative to the project root. Always requires the user's approval before it actually happens — call it when deletion is the right fix, don't avoid it just because it needs approval.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    {
      type: "function",
      name: "search_files",
      strict: true,
      description: "Search file names and contents under the project root for a query string.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      type: "function",
      name: "mark_checklist_item",
      strict: true,
      description: "Update the status of one objective checklist item as you make verifiable progress. Use 'skipped' only when the user explicitly told you to skip it — never to avoid difficult work.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["running", "completed", "blocked", "skipped"] },
          evidence: { type: "string" },
        },
        required: ["id", "status", "evidence"],
      },
    },
    {
      type: "function",
      name: "record_finding",
      strict: true,
      description: "Record a project-understanding finding. This creates a narrative-layer event from a structured finding object, not a rewritten trace log.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          rationale: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          file_path: { type: "string" },
        },
        required: ["id", "rationale", "evidence", "file_path"],
      },
    },
    {
      type: "function",
      name: "record_decision",
      strict: true,
      description: "Record a chosen engineering action from the Confidence Map decision object. The rationale must be the decision rationale.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          rationale: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          chosen_action: { type: "string" },
          confidence: { type: "integer" },
        },
        required: ["id", "rationale", "evidence", "chosen_action", "confidence"],
      },
    },
    {
      type: "function",
      name: "record_flag",
      strict: true,
      description: "Record uncertainty, conflict, or a preserved behavior worth user attention. This creates a flag-layer event from a structured flag object.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          rationale: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          flag_type: { type: "string" },
        },
        required: ["id", "rationale", "evidence", "flag_type"],
      },
    },
    {
      type: "function",
      name: "report_complete",
      strict: true,
      description: "Call this only once every checklist item is completed with real evidence from files you actually read or commands you actually ran. The summary must explain the user's request, user-facing behavior now, files changed and why, verification evidence, and limitations. Ends the mission.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
    {
      type: "function",
      name: "report_blocked",
      strict: true,
      description: "Call this if you cannot complete the objective (missing info, ambiguous request, tool failure). Ends the mission.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          reason: { type: "string" },
          blocked_item_ids: { type: "array", items: { type: "string" } },
        },
        required: ["reason", "blocked_item_ids"],
      },
    },
  ];

  if (canRunCommands) {
    tools.push({
      type: "function",
      name: "run_command",
      strict: true,
      description: "Run a shell command inside the project (or a subdirectory of it). No interactive stdin is provided, so avoid commands that prompt for input.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { command: { type: "string" }, cwd: { type: "string" } },
        required: ["command", "cwd"],
      },
    });
  }

  return tools;
}

export async function runMissionExecutor(input: MissionExecutorInput): Promise<MissionExecutorResult> {
  const maxTurns = input.maxTurns ?? (input.fastLane ? 6 : DEFAULT_MAX_TURNS);
  const maxNudges = input.maxNudges ?? (input.fastLane ? 1 : DEFAULT_MAX_NUDGES);
  const checklist = input.checklist.map((item) => ({ ...item }));
  const timeline: FactoryExecutionEvent[] = [];
  const usage: RuntimeUsageRecord[] = [];
  const changedFiles = new Set<string>();
  const commands: MissionExecutorResult["commands"] = [];
  const narrativeObjects: FactoryNarrativeObject[] = [];
  const tools = toolSchemas(input.access.capabilities.canRunCommands);

  async function emit(kind: FactoryExecutionEventKind, status: FactoryExecutionEventStatus, title: string, extra: Partial<FactoryExecutionEvent> = {}) {
    const event: FactoryExecutionEvent = {
      id: `mission-event-${timeline.length}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      tier: extra.tier ?? "trace",
      kind,
      status,
      title,
      ...extra,
    };
    timeline.push(event);
    await input.onEvent(event);
  }

  async function emitChecklistSnapshot() {
    await emit("planning", "completed", "Checklist updated", {
      internal: true,
      details: { checklistJson: JSON.stringify(checklist) },
    });
  }

  function finalize(status: "passed" | "failed" | "stopped" | "awaiting-approval" | "awaiting-mock-approval", blocker: string | undefined, turnsUsed: number): MissionExecutorResult {
    return {
      status,
      blocker,
      checklist,
      timeline,
      changedFiles: Array.from(changedFiles),
      commands,
      sessionSummary: buildSessionSummary(timeline, changedFiles),
      verification: buildVerificationEntries(checklist, changedFiles, narrativeObjects, commands),
      turnsUsed,
      usage,
    };
  }

  async function stoppedByUser(turn: number): Promise<MissionExecutorResult> {
    await emit("summary", "warning", "Stopped by user", { details: { reason: "The user stopped this mission before it finished." } });
    return finalize("stopped", "Stopped by user before completion.", turn);
  }

  const conversation: ConversationItem[] = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: [
            "You are a senior engineer working inside a real, already-connected project. You investigate and fix real problems by calling tools — you are not running a scripted plan.",
            input.priorContext
              ? "You already have verified context from earlier in this same mission, given below — trust it and don't re-read files it already covers unless something looks inconsistent with the current request."
              : "You have no built-in knowledge of this project's current contents — read files before assuming anything about them.",
            "write_file always takes the complete new file contents, never a partial patch.",
            "Writing to an environment/secrets-shaped file (.env and variants, credentials/secrets files, key material) needs the user's approval, same as a shell command — expect it to pause the same way, and don't avoid the edit just because it needs approval if it's the right fix.",
            "delete_file removes a file and always needs the user's approval — never avoid deleting something that genuinely should go, and never delete anything as a substitute for asking when you are unsure whether it's still needed.",
            input.fastLane
              ? "This is a small, focused task — either a quick edit or a single operational action like starting a server, running a build, or running tests. Keep it tight: do only what the request actually needs (the smallest correct edit, or the one command that satisfies an operational request), verify the real outcome directly (re-read the changed file, or confirm the server/build/test actually succeeded — e.g. an operational request to start a server is not done until you've confirmed it's actually reachable), and finish. Do not produce a multi-phase plan, architecture review, or full-project analysis for a task this size."
              : "",
            input.fastLane
              ? "For a request to start/run something that might already be running (a dev server, in particular): check first (e.g. a port check or a request to the expected local URL) before starting it again. If it's already up and reachable, say so and stop there — do not restart it, and do not treat confirming that as something that needs approval."
              : "",
            input.highRisk
              ? "This is a large-scope rewrite/migration/conversion/architecture mission. Build the new implementation alongside the existing one wherever the project structure allows it — do not overwrite or delete the old implementation's working files as a byproduct of building the new one. Only remove old files once the new path that replaces them is verified working, and do it via delete_file (which always pauses for approval) rather than silently overwriting them with write_file. The user should be able to see the old implementation still there until they explicitly approve removing it."
              : "",
            input.highRisk
              ? "Migrate feature-by-feature, not line-by-line. For each feature, first understand what it actually does for the user in the existing project, then re-implement that behavior the idiomatic way in the target stack — do not transliterate the old code statement-by-statement. Two implementations of the same feature in different stacks should rarely look structurally alike; they should behave alike."
              : "",
            input.highRisk
              ? "Work phase by phase in the order given. The moment every item in a phase is marked completed or skipped, record a decision or finding that plainly states what that phase actually changed and what still matches the old behavior — that's the user's checkpoint to see real progress before you start the next phase."
              : "",
            input.offerMockGate
              ? "This is a larger build, so treat the first checklist phase as building a minimal but real, clickable first pass of the primary screens — real navigation, real forms and layout, placeholder/mock data where deeper logic isn't built yet, professionally designed, not a wireframe. Do not build deep business logic, full data persistence, or later phases yet. The moment every item in that first phase is completed or skipped, the mission will pause automatically so the user can open a live preview and react before you continue — this is expected, not a failure or an interruption to work around. Do not call report_complete or try to keep working past the first phase; let it pause."
              : "",
            "For user-facing UI work, inspect the current UI structure and styling before editing. Improve the actual screen the user will see: aligned rows, clear labels, helpful helper text, sane empty states, accessible controls, and professional spacing. Do not ship raw/basic controls when the request is for product behavior.",
            "A styling or layout change is not verified by how it looks in your head — it's verified by the app still working. Before report_complete on any mission that touched .tsx/.jsx/.vue/.svelte/.html files: (1) actually run the app (build, dev server, or existing test suite — whichever this project has) and confirm it starts/builds without new errors, and (2) explicitly check that the interactive elements your change touched or sits near — buttons, forms, nav links, click handlers — still reference real, existing functions/state after your edit (read the handler wiring, don't assume a move/restyle left it intact). Record a finding or decision that states this plainly, e.g. \"Verified nav links still route correctly after moving the nav\" — not just \"updated styles.\" If you find something broken, fix it before completing; never report complete with a known-broken interaction.",
            "For requests that move hardcoded backend fields, payload fields, spreadsheet columns, or transaction fields into the frontend or configuration, build the whole product loop unless the existing project makes it impossible: create or update a durable config file, load existing fields from it, add/edit/remove fields in the UI, persist required/optional metadata, generate frontend forms from that config, and make backend upload/API mapping read the saved config dynamically.",
            "Do not treat 'created config file' as complete if the frontend still cannot edit it or the backend still uses hardcoded fields. Do not treat 'frontend form exists' as complete if Excel/upload/server processing is still hardcoded.",
            "Maintain two execution layers. Raw tool activity is trace. Narrative must come only from structured objects you explicitly record: record_finding for project understanding, record_decision for Confidence Map decisions, and record_flag for uncertainty/conflict/preserved behavior. Do not rely on generic reasoning text as narrative.",
            "Before report_complete on an edit/build/debug/deploy mission, record at least one finding and one decision. Record a flag whenever you preserve a path, leave uncertainty, encounter conflicting evidence, skip a verification, or see a behavior worth user attention.",
            "Work the way an experienced engineer actually works: form a hypothesis, test it with the smallest check that gives a real answer, learn from what you find, and adjust your next step. Don't work down a fixed list of steps decided in advance.",
            "For concrete bug/debug/error reports, inspect the existing code path before asking product or architecture questions. Do not ask whether to use design A or design B until you have read the files and found real conflicting implementations or requirements. Infer the intended behavior from the current code whenever there is one clear existing path.",
            "State your hypothesis once, in one or two plain sentences, like you're thinking out loud to a colleague. Then investigate quietly. Do not restate the same hypothesis again in different words (\"I think...\", \"My hunch is...\", \"I suspect...\") — if your understanding hasn't changed, say nothing and keep working. Speak again only when you've confirmed or ruled something out, when your understanding meaningfully changes, or right before you change a file or run a command.",
            "Never mention tool names, checklist ids, turn counts, or any other internal mechanics in what you say, and never describe your own process as a \"checklist\" or \"plan\" to the user — that bookkeeping is yours alone, for verifying you actually finished. Speak the way a person explains their thinking, not the way a program logs its steps. Keep each statement short — a sentence or two, not a paragraph.",
            "Call mark_checklist_item as soon as you have real evidence for an item, whether completed, blocked, or skipped, but never read the checklist back to the user or narrate updating it.",
            checklist.some((item) => item.phase)
              ? "Checklist items are grouped into phases (visible below as [phase] on each line). Work through phases in order — finish the items in the current phase before starting a later phase — unless a later item is trivially fast and clearly independent."
              : "",
            "Only call report_complete once every checklist item is completed or explicitly skipped with real evidence. If anything cannot be verified, call report_blocked instead and say exactly what is unresolved.",
            "The final report_complete summary must be product-specific: what the user asked for, what behavior changed, which files changed and why, how the user uses the new behavior, what was verified, and any limitations. Never summarize with generic next actions.",
            "If one checklist item gets stuck for a reason that has nothing to do with permission (e.g. a tool error, ambiguous request), don't stop everything — keep making real progress on every other item you still can, and only call report_blocked once you've done all the work that doesn't depend on the stuck item.",
            "If the user denies a command you needed, mark that checklist item skipped and, in the very next thing you say, state the exact command as something the user can run themselves (e.g. \"You can run `<command>` yourself when ready — I'll continue with everything else.\"). Never just say it was denied and move on silently. Then keep making progress on every other item.",
            input.access.capabilities.canRunCommands
              ? "You can run shell commands with run_command, confined to the project root. If run_command returns skipped: permission-required, the mission stops immediately and automatically the moment that happens — you do not get to try something else or keep working on other items first. Prefer the simplest command that gives real evidence — don't try several different verification strategies in a row, or repeatedly stop and restart the same server, if a simpler single check (or the file contents you already read) already answers the question — every permission prompt costs the user a real interruption."
              : "This connection cannot run shell commands. If a checklist item can only be verified by running a build/test, mark it blocked and explain why instead of guessing.",
            input.access.capabilities.canRunCommands
              ? "Do not run a bare dependency install such as npm ci, npm install, pnpm install, yarn install, or bun install as a reflex. First inspect package.json, lockfiles, and whether node_modules exists. If dependencies already appear installed, run the smallest relevant existing script or direct local command instead. If the user's request is to start an existing server, prefer the existing start/dev script or direct server entry command before any install. Ask for install approval only when dependency evidence is actually missing or a new package is truly required."
              : "",
            input.access.capabilities.canRunCommands && !input.fastLane
              ? "Before report_complete on a mission that changed code, check whether this specific project already has its own build, test, or lint tooling configured for what you touched — e.g. package.json build/test/lint scripts, a dotnet test project, a gradlew wrapper, flutter test, cargo test, go test, or an equivalent already present in this project — and run whichever of those is relevant to what changed as your real verification. Treat that as the one canonical check for this item, not an extra strategy on top of file read-back. If it fails, diagnose the actual cause, fix it when the fix matches the existing design, and rerun it before reporting anything — never summarize a failing check as if it passed. If this project genuinely has no such tooling configured for what you changed, say so plainly in your summary instead of leaving it unaddressed."
              : "",
            ...(!input.fastLane && input.access.capabilities.canRunCommands
              ? ["By default, run the app for the user, not just edit its files. Once you're reasonably confident in a fix and the project is a runnable app or server, start (or restart) it as your verification step and leave it running so the user can see the real result — don't stop at 'the file is correct.' Only skip this if the user explicitly said not to run it, or the checklist item genuinely doesn't need a running process to verify (e.g. a pure text/config change)."]
              : []),
            "Never create or write a file just to prove work happened. Every file you create or change must exist because it improves the actual project — evidence of your work belongs in what you say, not in the user's codebase.",
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
            `Project root: ${input.access.rootLabel}`,
            ...(input.priorContext ? ["", "Mission this continues:", formatParentContext(input.priorContext)] : []),
            "",
            "Checklist:",
            ...checklist.map((item) => `- [${item.id}]${item.phase ? ` [${item.phase}]` : ""} ${item.label}`),
          ].join("\n"),
        },
      ],
    },
  ];

  let consecutiveProviderFailures = 0;
  let nudgesUsed = 0;
  let completionRejections = 0;
  const maxCompletionRejections = 3;
  let lastFailedWriteSignature = "";
  let repeatedWriteFailures = 0;
  let hadUnresolvedToolFailure = false;
  let lastReasoningNormalized = "";
  let silentExplorationTurns = 0;
  const consequentialToolNames = new Set(["write_file", "delete_file", "run_command", "report_complete", "report_blocked"]);
  const explorationToolNames = new Set(["list_dir", "read_file", "search_files"]);

  async function emitReasoning(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (trimmed.length < 12) return false;
    const normalized = normalizeForSimilarity(trimmed);
    if (lastReasoningNormalized && textSimilarity(normalized, lastReasoningNormalized) > 0.6) return false;
    lastReasoningNormalized = normalized;
    await emit("reasoning", "completed", trimmed);
    return true;
  }

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    if (input.signal?.aborted) return stoppedByUser(turn);

    const body = JSON.stringify({
      model: modelForProfile(input.fastLane ? "fast" : "autonomous").model,
      input: conversation,
      tools,
      tool_choice: "auto",
      max_output_tokens: input.fastLane ? 2500 : 8000,
    });

    const result = await callOpenAIResponsesManaged<MissionOpenAIResponse>({
      apiKey: input.apiKey,
      body,
      workspaceId: input.workspaceId,
      userId: input.userId,
      maxAttempts: input.fastLane ? 2 : 6,
    });
    usage.push(result.usage);

    if (result.status !== "ok") {
      consecutiveProviderFailures += 1;
      if (consecutiveProviderFailures >= 2) {
        const detail = result.data.error?.message;
        const reason = detail ? `Model provider unavailable after retries: ${detail}` : "Model provider unavailable after retries.";
        await emit("summary", "error", "Mission blocked", { details: { reason } });
        return finalize("failed", reason, turn);
      }
      continue;
    }
    consecutiveProviderFailures = 0;

    const outputItems = result.data.output ?? [];
    const functionCalls = outputItems.filter((item): item is Required<Pick<MissionOutputItem, "name" | "call_id">> & MissionOutputItem =>
      item.type === "function_call" && Boolean(item.name) && Boolean(item.call_id));
    const messageText = extractMessageText(outputItems, result.data.output_text);

    // Surface the model's own reasoning at moments a person would actually want to hear it: its
    // opening hypothesis, right before a consequential action, when it has nothing to call at all,
    // or — so the user is never left wondering what's happening — after a couple of turns spent
    // purely exploring (reading/listing/searching) with no visible update at all.
    const hasConsequentialCall = functionCalls.some((call) => consequentialToolNames.has(call.name ?? ""));
    const explorationOnly = functionCalls.length > 0 && functionCalls.every((call) => explorationToolNames.has(call.name ?? ""));
    const forceCheckIn = explorationOnly && silentExplorationTurns >= 2;
    let emittedThisTurn = false;
    if (turn === 1 || !functionCalls.length || hasConsequentialCall || forceCheckIn) {
      const fallbackCheckIn = specificCheckInForCalls(functionCalls);
      emittedThisTurn = await emitReasoning(messageText.trim().length >= 12 ? messageText : forceCheckIn ? fallbackCheckIn : messageText);
    }
    silentExplorationTurns = emittedThisTurn ? 0 : explorationOnly ? silentExplorationTurns + 1 : 0;

    if (!functionCalls.length) {
      nudgesUsed += 1;
      if (nudgesUsed > maxNudges) {
        const stuckReason = "I lost a clear next step partway through and couldn't confirm the work was actually done, so I'm stopping instead of guessing further.";
        await emit("summary", "error", "Mission blocked", { details: { reason: stuckReason } });
        return finalize("failed", stuckReason, turn);
      }
      const outstanding = checklist.filter((item) => item.status !== "completed" && item.status !== "skipped");
      conversation.push({ role: "assistant", content: [{ type: "output_text", text: messageText || "(no text)" }] });
      conversation.push({
        role: "user",
        content: [{
          type: "input_text",
          text: outstanding.length
            ? `Continue working. These checklist items are not yet completed with evidence: ${outstanding.map((item) => `[${item.id}] ${item.label}`).join("; ")}. Verify each by reading the actual file (or re-running a command), then call mark_checklist_item for it. Call a tool now.`
            : "Continue: call a tool, or report_complete / report_blocked.",
        }],
      });
      continue;
    }

    for (const call of functionCalls) {
      if (input.signal?.aborted) return stoppedByUser(turn);

      const rawArgs = call.arguments ?? "{}";
      const parsedArgs = safeJsonParse(rawArgs);
      const args = parsedArgs ?? {};
      conversation.push({ type: "function_call", call_id: call.call_id, name: call.name, arguments: rawArgs });

      if (!parsedArgs && rawArgs.length > 2) {
        const reason = "The tool call arguments could not be parsed, most likely because the file content was too large and got cut off mid-write. Split this into a smaller change and try again.";
        hadUnresolvedToolFailure = true;
        await emit("edit", "warning", "Large edit failed, switching to a smaller patch", { details: { reason } });
        conversation.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ verified: false, accepted: false, reason }),
        });
        continue;
      }

      if (call.name === "report_complete") {
        const verification = verifyCompletion(checklist, changedFiles, narrativeObjects, Boolean(input.fastLane), hadUnresolvedToolFailure, commands);
        if (!verification.ok) {
          completionRejections += 1;
          if (completionRejections > maxCompletionRejections) {
            await emit("summary", "error", "Mission blocked", { details: { reason: verification.reason } });
            return finalize("failed", verification.reason, turn);
          }
          await emit("planning", "warning", "Completion claim rejected", { internal: true, details: { reason: verification.reason } });
          conversation.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify({
              accepted: false,
              reason: verification.reason,
              instruction: "Do not call report_complete again until every checklist item below is verified with real evidence via mark_checklist_item (re-read files or re-run commands as needed).",
            }),
          });
          continue;
        }
        await emit("summary", "completed", "Behavior verified", { details: { summary: String(args.summary ?? "") } });
        return finalize("passed", undefined, turn);
      }

      if (call.name === "report_blocked") {
        const reason = String(args.reason ?? "The model reported it could not complete the objective.");
        await emit("summary", "error", "Mission blocked", { details: { reason } });
        return finalize("failed", reason, turn);
      }

      const toolResult = await executeTool(call.name ?? "", args, input.access, emit, changedFiles, commands, narrativeObjects, input.preApprovedCommands, input.approvedCategories, messageText, input.task, input.standingApprovedCommands).catch((error) => ({
        error: error instanceof Error ? error.message : "Tool call failed unexpectedly.",
      }));
      if (call.name === "mark_checklist_item") {
        const phaseBefore = checklist.find((item) => item.id === args.id)?.phase;
        const phaseWasOpenBefore = phaseBefore
          ? checklist.some((item) => item.phase === phaseBefore && item.status !== "completed" && item.status !== "skipped")
          : false;
        applyChecklistUpdate(checklist, args);
        await emitChecklistSnapshot();
        if ((input.highRisk || input.offerMockGate) && phaseBefore && phaseWasOpenBefore) {
          const phaseNowDone = checklist.every((item) => item.phase !== phaseBefore || item.status === "completed" || item.status === "skipped");
          if (phaseNowDone) {
            const isFirstPhase = checklist[0]?.phase === phaseBefore;
            if (input.offerMockGate && isFirstPhase) {
              const message = `The first working mock is ready — "${phaseBefore}" is done. Open the preview and try it out, then tell me what to change or say it looks good to keep building.`;
              await emit("summary", "completed", "First working mock ready for review", { details: { reason: message } });
              return finalize("awaiting-mock-approval", message, turn);
            }
            await emit("summary", "completed", `Checkpoint: ${phaseBefore} complete`, {
              details: { reason: `Every item in "${phaseBefore}" is resolved. Review this checkpoint before the next phase starts.` },
            });
          }
        }
      }
      if (call.name === "write_file") {
        const writeResult = toolResult as { skipped?: string; reason?: string };
        if (writeResult.skipped === "permission-required") {
          const writePath = typeof args.path === "string" ? args.path : "";
          const reason = writeResult.reason ?? "This write needs your approval before Foundry can continue.";
          await emit("summary", "warning", "Waiting for your approval", { details: { reason, command: `write ${writePath}` } });
          return finalize("awaiting-approval", `Waiting for your approval to write: ${writePath}`, turn);
        }
        if (isFailedWriteResult(toolResult)) {
          hadUnresolvedToolFailure = true;
          const rawPath = String(args.path ?? "");
          const isBlankish = !rawPath.trim() || /^[./\\]*$/.test(rawPath.trim());
          const signature = `${isBlankish ? "(blank)" : rawPath}::${toolResult.reason ?? ""}`;
          repeatedWriteFailures = signature === lastFailedWriteSignature ? repeatedWriteFailures + 1 : 1;
          lastFailedWriteSignature = signature;

          if (repeatedWriteFailures >= 3) {
            const stuckReason = "I kept repeating the same failing file write and couldn't self-correct, so I'm stopping instead of continuing to guess.";
            await emit("summary", "error", "Mission blocked", { details: { reason: stuckReason } });
            return finalize("failed", stuckReason, turn);
          }

          if (repeatedWriteFailures === 2) {
            (toolResult as Record<string, unknown>).note =
              "You have made this exact write_file call with this exact invalid path twice in a row. Do not repeat it — provide a real relative file path, such as 'styles.css' or 'src/index.js'.";
          }
        } else {
          lastFailedWriteSignature = "";
          repeatedWriteFailures = 0;
          if (hadUnresolvedToolFailure) {
            hadUnresolvedToolFailure = false;
            await emit("edit", "completed", "Recovered — completed successfully with a smaller change");
          }
        }
      }
      if (call.name === "delete_file") {
        const deleteResult = toolResult as { skipped?: string; reason?: string };
        if (deleteResult.skipped === "permission-required") {
          const deletePath = typeof args.path === "string" ? args.path : "";
          const reason = deleteResult.reason ?? "This delete needs your approval before Foundry can continue.";
          await emit("summary", "warning", "Waiting for your approval", { details: { reason, command: `delete ${deletePath}` } });
          return finalize("awaiting-approval", `Waiting for your approval to delete: ${deletePath}`, turn);
        }
      }
      if (call.name === "run_command") {
        const commandResult = toolResult as { exitCode?: number | null; skipped?: string; reason?: string };
        if (commandResult.skipped === "permission-required") {
          const command = typeof args.command === "string" ? args.command : "";
          const reason = commandResult.reason ?? "This command needs your approval before Foundry can continue.";
          await emit("summary", "warning", "Waiting for your approval", { details: { reason, command } });
          return finalize("awaiting-approval", `Waiting for your approval to run: ${command}`, turn);
        }
        if (!commandResult.skipped && typeof commandResult.exitCode === "number") {
          if (commandResult.exitCode !== 0) {
            hadUnresolvedToolFailure = true;
          } else if (hadUnresolvedToolFailure) {
            hadUnresolvedToolFailure = false;
            await emit("command", "completed", "Recovered — the alternate approach completed successfully");
          }
        }
      }
      conversation.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(toolResult) });
    }
  }

  const ranOutOfTurnsButActuallyDone = verifyCompletion(checklist, changedFiles, narrativeObjects, Boolean(input.fastLane), hadUnresolvedToolFailure, commands);
  if (ranOutOfTurnsButActuallyDone.ok) {
    await emit("summary", "completed", "Behavior verified", {
      details: { summary: "The work was verified complete before the turn budget ran out; skipping the final wrap-up call." },
    });
    return finalize("passed", undefined, maxTurns);
  }

  const forcedReason = await forceProgressReport();
  const tookTooLongReason = forcedReason || "This turned out to be more involved than expected, and I wasn't able to finish within a reasonable amount of work.";
  await emit("summary", "error", "Mission blocked", { details: { reason: tookTooLongReason } });
  return finalize("failed", tookTooLongReason, maxTurns);

  async function forceProgressReport(): Promise<string> {
    conversation.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text: "You're out of turns for this run. Call report_blocked now with your best real understanding: what you found, what's most likely wrong or still needed, and what should happen next. Never say you ran out of turns or time — give a genuinely useful engineering update instead.",
        },
      ],
    });
    const body = JSON.stringify({
      model: modelForProfile(input.fastLane ? "fast" : "autonomous").model,
      input: conversation,
      tools,
      tool_choice: { type: "function", name: "report_blocked" },
      max_output_tokens: input.fastLane ? 1500 : 2500,
    });
    const result = await callOpenAIResponsesManaged<MissionOpenAIResponse>({
      apiKey: input.apiKey,
      body,
      workspaceId: input.workspaceId,
      userId: input.userId,
      maxAttempts: 4,
    });
    if (result.status !== "ok") return "";
    const call = (result.data.output ?? []).find((item) => item.type === "function_call" && item.name === "report_blocked" && item.call_id);
    if (!call) return "";
    const args = safeJsonParse(call.arguments ?? "{}") ?? {};
    return typeof args.reason === "string" ? args.reason : "";
  }
}

/** Renders the structured parent-mission record into plain text for the prompt. Kept as real structured fields end-to-end (never a pre-flattened string) so this is the only place formatting choices are made, and so a future caller could use the fields directly instead of parsing prose back out of them. */
function formatParentContext(context: MissionParentContext): string {
  const lines: string[] = [`Previous mission: "${context.summary || context.id}" (${context.state})`];
  const openItems = context.plan.filter((item) => item.status !== "completed" && item.status !== "skipped");
  const doneItems = context.plan.filter((item) => item.status === "completed" || item.status === "skipped");
  if (doneItems.length) lines.push(`Already done: ${doneItems.map((item) => item.label).join("; ")}`);
  if (openItems.length) lines.push(`Still open: ${openItems.map((item) => item.label).join("; ")}`);
  if (context.files_touched.length) {
    lines.push(`Files changed: ${context.files_touched.map((file) => `${file.status ?? "changed"} ${file.path}${file.diffSummary ? ` (${file.diffSummary})` : ""}`).join("; ")}`);
  }
  if (context.commands_run.length) {
    lines.push(`Commands run: ${context.commands_run.map((command) => `${command.command} (exit ${command.exitCode ?? "-"})`).join("; ")}`);
  }
  if (context.decisions.length) lines.push(`Decisions made: ${context.decisions.join("; ")}`);
  if (context.findings.length) lines.push(`Findings: ${context.findings.join("; ")}`);
  if (context.blocked_reason) lines.push(`Blocked on: ${context.blocked_reason}`);
  lines.push("This is real prior state — trust it and don't re-investigate what it already covers unless something looks inconsistent with the current request.");
  return lines.join("\n");
}

function specificCheckInForCalls(functionCalls: MissionOutputItem[]) {
  const runCommand = functionCalls.find((call) => call.name === "run_command");
  if (runCommand) {
    const args = safeJsonParse(runCommand.arguments ?? "{}") ?? {};
    const command = typeof args.command === "string" ? args.command : "";
    if (/\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:i|install|add)\b/i.test(command)) {
      return "Checking the project dependency evidence before deciding whether an install approval is needed.";
    }
    return command ? `Running ${command} to verify the current behavior.` : "Running the next verification command.";
  }

  const writeCall = functionCalls.find((call) => call.name === "write_file");
  if (writeCall) {
    const args = safeJsonParse(writeCall.arguments ?? "{}") ?? {};
    const pathArg = typeof args.path === "string" ? args.path : "";
    return pathArg ? `Updating ${pathArg} and then reading it back from disk.` : "Applying the next file change and verifying it on disk.";
  }

  const deleteCall = functionCalls.find((call) => call.name === "delete_file");
  if (deleteCall) {
    const args = safeJsonParse(deleteCall.arguments ?? "{}") ?? {};
    const pathArg = typeof args.path === "string" ? args.path : "";
    return pathArg ? `Deleting ${pathArg}.` : "Deleting the file identified as no longer needed.";
  }

  const readCall = functionCalls.find((call) => call.name === "read_file");
  if (readCall) {
    const args = safeJsonParse(readCall.arguments ?? "{}") ?? {};
    const pathArg = typeof args.path === "string" ? args.path : "";
    return pathArg ? `Opening ${pathArg} to inspect the relevant code.` : "Opening the next file to inspect the relevant code.";
  }

  const searchCall = functionCalls.find((call) => call.name === "search_files");
  if (searchCall) {
    const args = safeJsonParse(searchCall.arguments ?? "{}") ?? {};
    const query = typeof args.query === "string" ? args.query : "";
    return query ? `Searching for "${query}" to locate the right implementation path.` : "Searching the project to locate the right implementation path.";
  }

  const listCall = functionCalls.find((call) => call.name === "list_dir");
  if (listCall) {
    const args = safeJsonParse(listCall.arguments ?? "{}") ?? {};
    const pathArg = typeof args.path === "string" ? args.path : "";
    return pathArg ? `Scanning ${pathArg} to understand the project structure.` : "Scanning the project structure before changing files.";
  }

  return "Checking the next piece of project evidence before changing files.";
}

function applyChecklistUpdate(checklist: FactoryObjectiveChecklistItem[], args: Record<string, unknown>) {
  const item = checklist.find((entry) => entry.id === args.id);
  if (!item) return;
  const status = args.status;
  if (status === "running" || status === "completed" || status === "blocked" || status === "skipped") item.status = status;
  if (typeof args.evidence === "string") item.evidence = args.evidence;
}

/** Files whose extension means "this is interactive UI markup, not pure logic" — buttons, forms, nav,
 * event handlers live here. Used to decide whether report_complete needs real behavioral evidence on
 * top of the build/lint/typecheck check already required elsewhere, not just a styling read-back. */
const interactiveUiExtensions = /\.(tsx|jsx|vue|svelte|html)$/i;

function changedInteractiveUiFiles(changedFiles: Set<string>): string[] {
  return Array.from(changedFiles).filter((path) => interactiveUiExtensions.test(path));
}

/** Whether the mission ran something that could actually exercise runtime behavior (build/dev server/
 * test), as opposed to only reading a file back — a read-back proves the edit landed, not that it runs. */
function hasRuntimeVerificationCommand(commands: MissionExecutorResult["commands"]): boolean {
  return commands.some((command) => command.exitCode === 0 && /\b(build|dev|start|test|serve)\b/i.test(command.command));
}

/** Matches narrative text that actually addresses interactive/runtime behavior, not just styling —
 * e.g. "confirmed the nav links still route correctly" vs. "moved the nav and updated the colors". */
const interactionVerificationPattern = /\b(buttons?|forms?|submit\w*|clicks?|clicked|navigat\w*|links?|interactions?|renders?|rendering|rendered|runtime errors?|console errors?|no (new )?errors?|still works?|still functions?|behavior (is |was )?(unchanged|preserved|intact))\b/i;

function hasInteractionVerificationNarrative(narrativeObjects: FactoryNarrativeObject[]): boolean {
  return narrativeObjects.some((item) => interactionVerificationPattern.test(item.rationale ?? ""));
}

function verifyCompletion(
  checklist: FactoryObjectiveChecklistItem[],
  changedFiles: Set<string>,
  narrativeObjects: FactoryNarrativeObject[],
  fastLane = false,
  hasUnresolvedFailure = false,
  commands: MissionExecutorResult["commands"] = [],
): { ok: true } | { ok: false; reason: string } {
  // Section 19: never let a mission complete while its most recent command or write failure was never
  // followed by a fix or a successful retry — completion must never silently paper over a real failure.
  if (hasUnresolvedFailure) {
    return { ok: false, reason: "A command or file write failed and was never followed by a fix or a successful retry." };
  }
  if (fastLane && checklist.length === 1 && changedFiles.size > 0) return { ok: true };
  const incomplete = checklist.filter((item) => item.status !== "completed" && item.status !== "skipped");
  if (incomplete.length) {
    return { ok: false, reason: `Checklist item(s) not completed: ${incomplete.map((item) => item.label).join("; ")}` };
  }
  const withoutEvidence = checklist.filter((item) => !item.evidence?.trim());
  if (withoutEvidence.length) {
    return { ok: false, reason: `Checklist item(s) marked completed without evidence: ${withoutEvidence.map((item) => item.label).join("; ")}` };
  }
  // An honestly-skipped item (recorded with evidence, same as any other status) means the mission
  // already admitted some work didn't happen — e.g. a denied command — so requiring a file write on
  // top of that would penalize honesty. Only demand real file evidence when every item claims to be
  // fully done, since that's the shape of the actual hallucination this guard exists to catch.
  const hasSkippedItem = checklist.some((item) => item.status === "skipped");
  if (checklist.length && changedFiles.size === 0 && !hasSkippedItem) {
    return { ok: false, reason: "The mission reported completion, but no file write was ever verified on disk." };
  }
  const hasFinding = narrativeObjects.some((item) => item.tier === "finding");
  const hasDecision = narrativeObjects.some((item) => item.tier === "decision");
  if (!hasFinding || !hasDecision) {
    return { ok: false, reason: "The mission cannot complete until it records structured finding and decision objects for the narrative layer." };
  }
  // A change to interactive UI markup is not verified by styling alone: require evidence the app was
  // actually run (build/dev/test), and a narrative object that speaks to interactive behavior — not just
  // "the file reads back correctly." Skip this for fastLane (already handled above) and for missions that
  // only skipped items (already flagged honestly by the checks above).
  const touchedUi = changedInteractiveUiFiles(changedFiles);
  if (touchedUi.length && !hasSkippedItem) {
    if (!hasRuntimeVerificationCommand(commands)) {
      return {
        ok: false,
        reason: `Interactive UI file(s) changed (${touchedUi.join(", ")}) but no build/dev/test run verified the app still runs. A styling change is not enough evidence — actually run it.`,
      };
    }
    if (!hasInteractionVerificationNarrative(narrativeObjects)) {
      return {
        ok: false,
        reason: `Interactive UI file(s) changed (${touchedUi.join(", ")}) but no finding/decision confirms the actual interactive behavior (buttons, forms, navigation) still works — only that it runs or looks right. Record a finding or decision that says so, based on real evidence (reading the handler, checking the console/build output), not an assumption.`,
      };
    }
  }
  return { ok: true };
}

/** Builds real verification evidence from the exact same signals verifyCompletion() inspects — checklist evidence, files actually verified on disk, command/build results, and recorded findings/decisions. This is the one place verification is computed; the client must never re-derive it independently. */
function buildVerificationEntries(
  checklist: FactoryObjectiveChecklistItem[],
  changedFiles: Set<string>,
  narrativeObjects: FactoryNarrativeObject[],
  commands: MissionExecutorResult["commands"],
): ExecutionMissionVerification[] {
  const entries: ExecutionMissionVerification[] = [];

  for (const item of checklist) {
    if (item.status === "completed") {
      entries.push({ check_type: "checklist", result: "pass", evidence: item.evidence?.trim() || item.label });
    } else if (item.status === "skipped") {
      entries.push({ check_type: "checklist", result: "skipped", evidence: item.evidence?.trim() || `Skipped: ${item.label}` });
    } else if (item.status === "blocked") {
      entries.push({ check_type: "checklist", result: "fail", evidence: item.evidence?.trim() || `Blocked: ${item.label}` });
    }
  }

  for (const path of changedFiles) {
    entries.push({ check_type: "file-read", result: "pass", evidence: `${path} was written and read back from disk to confirm the change.` });
  }

  for (const command of commands) {
    const isBuildLike = /\b(build|tsc|compile)\b/i.test(command.command);
    const isTestLike = /\btest\b/i.test(command.command);
    entries.push({
      check_type: isBuildLike ? "build" : isTestLike ? "test" : "command",
      result: command.exitCode === 0 ? "pass" : "fail",
      evidence: `${command.command} exited with code ${command.exitCode ?? "unknown"}.`,
    });
  }

  for (const item of narrativeObjects) {
    if (item.tier === "finding" || item.tier === "decision") {
      entries.push({ check_type: "manual-evidence", result: "pass", evidence: item.rationale });
    }
  }

  return entries;
}

/** Same bypass semantics as run_command's approval check, generalized to non-command actions (file writes/deletes) keyed by a synthetic action string instead of a shell command. */
function isActionApproved(actionKey: string, category: string, preApprovedCommands: string[], approvedCategories: string[]): boolean {
  const exactApproved = preApprovedCommands.some((entry) => normalizeCommandText(entry) === normalizeCommandText(actionKey));
  const categoryApproved = approvedCategories.includes(category);
  return exactApproved || categoryApproved;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  access: ProjectAccess,
  emit: (kind: FactoryExecutionEventKind, status: FactoryExecutionEventStatus, title: string, extra?: Partial<FactoryExecutionEvent>) => Promise<void>,
  changedFiles: Set<string>,
  commands: MissionExecutorResult["commands"],
  narrativeObjects: FactoryNarrativeObject[],
  preApprovedCommands: string[] = [],
  approvedCategories: string[] = [],
  rationale = "",
  task = "",
  standingApprovedCommands: string[] = [],
): Promise<unknown> {
  const pathArg = typeof args.path === "string" ? args.path : "";
  const basename = pathArg.split("/").pop() || pathArg;

  switch (name) {
    case "list_dir": {
      await emit("inspection", "running", `Listing ${pathArg || "/"}`, { tier: "trace", filePath: pathArg || "/" });
      const entries = await access.listDir(pathArg);
      await emit("inspection", "completed", `Listed ${entries.length} entries in ${pathArg || "/"}`, {
        tier: "trace",
        filePath: pathArg || "/",
        details: { entries: entries.slice(0, 50).map((entry) => `${entry.kind === "directory" ? "[dir] " : ""}${entry.name}`) },
      });
      return { entries };
    }
    case "read_file": {
      const offsetBytes = typeof args.offset_bytes === "number" ? args.offset_bytes : 0;
      const limitBytes = typeof args.limit_bytes === "number" ? args.limit_bytes : 20_000;
      await emit("inspection", "running", `Reading ${basename}`, {
        tier: "trace",
        fileName: basename,
        filePath: pathArg,
        details: { offsetBytes, limitBytes },
      });
      const result = await access.readFile(pathArg, { offsetBytes, limitBytes });
      if (!result.exists) {
        await emit("inspection", "warning", `${pathArg} not found`, { tier: "trace", fileName: basename, filePath: pathArg });
      } else {
        const linesRead = countLines(result.content);
        await emit("inspection", "completed", `Read ${basename} (${result.totalBytes} bytes)`, {
          tier: "trace",
          fileName: basename,
          filePath: pathArg,
          details: {
            offsetBytes,
            limitBytes,
            totalBytes: result.totalBytes,
            truncated: result.truncated,
            lineRange: offsetBytes === 0 ? `Lines 1-${linesRead}` : `${linesRead} line(s) from byte ${offsetBytes}`,
          },
        });
      }
      return result;
    }
    case "search_files": {
      const query = typeof args.query === "string" ? args.query : "";
      await emit("inspection", "running", `Searching for "${query}"`, { tier: "trace", details: { query } });
      const hits = access.searchFiles ? await access.searchFiles(query) : [];
      await emit("inspection", "completed", `Found ${hits.length} matches for "${query}"`, {
        tier: "trace",
        details: { query, matches: hits.slice(0, 20).map((hit) => `${hit.path}${hit.line ? `:${hit.line}` : ""}`) },
      });
      return { hits };
    }
    case "write_file": {
      const content = typeof args.content === "string" ? args.content : "";
      if (!pathArg.trim() || /^[./\\]*$/.test(pathArg.trim())) {
        await emit("edit", "error", "Refused write with no file path", { tier: "trace", details: { reason: "path was empty or pointed at the project root." } });
        return {
          verified: false,
          reason: "path was empty, \".\", or otherwise pointed at the project root. You must pass a real relative file path, such as \"server.js\" or \"src/index.js\" — never an empty string, \".\", \"/\", or the project root.",
        };
      }
      if (isSensitiveFilePath(pathArg) && !isActionApproved(`write ${pathArg}`, "environment-changes", preApprovedCommands, approvedCategories)) {
        const reason = `${basename} looks like an environment/secrets file. Writing to it needs your approval.`;
        await emit("edit", "warning", `Permission needed: write ${basename}`, { tier: "trace", filePath: pathArg, details: { reason, category: "environment-changes" } });
        return { verified: false, skipped: "permission-required", reason, category: "environment-changes" };
      }
      const existedBeforeHint = await access.readFile(pathArg, { limitBytes: 1 });
      await emit(existedBeforeHint.exists ? "edit" : "file", "running", `${existedBeforeHint.exists ? "Editing" : "Creating"} ${basename}`, { tier: "trace" });
      const result = await access.writeFile(pathArg, content);
      if (result.verified) {
        changedFiles.add(pathArg);
        const delta = result.diff ? diffSummaryFromText(result.diff) : { added: 0, removed: 0 };
        const lineRange =
          result.firstChangedLine && result.lastChangedLine
            ? result.firstChangedLine === result.lastChangedLine
              ? `Line ${result.firstChangedLine}`
              : `Lines ${result.firstChangedLine}-${result.lastChangedLine}`
            : undefined;
        await emit(result.existedBefore ? "edit" : "file", "completed", writeEventTitle(pathArg, result.existedBefore, task, content, rationale, delta), {
          tier: "trace",
          fileName: basename,
          filePath: pathArg,
          output: result.diff,
          beforeContent: result.beforeContent,
          rationale: rationale.trim() || undefined,
          details: lineRange ? { lineRange } : undefined,
        });
        await emit("inspection", "completed", `Verified ${basename} on disk`, {
          tier: "trace",
          fileName: basename,
          filePath: pathArg,
          details: { modifiedAt: result.modifiedAt, bytes: result.bytes },
        });
      } else {
        await emit("edit", "error", `Verification failed for ${basename}`, { tier: "trace", fileName: basename, filePath: pathArg, details: { reason: result.reason } });
      }
      return { verified: result.verified, reason: result.reason, bytes: result.bytes };
    }
    case "delete_file": {
      if (!pathArg.trim() || /^[./\\]*$/.test(pathArg.trim())) {
        return { verified: false, reason: "path was empty, \".\", or otherwise pointed at the project root. Pass a real relative file path." };
      }
      if (!access.deleteFile) {
        await emit("edit", "skipped", `Delete unavailable: ${basename}`, { tier: "trace", filePath: pathArg });
        return { verified: false, skipped: "unsupported", reason: "Deleting files is not available in this connection mode." };
      }
      if (!isActionApproved(`delete ${pathArg}`, "deletes", preApprovedCommands, approvedCategories)) {
        const reason = `Deleting ${basename} needs your approval.`;
        await emit("edit", "warning", `Permission needed: delete ${basename}`, { tier: "trace", filePath: pathArg, details: { reason, category: "deletes" } });
        return { verified: false, skipped: "permission-required", reason, category: "deletes" };
      }
      await emit("edit", "running", `Deleting ${basename}`, { tier: "trace", filePath: pathArg });
      const result = await access.deleteFile(pathArg);
      if (result.verified) {
        changedFiles.add(pathArg);
        await emit("edit", "completed", `Deleted ${basename}`, { tier: "trace", fileName: basename, filePath: pathArg, rationale: rationale.trim() || undefined });
      } else {
        await emit("edit", "error", `Delete failed for ${basename}`, { tier: "trace", fileName: basename, filePath: pathArg, details: { reason: result.reason } });
      }
      return { verified: result.verified, reason: result.reason };
    }
    case "run_command": {
      const command = typeof args.command === "string" ? args.command : "";
      const cwd = typeof args.cwd === "string" ? args.cwd : "";
      await emit("command", "running", `Running ${command}`, { tier: "trace", command, cwd });
      if (!access.runCommand) {
        await emit("command", "skipped", `Command unavailable: ${command}`, { tier: "trace", command, cwd });
        return { exitCode: null, stdout: "", stderr: "Commands are not available in this connection mode.", skipped: "unsupported" };
      }
      const result = await access.runCommand(command, cwd, { approvedCommands: preApprovedCommands, approvedCategories, standingApprovedCommands });
      if (!result.skipped) {
        commands.push({ command, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, approvalScope: result.approvalScope });
      }
      const isBuildLike = /\b(build|tsc|compile)\b/i.test(command);
      if (result.skipped) {
        const needsPermission = result.skipped === "permission-required";
        if (result.skipped === "dependency-present") {
          await emit("command", "completed", `Verified dependencies for ${command}`, {
            tier: "trace",
            command,
            cwd,
            output: result.stdout || result.stderr,
            stdout: result.stdout,
            stderr: result.stderr,
            details: { reason: result.reason ?? "Dependency install skipped because packages were already available." },
          });
        } else if (needsPermission) {
          const permissionCategory = result.category || dependencyCommandCategory(command);
          const permissionReason = result.reason || dependencyCommandReason(command) || result.stderr || result.skipped;
          const narrative = makeNarrativeObject(
            "flag",
            {
              id: `permission-${Date.now()}`,
              rationale: `Permission is needed before running ${command}.`,
              evidence: [permissionReason ?? command].filter(Boolean),
              flag_type: "permission",
            },
            "uncertainty",
          );
          narrativeObjects.push(narrative);
          await emit("blocked", "warning", `Permission needed: ${command}`, {
            tier: "flag",
            narrative,
            rationale: narrative.rationale,
            command,
            cwd,
            output: result.stderr,
            details: { reason: permissionReason, category: permissionCategory },
          });
        } else {
          await emit("command", "skipped", `Command skipped: ${command}`, {
            tier: "trace",
            command,
            cwd,
            output: result.stderr,
            details: { reason: result.reason ?? result.skipped },
          });
        }
      } else if (result.exitCode === 0) {
        await emit("command", "completed", `Ran ${command}`, { tier: "trace", command, cwd, exitCode: result.exitCode, durationMs: result.durationMs, output: result.stdout || result.stderr, stdout: result.stdout, stderr: result.stderr, details: { shellUsed: result.shellUsed, shellFallbackFrom: result.shellFallbackFrom, approvalScopeLabel: approvalScopeLabel(result.approvalScope) } });
        if (isBuildLike) await emit("build", "completed", "Build passed", { tier: "trace", command, cwd, stdout: result.stdout, stderr: result.stderr });
      } else {
        await emit("command", "error", `Command failed: ${command}`, { tier: "trace", command, cwd, exitCode: result.exitCode, durationMs: result.durationMs, output: result.stderr || result.stdout, stdout: result.stdout, stderr: result.stderr, details: { shellUsed: result.shellUsed, shellFallbackFrom: result.shellFallbackFrom, approvalScopeLabel: approvalScopeLabel(result.approvalScope) } });
        if (isBuildLike) await emit("build", "error", "Build failed", { tier: "trace", command, cwd, stdout: result.stdout, stderr: result.stderr });
      }
      return result;
    }
    case "record_finding": {
      const narrative = makeNarrativeObject("finding", args, "project-understanding");
      narrativeObjects.push(narrative);
      await emit("reasoning", "completed", narrative.rationale, { tier: "finding", filePath: narrative.filePath, rationale: narrative.rationale, narrative, details: narrative.details });
      return { recorded: true, narrative };
    }
    case "record_decision": {
      const narrative = makeNarrativeObject("decision", args, "confidence-map");
      narrativeObjects.push(narrative);
      await emit("reasoning", "completed", narrative.rationale, { tier: "decision", rationale: narrative.rationale, narrative, details: narrative.details });
      return { recorded: true, narrative };
    }
    case "record_flag": {
      const narrative = makeNarrativeObject("flag", args, String(args.flag_type ?? "").toLowerCase().includes("conflict") ? "conflict" : "uncertainty");
      narrativeObjects.push(narrative);
      await emit("reasoning", "warning", narrative.rationale, { tier: "flag", rationale: narrative.rationale, narrative, details: narrative.details });
      return { recorded: true, narrative };
    }
    case "mark_checklist_item":
      return { acknowledged: true };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function writeEventTitle(
  filePath: string,
  existedBefore: boolean,
  task: string,
  content: string,
  rationale: string,
  delta: { added: number; removed: number },
) {
  const basename = filePath.split("/").pop() || filePath;
  const lowerTask = task.toLowerCase();
  const lowerContent = content.toLowerCase();
  const change = `+${delta.added}${delta.removed ? ` -${delta.removed}` : ""}`;

  if (/\b(fields?|columns?|excel|spreadsheet|upload|mapping|transaction|tx)\b/.test(lowerTask)) {
    if (/fields?\.json$/i.test(filePath)) return `${existedBefore ? "Updated" : "Created"} ${basename} field configuration ${change}`;
    if (/server\.(js|ts|mjs|cjs)$/i.test(filePath)) return `Updated ${basename} to load dynamic field configuration ${change}`;
    if (/\.(html|tsx|jsx|vue|svelte)$/i.test(filePath)) return `Updated ${basename} field manager UI ${change}`;
    if (/\.(js|ts|mjs|cjs)$/i.test(filePath) && /\b(add|remove|delete|save|field|config|required)\b/.test(lowerContent)) {
      return `Updated ${basename} add/edit/remove/save field behavior ${change}`;
    }
    if (/\.(css|scss|sass|less)$/i.test(filePath)) return `Polished ${basename} field manager styling ${change}`;
  }

  const reason = rationale
    .replace(/\s+/g, " ")
    .replace(/^(i('| a)?m|i am|i will|i need to|i'm going to|going to)\s+/i, "")
    .slice(0, 90)
    .trim();
  if (reason.length >= 18) return `${existedBefore ? "Updated" : "Created"} ${basename}: ${reason} ${change}`;
  return `${existedBefore ? "Updated" : "Created"} ${basename} ${change}`;
}

function makeNarrativeObject(
  tier: Exclude<FactoryNarrativeObject["tier"], "trace">,
  args: Record<string, unknown>,
  source: FactoryNarrativeObject["source"],
): FactoryNarrativeObject {
  const evidence = Array.isArray(args.evidence) ? args.evidence.map((item) => String(item)).filter(Boolean).slice(0, 8) : [];
  const confidence = typeof args.confidence === "number" ? Math.max(0, Math.min(100, Math.round(args.confidence))) : undefined;
  const details: FactoryNarrativeObject["details"] = {};
  if (typeof args.chosen_action === "string") details.chosenAction = args.chosen_action;
  if (typeof args.flag_type === "string") details.flagType = args.flag_type;
  if (typeof confidence === "number") details.confidence = confidence;

  return {
    id: String(args.id || `${tier}-${Date.now()}`),
    tier,
    rationale: String(args.rationale || `${tier} recorded.`).replace(/\s+/g, " ").trim(),
    evidence,
    source,
    confidence,
    filePath: typeof args.file_path === "string" ? args.file_path : undefined,
    details,
  };
}

function buildSessionSummary(timeline: FactoryExecutionEvent[], changedFiles: Set<string>): FactorySessionSummary {
  const narrative = timeline.map((event) => event.narrative).filter((item): item is FactoryNarrativeObject => Boolean(item));
  const findings = narrative.filter((item) => item.tier === "finding");
  const decisions = narrative.filter((item) => item.tier === "decision");
  const flags = narrative.filter((item) => item.tier === "flag");
  const changed = Array.from(changedFiles);
  const outcome =
    decisions.at(-1)?.rationale ||
    findings.at(-1)?.rationale ||
    (changed.length ? `Updated ${changed.length} file${changed.length === 1 ? "" : "s"} and verified the writes on disk.` : "No user-facing outcome was verified.");

  return {
    outcome,
    preserved: flags
      .filter((flag) => /preserv|kept|left|unchanged/i.test(flag.rationale) || /preserv/i.test(String(flag.details?.flagType ?? "")))
      .map((flag) => flag.rationale),
    changes: decisions.length ? decisions.map((decision) => decision.rationale) : changed.map((filePath) => `Changed ${filePath}.`),
    flags: flags.map((flag) => flag.rationale),
  };
}

function dependencyCommandCategory(command: string) {
  return /\b(npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:ci|i|install|add|remove|uninstall|upgrade|update)\b/i.test(command)
    ? "dependencies"
    : undefined;
}

function dependencyCommandReason(command: string) {
  return dependencyCommandCategory(command)
    ? `${command} changes or recreates the project's dependency environment, so it needs approval before running.`
    : undefined;
}

function diffSummaryFromText(diffText: string) {
  const lines = diffText.split(/\r?\n/);
  return {
    added: lines.filter((line) => line.startsWith("+ ")).length,
    removed: lines.filter((line) => line.startsWith("- ")).length,
  };
}

function countLines(content: string) {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

const HEDGE_PREFIX_PATTERN = /^(i think|i believe|i suspect|my hunch is|my guess is|it looks like|it seems like|it seems that)\b[,:]?\s*/i;

function normalizeForSimilarity(text: string) {
  return text
    .toLowerCase()
    .replace(HEDGE_PREFIX_PATTERN, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function textSimilarity(a: string, b: string) {
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function extractMessageText(items: MissionOutputItem[], outputText?: string) {
  if (outputText) return outputText;
  return items
    .filter((item) => item.type === "message")
    .flatMap((item) => [item.text, ...(item.content ?? []).map((content) => content.text)])
    .filter(Boolean)
    .join("\n");
}

function safeJsonParse(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isFailedWriteResult(result: unknown): result is { verified: false; reason?: string } {
  return typeof result === "object" && result !== null && (result as { verified?: unknown }).verified === false;
}
