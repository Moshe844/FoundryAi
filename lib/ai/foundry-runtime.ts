import crypto from "crypto";
import { fallbackModelForModel, modelForRuntimePayload, pricingForModel } from "@/lib/ai/model-router";

type RuntimeOpenAIResponse = {
  output_text?: string;
  output?: Array<{ type?: string; text?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type ManagedRuntimeResult<T extends RuntimeOpenAIResponse = RuntimeOpenAIResponse> = {
  response: Response;
  data: T;
  status: "ok" | "retrying" | "queued" | "failed" | "configured-fallback";
  statusMessage?: string;
  usage: RuntimeUsageRecord;
};

export type RuntimeUsageRecord = {
  workspaceId: string;
  userId: string;
  model: string;
  requestedModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  requestCount: number;
  rateLimitCount: number;
  failureCount: number;
  contextCompressed: boolean;
  cached: boolean;
  createdAt: string;
};

type ManagedCallOptions = {
  apiKey: string;
  body: string;
  workspaceId?: string;
  userId?: string;
  priority?: "active" | "background";
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
};

type RuntimePlan = {
  name: "free" | "pro" | "team" | "enterprise" | "developer";
  maxInputTokens: number;
  maxOutputTokens: number;
  monthlyTokens: number;
  concurrentRequests: number;
};

const runtimePlans: Record<RuntimePlan["name"], RuntimePlan> = {
  free: {
    name: "free",
    maxInputTokens: 24000,
    maxOutputTokens: 1000,
    monthlyTokens: 250000,
    concurrentRequests: 1,
  },
  pro: {
    name: "pro",
    maxInputTokens: 56000,
    maxOutputTokens: 8000,
    monthlyTokens: 3000000,
    concurrentRequests: 2,
  },
  team: {
    name: "team",
    maxInputTokens: 90000,
    maxOutputTokens: 12000,
    monthlyTokens: 15000000,
    concurrentRequests: 4,
  },
  enterprise: {
    name: "enterprise",
    maxInputTokens: 120000,
    maxOutputTokens: 16000,
    monthlyTokens: 100000000,
    concurrentRequests: 8,
  },
  developer: {
    name: "developer",
    maxInputTokens: 180000,
    maxOutputTokens: 24000,
    monthlyTokens: Number.MAX_SAFE_INTEGER,
    concurrentRequests: 12,
  },
};

const queues = new Map<string, Promise<unknown>>();
const usageRecords: RuntimeUsageRecord[] = [];
const responseCache = new Map<string, { data: RuntimeOpenAIResponse; expiresAt: number; usage: RuntimeUsageRecord }>();

export async function callOpenAIResponsesManaged<T extends RuntimeOpenAIResponse = RuntimeOpenAIResponse>(
  options: ManagedCallOptions,
): Promise<ManagedRuntimeResult<T>> {
  const workspaceId = options.workspaceId || "default-workspace";
  const userId = options.userId || "default-user";
  const plan = runtimePlanForWorkspace(workspaceId);
  const fetcher = options.fetchImpl ?? fetch;
  const prepared = prepareRequestBody(options.body, plan);
  const cacheKey = cacheKeyFor(prepared.body);

  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const response = new Response(JSON.stringify(cached.data), { status: 200 });
    return {
      response,
      data: cached.data as T,
      status: "ok",
      statusMessage: "Served from cache.",
      usage: { ...cached.usage, cached: true },
    };
  }

  return enqueueRuntimeCall(workspaceId, plan.concurrentRequests, async () => {
    const started = Date.now();
    const maxAttempts = Math.max(1, options.maxAttempts ?? 6);
    let activeBody = prepared.body;
    let activeModel = prepared.model;
    let lastResponse = new Response(null, { status: 503 });
    let lastData = {} as T;
    let rateLimitCount = 0;
    let failureCount = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      let data: T;
      try {
        response = await fetcher("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: activeBody,
        });
        data = (await response.json().catch(() => ({}))) as T;
      } catch (error) {
        failureCount += 1;
        const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
        const networkMessage = error instanceof Error ? `Network request to the AI provider failed: ${error.message}${cause ? ` (${cause})` : ""}` : "Network request to the AI provider failed.";
        lastResponse = new Response(null, { status: 503 });
        lastData = { error: { message: networkMessage } } as T;
        if (attempt < maxAttempts) {
          await delay(Math.min(6000, attempt * 800));
          continue;
        }
        break;
      }

      lastResponse = response;
      lastData = data;

      if (response.ok) {
        const usage = createUsageRecord({
          workspaceId,
          userId,
          requestedModel: prepared.requestedModel,
          model: activeModel,
          body: activeBody,
          data,
          contextCompressed: prepared.compressed,
          cached: false,
          rateLimitCount,
          failureCount,
        });
        usageRecords.push(usage);
        maybeCacheResponse(cacheKey, data, usage, activeBody);
        return {
          response,
          data,
          status: "ok" as const,
          statusMessage: prepared.compressed ? "Preparing a smaller context..." : elapsedStatus(started),
          usage,
        };
      }

      if (response.status === 429 || isRateLimitResponse(data)) {
        rateLimitCount += 1;
        const fallback = fallbackModelForModel(activeModel);
        if (fallback && fallback.model !== activeModel && canSafelyFallback(activeBody)) {
          const routed = replaceModel(activeBody, fallback.model);
          activeBody = routed.body;
          activeModel = routed.model;
        }
        if (attempt < maxAttempts) {
          await delay(Math.min(Math.max(retryDelayFromRateLimit(data.error?.message) || retryDelayFromHeader(response.headers.get("retry-after")) || attempt * 750, 250), 6000));
          continue;
        }
      }

      if (isModelUnavailableResponse(response.status, data)) {
        const fallback = fallbackModelForModel(activeModel);
        if (fallback && fallback.model !== activeModel && canSafelyFallback(activeBody) && attempt < maxAttempts) {
          const routed = replaceModel(activeBody, fallback.model);
          activeBody = routed.body;
          activeModel = routed.model;
          failureCount += 1;
          continue;
        }
      }

      const repairedBody = repairRejectedRequestBody(activeBody, response.status, data);
      if (repairedBody && repairedBody !== activeBody && attempt < maxAttempts) {
        activeBody = repairedBody;
        failureCount += 1;
        continue;
      }

      failureCount += 1;
      if (response.status >= 500 && attempt < maxAttempts) {
        await delay(Math.min(6000, attempt * 800));
        continue;
      }

      break;
    }

    const usage = createUsageRecord({
      workspaceId,
      userId,
      requestedModel: prepared.requestedModel,
      model: activeModel,
      body: activeBody,
      data: lastData,
      contextCompressed: prepared.compressed,
      cached: false,
      rateLimitCount,
      failureCount: Math.max(1, failureCount),
    });
    usageRecords.push(usage);

    return {
      response: lastResponse,
      data: lastData,
      status: rateLimitCount ? "queued" as const : "failed" as const,
      statusMessage: rateLimitCount ? "Provider is busy, retrying..." : "The answer is still queued. Foundry will keep trying.",
      usage,
    };
  });
}

export function prepareRequestBody(rawBody: string, plan: RuntimePlan = runtimePlanForWorkspace("default-workspace")) {
  const parsed = safeJsonParse(rawBody);
  if (!parsed || typeof parsed !== "object") {
    return {
      body: rawBody,
      requestedModel: "unknown",
      model: "unknown",
      estimatedInputTokens: estimateTokens(rawBody),
      compressed: false,
    };
  }

  const requestedModel = String((parsed as { model?: string }).model ?? "unknown");
  const model = modelForRuntimePayload(parsed, requestedModel).model;
  (parsed as { model?: string }).model = model;

  const outputBudget = Math.min(Number((parsed as { max_output_tokens?: number }).max_output_tokens ?? plan.maxOutputTokens), plan.maxOutputTokens);
  (parsed as { max_output_tokens?: number }).max_output_tokens = outputBudget;

  let body = JSON.stringify(parsed);
  let estimatedInputTokens = estimateTokens(body);
  let compressed = false;

  if (estimatedInputTokens > plan.maxInputTokens) {
    compressed = true;
    compressInputTextContent(parsed, plan.maxInputTokens);
    body = JSON.stringify(parsed);
    estimatedInputTokens = estimateTokens(body);
  }

  if (estimatedInputTokens > plan.maxInputTokens) {
    compressed = true;
    hardCapInputTextContent(parsed, plan.maxInputTokens);
    body = JSON.stringify(parsed);
    estimatedInputTokens = estimateTokens(body);
  }

  return {
    body,
    requestedModel,
    model,
    estimatedInputTokens,
    compressed,
  };
}

export function getRuntimeUsageSnapshot(workspaceId = "default-workspace") {
  const records = usageRecords.filter((record) => record.workspaceId === workspaceId);
  return {
    workspaceId,
    requests: records.reduce((sum, record) => sum + record.requestCount, 0),
    tokensUsed: records.reduce((sum, record) => sum + record.totalTokens, 0),
    estimatedCostUsd: Number(records.reduce((sum, record) => sum + record.estimatedCostUsd, 0).toFixed(6)),
    rateLimits: records.reduce((sum, record) => sum + record.rateLimitCount, 0),
    failures: records.reduce((sum, record) => sum + record.failureCount, 0),
    byModel: records.reduce<Record<string, number>>((models, record) => {
      models[record.model] = (models[record.model] ?? 0) + 1;
      return models;
    }, {}),
  };
}

export function estimateTokens(value: string) {
  return Math.ceil(value.length / 4);
}

function runtimePlanForWorkspace(workspaceId: string): RuntimePlan {
  const workspaceKey = workspaceId.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  const configured = (process.env[`FOUNDRY_PLAN_${workspaceKey}`] ?? process.env.FOUNDRY_PLAN ?? "pro").toLowerCase();
  if (configured === "free" || configured === "team" || configured === "enterprise" || configured === "developer") return runtimePlans[configured];
  return runtimePlans.pro;
}

async function enqueueRuntimeCall<T>(workspaceId: string, _concurrency: number, task: () => Promise<T>) {
  const previous = queues.get(workspaceId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(workspaceId, next.finally(() => {
    if (queues.get(workspaceId) === next) queues.delete(workspaceId);
  }));
  return next;
}

function compressInputTextContent(parsed: unknown, maxTokens: number) {
  const maxChars = Math.min(48000, Math.max(4000, Math.floor(maxTokens * 2.4)));
  const texts = collectInputTextNodes(parsed);
  const totalChars = texts.reduce((sum, item) => sum + item.value.length, 0);
  if (totalChars <= maxChars) return;

  let remaining = maxChars;
  texts.forEach((item, index) => {
    const share = Math.max(1200, Math.floor(maxChars * (item.value.length / Math.max(1, totalChars))));
    const allowed = index === texts.length - 1 ? Math.max(800, remaining) : Math.min(share, remaining);
    item.set(compressText(item.value, allowed));
    remaining -= Math.min(allowed, item.value.length);
  });
}

function hardCapInputTextContent(parsed: unknown, maxTokens: number) {
  const maxChars = Math.min(42000, Math.max(2500, Math.floor(maxTokens * 2.1)));
  let remaining = maxChars;
  collectInputTextNodes(parsed).forEach((item) => {
    const allowed = Math.max(400, Math.min(item.value.length, remaining));
    item.set(compressText(item.value, allowed));
    remaining -= allowed;
  });
}

function collectInputTextNodes(parsed: unknown) {
  const nodes: Array<{ value: string; set: (next: string) => void }> = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.type === "input_text" && typeof record.text === "string") {
      nodes.push({
        value: record.text,
        set: (next) => {
          record.text = next;
        },
      });
    }
    Object.values(record).forEach(visit);
  };
  visit(parsed);
  return nodes;
}

function compressText(value: string, maxChars: number) {
  const lineCompressed = value
    .split(/\r?\n/)
    .map((line) => {
      if (line.length <= 2200) return line;
      if (/\b(error|failed|failure|exception|current blocker|recommended next|selected evidence|relevant excerpt|what went wrong|build failed|conflict)\b/i.test(line)) {
        return line.slice(0, 1600);
      }
      return `${line.slice(0, 700)}\n[long low-signal line compressed]\n${line.slice(-350)}`;
    })
    .join("\n");

  if (lineCompressed.length <= maxChars) return lineCompressed;
  const headChars = Math.floor(maxChars * 0.35);
  const tailChars = Math.floor(maxChars * 0.18);
  const issueLines = lineCompressed
    .split(/\r?\n/)
    .filter((line) => /\b(error|failed|failure|exception|current blocker|recommended next|selected evidence|relevant excerpt|what went wrong|build failed|conflict)\b/i.test(line))
    .slice(0, 40)
    .join("\n");
  const middle = issueLines ? `\n[compressed relevant lines]\n${issueLines.slice(0, Math.max(400, maxChars - headChars - tailChars - 160))}\n` : "\n[context compressed for token budget]\n";
  return `${lineCompressed.slice(0, headChars).trimEnd()}${middle}${lineCompressed.slice(-tailChars).trimStart()}`;
}

function replaceModel(body: string, model: string) {
  const parsed = safeJsonParse(body) as { model?: string } | undefined;
  if (!parsed) return { body, model };
  parsed.model = model;
  return { body: JSON.stringify(parsed), model };
}

function canSafelyFallback(body: string) {
  return !/\b(surgical|legal|medical|financial|must be exact|high stakes|security incident)\b/i.test(body);
}

function isRateLimitResponse(data: RuntimeOpenAIResponse) {
  return /\brate.?limit|tokens per min|\btpm\b|too many requests/i.test([data.error?.message, data.error?.type, data.error?.code].filter(Boolean).join(" "));
}

function isModelUnavailableResponse(status: number, data: RuntimeOpenAIResponse) {
  const errorText = [data.error?.message, data.error?.type, data.error?.code].filter(Boolean).join(" ");
  return (status === 400 || status === 404) && /\b(?:model|profile|requested model|selected model)\b.{0,120}\b(?:not found|unavailable|unsupported|does not exist|invalid|access|not have access)\b|\b(?:model_not_found|invalid_model|unsupported_model)\b/i.test(errorText);
}

function repairRejectedRequestBody(body: string, status: number, data: RuntimeOpenAIResponse) {
  if (status !== 400 && status !== 422) return "";
  const errorText = [data.error?.message, data.error?.type, data.error?.code].filter(Boolean).join(" ");
  const parsed = safeJsonParse(body) as Record<string, unknown> | undefined;
  if (!parsed) return "";

  let changed = false;

  if (/\b(?:temperature|top_p|presence_penalty|frequency_penalty)\b.{0,120}\b(?:unsupported|unknown|not supported|not allowed|invalid|only the default)\b/i.test(errorText)) {
    ["temperature", "top_p", "presence_penalty", "frequency_penalty"].forEach((key) => {
      if (key in parsed) {
        delete parsed[key];
        changed = true;
      }
    });
  }

  if (/\bmax_output_tokens\b.{0,120}\b(?:too high|maximum|exceeds|invalid)\b/i.test(errorText) && typeof parsed.max_output_tokens === "number") {
    parsed.max_output_tokens = Math.min(parsed.max_output_tokens, 1200);
    changed = true;
  }

  return changed ? JSON.stringify(parsed) : "";
}

function retryDelayFromRateLimit(message = "") {
  const match = message.match(/try again in\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|seconds?)/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  return /^m/i.test(match[2] ?? "") ? amount : amount * 1000;
}

function retryDelayFromHeader(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function createUsageRecord(input: {
  workspaceId: string;
  userId: string;
  requestedModel: string;
  model: string;
  body: string;
  data: RuntimeOpenAIResponse;
  contextCompressed: boolean;
  cached: boolean;
  rateLimitCount: number;
  failureCount: number;
}): RuntimeUsageRecord {
  const inputTokens = input.data.usage?.input_tokens ?? estimateTokens(input.body);
  const outputTokens = input.data.usage?.output_tokens ?? estimateTokens(extractRuntimeText(input.data));
  const totalTokens = input.data.usage?.total_tokens ?? inputTokens + outputTokens;
  const pricing = pricingForModel(input.model);
  const estimatedCostUsd = ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000;

  return {
    workspaceId: input.workspaceId,
    userId: input.userId,
    requestedModel: input.requestedModel,
    model: input.model,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    requestCount: 1,
    rateLimitCount: input.rateLimitCount,
    failureCount: input.failureCount,
    contextCompressed: input.contextCompressed,
    cached: input.cached,
    createdAt: new Date().toISOString(),
  };
}

function maybeCacheResponse(cacheKey: string, data: RuntimeOpenAIResponse, usage: RuntimeUsageRecord, body: string) {
  if (!isCacheableRequest(body, data)) return;
  responseCache.set(cacheKey, {
    data,
    usage,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
}

function isCacheableRequest(body: string, data: RuntimeOpenAIResponse) {
  if (!extractRuntimeText(data)) return false;
  return /\b(stable answer|source lookup|documentation|what is|explain)\b/i.test(body) && !/\b(latest|today|current price|now|this screenshot|this log)\b/i.test(body);
}

function cacheKeyFor(body: string) {
  return crypto.createHash("sha256").update(body.replace(/\s+/g, " ").trim()).digest("hex");
}

function extractRuntimeText(data: RuntimeOpenAIResponse) {
  if (data.output_text) return data.output_text;
  return data.output
    ?.flatMap((item) => [item.text, ...(item.content ?? []).map((content) => content.text)].filter(Boolean))
    .join("\n") ?? "";
}

function elapsedStatus(started: number) {
  return Date.now() - started > 1500 ? "Provider is busy, retrying..." : undefined;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
