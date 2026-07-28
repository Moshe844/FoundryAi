export type GreenfieldBatchEvidence = {
  status: string;
  blocker?: string;
  changedFileCount: number;
  hasRunnableEntry: boolean;
};

export function needsGreenfieldImplementationRecovery(evidence: GreenfieldBatchEvidence): boolean {
  if (evidence.status !== "failed" && evidence.status !== "passed") return false;
  const blocker = evidence.blocker ?? "";
  const sourceBatchWithoutReachableProduct = evidence.changedFileCount > 0 && !evidence.hasRunnableEntry;
  const interruptedAfterWriting = evidence.changedFileCount > 0
    && /command or file write failed|production build (?:not verified|failed)/i.test(blocker);
  const setupOnlyNoProgress = !evidence.hasRunnableEntry
    && /NO_PROGRESS_BEFORE_MUTATION|model stopped producing executable actions before a verified source change/i.test(blocker);
  return sourceBatchWithoutReachableProduct || interruptedAfterWriting || setupOnlyNoProgress;
}
