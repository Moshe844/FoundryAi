import { openAIWebSearchProvider } from "@/lib/sources/openai-web-search";
import type { SourceProvider, SourceProviderRequest, SourceProviderResult } from "@/lib/sources/types";

const providers: SourceProvider[] = [openAIWebSearchProvider];

export function needsSources(request: SourceProviderRequest) {
  return providers.some((provider) => provider.shouldUseSources(request));
}

export async function answerWithSources(request: SourceProviderRequest): Promise<SourceProviderResult> {
  const provider = providers.find((candidate) => candidate.shouldUseSources(request));

  if (!provider) {
    return {
      answer: "I do not need external sources for this answer.",
      sources: [],
    };
  }

  return provider.answerWithSources(request);
}
