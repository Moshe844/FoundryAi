import { callOpenAIResponsesManaged } from "@/lib/ai/foundry-runtime";
import { parseToolCalls, translateToolChoice, translateTools } from "@/lib/ai/providers/tool-schema";
import type { ManagedCallOptions, ManagedModelRequest, ManagedModelResult, NeutralMessage } from "@/lib/ai/providers/types";

/**
 * Thin adapter over the existing, unchanged callOpenAIResponsesManaged() — this file only translates
 * the neutral ManagedModelRequest/Result shape to/from OpenAI's Responses API body. No behavior
 * change to the underlying retry/rate-limit/usage-tracking logic in lib/ai/foundry-runtime.ts.
 */
export async function callOpenAIManaged(request: ManagedModelRequest, options: ManagedCallOptions): Promise<ManagedModelResult> {
  const input: unknown[] = [];
  if (request.system) {
    input.push({ role: "system", content: [{ type: "input_text", text: request.system }] });
  }
  for (const message of request.messages) {
    input.push(...renderOpenAIMessage(message));
  }

  const body = JSON.stringify({
    model: request.model,
    ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
    ...(request.tools ? { tools: translateTools(request.tools, "openai"), tool_choice: translateToolChoice(request.toolChoice, "openai") ?? "auto" } : {}),
    max_output_tokens: request.maxOutputTokens,
    input,
  });

  const result = await callOpenAIResponsesManaged<{
    output_text?: string;
    output?: Array<{ type?: string; text?: string; content?: Array<{ type?: string; text?: string; refusal?: string }>; name?: string; arguments?: string }>;
    error?: { message?: string };
  }>({
    apiKey: options.apiKey,
    body,
    workspaceId: options.workspaceId,
    userId: options.userId,
    maxAttempts: options.maxAttempts,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });

  const parsed = parseToolCalls(result.data, "openai");
  return {
    provider: "openai",
    model: result.usage.model,
    text: parsed.text,
    toolCalls: parsed.toolCalls,
    usage: result.usage,
    stopReason: parsed.toolCalls.length ? "tool_call" : result.status === "ok" ? "end" : "error",
    errorMessage: result.data.error?.message,
  };
}

/**
 * A NeutralMessage renders to zero or more flat OpenAI "input" items — plain text becomes a
 * role+content item, but tool_use/tool_result parts each become their own top-level function_call /
 * function_call_output item (OpenAI's Responses API conversation array is flat, not nested per
 * message, which is exactly the coupling this translation layer exists to hide from every call site).
 */
function renderOpenAIMessage(message: NeutralMessage): unknown[] {
  const items: unknown[] = [];
  const textParts = message.content.filter((part) => part.type === "text");
  if (textParts.length) {
    items.push({ role: message.role, content: textParts.map((part) => ({ type: message.role === "assistant" ? "output_text" : "input_text", text: part.text })) });
  }
  for (const part of message.content) {
    if (part.type === "tool_use") {
      items.push({ type: "function_call", call_id: part.id, name: part.name, arguments: part.arguments });
    } else if (part.type === "tool_result") {
      items.push({ type: "function_call_output", call_id: part.toolUseId, output: part.content });
    }
  }
  return items;
}
