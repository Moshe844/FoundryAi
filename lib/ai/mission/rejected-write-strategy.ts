/**
 * Turning a refused write into a different approach.
 *
 * Observed live: a repair proposed a full `package.json` rewrite, a guard refused it for replacing the
 * scaffold's pinned framework version, and the model proposed the same rewrite again. Two refusals, no
 * durable change, and the repair budget was gone — while the actual fix was a single additive
 * devDependency the guard would have accepted.
 *
 * The guard was right and its message said exactly what was wrong. What was missing was the next step:
 * "that was refused" is not a strategy, and repeating a whole-file rewrite against a guard that objects
 * to one line inside it cannot succeed however many times it is tried.
 *
 * So a second refusal stops asking for the same shape of edit and names a smaller one. The escalation is
 * about the *shape* of the change, not the wording of the request — a differently-phrased instruction to
 * do the same rejected thing is the repetition this exists to prevent.
 */

export type RejectedWriteContext = {
  /** The tool that was refused. */
  tool: string;
  /** The path it targeted, or a batch marker. */
  path: string;
  /** The guard's own explanation. */
  reason: string;
  /** How many consecutive times this exact refusal has now happened. */
  occurrence: number;
};

export type RejectedWriteGuidance = {
  /** Appended to the tool result so the next turn sees it. */
  note: string;
  /** True once repeating is provably pointless and the mission should change tack or stop. */
  exhausted: boolean;
};

/**
 * Whether a refusal is about the *content* of a whole-file write.
 *
 * A blank or root path is a malformed call — the fix is a real path, and the existing guidance already
 * says so. A guard that objected to what the file would contain is different: the call was well-formed
 * and the content was wrong, so the answer is a narrower edit rather than a corrected path.
 */
function isContentRefusal(context: RejectedWriteContext): boolean {
  return context.tool === "write_file" || context.tool === "write_files";
}

/** A manifest refusal has a specific, always-available smaller move: add, never replace. */
function isManifestPath(path: string): boolean {
  return /(?:^|[\\/])package\.json$/i.test(path);
}

export function guidanceForRejectedWrite(context: RejectedWriteContext): RejectedWriteGuidance | undefined {
  if (context.occurrence < 2 || !isContentRefusal(context)) return undefined;

  const shared = [
    `This exact write was refused ${context.occurrence} times for the same reason, so proposing it again cannot succeed.`,
    `The refusal was: ${context.reason}`,
  ];

  if (isManifestPath(context.path)) {
    return {
      note: [
        ...shared,
        "Stop rewriting this manifest wholesale. Use replace_in_file to add only the entries you actually need, leaving every existing version string exactly as it is.",
        "If the failure is a missing type declaration, the fix is a devDependency addition, not a version change — and the runtime installs those itself, so do not edit the manifest for it at all.",
      ].join(" "),
      exhausted: context.occurrence >= 3,
    };
  }

  return {
    note: [
      ...shared,
      "Change the shape of the edit, not its wording: use replace_in_file to change only the specific lines the refusal names, and leave the rest of the file untouched.",
      "If you cannot satisfy the refusal with a narrower edit, say so plainly and stop rather than resubmitting the same file.",
    ].join(" "),
    exhausted: context.occurrence >= 3,
  };
}
