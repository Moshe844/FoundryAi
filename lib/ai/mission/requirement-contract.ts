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

export type ObservableBrowserCapability =
  | "multiple-file-upload"
  | "editable-pricing"
  | "visual-polish"
  | "create-record"
  | "search-filter"
  | "update-record"
  | "assign-record"
  | "complete-record"
  | "permission-denied"
  | "cancel-record"
  | "conflict-rejection"
  | "toggle-state"
  | "delete-record"
  | "persistent-state";

const recordNounPattern = "item|items|record|records|note|notes|task|tasks|booking|bookings|reservation|reservations|entry|entries|product|products|event|events|post|posts|customer|customers|order|orders|work[ -]?orders?|assets?|technicians?|schedules?|tickets?|issues?";

function actionTargetsRecord(text: string, actionPattern: string): boolean {
  return new RegExp(`\\b(?:${actionPattern})\\b[^.;\\n]{0,48}\\b(?:${recordNounPattern})\\b|\\b(?:${recordNounPattern})\\b[^.;\\n]{0,48}\\b(?:${actionPattern})\\b`, "i").test(text);
}

// In a relocation request the landmark names *where* something goes, not a feature being asked for.
// "Move the total above the filter bar" mentions a filter only to point at a place on the page, but a
// bare keyword scan read it as "this project must have a working filter" and failed the mission for
// missing a search control it was never asked to build — while the requested move had been applied
// correctly and typecheck, build and preview all passed.
//
// Scoped deliberately to relocation phrasing. In "add a filter above the header" the filter is the
// real request, and only the trailing landmark is dropped.
const POSITIONAL_LANDMARK =
  /\b(?:above|below|under|underneath|beneath|over|on top of|next to|beside|alongside|to the left of|to the right of|in front of|before|after|inside|within)\s+(?:the\s+|a\s+|an\s+|its\s+|their\s+|my\s+)?(?:[\w-]+\s+){0,3}[\w-]+/gi;

function withoutPositionalLandmarks(text: string): string {
  if (!/\b(?:move|reposition|reorder|relocate|place|put|shift|drag|show|display)\b/i.test(text)) return text;
  return text.replace(POSITIONAL_LANDMARK, " ");
}

/**
 * A follow-up edit is accepted on what it was asked to do, not on everything the project already does.
 *
 * The implementation blob appends the saved brief as background context, so capability extraction was
 * reading the whole product description and demanding this mission demonstrate every pre-existing
 * feature in the browser. Asking to move a number failed on "missing capability: search-filter" — a
 * filter the project has had since it was built and that this edit never touched. That is the
 * "it failed even though the build succeeded" class of false failure.
 *
 * `Current instruction:` marks a follow-up against a finished project, so acceptance narrows to it.
 * `Current continuation instruction:` marks an unfinished build being resumed, where the brief really
 * is the requirement source — that blob is left whole.
 */
function acceptanceScopeForFollowUp(text: string): string {
  if (/(?:^|\n)\s*Current continuation instruction:/i.test(text)) return text;
  const followUp = text.match(/(?:^|\n)\s*Current instruction:\s*([\s\S]*)$/i);
  if (!followUp) return text;
  const instruction = followUp[1].split(/\n\s*(?:Saved project brief|Attached readable evidence|Referenced request)\b/i)[0];
  return instruction.trim() || text;
}

/** Framework-independent DOM capabilities that Foundry can verify without another model call. */
const NON_CONTENT_LITERAL = /^(?:index\.html|html|css|js|javascript|typescript|react|next\.?js|vite|astro|svelte|node|npm|json|ya?ml|scss|tsx?|jsx?|api|ui|ux)$/i;

function isCheckableLiteral(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  if (!/[a-z0-9]/i.test(trimmed)) return false;
  if (NON_CONTENT_LITERAL.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed) || /\.\w{2,4}$/.test(trimmed)) return false;
  return true;
}

/**
 * The literal on-screen content a request explicitly demands. A brief like
 *
 *   must show exactly: the heading "Sam Carter", the bio line "Product designer who likes calm
 *   interfaces", and three skill tags labelled Design, Prototyping and Research
 *
 * carries exact strings — the most checkable requirement that exists. The capability contract only ever
 * understood CRUD verbs, so none of this reached the browser gate: it derived nothing, verified nothing,
 * and a page delivering one of three requirements still reported "Done". These literals are checked
 * against the rendered text so an omission becomes a real, repairable acceptance failure.
 */
export function requiredVisibleTextsForTask(task: string): string[] {
  const scope = acceptanceScopeForFollowUp(task);
  const texts = new Set<string>();

  // Quoted literals — straight, smart, and backtick quotes.
  for (const match of scope.matchAll(/["“”'‘’`]([^"“”'‘’`\n]{2,80})["“”'‘’`]/g)) {
    if (isCheckableLiteral(match[1])) texts.add(match[1].trim());
  }

  // Explicit label lists: `labelled Design, Prototyping and Research`, `named Alpha and Beta`.
  for (const match of scope.matchAll(/\b(?:labell?ed|named|called|titled|reading)\s+([A-Z0-9][\w'&-]*(?:\s*(?:,|and|&)\s*(?:and\s+)?[A-Z0-9][\w'&-]*){1,6})/g)) {
    for (const part of match[1].split(/\s*(?:,|and|&)\s*/)) {
      if (isCheckableLiteral(part)) texts.add(part.trim());
    }
  }

  // Natural product instructions rarely quote their most important identity requirements:
  // "portfolio about Moshe Ekstein", "working at Sola Payments", "as an Integration Specialist".
  // Those are still exact, visible claims and are stronger browser evidence than a generic render.
  const identityPatterns = [
    /\b(?:portfolio|profile|website|site|page)\s+(?:(?:is|to\s+be)\s+)?about\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){1,4})/giu,
    /\b(?:works?|working|employed)\s+(?:at|for)\s+([A-Z][\p{L}'&.-]+(?:[ \t]+[A-Z][\p{L}'&.-]+){0,4})/gu,
    /\b(?:works?|working)\s+as\s+(?:an?\s+)?((?!(?:at|for|with)\b)[\p{L}'&/-]+(?:[ \t]+(?!(?:at|for|with)\b)[\p{L}'&/-]+){0,3})(?=[ \t]*(?:[.,;]|\n|$|\bat\b))/giu,
  ];
  for (const pattern of identityPatterns) {
    for (const match of scope.matchAll(pattern)) {
      const literal = match[1].replace(/\s+(?:and|who|with|at|for)\s*$/i, "").trim();
      if (isCheckableLiteral(literal)) texts.add(literal);
    }
  }

  return [...texts].slice(0, 12);
}

export type RequiredDomFeature = { label: string; selector: string };

/**
 * Element-level claims a request makes about the finished page. These are deliberately generic — if the
 * brief names a visible thing, the rendered page must actually contain it. A portfolio brief listing
 * "Responsive images with lazy loading" was ticked complete against a page with ZERO <img> tags (its
 * "media" were CSS gradient divs); nothing checked, because the acceptance contract only understood
 * quoted literals and CRUD verbs. Element existence is the least arguable evidence available.
 */
const DOM_FEATURE_RULES: Array<{ match: RegExp; label: string; selector: string }> = [
  { match: /\blazy[- ]?load(?:ing|ed|s)?\b/i, label: "lazy-loaded media", selector: "img[loading='lazy'], iframe[loading='lazy']" },
  { match: /\b(?:image|images|photo|photos|picture|pictures|gallery|thumbnail|thumbnails|screenshot|screenshots)\b/i, label: "images", selector: "img, picture" },
  { match: /\bfooter\b/i, label: "a footer", selector: "footer, [role='contentinfo']" },
  { match: /\b(?:navigation|navbar|nav bar|nav|menu)\b/i, label: "navigation", selector: "nav, [role='navigation']" },
  { match: /\b(?:form|contact form|signup form|sign-?up form)\b/i, label: "a form", selector: "form" },
  { match: /\bvideos?\b/i, label: "video", selector: "video, iframe[src*='youtube'], iframe[src*='vimeo']" },
  { match: /\bsearch\b/i, label: "a search control", selector: "input[type='search'], [role='search'], input[name*='search' i], input[placeholder*='search' i]" },
  { match: /\b(?:chart|charts|graph|graphs|visuali[sz]ation)\b/i, label: "a chart", selector: "canvas, svg, [class*='chart' i]" },
];

export function requiredDomFeaturesForTask(task: string): RequiredDomFeature[] {
  const scope = acceptanceScopeForFollowUp(task);
  const features = new Map<string, RequiredDomFeature>();
  for (const rule of DOM_FEATURE_RULES) {
    if (rule.match.test(scope)) features.set(rule.label, { label: rule.label, selector: rule.selector });
  }
  // "lazy-loaded media" already implies images; keep the stricter one only.
  if (features.has("lazy-loaded media")) features.delete("images");
  return [...features.values()];
}

export function observableBrowserContractForTask(task: string) {
  // Runtime continuity labels are useful context for the planner, but they are not product
  // requirements. Remove the labels here so browser acceptance never reports Foundry's own
  // bookkeeping language as a missing user-facing feature.
  const acceptanceText = withoutPositionalLandmarks(acceptanceScopeForFollowUp(task).replace(
    /(?:^|\n)\s*(?:Foundry's referenced proposal \([^\n]+\)|Referenced request|Current instruction|Continuation decision|Saved project brief \([^\n]+\)):\s*/gi,
    "\n",
  ));
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
    const recordNoun = new RegExp(`\\b(?:${recordNounPattern})\\b`, "i").test(text);
    if (/\b(?:add|create|new)\b/i.test(text) && recordNoun) capabilities.add("create-record");
    if (/\b(?:search|filter|find)\b/i.test(text)) capabilities.add("search-filter");
    if (actionTargetsRecord(text, "edit|update|modify")) capabilities.add("update-record");
    if (actionTargetsRecord(text, "assign|assignment|reassign")) capabilities.add("assign-record");
    if (actionTargetsRecord(text, "complete|completion|resolve|close")) capabilities.add("complete-record");
    if (/\b(?:permission[- ]denied|forbidden|unauthori[sz]ed|access[- ]denied|insufficient permissions?|role permissions?)\b/i.test(text)) capabilities.add("permission-denied");
    if (/\bcancel(?:led|ing)?\b/i.test(text) && /\b(?:booking|bookings|reservation|reservations|event|events|order|orders)\b/i.test(text)) capabilities.add("cancel-record");
    if (/\b(?:conflict|conflicts|overlap|overlapping|collision|double[- ]book|reject(?:ed|ion)?)\b/i.test(text)) capabilities.add("conflict-rejection");
    if (actionTargetsRecord(text, "pin|unpin|favorite|favourite|star|toggle")) capabilities.add("toggle-state");
    if (actionTargetsRecord(text, "delete|remove|discard")) capabilities.add("delete-record");
    const requestsPersistence = /\b(?:local\s*storage|localstorage|persist(?:s|ed|ence|ent)?|keep (?:the |their )?data|survive\s+(?:a\s+)?reload)\b/i.test(text)
      || /\b(?:save|store|remember|retain)\b[^.;\n]{0,60}\b(?:data|records?|items?|entries|drafts?|reports?|settings?|preferences?|history|state|values?)\b|\b(?:data|records?|items?|entries|drafts?|reports?|settings?|preferences?|history|state|values?)\b[^.;\n]{0,60}\b(?:save|store|remember|retain)\b/i.test(text);
    const rejectsPersistence = /\b(?:no|not|without)\s+(?:any\s+)?(?:data\s+)?persist(?:ence|ent|ing)?\b|\bdo(?:es)?\s+not\s+persist\b|\btransient\b|\bin[- ]memory\s+only\b|\bsession[- ]only\b/i.test(text);
    if (requestsPersistence && !rejectsPersistence) capabilities.add("persistent-state");
    return { text, capabilities: [...capabilities] };
  });
  const operationalEvidenceClause = /^(?:verification[- ]only|(?:re[- ]?)?run|inspect|review|read|open|build|compile|test|verify|validate|check|analy[sz]e|plan)\b|^(?:do\s+not|don't)\b[^.\n]{0,100}\b(?:edit|change|modify|rewrite|touch)\b/i;
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
  // App surfaces imply interactive, feature-rich behavior (forms, many controls). Content surfaces
  // (site/page/website/landing) are frequently — and legitimately — small and formless: a profile card,
  // a portfolio, a landing page. Only an explicit quality word makes a content surface "substantial".
  const appSurface = "app|application|dashboard|tool|planner|tracker|workspace|portal|console|admin|editor|crm|spreadsheet|kanban|board";
  const anySurface = `${appSurface}|website|site|landing|interface|platform`;
  if (new RegExp(`\\b(?:${quality})\\b[^.\\n]{0,70}\\b(?:${anySurface})\\b|\\b(?:${anySurface})\\b[^.\\n]{0,70}\\b(?:${quality})\\b`, "i").test(task)) return true;

  // A long feature list implies substantial UI only for an app surface. A static content page can list
  // five small features (heading, bio, tags, a hover effect) without ever needing forms or ten controls,
  // and demanding them turned a complete profile card into a permanent "thin shell" repair loop.
  const featureLine = task.match(/^Main features:\s*(.+)$/im)?.[1] ?? "";
  const namedFeatures = featureLine.split(/\s*;\s*/).map((item) => item.trim()).filter(Boolean);
  return namedFeatures.length >= 5 && new RegExp(`\\b(?:${appSurface})\\b`, "i").test(task);
}
