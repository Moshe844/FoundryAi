const verificationActionPattern = /\b(?:run|execute|rerun|verify|validate|revalidate|check|recheck|test|retest|exercise)\b/i;
const verificationTargetPattern = /\b(?:acceptance|browser|preview|navigation|user\s+flow|workflow|build|tests?|lint|typecheck|runtime|server|endpoint|artifact|gate|capabilit(?:y|ies))\b/i;
const explicitNoMutationPattern = /\b(?:do not|don't|without)\b[^.!?\n]{0,120}\b(?:edit|change|modify|rewrite|touch|rebuild)(?:ing)?\b|\bno\s+(?:source|file|code)\s+changes?\b/i;
const explicitRepairPattern = /\b(?:fix|repair|implement|change|modify|rewrite|refactor|resolve)\b/i;

/**
 * A verification request may name the behavior being exercised with ordinary mutation verbs:
 * "run the add, complete, and delete acceptance flow". Those are capability names, not authority
 * to edit source. Only an explicit repair instruction changes this operation into implementation.
 */
export function isVerificationOnlyOperation(request: string): boolean {
  const text = request.trim();
  if (!verificationActionPattern.test(text) || !verificationTargetPattern.test(text)) return false;
  if (explicitNoMutationPattern.test(text)) return true;
  if (explicitRepairPattern.test(text)) return false;

  // Direct destructive/edit commands remain mutations unless the verb is clearly naming a
  // verification surface such as "delete flow" or "add capability".
  const directMutation = /^(?:please\s+)?(?:add|create|remove|delete|complete|finish)\b|(?:\band\b|\bthen\b)\s+(?:add|create|remove|delete|complete|finish)\b(?!\s+(?:acceptance|browser|capabilit(?:y|ies)|flow|workflow|behavior|functionality|operation|test|verification)\b)/i;
  return !directMutation.test(text);
}
