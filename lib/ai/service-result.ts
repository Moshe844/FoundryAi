export function isRetryableServiceAnswer(answer: string) {
  return /\banswer is still queued\b|\bkeep trying\b|\banswer service\b.{0,80}\b(rate-limited|temporary server issue)\b|\bplease try again in a moment\b/i.test(answer);
}

export function createProviderBusyResult() {
  return {
    answer: "The provider is busy right now, and Foundry could not complete this request after retrying. Your workspace context is preserved; send it again in a moment.",
    sources: [],
    retryable: false,
  };
}

export function routeServiceAnswer(answer: string) {
  if (isRetryableServiceAnswer(answer)) return createProviderBusyResult();
  return { answer, sources: [], retryable: false };
}
