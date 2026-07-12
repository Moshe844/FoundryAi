import { parseToolCalls, translateToolChoice, translateTools } from "@/lib/ai/providers/tool-schema";
import type { ManagedCallOptions, ManagedModelRequest, ManagedModelResult, NeutralMessage } from "@/lib/ai/providers/types";
import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { pricingForProviderModel } from "@/lib/ai/model-router";

/**
 * Real (not placeholder) Gemini generateContent integration — hand-rolled fetch, same rationale as
 * anthropic-runtime.ts (no @google/generative-ai dependency, own self-contained retry loop).
 *
 * Verified live on 2026-07-10 against a real GEMINI_API_KEY: ListModels confirmed current model IDs
 * (see lib/ai/model-router.ts's TIER_MODEL_TABLE comment — gemini-2.5-flash/pro are listed but reject
 * generateContent for this account; gemini-flash-lite-latest/gemini-pro-latest returned real 200s), and
 * a full function-calling round trip through /api/factory/intent (forced provider:"google") returned a
 * real tool_use response, confirming the functionResponse role/shape below is correct.
 */
export async function callGoogleManaged(request: ManagedModelRequest, options: ManagedCallOptions): Promise<ManagedModelResult> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 90_000);
  const callSignal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const body: Record<string, unknown> = {
    contents: renderGoogleContents(request.messages),
    generationConfig: { maxOutputTokens: request.maxOutputTokens },
  };
  if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
  if (request.tools?.length) {
    body.tools = translateTools(request.tools, "google");
    body.tool_config = translateToolChoice(request.toolChoice, "google") ?? { function_calling_config: { mode: "AUTO" } };
  }

  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const workspaceId = options.workspaceId || "default-workspace";
  const userId = options.userId || "default-user";
  let rateLimitCount = 0;
  let failureCount = 0;
  let lastErrorMessage: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    let data: GoogleGenerateContentResponse;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${options.apiKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: callSignal,
      });
      data = (await response.json().catch(() => ({}))) as GoogleGenerateContentResponse;
    } catch (error) {
      failureCount += 1;
      lastErrorMessage = error instanceof Error ? `Network request to Google failed: ${error.message}` : "Network request to Google failed.";
      if (callSignal.aborted) break;
      if (attempt < maxAttempts) {
        await delay(Math.min(6000, attempt * 800));
        continue;
      }
      break;
    }

    if (response.ok && !data.error) {
      const parsed = parseToolCalls(data, "google");
      const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
      const usage: RuntimeUsageRecord = {
        provider: "google",
        workspaceId,
        userId,
        model: request.model,
        requestedModel: request.model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: estimateGoogleCost(request.model, inputTokens, outputTokens),
        requestCount: 1,
        rateLimitCount,
        failureCount,
        contextCompressed: false,
        cached: false,
        createdAt: new Date().toISOString(),
      };
      const finishReason = data.candidates?.[0]?.finishReason;
      return {
        provider: "google",
        model: request.model,
        text: parsed.text,
        toolCalls: parsed.toolCalls,
        usage,
        stopReason: parsed.toolCalls.length ? "tool_call" : finishReason === "MAX_TOKENS" ? "length" : "end",
      };
    }

    const status = data.error?.status;
    const httpStatus = data.error?.code ?? response.status;
    lastErrorMessage = data.error?.message;

    if (httpStatus === 429 || status === "RESOURCE_EXHAUSTED") {
      rateLimitCount += 1;
      if (attempt < maxAttempts) {
        await delay(Math.min(8000, attempt * 900));
        continue;
      }
      break;
    }

    failureCount += 1;
    if ((httpStatus >= 500 || status === "UNAVAILABLE") && attempt < maxAttempts) {
      await delay(Math.min(6000, attempt * 800));
      continue;
    }

    break;
  }

  const usage: RuntimeUsageRecord = {
    provider: "google",
    workspaceId,
    userId,
    model: request.model,
    requestedModel: request.model,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    requestCount: 1,
    rateLimitCount,
    failureCount: Math.max(1, failureCount),
    contextCompressed: false,
    cached: false,
    createdAt: new Date().toISOString(),
  };
  return { provider: "google", model: request.model, text: "", toolCalls: [], usage, stopReason: "error", errorMessage: lastErrorMessage ?? "Gemini request failed." };
}

type GoogleGenerateContentResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; status?: string; message?: string };
};

/**
 * Gemini uses role "user"/"model" (never "assistant"), and a tool_result maps to a functionResponse
 * part keyed by NAME, not a call id — unlike OpenAI/Anthropic, so tool_use ids must be resolved to
 * their names by scanning the whole history first (best-effort per the file-level flag above; verify
 * against a live round trip before trusting this path).
 */
function renderGoogleContents(messages: NeutralMessage[]) {
  const nameForToolUseId = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "tool_use") nameForToolUseId.set(part.id, part.name);
    }
  }

  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: message.content.map((part) => {
      if (part.type === "text") return { text: part.text };
      if (part.type === "tool_use") return { functionCall: { name: part.name, args: safeJsonParse(part.arguments) }, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) };
      return { functionResponse: { name: nameForToolUseId.get(part.toolUseId) ?? "unknown_tool", response: { content: part.content, isError: part.isError || undefined } } };
    }),
  }));
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function estimateGoogleCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = pricingForProviderModel("google", model);
  return Number((((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000).toFixed(6));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
