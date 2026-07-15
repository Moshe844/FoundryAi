import type { SourceProvider, SourceProviderRequest, SourceProviderResult, SourceReference } from "@/lib/sources/types";
import { answerQualityContract, instructionAnswerContract, sourceAnswerContract } from "@/lib/ai/answer-contract";
import { isInstructionalRequest } from "@/lib/ai/intent-resolution";
import { modelForProfile } from "@/lib/ai/model-router";
import { looksLikeDiagnosticPaste } from "@/lib/mission-engine";
import { refreshModelRegistry } from "@/lib/ai/routing/dynamic-router";
import { callOpenAIResponsesManaged } from "@/lib/ai/foundry-runtime";

type OpenAIContent = {
  type?: string;
  text?: string;
  annotations?: Array<{
    type?: string;
    url?: string;
    title?: string;
  }>;
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: OpenAIContent[];
  }>;
  error?: {
    message?: string;
  };
};

type FetchedSource = SourceReference & {
  body: string;
};

type SourceAnswerPlan = {
  literalAsk: string;
  mostLikelyIntent: string;
  sourceStrategy: string;
  contextToUse: string;
  clarificationRule: string;
  verification: string;
  fallback: string;
};

type DirectSourceIntent = "download" | "template" | "requirements" | "release-notes" | "changelog" | "api-docs" | "pricing" | "status" | "docs";

const sourceIntentPattern =
  /\b(docs?|official docs?|documentation|sources|cite|citation|release notes?|changelog|vendor|api requirements?|look this up|search|verify online|verify with sources|template|templates|download|downloads|import guide|sample file|sample template)\b/i;
const explicitSourcePhrasePattern =
  /\b(look this up|search (?:the )?(?:web|online)|verify online|verify with sources|cite sources?|official docs?|official link|official url|docs url|docs link|documentation url|release notes?|changelog|download link|sample template|sample file)\b/i;
const sourceTopicPattern =
  /\b(docs?|documentation|sources?|citations?|release notes?|changelog|vendor|api requirements?|templates?|downloads?|import guide|sample files?|sample templates?|urls?|links?)\b/i;
const sourceActionPattern =
  /\b(find|send|give|open|show|need|want|search|look up|verify|cite|download|get|where(?:'s| is| can)?|what(?:'s| is)?)\b/i;
const currentInfoPattern =
  /\b(latest|current|today|newest|most recent)\b.{0,80}\b(version|release|docs?|documentation|url|link|requirements?|changelog|download|template|pricing|status)\b|\b(version|release|docs?|documentation|url|link|requirements?|changelog|download|template|pricing|status)\b.{0,80}\b(latest|current|today|newest|most recent)\b/i;
const followUpSourcePattern = /\b(that source|that page|the page|the docs?|those docs?|same source|the link)\b/i;
const urlPattern = /https?:\/\/[^\s<>)"]+/gi;

export const openAIWebSearchProvider: SourceProvider = {
  shouldUseSources(request) {
    return shouldUseSources(request);
  },
  async answerWithSources(request) {
    await refreshModelRegistry();
    const urls = extractUrls(request.userMessage);

    if (urls.length > 0) {
      return answerFromUrls(request, urls);
    }

    if (shouldReusePreviousSources(request)) {
      return answerFromPreviousSources(request);
    }

    return answerWithWebSearch(request);
  },
};

function shouldUseSources(request: SourceProviderRequest) {
  const message = request.userMessage;
  const urls = extractUrls(message);
  const onlyPastedReadableUrl =
    urls.length === 1 && normalizePastedUrlForRouting(message) === normalizePastedUrlForRouting(urls[0]) && isLikelyReadableUserUrl(urls[0]);
  const sourceIntentText = sourceIntentTextOutsideTranscript(message);
  const explicitIntent = explicitSourceIntent(sourceIntentText || message);

  if (isTroubleshootingOrDiagnosticRequest(message) && !explicitIntent) return false;
  if (looksLikeDiagnosticPaste(message) && !explicitIntent) return false;
  if (isLikelyCommandOutputOrTechnicalTranscript(message) && !explicitSourceIntent(sourceIntentText)) return false;
  if (isApiImplementationCorrectionRequest(request.userMessage)) return false;
  if (!explicitIntent && !onlyPastedReadableUrl) return false;
  if (urls.some(isLikelyReadableUserUrl)) return true;
  if (isQuotedFollowUpWithoutSourceIntent(request)) return false;
  if (mentionsSourceAsCodeOrOrigin(request.userMessage)) return false;
  if (sourceTopicPattern.test(sourceIntentText || message)) return true;
  if (currentInfoPattern.test(sourceIntentText || message)) return true;
  return shouldReusePreviousSources(request);
}

function explicitSourceIntent(message: string) {
  return (
    explicitSourcePhrasePattern.test(message) ||
    explicitLinkIntent(message) ||
    (sourceActionPattern.test(message) && sourceTopicPattern.test(message)) ||
    (sourceActionPattern.test(message) && currentInfoPattern.test(message))
  );
}

function explicitLinkIntent(message: string) {
  return /\b(docs url|documentation url|official url|official link|docs link|download link|link to|url for|where can i download|where is the docs|send (?:me )?(?:the )?(?:url|link)|give (?:me )?(?:the )?(?:url|link))\b/i.test(
    message,
  );
}

function isTroubleshootingOrDiagnosticRequest(message: string) {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return false;

  const explicitlyAsksForSources =
    /\b(find|send|give|open|show|need|want|search|look up|verify)\b.{0,80}\b(docs?|documentation|url|link|links|source|sources|release notes?|changelog)\b/i.test(text) ||
    /\b(docs?|documentation|url|link|links|source|sources|release notes?|changelog)\b.{0,80}\b(find|send|give|open|show|need|want|search|look up|verify)\b/i.test(text);
  if (explicitlyAsksForSources) return false;

  const logOrFailure =
    /\b(FAILURE:\s*Build failed|BUILD FAILED|What went wrong|Try:|Run with --stacktrace|Run with --info|Run with --debug|Exception|Caused by:|Plugin .* was not found|Could not resolve|Unresolved reference|Compilation failed|Execution failed|error:|e: file:\/\/|failed with an exception)\b/i.test(message);
  const asksForFix = /\b(fix|help|why|what went wrong|not working|failed|error|issue|problem|refresh|sync|build|run)\b/i.test(text);

  return logOrFailure || (asksForFix && /\b(error|failed|failure|exception|not found|unresolved|cannot|could not)\b/i.test(text));
}

function shouldReusePreviousSources(request: SourceProviderRequest) {
  if (isApiImplementationCorrectionRequest(request.userMessage)) return false;
  return request.previousSources.length > 0 && followUpSourcePattern.test(request.userMessage) && explicitSourceIntent(request.userMessage);
}

function sourceIntentTextOutsideTranscript(message: string) {
  return message
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:PS\s+[A-Z]:\\|[A-Z]:\\|>|FAILURE:|BUILD FAILED|\* |Warning:|Certificate |Do you still want|Run with|Get more help|Install the latest PowerShell)/i.test(line))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyCommandOutputOrTechnicalTranscript(message: string) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  const technicalMarkers = [
    /^\s*(PS\s+[A-Z]:\\|[A-Z]:\\|>\s*)/i,
    /\bgradlew(?:\.bat)?\b/i,
    /\bGradle\s+\d+(?:\.\d+)?/i,
    /\bJava home\b/i,
    /\bJVM:\b/i,
    /\bOS:\b/i,
    /\bKotlin:\b/i,
    /\bGroovy:\b/i,
    /\bAnt:\b/i,
    /\bLauncher JVM:\b/i,
    /\bDaemon JVM:\b/i,
    /\bDistribution URL:\b/i,
    /\bRevision:\b/i,
  ];

  return technicalMarkers.some((pattern) => pattern.test(message));
}

async function answerWithWebSearch(request: SourceProviderRequest): Promise<SourceProviderResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const instructional = isInstructionalRequest(request.userMessage);
  const directLinkRequest = isDirectSourceLinkRequest(request.userMessage);
  const implementationRequest = isImplementationArtifactRequest(request.userMessage);
  if (!apiKey) {
    return {
      answer: "I need the OpenAI API key configured before I can search verified sources.",
      sources: [],
    };
  }

  const { response, data } = await callOpenAIResponsesManaged<OpenAIResponse>({
    apiKey,
    workspaceId: request.missionTitle || "source-search",
    userId: "default-user",
    maxAttempts: 1,
    requestId: `source-search:${request.userMessage}`,
    routingReason: implementationRequest ? "Fast source discovery followed by bounded Builder artifact generation." : "Search, source reading, and summaries always use Fast.",
    body: JSON.stringify({
      model: modelForProfile(implementationRequest ? "standard" : "fast").model,
      tools: [{ type: "web_search" }],
      input: [
        {
          role: "system",
          content: [
            answerQualityContract,
            instructional ? instructionAnswerContract : "",
            sourceAnswerContract,
            "Use web search only to answer source/current/documentation questions.",
            implementationRequest
              ? "The user is asking you to build or write an artifact using source/docs context. Do not return a link list as the answer. Produce the requested code/script/files directly. Before writing any request body or payload, extract required API fields from the sources and include required constants/config values even if they are not user-upload columns."
              : "",
            directLinkRequest
              ? "The user is asking for links/docs/templates/downloads. Return the requested official links first in a compact list. Do not write a tutorial before the links. Add only a short next-step note after the links."
              : "Use a mentor style, not a report style. If the user is troubleshooting, orient them with current situation, do this now, expected result, and after that.",
            "If multiple fixes or interpretations exist, give the recommended one first and then the practical alternatives. Do not collapse a multi-path problem into one source-backed paragraph.",
          ].join(" "),
        },
        {
          role: "user",
          content: formatSourceRequest(request),
        },
      ],
      temperature: 0.25,
      max_output_tokens: implementationRequest ? 3600 : directLinkRequest ? 700 : instructional ? 1800 : 900,
    }),
  });

  if (!response.ok) {
    return {
      answer: data.error?.message
        ? `I could not search verified sources: ${data.error.message}`
        : "I could not search verified sources right now.",
      sources: [],
    };
  }

  const rawAnswer = sanitizeAnswerUrls(extractText(data) || "I searched, but could not produce a useful sourced answer.");
  const sources = extractSources(data, "openai-web-search", rawAnswer);

  if (sources.length === 0) {
    if (implementationRequest) {
      return {
        answer:
          "I could not get a citable official page back, but this is a build/code request. I should still provide a usable starter implementation and mark any API-specific values to verify.",
        sources: [],
      };
    }

    return {
      answer:
        "I tried to search verified sources, but I could not get a citable official page back. I do not want to guess or invent a URL here.",
      sources: [],
    };
  }

  if (directLinkRequest) {
    return {
      answer: formatDirectSourceLinksAnswer(request, rawAnswer, sources),
      sources,
    };
  }

  return {
    answer: appendSourcesIfNeeded(rawAnswer, sources),
    sources,
  };
}

async function answerFromUrls(request: SourceProviderRequest, urls: string[]): Promise<SourceProviderResult> {
  const fetched = await Promise.all(urls.slice(0, 4).map(fetchUrlSource));
  const sources = fetched.filter((source): source is FetchedSource => source !== null);

  if (sources.length === 0) {
    if (isImplementationArtifactRequest(request.userMessage)) {
      return {
        answer: "I could not read the docs URL from here, but this is a build/code request. I should still provide a usable starter implementation and clearly mark the API-specific pieces to verify against the docs.",
        sources: [],
      };
    }

    return {
      answer: "I could not read the URL you pasted. The page may be blocked, unavailable, or not readable from the server.",
      sources: [],
    };
  }

  const answer = await answerFromProvidedSourceText(request, sources);
  return {
    answer: appendSourcesIfNeeded(answer, sources),
    sources: sources.map(toSourceReference),
  };
}

async function answerFromPreviousSources(request: SourceProviderRequest): Promise<SourceProviderResult> {
  const answer = await answerFromProvidedSourceText(
    request,
    request.previousSources.slice(0, 8).map((source) => ({
      ...source,
      body: source.snippet || source.title,
    })),
  );

  return {
    answer: appendSourcesIfNeeded(answer, request.previousSources),
    sources: request.previousSources,
  };
}

async function answerFromProvidedSourceText(
  request: SourceProviderRequest,
  sources: Array<SourceReference & { body: string }>,
) {
  const apiKey = process.env.OPENAI_API_KEY;
  const instructional = isInstructionalRequest(request.userMessage);
  const directLinkRequest = isDirectSourceLinkRequest(request.userMessage);
  const implementationRequest = isImplementationArtifactRequest(request.userMessage);
  if (!apiKey) return "I need the OpenAI API key configured before I can read and answer from sources.";

  const { response, data } = await callOpenAIResponsesManaged<OpenAIResponse>({
    apiKey,
    workspaceId: request.missionTitle || "source-reading",
    userId: "default-user",
    maxAttempts: 1,
    requestId: `source-reading:${request.userMessage}`,
    routingReason: implementationRequest ? "Builder is used only for the requested implementation artifact." : "Provided-source reading and summarization use Fast.",
    body: JSON.stringify({
      model: modelForProfile(implementationRequest ? "standard" : "fast").model,
      input: [
        {
          role: "system",
          content: [
            answerQualityContract,
            instructional ? instructionAnswerContract : "",
            sourceAnswerContract,
            "Answer from the provided source text first.",
            "Use the source answer plan silently before writing. Do not expose planning labels.",
            implementationRequest
              ? "The user is asking you to build or write an artifact using the docs. Do not return a link list as the answer. Produce the requested code/script/files directly, using the docs as implementation context. Before writing any request body or payload, extract the source-required API fields and include required constants/config values even if they are not spreadsheet columns. If the user listed row fields, merge them with required API fields from the docs. If a required value must be configured, use an env var or clear constant placeholder."
              : "",
            directLinkRequest
              ? "The user is asking for links/docs/templates/downloads. Return the requested links first in a compact list. Do not write a tutorial before the links. Add only a short next-step note after the links."
              : "Use a mentor style, not a report style. Continue from what the user has already done and move one concrete step forward.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Thread title: ${request.missionTitle}`,
            `Current question: ${request.userMessage}`,
            "Relevant prior messages:",
            request.priorMessages.map((message) => `${message.author}: ${message.body}`).join("\n") || "None",
            "Source text:",
            formatSourcesForImplementation(request, sources),
            "Internal source answer plan:",
            formatSourceAnswerPlan(createSourceAnswerPlan(request, sources)),
          ].join("\n\n"),
        },
      ],
      temperature: 0.25,
      max_output_tokens: implementationRequest ? 3600 : directLinkRequest ? 700 : instructional ? 1800 : 900,
    }),
  });

  if (!response.ok) {
    return data.error?.message
      ? `I could not answer from the source: ${data.error.message}`
      : "I could not answer from the source right now.";
  }

  const answer = sanitizeAnswerUrls(extractText(data) || "I read the source, but could not produce a useful answer.");
  return directLinkRequest ? formatDirectSourceLinksAnswer(request, answer, sources.map(toSourceReferenceLike)) : answer;
}

async function fetchUrlSource(url: string): Promise<FetchedSource | null> {
  try {
    const clean = cleanUrl(url);
    const response = await fetch(clean, {
      headers: {
        Accept: "text/html,text/plain,application/json,application/xml,text/xml,*/*",
        "User-Agent": "FoundryWorkspace/1.0",
      },
    });

    if (!response.ok) return null;

    const raw = await response.text();
    const text = htmlToText(raw).slice(0, 30000);
    const title = extractTitle(raw) || clean;

    return {
      id: createSourceId(clean),
      title,
      url: clean,
      snippet: text.slice(0, 600),
      body: text,
      provider: "url-fetch" as const,
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function formatSourcesForImplementation(request: SourceProviderRequest, sources: Array<SourceReference & { body: string }>) {
  const terms = implementationSourceTerms(request.userMessage);

  return sources
    .map((source) =>
      [
        `Source: ${source.title}`,
        `URL: ${source.url}`,
        excerptSourceBody(source.body, terms, 22000),
      ].join("\n"),
    )
    .join("\n\n");
}

function implementationSourceTerms(message: string) {
  const fieldTerms = Array.from(message.matchAll(/\bx[A-Za-z0-9_]+\b/g), (match) => match[0]);
  const quotedTerms = Array.from(message.matchAll(/[`"']([^`"']{3,60})[`"']/g), (match) => match[1] ?? "");
  const userHintTerms = extractImplementationHintTerms(message);
  const baseTerms = [
    "required",
    "fields",
    "request",
    "transaction",
    "command",
    "key",
    "endpoint",
    "content-type",
    "form",
    "json",
    "token",
    "amount",
  ];

  return Array.from(new Set([...fieldTerms, ...quotedTerms, ...userHintTerms, ...baseTerms].map((term) => term.trim()).filter(Boolean)));
}

function extractImplementationHintTerms(message: string) {
  const beforePayload = message.split(/\bconst\s+\w+\s*=\s*\{/i)[0] ?? message;
  return beforePayload
    .replace(/[`"'.,;:()[\]{}]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4)
    .filter((term) => !/\b(forgot|missing|missed|left|docs?|documentation|didn|didnt|you|see|the|with|from|that|this|need|also)\b/i.test(term));
}

function excerptSourceBody(body: string, terms: string[], maxChars: number) {
  const normalized = body.replace(/\r\n/g, "\n");
  if (normalized.length <= maxChars) return normalized;

  const lower = normalized.toLowerCase();
  const windows: Array<{ start: number; end: number }> = [{ start: 0, end: Math.min(5000, normalized.length) }];

  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    let index = lower.indexOf(needle);
    let hits = 0;
    while (index >= 0 && hits < 3) {
      windows.push({
        start: Math.max(0, index - 1800),
        end: Math.min(normalized.length, index + 2600),
      });
      hits += 1;
      index = lower.indexOf(needle, index + needle.length);
    }
  }

  const merged = mergeWindows(windows).slice(0, 8);
  let output = "";
  for (const window of merged) {
    const chunk = normalized.slice(window.start, window.end).trim();
    if (!chunk) continue;
    const next = `${output ? "\n\n[...]\n\n" : ""}${chunk}`;
    if (output.length + next.length > maxChars) break;
    output += next;
  }

  return output || normalized.slice(0, maxChars);
}

function mergeWindows(windows: Array<{ start: number; end: number }>) {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const window of sorted) {
    const previous = merged.at(-1);
    if (previous && window.start <= previous.end + 400) {
      previous.end = Math.max(previous.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }

  return merged;
}

function toSourceReference(source: FetchedSource): SourceReference {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    snippet: source.snippet,
    provider: source.provider,
    createdAt: source.createdAt,
  };
}

function toSourceReferenceLike(source: SourceReference & { body?: string }): SourceReference {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    snippet: source.snippet,
    provider: source.provider,
    createdAt: source.createdAt,
  };
}

function isDirectSourceLinkRequest(message: string) {
  if (isImplementationArtifactRequest(message)) return false;

  const asksForLinks = /\b(send|give|get|find|need|share|provide|show)\b.{0,100}\b(docs?|documentation|resources?|url|link|links|template|templates|sample file|download|downloads|requirements?)\b|\b(docs?|documentation|resources?|url|link|links|template|templates|sample file|download|downloads|requirements?)\b.{0,100}\b(send|give|get|find|need|share|provide|show)\b/i.test(
    message,
  );
  const conciseDocsRequest =
    /\b(docs?|documentation|resources?|links?|urls?|requirements?)\b/i.test(message) &&
    !/\b(what does|what do|summarize|summary|compare|difference|explain|how does|why does)\b/i.test(message);
  const asksForExplanation = /\b(how do i|how to|walk me through|explain|steps?|guide me|setup|set up|configure|implement|integrate|troubleshoot|fix)\b/i.test(
    message,
  );

  return (asksForLinks || conciseDocsRequest) && !asksForExplanation;
}

function isImplementationArtifactRequest(message: string) {
  if (isApiImplementationCorrectionRequest(message)) return true;

  const wantsBuild = /\b(build|create|make|write|generate|give me|provide|need|want|implement|code|script|tool|app|page|html|css|js|javascript|typescript|python|php|node|react|vue|svelte)\b/i.test(
    message,
  );
  const wantsArtifact = /\b(html|css|js|javascript|typescript|code|script|file|files|tool|app|page|form|upload|processor|parser|integration|endpoint|api call|sample implementation)\b/i.test(
    message,
  );
  const sourceOnly = /\b(just|only)\b.{0,30}\b(docs?|links?|urls?|sources?)\b/i.test(message);

  return wantsBuild && wantsArtifact && !sourceOnly;
}

function isApiImplementationCorrectionRequest(message: string) {
  const hasCodeOrPayload = /\bconst\s+\w+\s*=|x[A-Z][A-Za-z0-9_]*\s*:|body\s*=|payload|request body|params|fields?\b/i.test(message);
  const saysMissing = /\b(forgot|missing|missed|left out|didn'?t add|didnt add|add the|include the|required)\b/i.test(message);
  const referencesDocs = /\bdocs?|documentation|api|required|didn'?t you see|didnt you see\b/i.test(message);
  const namesApiFields = extractLikelyApiFieldMentions(message).length > 0;

  return hasCodeOrPayload && (saysMissing || namesApiFields) && referencesDocs;
}

function extractLikelyApiFieldMentions(message: string) {
  const beforePayload = message.split(/\bconst\s+\w+\s*=\s*\{/i)[0] ?? message;
  return Array.from(beforePayload.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g), (match) => match[0]).filter((name) => {
    if (/^x[A-Z][A-Za-z0-9_]*$/.test(name)) return true;
    if (/^(?:api|merchant|software|version|terminal|account|client|developer|vendor)[A-Z][A-Za-z0-9_]*$/.test(name)) return true;
    if (/^[A-Za-z]+(?:Version|Software|SoftwareName|ApiKey|Merchant|Terminal|Account|ClientId|Secret)$/.test(name)) return true;
    return false;
  });
}

function formatDirectSourceLinksAnswer(request: SourceProviderRequest, _rawAnswer: string, sources: SourceReference[]) {
  const officialSources = sources.slice(0, 6);
  const intent = directSourceIntent(request.userMessage);
  const primarySources = rankSourcesForDirectIntent(officialSources, intent);

  const linkList = primarySources
    .map((source) => `- [${source.title}](${source.url})`)
    .join("\n");
  const note = noteForDirectSourceIntent(intent, primarySources);

  return [
    sourceRequestAcknowledgement(request.userMessage),
    "**Official Links**",
    linkList,
    note ? `\n**Note**\n${note}` : "",
    `\n**Next**\n${nextStepForSourceIntent(intent)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function acknowledgementForSourceRequest(message: string) {
  if (/\b(please|pls)\b/i.test(message)) return "Sure — here are the official links I found.";
  if (/\b(can you|could you|would you|send me|give me|share)\b/i.test(message)) {
    return "Sure — here are the official links I found.";
  }
  return "Here are the official links I found.";
}

function sourceRequestAcknowledgement(message: string) {
  if (/\b(please|pls)\b/i.test(message)) return "Sure - here are the official links I found.";
  if (/\b(can you|could you|would you|send me|give me|share)\b/i.test(message)) {
    return "Sure - here are the official links I found.";
  }
  return "Here are the official links I found.";
}

function directSourceIntent(message: string): DirectSourceIntent {
  if (/\b(template|templates|sample file|sample template)\b/i.test(message)) return "template";
  if (/\b(download|downloads|installer|package|sample)\b/i.test(message)) return "download";
  if (/\b(requirements?|rules?|criteria|spec|specification)\b/i.test(message)) return "requirements";
  if (/\brelease notes?\b/i.test(message)) return "release-notes";
  if (/\bchangelog|change log\b/i.test(message)) return "changelog";
  if (/\b(api|endpoint|sdk|developer|integration)\b/i.test(message)) return "api-docs";
  if (/\b(pricing|price|billing|plans?)\b/i.test(message)) return "pricing";
  if (/\b(status|uptime|incident|outage)\b/i.test(message)) return "status";
  return "docs";
}

function rankSourcesForDirectIntent(sources: SourceReference[], intent: DirectSourceIntent) {
  const termsByIntent: Record<DirectSourceIntent, RegExp> = {
    download: /\b(download|installer|package|sample|file)\b/i,
    template: /\b(template|sample|csv|import|download)\b/i,
    requirements: /\b(requirement|rule|spec|specification|guide|docs?|documentation)\b/i,
    "release-notes": /\b(release|notes?|version|updates?)\b/i,
    changelog: /\b(changelog|change log|changes|updates?)\b/i,
    "api-docs": /\b(api|endpoint|sdk|developer|integration|docs?|documentation)\b/i,
    pricing: /\b(pricing|price|billing|plan)\b/i,
    status: /\b(status|uptime|incident|outage)\b/i,
    docs: /\b(docs?|documentation|guide|help|resource)\b/i,
  };

  const matcher = termsByIntent[intent];
  return [...sources].sort((left, right) => {
    const leftText = `${left.title} ${left.url}`;
    const rightText = `${right.title} ${right.url}`;
    return Number(matcher.test(rightText)) - Number(matcher.test(leftText));
  });
}

function noteForDirectSourceIntent(intent: DirectSourceIntent, sources: SourceReference[]) {
  const topSourceText = sources.map((source) => `${source.title} ${source.url}`).join(" ");
  if ((intent === "template" || intent === "download") && !/\b(template|sample|download|installer|package|file)\b/i.test(topSourceText)) {
    return "I found official documentation, but not a separate citable download/template URL. Check the linked official page for the download area.";
  }
  return "";
}

function nextStepForSourceIntent(intent: DirectSourceIntent) {
  const nextSteps: Record<DirectSourceIntent, string> = {
    download: "Open the official page first and use the vendor-provided download link from there. Send me the file or page text if you want me to verify it.",
    template: "Open the official page first and use the vendor-provided template/sample link from there. Send me the template if you want me to check the fields.",
    requirements: "Open the official docs first. If you want, ask me to extract the exact requirements into a short checklist.",
    "release-notes": "Open the official release notes first. If you want, ask me to summarize the changes that matter for your version.",
    changelog: "Open the official changelog first. If you want, ask me to pull out the relevant changes or breaking changes.",
    "api-docs": "Open the official API docs first. If you want, ask me to turn the relevant section into an implementation checklist.",
    pricing: "Open the official pricing page first. If you want, ask me to compare the plan details that matter for your use case.",
    status: "Open the official status page first. If you want, send me the incident text and I can help interpret impact.",
    docs: "Open the official page first. If you want, I can pull out the exact requirements or steps from the docs next.",
  };

  return nextSteps[intent];
}

function formatSourceRequest(request: SourceProviderRequest) {
  return [
    `Thread title: ${request.missionTitle}`,
    `Current question: ${request.userMessage}`,
    "Relevant prior messages:",
    request.priorMessages.map((message) => `${message.author}: ${message.body}`).join("\n") || "None",
    "Previous sources available for follow-up:",
    request.previousSources.map((source) => `- ${source.title}: ${source.url}`).join("\n") || "None",
    "Internal source answer plan:",
    formatSourceAnswerPlan(createSourceAnswerPlan(request)),
    "Answer clearly and cite the sources you used. Prefer official or vendor pages when available.",
  ].join("\n\n");
}

function createSourceAnswerPlan(
  request: SourceProviderRequest,
  providedSources: Array<SourceReference & { body?: string }> = [],
): SourceAnswerPlan {
  const urls = extractUrls(request.userMessage);
  const usesPreviousSources = shouldReusePreviousSources(request);
  const asksCurrentFact = currentInfoPattern.test(request.userMessage);
  const asksSpecificUrl = urls.length > 0;
  const asksDocs = sourceIntentPattern.test(request.userMessage);

  return {
    literalAsk: request.userMessage.replace(/\s+/g, " ").trim().slice(0, 700),
    mostLikelyIntent: asksSpecificUrl
      ? "Answer from the pasted URL first."
      : usesPreviousSources
        ? "Continue from previously cited sources."
        : asksCurrentFact
          ? "Verify a current or latest fact before answering."
          : asksDocs
            ? "Find authoritative documentation or source links before answering."
            : "Use sources only if they materially improve the answer.",
    sourceStrategy: providedSources.length
      ? `Use the ${providedSources.length} provided readable source(s) as primary evidence.`
      : "Search for official, vendor, primary, or authoritative pages first; avoid unsupported snippets and invented URLs.",
    contextToUse: request.priorMessages.length
      ? "Use prior messages only to resolve follow-ups such as that page, same source, or the docs."
      : "No prior conversation context is available.",
    clarificationRule:
      "Do not ask for clarification unless two source targets would require materially different searches and neither can be answered safely.",
    verification:
      "State what source text supports the answer, mention if the source is insufficient, and include a practical verification or next check when useful.",
    fallback:
      "If no citable authoritative source is found, say so plainly instead of guessing or fabricating a link.",
  };
}

function formatSourceAnswerPlan(plan: SourceAnswerPlan) {
  return [
    `Literal ask: ${plan.literalAsk}`,
    `Most likely intent: ${plan.mostLikelyIntent}`,
    `Source strategy: ${plan.sourceStrategy}`,
    `Context to use: ${plan.contextToUse}`,
    `Clarification rule: ${plan.clarificationRule}`,
    `Verification: ${plan.verification}`,
    `Fallback: ${plan.fallback}`,
    "Response shape: If this is a workflow or troubleshooting question, write like a person guiding the user beside them: current situation, do this now, expected result, after that. Include practical alternatives when they change the user's decision.",
    "Keep this plan internal and write only the final answer.",
  ].join("\n");
}

function extractUrls(value: string) {
  return Array.from(value.matchAll(urlPattern)).map((match) => match[0].replace(/[.,;:!?]+$/, ""));
}

function normalizePastedUrlForRouting(value: string) {
  return cleanUrl(value.trim().replace(/^`+|`+$/g, "").replace(/%60$/i, "").replace(/[.,;:!?]+$/g, ""));
}

function extractText(response: OpenAIResponse) {
  if (response.output_text) return response.output_text.trim();

  return response.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractSources(response: OpenAIResponse, provider: SourceReference["provider"], answer = "") {
  const seen = new Set<string>();
  const sources: SourceReference[] = [];

  response.output
    ?.flatMap((item) => item.content ?? [])
    .flatMap((content) => content.annotations ?? [])
    .forEach((annotation) => {
      const url = annotation.url ? cleanUrl(annotation.url) : "";
      if (annotation.type !== "url_citation" || !url || seen.has(url) || !isLikelyVerifiedSourceUrl(url)) return;
      seen.add(url);
      sources.push({
        id: createSourceId(url),
        title: annotation.title || url,
        url,
        provider,
        createdAt: new Date().toISOString(),
      });
    });

  Array.from(answer.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\b(https?:\/\/[^\s<>)"]+)/gi)).forEach((match) => {
    const title = match[1] || match[2] || match[3];
    const url = cleanUrl(match[2] || match[3] || "");
    if (!url || seen.has(url) || !isLikelyVerifiedSourceUrl(url)) return;
    seen.add(url);
    sources.push({
      id: createSourceId(url),
      title,
      url,
      provider,
      createdAt: new Date().toISOString(),
    });
  });

  return sources;
}

function isQuotedFollowUpWithoutSourceIntent(request: SourceProviderRequest) {
  const finalQuestion = extractFinalLine(request.userMessage);
  const quotedText = request.userMessage.replace(finalQuestion, "");
  if (quotedText.trim().length < 20) return false;
  if (/\b(docs?|documentation|official|url|link|sources|cite|citation|look this up|search|release notes?|changelog|download|template)\b/i.test(finalQuestion)) {
    return false;
  }

  return request.priorMessages.some((message) => /\b(foundry|assistant|system)\b/i.test(message.author) && textOverlapScore(quotedText, message.body) >= 0.45);
}

function extractFinalLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? value.trim();
}

function textOverlapScore(a: string, b: string) {
  const aTerms = meaningfulTerms(a);
  const bTerms = new Set(meaningfulTerms(b));
  if (aTerms.length === 0 || bTerms.size === 0) return 0;

  const matches = aTerms.filter((term) => bTerms.has(term)).length;
  return matches / aTerms.length;
}

function meaningfulTerms(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .filter((term) => !["the", "and", "for", "from", "that", "this", "with", "you", "your", "into", "would", "what", "which"].includes(term));
}

function mentionsSourceAsCodeOrOrigin(message: string) {
  return /\bsource\s+(code|access|folder|file|files|module|sdk|project|package|tree|repo|repository)\b/i.test(message);
}

function isLikelyReadableUserUrl(url: string) {
  return isLikelyVerifiedSourceUrl(url);
}

function isLikelyVerifiedSourceUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host === "schemas.android.com" || host.endsWith(".w3.org") || host === "www.w3.org") return false;
    if (/\.(xsd|dtd)$/i.test(path)) return false;

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function appendSourcesIfNeeded(answer: string, sources: SourceReference[]) {
  if (sources.length === 0) return answer;
  if (/^#{1,3}\s+sources\b/im.test(answer) || /\*\*sources\*\*/i.test(answer)) return answer;

  return `${answer.trim()}\n\n**Sources**\n${sources.map((source) => `- [${source.title}](${source.url})`).join("\n")}`;
}

function htmlToText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(value: string) {
  return value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
}

function createSourceId(url: string) {
  return `source-${Buffer.from(cleanUrl(url)).toString("base64url").slice(0, 40)}`;
}

function sanitizeAnswerUrls(answer: string) {
  return answer.replace(/https?:\/\/[^\s<>)"]+/g, (url) => cleanUrl(url));
}

function cleanUrl(value: string) {
  try {
    const url = new URL(value.replace(/[.,;:!?]+$/, ""));
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((param) => url.searchParams.delete(param));
    return url.toString();
  } catch {
    return value.replace(/[.,;:!?]+$/, "");
  }
}
