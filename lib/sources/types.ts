export type SourceReference = {
  id: string;
  title: string;
  url: string;
  snippet?: string;
  provider: "openai-web-search" | "url-fetch";
  createdAt: string;
};

export type SourceProviderRequest = {
  missionTitle: string;
  userMessage: string;
  priorMessages: Array<{
    author: string;
    body: string;
  }>;
  previousSources: SourceReference[];
};

export type SourceProviderResult = {
  answer: string;
  sources: SourceReference[];
};

export type SourceProvider = {
  shouldUseSources: (request: SourceProviderRequest) => boolean;
  answerWithSources: (request: SourceProviderRequest) => Promise<SourceProviderResult>;
};
