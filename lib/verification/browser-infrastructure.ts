/** Generated framework assets can become stale when a build replaces a live preview generation. */
export function isDisposableFrameworkAssetProblem(problem: string) {
  return /(?:HTTP response|Failed local request):[^\r\n]*\/_next\/static\/(?:chunks|css)\//i.test(problem)
    || /(?:Page error|Console):[^\r\n]*(?:Loading chunk \d+ failed|ChunkLoadError)/i.test(problem);
}

/**
 * One stale generated asset invalidates DOM evidence collected from the affected route. Product
 * failures may be classified only after Foundry restarts the owned preview and repeats the gate.
 */
export function hasDisposableFrameworkAssetFailure(problems: string[]) {
  return problems.some(isDisposableFrameworkAssetProblem);
}
