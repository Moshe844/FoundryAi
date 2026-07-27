/**
 * Turning "that batch had no screen in it" into something the model can actually act on.
 *
 * The guard is right to refuse a first product batch made of types, utilities and tests: a UI
 * application led by its supporting files is how a mission ends with a scaffold and no product. But
 * observed live on a customer-ordering build, the refusal read:
 *
 *   "The first coordinated product batch contains no real user-facing screen or workflow. Tests,
 *    manifests, JSON, and isolated utilities cannot lead a UI application build."
 *
 * True, and unusable. It never said which file the screen belongs in, and the project already had one
 * — `src/app/page.tsx`, written by the scaffold. The model proposed a batch, was refused, proposed
 * another, was refused again, and the run was over: two refusals hard-stopped the batch. Ten minutes
 * and $1.59 later the app was still the scaffold's three-line placeholder, and the browser-repair
 * stage spent the rest of the budget adding CSS to a page with no features.
 *
 * Nothing there was a generation problem. The model was never told what would be accepted.
 *
 * So a refusal names the entry route it wants filled, and a second refusal changes the *shape* of what
 * it asks for rather than repeating itself louder: write the one screen, alone, completely. A batch
 * that keeps being refused for its composition can always be narrowed to the single file the guard is
 * asking for, and that is a move the model can make.
 */

/**
 * Where a runnable user-facing entry lives, per stack convention.
 *
 * Deliberately the same conventions the runnable-entry check uses, so the guard cannot ask for a file
 * in a place the rest of the system would not recognise as the entry.
 */
export const PRODUCT_ENTRY_PATTERNS: RegExp[] = [
  /^(?:src\/)?app\/page\.[cm]?[jt]sx?$/i,
  /^(?:src\/)?pages\/index\.[cm]?[jt]sx?$/i,
  /^(?:src\/)?(?:main|index|app)\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i,
  /^index\.html?$/i,
];

/**
 * The entry route this project already has, if any.
 *
 * Preferring a file that exists over a name invented for the instruction: the scaffold's own entry is
 * the file the build already renders, so filling it is what makes the product appear.
 */
export function productEntryPath(paths: string[]): string | undefined {
  const normalized = paths.map((path) => path.replace(/\\/g, "/").replace(/^\.\//, ""));
  for (const pattern of PRODUCT_ENTRY_PATTERNS) {
    const match = normalized.find((path) => pattern.test(path));
    if (match) return match;
  }
  return undefined;
}

/**
 * What to tell the model when its product batch had no screen in it.
 *
 * The first refusal names the target. The second stops asking for a batch at all — repeating a
 * composition requirement against a model that has already failed it twice cannot succeed, and the
 * single-file version of the same request always can.
 */
export function productSliceInstruction(input: { entryPath?: string; occurrence: number }): string {
  const entry = input.entryPath ?? "the application's entry route (for example src/app/page.tsx)";

  if (input.occurrence >= 2) {
    return [
      `This batch was refused ${input.occurrence} times for the same reason, so sending another batch of supporting files cannot succeed.`,
      `Change approach: write ${entry} by itself in this turn, using write_file.`,
      "It must be the real screen a person sees and uses — the actual layout, controls and interactions the request describes — not a heading, a summary of what is coming, or a link list.",
      "Inline whatever state or sample data it needs so it works on its own. Supporting modules, extraction and tests come in the next turn, once this screen exists.",
    ].join(" ");
  }

  return [
    "The first coordinated product batch contains no real user-facing screen, so it was rejected before touching disk.",
    `Include ${entry} in the batch, containing the actual screen a person sees and uses — the layout, controls and interactions the request asks for.`,
    "Supporting state, persistence or integration boundaries, and tests belong in the same batch, but the screen has to lead it.",
    "Tests, manifests, JSON and isolated utilities cannot lead a UI application build.",
  ].join(" ");
}
