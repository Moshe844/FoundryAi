export type PreviewVerificationResult = {
  processStarted: boolean;
  portListening: boolean;
  healthCheckPassed: boolean;
  contentLoaded: boolean;
  expectedProjectMatched: boolean;
  consoleErrors: string[];
  failedRequests: string[];
  verifiedAt: string;
};

export type PreviewSession = {
  id: string;
  missionId: string;
  url?: string;
  state: "starting" | "ready" | "error" | "stopped";
  reason?: string;
  verification?: PreviewVerificationResult;
  createdAt: string;
  updatedAt: string;
};

export interface PreviewProbe {
  processStarted(): Promise<boolean>;
  portListening(): Promise<boolean>;
  healthCheck(): Promise<boolean>;
  contentLoaded(): Promise<boolean>;
  expectedProjectMatched(): Promise<boolean>;
  browserEvidence(): Promise<{ consoleErrors: string[]; failedRequests: string[] }>;
}

export class PreviewCoordinator {
  async verify(session: PreviewSession, probe: PreviewProbe): Promise<PreviewSession> {
    const [processStarted, portListening, healthCheckPassed, contentLoaded, expectedProjectMatched, browser] = await Promise.all([
      probe.processStarted(),
      probe.portListening(),
      probe.healthCheck(),
      probe.contentLoaded(),
      probe.expectedProjectMatched(),
      probe.browserEvidence(),
    ]);
    const verifiedAt = new Date().toISOString();
    const verification: PreviewVerificationResult = {
      processStarted,
      portListening,
      healthCheckPassed,
      contentLoaded,
      expectedProjectMatched,
      consoleErrors: browser.consoleErrors,
      failedRequests: browser.failedRequests,
      verifiedAt,
    };
    const ready = processStarted && portListening && healthCheckPassed && contentLoaded && expectedProjectMatched && browser.consoleErrors.length === 0;
    return {
      ...session,
      state: ready ? "ready" : "error",
      reason: ready ? undefined : failureReason(verification),
      verification,
      updatedAt: verifiedAt,
    };
  }
}

function failureReason(result: PreviewVerificationResult) {
  if (!result.processStarted) return "Preview process did not start.";
  if (!result.portListening) return "Preview process started but no listening port was verified.";
  if (!result.healthCheckPassed) return "Preview health check failed.";
  if (!result.contentLoaded) return "Preview URL did not load usable content.";
  if (!result.expectedProjectMatched) return "Preview content did not match the active project.";
  if (result.consoleErrors.length) return `Preview rendered with ${result.consoleErrors.length} console error(s).`;
  return "Preview verification failed.";
}
