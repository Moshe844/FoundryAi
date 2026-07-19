const requirementActionPattern = "add|allow|build|change|connect|create|design|disable|enable|ensure|fix|implement|include|let|make|navigate|open|prevent|redirect|remove|require|show|stop|style|support|update";

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

export type ObservableBrowserCapability = "multiple-file-upload" | "editable-pricing" | "visual-polish";

/** Framework-independent DOM capabilities that Foundry can verify without another model call. */
export function observableBrowserContractForTask(task: string) {
  // Runtime continuity labels are useful context for the planner, but they are not product
  // requirements. Remove the labels here so browser acceptance never reports Foundry's own
  // bookkeeping language as a missing user-facing feature.
  const acceptanceText = task.replace(
    /(?:^|\n)\s*(?:Foundry's referenced proposal \([^\n]+\)|Referenced request|Current instruction|Continuation decision|Saved project brief \([^\n]+\)):\s*/gi,
    "\n",
  );
  const requirements = extractAtomicUserRequirements(acceptanceText).map((text) => {
    const capabilities = new Set<ObservableBrowserCapability>();
    const upload = /\b(?:upload|attach|import|add)\b/i.test(text) && /\b(?:image|images|picture|pictures|photo|photos|media|file|files)\b/i.test(text);
    const multiple = /\b(?:more|multiple|several|many|gallery|pictures|photos|images)\b/i.test(text);
    if (upload && multiple) capabilities.add("multiple-file-upload");
    const pricing = /\b(?:price|prices|pricing|cost|rate|rates)\b/i.test(text);
    const selfServe = /\b(?:edit|update|change|set|manage|adjust|control|myself|my own|on my own|without code)\b/i.test(text);
    if (pricing && selfServe) capabilities.add("editable-pricing");
    const visual = /\b(?:style|styles|styling|visual|design|look|appearance|layout|ui|ux|interface|website|site|app)\b/i.test(text);
    const quality = /\b(?:nice|nicer|beautiful|polished|premium|professional|modern|eye[- ]catching|ugly|redesign|overhaul|improve|better)\b/i.test(text);
    if (visual && quality) capabilities.add("visual-polish");
    return { text, capabilities: [...capabilities] };
  });
  const operationalEvidenceClause = /^(?:inspect|review|read|open|run|build|compile|test|verify|validate|check|analy[sz]e|plan)\b/i;
  return {
    requirements,
    unsupported: requirements
      .filter((item) => item.capabilities.length === 0 && !operationalEvidenceClause.test(item.text))
      .map((item) => item.text),
  };
}

export function requiresPolishedUiAcceptance(task: string): boolean {
  const quality = "nice|nicer|better|beautiful|polished|professional|modern|intentional|premium|eye[- ]catching|high[- ]quality|well[- ]designed|content[- ]rich";
  const surface = "ui|ux|interface|screen|page|form|dashboard|website|site|app|layout|style|styles|styling|design";
  return new RegExp(`\\b(?:${quality})\\b[^.\\n]{0,50}\\b(?:${surface})\\b|\\b(?:${surface})\\b[^.\\n]{0,50}\\b(?:${quality})\\b`, "i").test(task);
}

/**
 * Outcome-level UI detection used by completion policy. The model router's visualNeed is the
 * primary semantic signal when it is available; the text fallback keeps the same safety guarantee
 * for connector and recovery paths that predate a routing assessment.
 */
export function isUserFacingUiOutcome(task: string, visualNeed?: number): boolean {
  if (typeof visualNeed === "number" && visualNeed >= 0.35) return true;
  if (/\b(?:user experience|ux|user interface|interface|ui|front[ -]?end|screen|page|form|dashboard|website|site|layout|visual design|responsive|mobile|phones?|accessibility|styling|styles?)\b/i.test(task)) return true;
  const experientialQuality = "easier|clearer|simpler|smoother|friendlier|more intuitive|more usable|pleasant|delightful|less confusing|less friction";
  const productSurface = "use|users?|experience|workflow|product|application|app|interface";
  return new RegExp(`\\b(?:${experientialQuality})\\b[^.\\n]{0,80}\\b(?:${productSurface})\\b|\\b(?:${productSurface})\\b[^.\\n]{0,80}\\b(?:${experientialQuality})\\b`, "i").test(task);
}

/**
 * A user's current observation that behavior is broken is stronger evidence than an older
 * "complete" mission. File hashes and a compiler pass can prove source integrity, but they can
 * never disprove a newly reported crash, unexpected exit, failed interaction, or wrong response.
 */
export function reportsCurrentBehaviorFailure(task: string): boolean {
  const failure = /\b(?:crash(?:es|ed|ing)?|clos(?:e|es|ed|ing)|exit(?:s|ed|ing)?|shuts?\s+down|disappears?|freezes?|hangs?|stops?\s+working|does\s+not\s+work|doesn['’]?t\s+work|not\s+working|fails?|failing|throws?|errors?|broken|wrong|unexpected)\b/i;
  const runtimeSurface = /\b(?:click(?:ing|ed)?|tap(?:ping|ped)?|press(?:ing|ed)?|open(?:ing|ed)?|launch(?:ing|ed)?|start(?:ing|ed)?|navigat(?:e|es|ed|ing|ion)|settings?|button|menu|dialog|screen|page|form|window|app|application|workflow|login|sign[ -]?in|upload|download|save|endpoint|request|response|command)\b/i;
  return failure.test(task) && runtimeSurface.test(task);
}

/**
 * Repeated runtime/capability work needs a current, requirement-directed acceptance check before
 * Foundry may reuse a prior mission. Non-behavioral source requests (for example a private symbol
 * rename or documentation edit) can still use exact fingerprints and deterministic checks.
 */
export function requiresFreshBehavioralAcceptance(task: string, visualNeed?: number): boolean {
  if (reportsCurrentBehaviorFailure(task) || isUserFacingUiOutcome(task, visualNeed)) return true;
  const behaviorAction = /\b(?:add|allow|change|connect|create|enable|ensure|fix|implement|include|make|prevent|redirect|remove|repair|show|stop|support|update)\b/i;
  const runtimeSurface = /\b(?:settings?|button|menu|dialog|screen|page|form|window|app|application|website|site|workflow|navigation|route|login|sign[ -]?in|auth(?:entication)?|upload|download|save|checkout|endpoint|api|request|response|command|runtime|feature)\b/i;
  return behaviorAction.test(task) && runtimeSurface.test(task);
}

/**
 * Web behavior may enter provisional fingerprint reuse only because the caller immediately runs a
 * fresh requirement-directed browser gate. Other platforms currently lack an equivalent general
 * interaction driver, so their behavioral requests must execute normally.
 */
export function mayAttemptPriorCompletionReuse(task: string, previewPlatform: string): boolean {
  if (reportsCurrentBehaviorFailure(task)) return false;
  return !requiresFreshBehavioralAcceptance(task) || previewPlatform === "web";
}

/** A broad aesthetic improvement must land in the rendered presentation layer, not only in logic. */
export function requiresPresentationLayerChange(task: string, visualNeed?: number): boolean {
  if (requiresPolishedUiAcceptance(task)) return true;
  const broadChange = /\b(?:redesign|overhaul|revamp|make|modify|change|improve|upgrade|moderni[sz]e|polish)\b/i.test(task);
  const aestheticOutcome = /\b(?:look|feel|appearance|visual|design|style|styles|styling|layout|spacing|typography|color|responsive|accessible|easier|clearer|simpler|smoother|friendlier|intuitive|usable|pleasant|delightful|eye[- ]catching|user experience|ux|ui)\b/i.test(task);
  return isUserFacingUiOutcome(task, visualNeed) && broadChange && aestheticOutcome;
}

/** Advanced/full-featured product language raises the rendered acceptance floor across domains. */
export function requiresSubstantialUiAcceptance(task: string): boolean {
  const quality = "advanced|comprehensive|full[- ]featured|feature[- ]rich|production[- ]ready|enterprise[- ]grade";
  const surface = "app|application|website|site|dashboard|tool|planner|tracker|list|workspace|portal|console|interface";
  if (new RegExp(`\\b(?:${quality})\\b[^.\\n]{0,70}\\b(?:${surface})\\b|\\b(?:${surface})\\b[^.\\n]{0,70}\\b(?:${quality})\\b`, "i").test(task)) return true;

  const featureLine = task.match(/^Main features:\s*(.+)$/im)?.[1] ?? "";
  const namedFeatures = featureLine.split(/\s*;\s*/).map((item) => item.trim()).filter(Boolean);
  return namedFeatures.length >= 5 && new RegExp(`\\b(?:${surface})\\b`, "i").test(task);
}
