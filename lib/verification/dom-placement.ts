/**
 * Verifies *where* something ended up, in the rendered page.
 *
 * Source-level checks can confirm that content moved but not that it landed where the user asked.
 * Observed live: asked to put the total "above the filter bar", a mission moved it *inside* the filter
 * bar's flex row, so it rendered side-by-side with "Filter by date:". The source moved 30 lines, every
 * build check passed, and Foundry reported "Done" — but the user's eye sees the thing beside the bar,
 * not above it. Placement is the request, so placement has to be the check.
 *
 * The rendered DOM answers this unambiguously with geometry, which is exactly what the user's eye does.
 * This module is pure: it takes element boxes and returns a verdict, so it is testable without a browser.
 */

export type ElementBox = {
  /** Debug/user-facing hint: tag plus class, e.g. `section.filter-bar`. */
  selectorHint: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SpatialRelation = "above" | "below" | "left-of" | "right-of" | "inside";

export type SpatialRequirement = {
  relation: SpatialRelation;
  subjectTokens: string[];
  landmarkTokens: string[];
  /** The phrase this came from, for evidence the user can recognize. */
  source: string;
};

export type PlacementResult = {
  verdict: "satisfied" | "violated" | "indeterminate";
  evidence: string;
  /** Actionable correction when violated — names the actual geometry, not the goal. */
  correction?: string;
};

const RELATION_PATTERNS: { relation: SpatialRelation; pattern: RegExp }[] = [
  { relation: "above", pattern: /\b(?:above|over|on top of|at the top of|before)\b/i },
  { relation: "below", pattern: /\b(?:below|under|underneath|beneath|at the bottom of|after)\b/i },
  { relation: "left-of", pattern: /\bto the left of\b/i },
  { relation: "right-of", pattern: /\bto the right of\b/i },
  { relation: "inside", pattern: /\b(?:inside|within|into)\b/i },
];

const REPOSITION_VERB = /\b(?:move|reposition|reorder|relocate|place|put|shift|show|display)\b/i;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "so", "it", "its", "that", "this", "then", "there", "shows", "show",
  "showing", "displays", "display", "please", "can", "could", "you", "would", "should", "make", "into",
  "from", "with", "for", "to", "of", "in", "on", "at", "is", "are", "be", "my", "our", "their", "just",
]);

function tokenize(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/** Extracts "put <subject> above <landmark>" as a checkable spatial claim. */
export function spatialRequirementForRequest(request: string): SpatialRequirement | undefined {
  if (!REPOSITION_VERB.test(request)) return undefined;
  const verb = REPOSITION_VERB.exec(request);
  if (!verb) return undefined;

  let best: { relation: SpatialRelation; index: number; length: number } | undefined;
  for (const { relation, pattern } of RELATION_PATTERNS) {
    const match = pattern.exec(request);
    if (!match) continue;
    if (match.index <= verb.index) continue;
    if (!best || match.index < best.index) best = { relation, index: match.index, length: match[0].length };
  }
  if (!best) return undefined;

  const subjectTokens = tokenize(request.slice(verb.index + verb[0].length, best.index));
  const landmarkTokens = tokenize(request.slice(best.index + best.length));
  if (!subjectTokens.length || !landmarkTokens.length) return undefined;
  return { relation: best.relation, subjectTokens, landmarkTokens, source: request.trim() };
}

// Text is a weak signal for identity because an ancestor's innerText contains every descendant's words:
// a page wrapper "matches" any landmark on the page. Observed live — "the filter bar" resolved to a
// 1440x62 container whose text happened to include the words, rather than the bar itself. A tag/class
// match names the element; a text match merely says the words appear somewhere inside it.
const HINT_WEIGHT = 10;

// An element whose text is far longer than a landmark phrase is a region containing the thing, not the
// thing. Only used to discard text-only matches — a real class match stands regardless of size.
const TEXT_ONLY_MAX_CHARS = 240;

function matchScore(box: ElementBox, tokens: string[]): number {
  const hint = box.selectorHint.toLowerCase().replace(/[^a-z0-9]/g, "");
  const text = box.text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hintHits = tokens.filter((token) => hint.includes(token)).length;
  const textHits = tokens.filter((token) => text.includes(token)).length;
  if (hintHits === 0 && box.text.length > TEXT_ONLY_MAX_CHARS) return 0;
  return hintHits * HINT_WEIGHT + textHits;
}

function visible(box: ElementBox): boolean {
  return box.width > 0 && box.height > 0;
}

/**
 * The subject is the *smallest* element carrying its words — the label itself, not the section wrapping
 * it. The landmark is the *largest* match, because a landmark like "the filter bar" names a container
 * and the user means the whole bar, not the first word inside it.
 */
function findSubject(boxes: ElementBox[], tokens: string[]): ElementBox | undefined {
  const candidates = boxes.filter((box) => visible(box) && matchScore(box, tokens) > 0);
  if (!candidates.length) return undefined;
  const bestScore = Math.max(...candidates.map((box) => matchScore(box, tokens)));
  return candidates
    .filter((box) => matchScore(box, tokens) === bestScore)
    .sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

function findLandmark(boxes: ElementBox[], tokens: string[], exclude?: ElementBox): ElementBox | undefined {
  const candidates = boxes.filter((box) => visible(box) && box !== exclude && matchScore(box, tokens) > 0);
  if (!candidates.length) return undefined;
  const bestScore = Math.max(...candidates.map((box) => matchScore(box, tokens)));
  return candidates
    .filter((box) => matchScore(box, tokens) === bestScore)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

function contains(outer: ElementBox, inner: ElementBox): boolean {
  return inner.x >= outer.x - 1
    && inner.y >= outer.y - 1
    && inner.x + inner.width <= outer.x + outer.width + 1
    && inner.y + inner.height <= outer.y + outer.height + 1;
}

// Sub-pixel layout rounding shouldn't decide a verdict, but a genuine gap is many pixels.
const EDGE_TOLERANCE_PX = 2;

/** Checks the requirement against real rendered geometry. */
export function evaluatePlacement(requirement: SpatialRequirement, boxes: ElementBox[]): PlacementResult {
  const subject = findSubject(boxes, requirement.subjectTokens);
  const landmark = findLandmark(boxes, requirement.landmarkTokens, subject);
  const subjectName = requirement.subjectTokens.join(" ");
  const landmarkName = requirement.landmarkTokens.join(" ");

  if (!subject) {
    return { verdict: "indeterminate", evidence: `No visible element matching "${subjectName}" was found in the rendered page, so its placement could not be checked.` };
  }
  if (!landmark) {
    return { verdict: "indeterminate", evidence: `No visible element matching "${landmarkName}" was found in the rendered page, so placement could not be checked against it.` };
  }

  const subjectBottom = subject.y + subject.height;
  const subjectRight = subject.x + subject.width;
  const landmarkBottom = landmark.y + landmark.height;
  const landmarkRight = landmark.x + landmark.width;
  const where = `"${subjectName}" renders at x=${Math.round(subject.x)},y=${Math.round(subject.y)} (${Math.round(subject.width)}×${Math.round(subject.height)}) and "${landmarkName}" at x=${Math.round(landmark.x)},y=${Math.round(landmark.y)} (${Math.round(landmark.width)}×${Math.round(landmark.height)})`;

  // Being nested inside the landmark is the failure that looks most like success: the content did move,
  // it is near the right place, and only the geometry reveals it is in the bar rather than above it.
  const nested = contains(landmark, subject);

  switch (requirement.relation) {
    case "above": {
      if (subjectBottom <= landmark.y + EDGE_TOLERANCE_PX) return { verdict: "satisfied", evidence: `"${subjectName}" renders fully above "${landmarkName}". ${where}.` };
      return {
        verdict: "violated",
        evidence: nested
          ? `"${subjectName}" renders INSIDE "${landmarkName}" rather than above it. ${where}.`
          : `"${subjectName}" does not render above "${landmarkName}". ${where}.`,
        correction: nested
          ? `The element is currently nested inside the "${landmarkName}" container, so it renders within it instead of above it. Move it OUT of that container entirely and place it as a preceding sibling, before the container's opening tag.`
          : `The element must render fully above "${landmarkName}" — its bottom edge above that element's top edge. It currently does not. Place it earlier in the document, outside and before "${landmarkName}".`,
      };
    }
    case "below": {
      if (subject.y >= landmarkBottom - EDGE_TOLERANCE_PX) return { verdict: "satisfied", evidence: `"${subjectName}" renders fully below "${landmarkName}". ${where}.` };
      return {
        verdict: "violated",
        evidence: nested ? `"${subjectName}" renders INSIDE "${landmarkName}" rather than below it. ${where}.` : `"${subjectName}" does not render below "${landmarkName}". ${where}.`,
        correction: nested
          ? `The element is nested inside the "${landmarkName}" container. Move it OUT and place it as a following sibling, after the container's closing tag.`
          : `The element must render fully below "${landmarkName}" — its top edge under that element's bottom edge. Place it later in the document, outside and after "${landmarkName}".`,
      };
    }
    case "left-of": {
      if (subjectRight <= landmark.x + EDGE_TOLERANCE_PX) return { verdict: "satisfied", evidence: `"${subjectName}" renders to the left of "${landmarkName}". ${where}.` };
      return { verdict: "violated", evidence: `"${subjectName}" does not render to the left of "${landmarkName}". ${where}.`, correction: `The element must render entirely left of "${landmarkName}". Reorder them within their shared row.` };
    }
    case "right-of": {
      if (subject.x >= landmarkRight - EDGE_TOLERANCE_PX) return { verdict: "satisfied", evidence: `"${subjectName}" renders to the right of "${landmarkName}". ${where}.` };
      return { verdict: "violated", evidence: `"${subjectName}" does not render to the right of "${landmarkName}". ${where}.`, correction: `The element must render entirely right of "${landmarkName}". Reorder them within their shared row.` };
    }
    case "inside": {
      if (nested) return { verdict: "satisfied", evidence: `"${subjectName}" renders inside "${landmarkName}". ${where}.` };
      return { verdict: "violated", evidence: `"${subjectName}" renders outside "${landmarkName}". ${where}.`, correction: `Nest the element within the "${landmarkName}" container.` };
    }
  }
}
