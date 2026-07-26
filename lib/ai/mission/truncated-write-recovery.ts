/**
 * Recovering when a write is cut off mid-argument.
 *
 * A tool call whose JSON exceeds the response budget arrives truncated and never parses. The recovery
 * has to tell the model what to do differently — and the right answer depends entirely on whether the
 * file already exists.
 *
 * For an edit to a large existing file, "don't rewrite it, patch the lines that change" is exactly
 * right. For a greenfield batch it is impossible advice: `replace_in_file` needs existing text to match
 * against, and none of these files exist yet. Observed live, twice: a model tried to write a whole
 * application in one call, was told to use `replace_in_file`, could not, and fell back to whatever few
 * small files fit — a project of `types.ts`, `validation.ts` and `ui.ts` with no application in it.
 * Both builds then passed every compiler gate, because a scaffold always does.
 *
 * When the file does not exist the constraint is not the file's size — it is how many files were
 * attempted at once. So the instruction is to write fewer per call and keep going.
 */

/** Files per call that comfortably fits a response budget while still making real progress. */
const FILES_PER_CALL = 3;

export type TruncatedWriteContext = {
  /** The tool whose arguments were cut off. */
  tool: string;
  /** The file being written, when it could be recovered from the truncated arguments. */
  path?: string;
  /** True when this batch is creating a project rather than editing an existing one. */
  creating: boolean;
  /** How many times this has now happened in this run. */
  attempt: number;
};

export function guidanceForTruncatedWrite(context: TruncatedWriteContext): string {
  const opening = `The ${context.tool} arguments could not be parsed because the content was cut off mid-write — what you tried to send does not fit in one response.`;

  if (context.creating) {
    return [
      opening,
      `Do not try to write the whole project in one call. These files do not exist yet, so replace_in_file cannot be used on them.`,
      `Send write_files again with at most ${FILES_PER_CALL} complete files, starting with the ones the rest of the application depends on.`,
      "You will get further turns to write the remainder, so keep each call small and complete rather than fitting everything into this one.",
      context.attempt >= 2
        ? "This has now failed twice: send ONE complete file in the next call, then continue file by file."
        : "",
    ].filter(Boolean).join(" ");
  }

  return [
    opening,
    context.path ? `Do NOT rewrite ${context.path} in full.` : "Do NOT rewrite the whole file.",
    "Use replace_in_file with a small exact old_text match and only the lines that must change. Keep every other line untouched.",
    context.attempt >= 2
      ? "This has now failed twice: make the smallest possible replacement that satisfies the request, one region at a time."
      : "",
  ].filter(Boolean).join(" ");
}

/** The tool the model should switch to, for the event record. */
export function forcedToolAfterTruncation(creating: boolean): string {
  return creating ? "write_files (fewer files per call)" : "replace_in_file";
}
