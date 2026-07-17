export type BlockerDisposition = "recoverable-engineering" | "external-dependency" | "authority-required" | "user-stopped";

export type AutonomousTerminalAssessment = {
  disposition: BlockerDisposition;
  terminal: boolean;
  nextAction?: string;
};

const USER_STOPPED = /\b(?:stopped|cancelled|canceled) by (?:the )?user\b|user stopped/i;
const AUTHORITY_REQUIRED = /\b(?:approval|permission|consent) (?:is )?required\b|approval denied|user decision required|ambiguous destructive|confirm (?:deletion|overwrite|replacement)|outside (?:the )?(?:accepted|authorized) scope/i;
const MISSING_CREDENTIALS = /\b(?:missing|unset|invalid|expired)\s+(?:api[_ -]?key|credential|token|secret|certificate|signing identity|password)\b|authentication failed|unauthorized|forbidden/i;
const PROVIDER_OUTAGE = /\b(?:providers?|services?|registr(?:y|ies)|networks?)\b[^.\n]{0,80}\b(?:unavailable|unreachable|outage|timed? out|timeout|dns|connection refused)\b|econnrefused|enotfound|eai_again/i;
const PLATFORM_IMPOSSIBLE = /requires (?:macos|windows|linux|xcode|a connected device|an emulator)|not available on this (?:operating system|platform)|unsupported host platform/i;

/**
 * Foundry's enforceable autonomy contract. Project defects are recoverable by default; a model's
 * inability to solve them is not itself a terminal condition. Only user control/safety boundaries
 * and concrete external dependencies may stop autonomous engineering work.
 */
export function assessAutonomousBlocker(reason: string): AutonomousTerminalAssessment {
  const text = reason.trim();
  if (USER_STOPPED.test(text)) return { disposition: "user-stopped", terminal: true };
  if (AUTHORITY_REQUIRED.test(text)) {
    return {
      disposition: "authority-required",
      terminal: true,
      nextAction: "Approve the specifically identified action or choose the requested safe alternative; Foundry will then resume from the preserved evidence.",
    };
  }
  if (MISSING_CREDENTIALS.test(text)) {
    return {
      disposition: "external-dependency",
      terminal: true,
      nextAction: "Provide or refresh the named credential in Foundry settings, then resume this task; no completed source work needs to be repeated.",
    };
  }
  if (PROVIDER_OUTAGE.test(text)) {
    return {
      disposition: "external-dependency",
      terminal: true,
      nextAction: "Resume when the named provider or network endpoint is reachable; Foundry will continue from the saved failure fingerprint without replaying completed work.",
    };
  }
  if (PLATFORM_IMPOSSIBLE.test(text)) {
    return {
      disposition: "external-dependency",
      terminal: true,
      nextAction: "Connect a compatible host, SDK, emulator, or device for the named platform check, then resume from the existing project state.",
    };
  }
  return { disposition: "recoverable-engineering", terminal: false };
}

export function terminalBlockerWithNextAction(reason: string) {
  const assessment = assessAutonomousBlocker(reason);
  if (!assessment.terminal || !assessment.nextAction || reason.includes(assessment.nextAction)) return reason;
  return `${reason.trim()} Next action: ${assessment.nextAction}`;
}
