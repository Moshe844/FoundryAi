import { NextResponse } from "next/server";
import { generateReasonedAnswer } from "@/lib/ai/provider";
import type { ReasoningRequest } from "@/lib/ai/context";
import { normalizeReasoningRequest } from "@/lib/ai/request-normalization";
import { isRetryableServiceAnswer, createProviderBusyResult } from "@/lib/ai/service-result";
import { answerWithSources, needsSources } from "@/lib/sources/provider";
import { refreshModelRegistry } from "@/lib/ai/routing/dynamic-router";
import { modelForAutoRequest } from "@/lib/ai/model-router";

export async function POST(request: Request) {
  try {
    const body = normalizeReasoningRequest((await request.json()) as Partial<ReasoningRequest>);

    const sourceRequest = {
      missionTitle: body.missionTitle,
      userMessage: body.userMessage,
      priorMessages: body.priorMessages ?? [],
      previousSources: body.sources ?? [],
    };

    if (needsSources(sourceRequest)) {
      const result = await answerWithSources(sourceRequest);
      return NextResponse.json(result);
    }

    await refreshModelRegistry();
    const modelSelection = modelForAutoRequest(body, { provider: "openai" });
    const answer = await generateReasonedAnswer(body);

    if (isRetryableServiceAnswer(answer)) {
      return NextResponse.json(createProviderBusyResult());
    }

    return NextResponse.json({ answer, sources: [], modelSelection });
  } catch (error) {
    if (isRetryableRouteError(error)) {
      return NextResponse.json({ answer: "", sources: [], retryable: true, retryAfterMs: 900 });
    }

    return NextResponse.json(
      {
        answer: userSafeRouteError(error),
        sources: [],
      },
      { status: 200 },
    );
  }
}

function isRetryableRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\brate.?limit|tokens per min|\btpm\b|too many requests/i.test(message);
}

function userSafeRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/\brate.?limit|tokens per min|\btpm\b|too many requests/i.test(message)) {
    return "The answer is still queued. Foundry will keep trying.";
  }
  return "I hit a server-side issue while preparing that answer.";
}
