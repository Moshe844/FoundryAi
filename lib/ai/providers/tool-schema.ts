import type { ManagedToolCall, NeutralTool, NeutralToolChoice, ProviderId } from "@/lib/ai/providers/types";

/**
 * The tool-calling translation layer. A tool is defined once as a NeutralTool ({name, description,
 * parameters} — today's schemas minus the OpenAI-only type:"function"/strict:true wrapper) and
 * translated to each provider's wire format only at request-build time. Every call site keeps parsing
 * `arguments` as a JSON string exactly as it does today (see parseToolCalls) — only where that string
 * came from changes.
 */
export function translateTools(tools: NeutralTool[] | undefined, provider: ProviderId): unknown {
  if (!tools || !tools.length) return undefined;
  if (provider === "openai") {
    // Neutral schemas intentionally allow optional properties. OpenAI strict mode requires every
    // property to be required, so enabling it here rejects otherwise valid cross-provider tools.
    return tools.map((tool) => ({ type: "function", strict: false, name: tool.name, description: tool.description, parameters: tool.parameters }));
  }
  if (provider === "anthropic") {
    return tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
  }
  // google
  return [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: sanitizeSchemaForGoogle(tool.parameters) })) }];
}

/**
 * Gemini's function-declaration schema is a restricted OpenAPI 3.0 subset. Two confirmed-live
 * incompatibilities with the plain-JSON-Schema NeutralTool schemas (written against OpenAI/Anthropic's
 * fuller support):
 * 1. additionalProperties is rejected outright (400: "Unknown name additionalProperties... Cannot find
 *    field").
 * 2. type as an array (JSON Schema's nullable-type idiom, e.g. `type: ["string","null"]`) is rejected
 *    (400: "Proto field is not repeating, cannot start list") — Gemini instead wants `type: "string",
 *    nullable: true`.
 * A call that fails at the Gemini API level doesn't throw here (see google-runtime.ts's retry loop) —
 * it comes back as toolCalls:[] and every call site's `call?.arguments` check treats that exactly like
 * "the model declined to call the tool" and falls back to defaults silently, so a schema mismatch here
 * looks identical to a working call that just returned nothing. Strip/translate rather than rewriting
 * every existing schema.
 */
function sanitizeSchemaForGoogle(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGoogle);
  if (schema === null || typeof schema !== "object") return schema;
  const { additionalProperties, ...rest } = schema as Record<string, unknown>;
  void additionalProperties;

  const result: Record<string, unknown> = {};
  if (Array.isArray(rest.type)) {
    const types = rest.type.filter((t): t is string => typeof t === "string");
    const nonNullType = types.find((t) => t !== "null") ?? "string";
    result.type = nonNullType;
    if (types.includes("null")) result.nullable = true;
  }
  for (const [key, value] of Object.entries(rest)) {
    if (key === "type" && result.type !== undefined) continue;
    result[key] = sanitizeSchemaForGoogle(value);
  }
  return result;
}

export function translateToolChoice(choice: NeutralToolChoice | undefined, provider: ProviderId): unknown {
  if (!choice) return undefined;
  if (provider === "openai") {
    return choice === "auto" ? "auto" : { type: "function", name: choice.name };
  }
  if (provider === "anthropic") {
    return choice === "auto" ? { type: "auto" } : { type: "tool", name: choice.name };
  }
  // google
  return choice === "auto"
    ? { function_calling_config: { mode: "AUTO" } }
    : { function_calling_config: { mode: "ANY", allowed_function_names: [choice.name] } };
}

export type ParsedToolResponse = { toolCalls: ManagedToolCall[]; text: string };

/** raw is the provider's own parsed JSON response body — parseToolCalls normalizes it into the one shape every call site reads. */
export function parseToolCalls(raw: unknown, provider: ProviderId): ParsedToolResponse {
  if (provider === "openai") return parseOpenAIToolCalls(raw);
  if (provider === "anthropic") return parseAnthropicToolCalls(raw);
  return parseGoogleToolCalls(raw);
}

type OpenAIOutputItem = { type?: string; text?: string; content?: Array<{ type?: string; text?: string }>; name?: string; arguments?: string };

function parseOpenAIToolCalls(raw: unknown): ParsedToolResponse {
  const data = raw as { output_text?: string; output?: OpenAIOutputItem[] } | undefined;
  const toolCalls: ManagedToolCall[] = (data?.output ?? [])
    .filter((item) => item.type === "function_call" && item.name)
    .map((item) => ({ name: item.name as string, arguments: item.arguments ?? "{}" }));
  const text = data?.output_text ?? (data?.output ?? []).flatMap((item) => [item.text, ...(item.content ?? []).map((c) => c.text)].filter(Boolean)).join("\n");
  return { toolCalls, text: text ?? "" };
}

type AnthropicContentBlock = { type?: string; text?: string; id?: string; name?: string; input?: unknown };

function parseAnthropicToolCalls(raw: unknown): ParsedToolResponse {
  const data = raw as { content?: AnthropicContentBlock[] } | undefined;
  const blocks = data?.content ?? [];
  const toolCalls: ManagedToolCall[] = blocks
    .filter((block) => block.type === "tool_use" && block.name)
    .map((block) => ({ id: block.id, name: block.name as string, arguments: JSON.stringify(block.input ?? {}) }));
  const text = blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
  return { toolCalls, text };
}

type GoogleFunctionCallPart = { functionCall?: { name?: string; args?: unknown }; thoughtSignature?: string; text?: string };

function parseGoogleToolCalls(raw: unknown): ParsedToolResponse {
  const data = raw as { candidates?: Array<{ content?: { parts?: GoogleFunctionCallPart[] } }> } | undefined;
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const toolCalls: ManagedToolCall[] = parts
    .filter((part) => part.functionCall?.name)
    .map((part) => ({ name: part.functionCall?.name as string, arguments: JSON.stringify(part.functionCall?.args ?? {}), thoughtSignature: part.thoughtSignature }));
  const text = parts.filter((part) => typeof part.text === "string").map((part) => part.text as string).join("\n");
  return { toolCalls, text };
}
