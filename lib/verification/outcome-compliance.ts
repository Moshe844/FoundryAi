/**
 * Checks that the change the user asked for actually happened.
 *
 * Foundry verifies *health* thoroughly and *compliance* not at all. File read-back proves a file was
 * written, typecheck and build prove the code is valid, and the preview proves the page renders — all
 * four pass on a change that does nothing. Observed live: asked to move a number above the filter bar,
 * a mission deleted one comment line, then reported "Done — Verified by: file-read, typecheck, build,
 * preview." A false success is worse than a false failure, because nothing downstream questions it.
 *
 * This derives a deterministic assertion about the requested outcome and checks it against the real
 * diff. No model call, no network, no per-stack knowledge — it reads the request's grammar and the
 * before/after source.
 *
 * The governing rule lives in `complianceVerdict`: when no assertion can be derived, the outcome is
 * "underivable", which must downgrade a completion claim to unverified. It must never read as proof.
 */

export type FileChange = {
  path: string;
  before?: string;
  after: string;
};

export type OutcomeAssertion = {
  kind: "relocation" | "addition" | "removal" | "replacement";
  /** What must be true for the request to have been carried out, in the user's terms. */
  requirement: string;
  verdict: "satisfied" | "violated" | "indeterminate";
  evidence: string;
};

const REPOSITION_VERB = /\b(?:move|reposition|reorder|relocate|place|put|shift|drag)\b/i;
const POSITIONAL_PREPOSITION =
  /\b(?:above|below|under|underneath|beneath|over|on top of|next to|beside|alongside|to the left of|to the right of|in front of|before|after|inside|within|at the top of|at the bottom of)\b/i;
const REMOVAL_VERB = /\b(?:remove|delete|drop|get rid of|take out|hide)\b/i;
const ADDITION_VERB = /\b(?:add|create|insert|introduce|include)\b/i;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "so", "it", "its", "that", "this", "then", "there", "here", "shows",
  "show", "showing", "displays", "display", "please", "can", "could", "you", "would", "should", "make",
  "makes", "into", "from", "with", "for", "to", "of", "in", "on", "at", "is", "are", "be", "my", "our",
  "their", "his", "her", "them", "up", "down", "just", "also", "now", "when", "where", "what",
]);

/** Content that carries no product meaning — a diff made only of these changed nothing real. */
function isTrivialLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^\{?\s*\/\*[\s\S]*\*\/\s*\}?$/.test(trimmed)) return true; // {/* comment */} or /* comment */
  if (/^\/\//.test(trimmed)) return true;
  if (/^\{?\s*$/.test(trimmed)) return true;
  if (/^[)}\]>;,]+$/.test(trimmed)) return true;
  return false;
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function meaningfulLines(text: string): string[] {
  return text.split("\n").filter((line) => !isTrivialLine(line)).map(normalizeLine);
}

/** Lines removed and added, as multisets, ignoring pure reordering noise. */
function lineDelta(before: string, after: string): { removed: string[]; added: string[] } {
  const beforeCounts = new Map<string, number>();
  for (const line of meaningfulLines(before)) beforeCounts.set(line, (beforeCounts.get(line) ?? 0) + 1);
  const afterCounts = new Map<string, number>();
  for (const line of meaningfulLines(after)) afterCounts.set(line, (afterCounts.get(line) ?? 0) + 1);

  const removed: string[] = [];
  const added: string[] = [];
  for (const [line, count] of beforeCounts) {
    const surplus = count - (afterCounts.get(line) ?? 0);
    for (let index = 0; index < surplus; index += 1) removed.push(line);
  }
  for (const [line, count] of afterCounts) {
    const surplus = count - (beforeCounts.get(line) ?? 0);
    for (let index = 0; index < surplus; index += 1) added.push(line);
  }
  return { removed, added };
}

/**
 * The thing being acted on, taken from between the verb and the positional preposition:
 * "move **the total spend number** so it shows above the filter bar" -> ["total", "spend", "number"].
 */
function subjectTokens(request: string, verb: RegExp): string[] {
  const verbMatch = verb.exec(request);
  if (!verbMatch) return [];
  const afterVerb = request.slice(verbMatch.index + verbMatch[0].length);
  const boundary = POSITIONAL_PREPOSITION.exec(afterVerb);
  const subject = boundary ? afterVerb.slice(0, boundary.index) : afterVerb;
  return subject
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

/** Case- and separator-insensitive: "total spend" matches `totalSpend`, `total-spend`, `Total:`. */
function mentionsToken(haystack: string, token: string): boolean {
  return haystack.toLowerCase().replace(/[^a-z0-9]/g, "").includes(token);
}

/** Positions of the meaningful lines that mention the subject, indexed among meaningful lines only. */
function subjectPositions(text: string, tokens: string[]): number[] {
  const positions: number[] = [];
  meaningfulLines(text).forEach((line, index) => {
    if (tokens.some((token) => mentionsToken(line, token))) positions.push(index);
  });
  return positions;
}

// A correctly performed move keeps its lines byte-identical and only changes where they sit, so a
// content diff sees nothing at all. Position is the signal. Anything smaller than this is ordinary
// drift from edits elsewhere in the file — deleting one comment above the block shifts it by one.
const MOVED_LINE_THRESHOLD = 3;

/**
 * Scope note: this confirms that the subject *moved*, not that it landed in the exact requested spot.
 * Proving "above the filter bar" from source alone is unreliable — "filter" matches `filter-bar`,
 * `filter-inner` and `filter-summary` alike — so precise placement belongs to the rendered DOM, where
 * it is unambiguous. What this does catch with certainty are the two failures actually observed: the
 * subject deleted and never re-added, and nothing meaningful happening at all.
 */
function relocationAssertion(request: string, changes: FileChange[]): OutcomeAssertion | undefined {
  if (!REPOSITION_VERB.test(request) || !POSITIONAL_PREPOSITION.test(request)) return undefined;
  const tokens = subjectTokens(request, REPOSITION_VERB);
  if (!tokens.length) return undefined;
  const requirement = `The content matching "${tokens.join(" ")}" must still exist and must sit in a different position than before.`;

  let existedBefore = false;
  let droppedSubjectLines = 0;
  let addedSubjectLines = 0;
  let largestShift = 0;
  let unmeasurable = false;
  for (const change of changes) {
    if (change.before === undefined) continue;
    const beforePositions = subjectPositions(change.before, tokens);
    const afterPositions = subjectPositions(change.after, tokens);
    if (beforePositions.length) existedBefore = true;

    // Deletion first. A subject keyword is rarely unique — "total" also matches `monthlyTotals` and
    // `categoryTotals` — so simply asking "does the subject still appear?" cannot see a deleted block.
    // The content diff can: lines that left and were never re-added are destroyed, not moved.
    const { removed, added } = lineDelta(change.before, change.after);
    droppedSubjectLines += removed.filter((line) => tokens.some((token) => mentionsToken(line, token))).length;
    addedSubjectLines += added.filter((line) => tokens.some((token) => mentionsToken(line, token))).length;

    // Position second. Pairing k-th occurrence to k-th occurrence is only sound when the counts match —
    // a clean move keeps every line byte-identical. When they differ, the subject was rewritten as well
    // as moved, and pairing would compare unrelated lines.
    if (beforePositions.length === afterPositions.length) {
      for (let index = 0; index < beforePositions.length; index += 1) {
        largestShift = Math.max(largestShift, Math.abs(afterPositions[index] - beforePositions[index]));
      }
    } else {
      // Rewritten *and* relocated: compare where the subject's lines left from against where they
      // arrived. Skipping this measurement entirely is what produced a confident "shifted 0 lines" for a
      // move that had plainly happened — a claim about a distance that was never measured.
      const beforeLines = meaningfulLines(change.before);
      const afterLines = meaningfulLines(change.after);
      const removedIndexes = beforeLines
        .map((line, index) => ({ line, index }))
        .filter((entry) => removed.includes(entry.line) && tokens.some((token) => mentionsToken(entry.line, token)))
        .map((entry) => entry.index);
      const addedIndexes = afterLines
        .map((line, index) => ({ line, index }))
        .filter((entry) => added.includes(entry.line) && tokens.some((token) => mentionsToken(entry.line, token)))
        .map((entry) => entry.index);
      for (const from of removedIndexes) {
        for (const to of addedIndexes) largestShift = Math.max(largestShift, Math.abs(to - from));
      }
      if (!removedIndexes.length || !addedIndexes.length) unmeasurable = true;
    }
  }

  if (!existedBefore) {
    return { kind: "relocation", requirement, verdict: "indeterminate", evidence: "The named subject was not found in the edited files before the change, so the move could not be checked here." };
  }
  if (droppedSubjectLines > 0 && addedSubjectLines === 0) {
    return {
      kind: "relocation",
      requirement,
      verdict: "violated",
      evidence: `${droppedSubjectLines} line(s) of the content to be moved were removed and never re-inserted. A move that deletes without re-adding silently destroys working UI.`,
    };
  }
  if (largestShift >= MOVED_LINE_THRESHOLD) {
    return { kind: "relocation", requirement, verdict: "satisfied", evidence: `The requested content still exists and moved ${largestShift} line(s) from its original position.` };
  }
  if (unmeasurable) {
    return {
      kind: "relocation",
      requirement,
      verdict: "indeterminate",
      evidence: "The subject was rewritten rather than moved intact, so its change in position could not be measured from the source. Placement is checked against the rendered page instead.",
    };
  }
  return {
    kind: "relocation",
    requirement,
    verdict: "violated",
    evidence: `The requested content is still in its original position (shifted ${largestShift} line(s), which is ordinary drift rather than a move). The requested change did not happen.`,
  };
}

function removalAssertion(request: string, changes: FileChange[]): OutcomeAssertion | undefined {
  if (!REMOVAL_VERB.test(request) || REPOSITION_VERB.test(request)) return undefined;
  const tokens = subjectTokens(request, REMOVAL_VERB);
  if (!tokens.length) return undefined;
  const requirement = `Content matching "${tokens.join(" ")}" must no longer be present.`;
  // Anchor on the words that actually occur in the source, not the whole noun phrase. A user names a
  // thing in their own words — "the deprecated retry decorator" — and only some of those words exist as
  // identifiers; "decorator" describes the construct rather than appearing in it. Demanding every token
  // made real removals unprovable, which reads as "no check available" and waves the mission through.
  const anchored = tokens.filter((token) => changes.some((change) => change.before !== undefined && mentionsToken(change.before, token)));
  if (!anchored.length) {
    return { kind: "removal", requirement, verdict: "indeterminate", evidence: "None of the words naming the subject appear in the edited files before the change, so removal could not be confirmed here." };
  }
  const stillPresent = anchored.filter((token) => changes.some((change) => mentionsToken(change.after, token)));
  return stillPresent.length
    ? { kind: "removal", requirement, verdict: "violated", evidence: `The subject is still present in the edited source (found ${stillPresent.map((token) => `"${token}"`).join(", ")} after the change).` }
    : { kind: "removal", requirement, verdict: "satisfied", evidence: `The subject is no longer present in the edited source (${anchored.map((token) => `"${token}"`).join(", ")} were removed).` };
}

function additionAssertion(request: string, changes: FileChange[]): OutcomeAssertion | undefined {
  if (!ADDITION_VERB.test(request) || REPOSITION_VERB.test(request)) return undefined;
  const tokens = subjectTokens(request, ADDITION_VERB);
  if (!tokens.length) return undefined;
  const requirement = `New content matching "${tokens.join(" ")}" must appear in the source.`;
  let addedMatching = 0;
  for (const change of changes) {
    const { added } = change.before === undefined
      ? { added: meaningfulLines(change.after) }
      : lineDelta(change.before, change.after);
    addedMatching += added.filter((line) => tokens.some((token) => mentionsToken(line, token))).length;
  }
  if (addedMatching > 0) {
    return { kind: "addition", requirement, verdict: "satisfied", evidence: `${addedMatching} added line(s) reference the requested subject.` };
  }
  // What the user asked for is that the thing exist, not that this particular diff created it. With no
  // diff at all — the "request already satisfied" claim — presence is the only meaningful evidence, and
  // demanding an insertion would reject a claim that happens to be true.
  const presentTokens = tokens.filter((token) => changes.some((change) => mentionsToken(change.after, token)));
  if (presentTokens.length === tokens.length) {
    return { kind: "addition", requirement, verdict: "satisfied", evidence: `The requested subject is already present in the source (${presentTokens.map((token) => `"${token}"`).join(", ")}).` };
  }
  const missing = tokens.filter((token) => !presentTokens.includes(token));
  return { kind: "addition", requirement, verdict: "violated", evidence: `The requested subject is not present in the source — no added line references it and ${missing.map((token) => `"${token}"`).join(", ")} ${missing.length === 1 ? "does" : "do"} not appear.` };
}

/** Deterministic assertions about the requested outcome, derived from the request and the real diff. */
export function deriveOutcomeAssertions(request: string, changes: FileChange[]): OutcomeAssertion[] {
  if (!request.trim() || !changes.length) return [];
  return [
    relocationAssertion(request, changes),
    removalAssertion(request, changes),
    additionAssertion(request, changes),
  ].filter((assertion): assertion is OutcomeAssertion => Boolean(assertion));
}

/**
 * Turns a violated assertion into a correction the model can act on.
 *
 * Detection alone does not help the user — being told precisely why their request was not carried out
 * is still a request that was not carried out. Each failure mode observed live has a different remedy,
 * and naming the *specific* one matters: the generic instruction ("move it") is what produced the
 * delete, the no-op and the duplicate in the first place.
 */
export function correctionInstruction(assertion: OutcomeAssertion): string {
  if (assertion.verdict !== "violated") return "";
  if (assertion.kind === "relocation") {
    if (/removed and never re-inserted/.test(assertion.evidence)) {
      return "You deleted the content instead of moving it. Re-insert the exact block you removed at the requested position, character for character, so nothing is lost.";
    }
    return "The content is still sitting at its original position. A move is two edits in one turn: delete the block where it currently is, AND insert it at the requested position. Do not leave the original in place, and do not add a second copy — after your edit the content must appear exactly once, at the new position.";
  }
  if (assertion.kind === "removal") return "The content you were asked to remove is still present. Delete it from the source.";
  if (assertion.kind === "addition") return "The content you were asked to add is not present in the source. Add it.";
  return "";
}

/**
 * True when a rewrite of an existing, substantive file discarded most of its implementation.
 *
 * Observed live: an autonomous repair chasing a typecheck failure rewrote every screen of a working
 * water-tracker as 17–33 line stubs — typecheck then passed because the product was gone. A gate fix
 * that deletes the implementation is not a repair; it is data loss that happens to compile. The caller
 * reverts such files to their before-content and reports the repair as failed instead.
 *
 * Thresholds: only files that were substantive (>40 meaningful lines) count, and only when more than
 * half of that substance vanished — a legitimate refactor that moves code elsewhere in the same batch
 * still nets out fine because the moved-to files are new, not shrunken.
 */
export function isDestructiveRewrite(before: string, after: string): boolean {
  const beforeLines = meaningfulLines(before).length;
  if (beforeLines <= 40) return false;
  const afterLines = meaningfulLines(after).length;
  if (afterLines >= beforeLines * 0.5) return false;
  // "Destructive" means the real implementation was replaced with a STUB — the defect this guards against
  // gutted every screen to near-empty bodies so a compile-only gate would pass. Judge that in absolute
  // terms, not merely "less than half": a compacting rewrite that still yields a real, sizable file is a
  // legitimate repair. Reverting one restores the broken original and loops forever — exactly what turned a
  // marketing site's frontmatter-stripping fix into an infinite repair cycle. A genuine stub is small on
  // its own (few meaningful lines and little text), whatever the original size was.
  return afterLines < 40 && after.trim().length < 1_500;
}

export type ComplianceVerdict = {
  status: "satisfied" | "violated" | "underivable";
  assertions: OutcomeAssertion[];
  summary: string;
};

/**
 * Folds assertions into one verdict.
 *
 * `underivable` is the honest answer when the request's outcome cannot be expressed as a source-level
 * check — it means "not proven", and callers must render it as unverified rather than as success. That
 * inversion is the whole point: treating "no check available" as a pass is what let a mission delete a
 * comment and report Done.
 */
export function complianceVerdict(assertions: OutcomeAssertion[]): ComplianceVerdict {
  const violated = assertions.filter((assertion) => assertion.verdict === "violated");
  if (violated.length) {
    return {
      status: "violated",
      assertions,
      summary: `The requested change was not carried out. ${violated.map((assertion) => assertion.evidence).join(" ")}`,
    };
  }
  const satisfied = assertions.filter((assertion) => assertion.verdict === "satisfied");
  if (satisfied.length) {
    return {
      status: "satisfied",
      assertions,
      summary: `Requested outcome confirmed in the source: ${satisfied.map((assertion) => assertion.evidence).join(" ")}`,
    };
  }
  return {
    status: "underivable",
    assertions,
    summary: "Foundry could not derive a deterministic source-level check for this request, so the requested outcome is not independently proven.",
  };
}
