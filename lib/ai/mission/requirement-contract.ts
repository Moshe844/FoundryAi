const requirementActionPattern = "add|allow|build|change|connect|create|design|ensure|fix|implement|include|let|make|navigate|open|redirect|remove|show|style|support|update";

/** Keep every independently actionable clause from the user's message as a durable contract. */
export function extractAtomicUserRequirements(task: string): string[] {
  const normalized = task
    .replace(/\r/g, "")
    .replace(/^\s*(?:nice|great|good|okay|ok)[,!]?\s+(?:now\s+)?/i, "")
    .trim();
  if (!normalized) return [];

  const candidates = normalized
    .split(new RegExp(
      `(?:\\n\\s*(?:[-*•]|\\d+[.):])?\\s+|[;]+\\s*|[.!?]+\\s+|\\s+(?:also|plus|as\\s+well\\s+as)\\s+|\\s+and\\s+(?=(?:please\\s+)?(?:${requirementActionPattern})\\b))`,
      "i",
    ))
    .map((clause) => clause
      .replace(/^\s*(?:[-*•]|\d+[.):])\s*/, "")
      .replace(/^\s*(?:and|also|then|please|now)\s+/i, "")
      .replace(/[.!?]+$/, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter((clause) => clause.length >= 4);

  const seen = new Set<string>();
  return candidates.filter((clause) => {
    const key = clause.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function requiresPolishedUiAcceptance(task: string): boolean {
  const quality = "nice|beautiful|polished|professional|modern|intentional|premium|high[- ]quality|well[- ]designed|content[- ]rich";
  const surface = "ui|ux|interface|screen|page|form|dashboard|website|site|app|layout";
  return new RegExp(`\\b(?:${quality})\\b[^.\\n]{0,50}\\b(?:${surface})\\b|\\b(?:${surface})\\b[^.\\n]{0,50}\\b(?:${quality})\\b`, "i").test(task);
}
