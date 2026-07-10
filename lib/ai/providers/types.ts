import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";

/**
 * Provider-agnostic shapes every call site should use instead of constructing raw OpenAI Responses
 * API bodies inline. A tool schema is defined once as a NeutralTool and translated per-provider by
 * lib/ai/providers/tool-schema.ts; a ManagedModelResult is what every call site parses regardless of
 * which provider actually answered.
 */
export type ProviderId = "openai" | "anthropic" | "google";

export type NeutralContentPart =
  | { type: "text"; text: string }
  // thoughtSignature is Gemini-specific (opaque token tied to a thinking-enabled model's reasoning
  // for this exact function call) — other providers ignore it. Gemini 3.x rejects a later turn that
  // replays a functionCall without echoing back the signature it originally returned (confirmed via a
  // live 400: "Function call is missing a thought_signature in functionCall parts"), so every call site
  // that stores a tool_use turn must round-trip whatever came back on ManagedToolCall.
  | { type: "tool_use"; id: string; name: string; arguments: string; thoughtSignature?: string }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export type NeutralMessage = {
  role: "user" | "assistant";
  content: NeutralContentPart[];
};

/** {name, description, parameters} — today's tool schemas minus the OpenAI-only type:"function"/strict:true wrapper. */
export type NeutralTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type NeutralToolChoice = "auto" | { name: string };

export type ManagedModelRequest = {
  provider: ProviderId;
  model: string;
  system?: string;
  messages: NeutralMessage[];
  tools?: NeutralTool[];
  toolChoice?: NeutralToolChoice;
  maxOutputTokens: number;
  effort?: "low" | "medium" | "high";
};

export type ManagedToolCall = { id?: string; name: string; arguments: string; thoughtSignature?: string };

export type ManagedModelResult = {
  provider: ProviderId;
  model: string;
  text: string;
  toolCalls: ManagedToolCall[];
  usage: RuntimeUsageRecord;
  stopReason: "end" | "tool_call" | "length" | "error";
  errorMessage?: string;
};

export type ManagedCallOptions = {
  apiKey: string;
  workspaceId?: string;
  userId?: string;
  maxAttempts?: number;
};
