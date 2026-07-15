import { parseToolCalls, translateToolChoice, translateTools } from "@/lib/ai/providers/tool-schema";
import type { ManagedCallOptions, ManagedModelRequest, ManagedModelResult, NeutralMessage } from "@/lib/ai/providers/types";
import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { pricingForProviderModel } from "@/lib/ai/model-router";

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Real (not placeholder) Anthropic Messages API integration — hand-rolled fetch, matching the existing
 * OpenAI integration's own pattern (lib/ai/foundry-runtime.ts) rather than adding the @anthropic-ai/sdk
 * dependency. Its own self-contained retry loop, deliberately simpler than the OpenAI runtime's
 * (no workspace-tier plans/token-compression/response-cache — those are OpenAI-usage-specific
 * optimizations, not required for correctness here).
 */
export async function callAnthropicManaged(request: ManagedModelRequest, options: ManagedCallOptions): Promise<ManagedModelResult> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 90_000);
  const callSignal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    cache_control: { type: "ephemeral" },
    messages: request.messages.map(renderAnthropicMessage),
  };
  if (request.system) body.system = request.system;
  if (request.tools?.length) {
    body.tools = translateTools(request.tools, "anthropic");
    body.tool_choice = translateToolChoice(request.toolChoice, "anthropic") ?? { type: "auto" };
  }
  // Extended thinking is tier-gated, not used for low-effort (Fast/Builder) work — matches the Cost
  // Rule (never spend extra latency/tokens on trivial requests).
  if (request.effort === "high") {
    body.thinking = { type: "adaptive" };
  }

  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const workspaceId = options.workspaceId || "default-workspace";
  const userId = options.userId || "default-user";
  let rateLimitCount = 0;
  let failureCount = 0;
  let lastErrorMessage: string | undefined;
  let activeBody = body;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    let data: AnthropicResponse;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": options.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(activeBody),
        signal: callSignal,
      });
      data = (await response.json().catch(() => ({}))) as AnthropicResponse;
    } catch (error) {
      failureCount += 1;
      lastErrorMessage = error instanceof Error ? `Network request to Anthropic failed: ${error.message}` : "Network request to Anthropic failed.";
      if (callSignal.aborted) break;
      if (attempt < maxAttempts) {
        await delay(Math.min(6000, attempt * 800));
        continue;
      }
      break;
    }

    if (response.ok) {
      const parsed = parseToolCalls(data, "anthropic");
      const inputTokens = data.usage?.input_tokens ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;
      const usage: RuntimeUsageRecord = {
        provider: "anthropic",
        workspaceId,
        userId,
        model: request.model,
        requestedModel: request.model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: estimateAnthropicCost(request.model, inputTokens, outputTokens),
        requestCount: 1,
        rateLimitCount,
        failureCount,
        contextCompressed: false,
        cached: (data.usage?.cache_read_input_tokens ?? 0) > 0,
        createdAt: new Date().toISOString(),
      };
      return {
        provider: "anthropic",
        model: request.model,
        text: parsed.text,
        toolCalls: parsed.toolCalls,
        usage,
        stopReason: parsed.toolCalls.length ? "tool_call" : data.stop_reason === "max_tokens" ? "length" : "end",
      };
    }

    lastErrorMessage = data.error?.message;

    if (response.status === 429) {
      rateLimitCount += 1;
      if (attempt < maxAttempts) {
        await delay(Math.min(retryDelayFromHeader(response.headers.get("retry-after")) || attempt * 900, 8000));
        continue;
      }
      break;
    }

    if (response.status === 400 && data.error?.type === "invalid_request_error" && /max_tokens/i.test(data.error?.message ?? "")) {
      failureCount += 1;
      if (attempt < maxAttempts) {
        activeBody = { ...activeBody, max_tokens: Math.min(Number(activeBody.max_tokens) || 1024, 4096) };
        continue;
      }
      break;
    }

    failureCount += 1;
    if ((response.status >= 500 || response.status === 529) && attempt < maxAttempts) {
      await delay(Math.min(6000, attempt * 800));
      continue;
    }

    break;
  }

  const usage: RuntimeUsageRecord = {
    provider: "anthropic",
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
  return { provider: "anthropic", model: request.model, text: "", toolCalls: [], usage, stopReason: "error", errorMessage: lastErrorMessage ?? "Anthropic request failed." };
}

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  error?: { type?: string; message?: string };
};

/** Anthropic's messages array only carries user/assistant turns — a system prompt is a separate top-level field, handled by the caller. */
function renderAnthropicMessage(message: NeutralMessage) {
  return {
    role: message.role,
    content: message.content.map((part) => {
      if (part.type === "text") return { type: "text", text: part.text };
      if (part.type === "image") {
        const parsed = parseDataUrl(part.dataUrl);
        return { type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } };
      }
      if (part.type === "tool_use") return { type: "tool_use", id: part.id, name: part.name, input: safeJsonParse(part.arguments) };
      return { type: "tool_result", tool_use_id: part.toolUseId, content: part.content, is_error: part.isError || undefined };
    }),
  };
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  return { mediaType: match?.[1] ?? "image/png", data: match?.[2] ?? "" };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function estimateAnthropicCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = pricingForProviderModel("anthropic", model);
  return Number((((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000).toFixed(6));
}

function retryDelayFromHeader(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
