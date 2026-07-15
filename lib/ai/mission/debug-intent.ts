const FAILURE_SIGNAL = /\b(error|exception|failure|failed|fails?|failing|broken|crash(?:es|ing)?|bug|issue|problem|diagnose|debug|unexpected character|syntaxerror|typeerror|referenceerror|uncaught|traceback|status\s+(?:500|404|403|401))\b/i;
const TECHNICAL_TARGET = /\b(parse|parser|json|upload|request|response|stack trace|console|terminal|build|compile|api|route|endpoint|auth|login|runtime)\b/i;

/** Requires both a real failure signal and a technical target. Ordinary product briefs that mention
 * uploads, requests, JSON, builds, or future failure handling are creation work, not bug reports. */
export function isConcreteDebugRequest(task: string) {
  const text = task.trim();
  if (!text || !FAILURE_SIGNAL.test(text)) return false;
  if (/^(?:build|create|implement|add|design|scaffold)\b/i.test(text) && /\b(?:error|failure)\s+(?:state|states|handling|message|messages|page|pages|ui)\b/i.test(text) && !/\b(?:failed|failing|broken|crash(?:es|ing)?|bug|diagnose|debug|unexpected|exception)\b/i.test(text)) return false;
  if (/\b(?:no|without)\s+(?:known\s+)?(?:errors?|failures?|issues?|problems?)\b/i.test(text) && !/\b(?:but|however|except)\b/i.test(text)) return false;
  return TECHNICAL_TARGET.test(text) || /\b(?:when|while|after|during)\b/i.test(text);
}
