/**
 * Catches stylesheet rules written against selectors that exist nowhere in the project.
 *
 * Observed defect: a mission asked to move an element appended
 *   .page-shell { display: flex; flex-direction: column; }
 *   .total-spend, [data-total-spend] { order: 1; }
 * to a project whose markup contains none of those names — the retry pass guessed at class names
 * instead of reading the markup. The rules were inert, so every compile and build stayed green and the
 * dead code shipped into the user's project unnoticed.
 *
 * This is intentionally a *finding*, not a hard rejection. Class names can legitimately be produced at
 * runtime (template strings, CSS modules, `clsx`, framework-generated attributes), so a selector that
 * looks unused is strong evidence of a mistake but not proof of one. Surfacing it as a validation
 * problem puts it in front of the mission's own verification instead of silently discarding model output.
 */

const DECLARATION_BLOCK = /(^|\})([^{}]+)\{/g;
const CLASS_TOKEN = /\.(-?[_a-zA-Z][\w-]*)/g;
const ATTRIBUTE_TOKEN = /\[([\w-]+)(?:[~|^$*]?=\s*["']?[^\]"']*["']?)?\]/g;

// Selectors that never correspond to authored markup names.
const IGNORED_ATTRIBUTES = new Set(["class", "id", "style", "type", "href", "src", "disabled", "checked", "hidden", "open", "selected", "readonly", "required", "lang", "dir", "role"]);

function selectorNamesIn(css: string): { classes: Set<string>; attributes: Set<string> } {
  const classes = new Set<string>();
  const attributes = new Set<string>();
  // Strip comments and at-rule preludes so `@media (min-width: 40rem)` contributes no tokens.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(DECLARATION_BLOCK)) {
    const prelude = match[2] ?? "";
    if (prelude.trim().startsWith("@")) continue;
    for (const cls of prelude.matchAll(CLASS_TOKEN)) classes.add(cls[1]);
    for (const attr of prelude.matchAll(ATTRIBUTE_TOKEN)) {
      const name = attr[1];
      if (!IGNORED_ATTRIBUTES.has(name.toLowerCase())) attributes.add(name);
    }
  }
  return { classes, attributes };
}

/**
 * Returns the class and attribute selectors in `css` that appear nowhere in `markup`.
 *
 * `markup` should be the concatenated source of the project's component/template files. A selector is
 * considered present on a plain substring match, which deliberately over-accepts: `class="card-title"`,
 * `` className={`card ${x}`} ``, and `data-testid` attributes all count as usage.
 */
export function unmatchedStylesheetSelectors(css: string, markup: string): string[] {
  if (!css.trim() || !markup.trim()) return [];
  const { classes, attributes } = selectorNamesIn(css);
  const unmatched: string[] = [];
  for (const name of classes) {
    if (!markup.includes(name)) unmatched.push(`.${name}`);
  }
  for (const name of attributes) {
    if (!markup.includes(name)) unmatched.push(`[${name}]`);
  }
  return unmatched.sort();
}

/** One reviewer-readable finding, or undefined when every selector is accounted for. */
export function stylesheetSelectorProblem(filePath: string, css: string, markup: string): string | undefined {
  const unmatched = unmatchedStylesheetSelectors(css, markup);
  if (!unmatched.length) return undefined;
  const shown = unmatched.slice(0, 8).join(", ");
  const rest = unmatched.length > 8 ? ` (and ${unmatched.length - 8} more)` : "";
  return `${filePath}: ${unmatched.length} selector${unmatched.length === 1 ? "" : "s"} match no markup in this project: ${shown}${rest}. Style the classes the project actually uses, or add the markup these rules target — inert CSS is dead code.`;
}
