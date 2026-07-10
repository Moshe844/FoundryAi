import { callOpenAIManaged } from "@/lib/ai/providers/openai-runtime";
import { callAnthropicManaged } from "@/lib/ai/providers/anthropic-runtime";
import { callGoogleManaged } from "@/lib/ai/providers/google-runtime";
import type { ManagedCallOptions, ManagedModelRequest, ManagedModelResult, ProviderId } from "@/lib/ai/providers/types";

/** The env var each provider's key lives in — same "read directly, 503 if missing" pattern every route already used for OPENAI_API_KEY. */
export function apiKeyForProvider(provider: ProviderId): string | undefined {
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  return process.env.GEMINI_API_KEY;
}

export function envVarNameForProvider(provider: ProviderId): string {
  if (provider === "openai") return "OPENAI_API_KEY";
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  return "GEMINI_API_KEY";
}

/**
 * The single entry point every migrated call site should import instead of calling
 * callOpenAIResponsesManaged (or a provider-specific function) directly. Dispatches on
 * request.provider.
 */
export async function callManagedModel(request: ManagedModelRequest, options: ManagedCallOptions): Promise<ManagedModelResult> {
  if (request.provider === "openai") return callOpenAIManaged(request, options);
  if (request.provider === "anthropic") return callAnthropicManaged(request, options);
  return callGoogleManaged(request, options);
}
