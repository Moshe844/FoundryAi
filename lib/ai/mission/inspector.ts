import { callOpenAIResponsesManaged, type RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { modelForProfile } from "@/lib/ai/model-router";
import type { ProjectAccess } from "@/lib/ai/mission/project-access";
import type { FactoryExecutionEvent, FactoryExecutionEventKind, FactoryExecutionEventStatus } from "@/lib/factory/types";

export type InspectionResult = {
  answer: string;
  usage: RuntimeUsageRecord[];
};

type InspectorOutputItem = {
  type?: string;
  text?: string;
  content?: Array<{ type?: string; text?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
};

const INSPECTOR_TOOLS = [
  {
    type: "function",
    name: "list_dir",
    strict: true,
    description: "List immediate files and subdirectories under a path relative to the project root. Use \"\" for the root.",
    parameters: { type: "object", additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    type: "function",
    name: "read_file",
    strict: true,
    description: "Read a text file's contents relative to the project root.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { path: { type: "string" }, offset_bytes: { type: "integer" }, limit_bytes: { type: "integer" } },
      required: ["path", "offset_bytes", "limit_bytes"],
    },
  },
  {
    type: "function",
    name: "search_files",
    strict: true,
    description: "Search file names and contents under the project root for a query string.",
    parameters: { type: "object", additionalProperties: false, properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    type: "function",
    name: "answer",
    strict: true,
    description: "Give the final answer to the user's question. Call this once you have read enough real files to answer accurately, never before.",
    parameters: { type: "object", additionalProperties: false, properties: { text: { type: "string" } }, required: ["text"] },
  },
] as const;

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_SOFT_BUDGET_MS = 20_000;

export async function runReadOnlyInspection(input: {
  message: string;
  access: ProjectAccess;
  onEvent: (event: FactoryExecutionEvent) => void | Promise<void>;
  apiKey: string;
  workspaceId?: string;
  userId?: string;
  maxTurns?: number;
  softBudgetMs?: number;
}): Promise<InspectionResult> {
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const softBudgetMs = input.softBudgetMs ?? DEFAULT_SOFT_BUDGET_MS;
  const startedAt = Date.now();
  const usage: RuntimeUsageRecord[] = [];
  const investigatedPaths: string[] = [];
  let timelineLength = 0;
  let lastReasoningNormalized = "";

  async function emit(kind: FactoryExecutionEventKind, status: FactoryExecutionEventStatus, title: string, extra: Partial<FactoryExecutionEvent> = {}) {
    timelineLength += 1;
    await input.onEvent({
      id: `inspect-event-${timelineLength}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      kind,
      status,
      title,
      ...extra,
    });
  }

  async function emitReasoning(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 8) return;
    const normalized = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    if (lastReasoningNormalized) {
      const aTokens = new Set(normalized.split(/\s+/).filter(Boolean));
      const bTokens = new Set(lastReasoningNormalized.split(/\s+/).filter(Boolean));
      let overlap = 0;
      for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
      if (overlap / Math.max(aTokens.size, bTokens.size, 1) > 0.6) return;
    }
    lastReasoningNormalized = normalized;
    await emit("reasoning", "completed", trimmed);
  }

  const conversation: Record<string, unknown>[] = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: [
            "You answer a question about a real, already-connected software project by reading its actual files — you investigate like an engineer skimming a codebase, not a script that reads everything indiscriminately.",
            "Before you call a tool, if the reason isn't already obvious from what you just said, say one short plain sentence connecting it to the user's actual question — e.g. \"Checking server.js because the question mentions an upload token.\" Don't restate the same reasoning again in different words turn after turn; speak again only when your understanding changes.",
            "Most questions can be answered from a small number of well-chosen files — an entry point, a config/README, and whatever plausibly matches the question's own keywords. Do not read the whole project and do not open a file you have no real reason to open.",
            "Answer as soon as you have a real, useful answer — never keep reading just to be thorough. A grounded partial answer beats an exhaustive one that never arrives.",
            "Never invent file names or behavior. Only describe what you actually read.",
            "Do not write or modify any files — you have no ability to do so in this mode.",
            "When ready, call answer with a concise, specific response, and end by asking what the user wants next.",
          ].join("\n"),
        },
      ],
    },
    { role: "user", content: [{ type: "input_text", text: input.message }] },
  ];

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const elapsedMs = Date.now() - startedAt;
    const mustAnswerNow = turn === maxTurns || elapsedMs > softBudgetMs;

    if (mustAnswerNow && turn > 1) {
      conversation.push({
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Answer now with your best understanding based on everything you've read so far. Do not ask to continue and never say you ran out of time or turns — give a real, useful answer: what you found, what's most likely relevant (or wrong), and what you'd check or change next.",
          },
        ],
      });
    }

    const body = JSON.stringify({
      model: modelForProfile("standard").model,
      input: conversation,
      tools: INSPECTOR_TOOLS,
      tool_choice: mustAnswerNow ? { type: "function", name: "answer" } : "auto",
      max_output_tokens: 1200,
    });

    const result = await callOpenAIResponsesManaged<{ output?: InspectorOutputItem[]; output_text?: string }>({
      apiKey: input.apiKey,
      body,
      workspaceId: input.workspaceId,
      userId: input.userId,
      maxAttempts: 6,
    });
    usage.push(result.usage);

    if (result.status !== "ok") continue;

    const outputItems = result.data.output ?? [];
    const call = outputItems.find((item) => item.type === "function_call" && item.name && item.call_id);
    const messageText = result.data.output_text || extractMessageText(outputItems);

    if (!call) {
      if (messageText) return { answer: messageText, usage };
      conversation.push({ role: "user", content: [{ type: "input_text", text: "Continue, or call answer with what you found." }] });
      continue;
    }

    if (messageText) await emitReasoning(messageText);

    const args = safeJsonParse(call.arguments ?? "{}") ?? {};
    conversation.push({ type: "function_call", call_id: call.call_id, name: call.name, arguments: call.arguments ?? "{}" });

    if (call.name === "answer") {
      const text = typeof args.text === "string" ? args.text : "";
      await emit("summary", "completed", "Answered without editing files", { output: text });
      return { answer: text, usage };
    }

    if (call.name === "read_file" && typeof args.path === "string") investigatedPaths.push(args.path);

    const toolResult = await executeReadOnlyTool(call.name ?? "", args, input.access, emit).catch((error) => ({
      error: error instanceof Error ? error.message : "Tool call failed unexpectedly.",
    }));
    conversation.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(toolResult) });
  }

  const fallbackAnswer = investigatedPaths.length
    ? `I looked at ${investigatedPaths.join(", ")} but hit a provider issue before I could form a full answer. Ask again and I'll pick up from what I already read instead of starting over.`
    : "I hit a provider issue before I could read enough of the project to answer. Try again in a moment.";
  return { answer: fallbackAnswer, usage };
}

async function executeReadOnlyTool(
  name: string,
  args: Record<string, unknown>,
  access: ProjectAccess,
  emit: (kind: FactoryExecutionEventKind, status: FactoryExecutionEventStatus, title: string, extra?: Partial<FactoryExecutionEvent>) => Promise<void>,
): Promise<unknown> {
  const pathArg = typeof args.path === "string" ? args.path : "";
  const basename = pathArg.split("/").pop() || pathArg;

  switch (name) {
    case "list_dir": {
      await emit("inspection", "running", `Listing ${pathArg || "/"}`);
      const entries = await access.listDir(pathArg);
      await emit("inspection", "completed", `Listed ${entries.length} entries in ${pathArg || "/"}`, {
        details: { entries: entries.slice(0, 50).map((entry) => `${entry.kind === "directory" ? "[dir] " : ""}${entry.name}`) },
      });
      return { entries };
    }
    case "read_file": {
      await emit("inspection", "running", `Reading ${basename}`);
      const offsetBytes = typeof args.offset_bytes === "number" ? args.offset_bytes : 0;
      const limitBytes = typeof args.limit_bytes === "number" ? args.limit_bytes : 20_000;
      const result = await access.readFile(pathArg, { offsetBytes, limitBytes });
      await emit("inspection", result.exists ? "completed" : "warning", result.exists ? `Read ${basename} (${result.totalBytes} bytes)` : `${pathArg} not found`);
      return result;
    }
    case "search_files": {
      const query = typeof args.query === "string" ? args.query : "";
      await emit("inspection", "running", `Searching for "${query}"`);
      const hits = access.searchFiles ? await access.searchFiles(query) : [];
      await emit("inspection", "completed", `Found ${hits.length} matches for "${query}"`);
      return { hits };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function extractMessageText(items: InspectorOutputItem[]) {
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
