/**
 * Enforces a mission's declared write scope at the moment of the write.
 *
 * When a follow-up is resolved to a bounded set of files, the executor's prompt already says: do not
 * write or delete any other file, and if a dependency makes that necessary, report it rather than
 * widening scope yourself. Nothing enforced it. An instruction the model is free to ignore is not a
 * boundary, which is why an unrequested change could only ever be *reported* after the fact — by then a
 * file the user never mentioned had already been rewritten.
 *
 * Two deliberate limits keep this from producing false refusals:
 *
 * - It only applies when the mission actually declared a bounded scope. An open-ended request or a new
 *   project has no boundary to cross, so nothing is enforced and behavior is unchanged.
 * - Anything the mission created or already changed in this run stays writable. You can always continue
 *   editing your own work, so a multi-pass implementation is never blocked by its own first pass.
 */

export type WriteScope = {
  /** Normalized bounded paths this mission may write. */
  paths: string[];
};

/**
 * A scope, or undefined when the mission is unbounded.
 *
 * Returning undefined rather than an empty scope matters: an empty path list means "no boundary was
 * declared", and treating that as "nothing may be written" would block every unbounded mission.
 */
export function createWriteScope(boundedPaths: string[] | undefined): WriteScope | undefined {
  const paths = (boundedPaths ?? []).map(normalizePath).filter(Boolean);
  return paths.length ? { paths } : undefined;
}

export type WriteScopeVerdict =
  | { allow: true }
  | { allow: false; reason: string };

export function evaluateWrite(input: {
  path: string;
  operation: "write" | "delete";
  scope?: WriteScope;
  /** Paths this mission has already created or changed in this run. */
  touched: Iterable<string>;
}): WriteScopeVerdict {
  if (!input.scope) return { allow: true };

  const target = normalizePath(input.path);
  if (!target) return { allow: true };

  if (input.scope.paths.some((allowed) => pathsMatch(allowed, target))) return { allow: true };

  for (const existing of input.touched) {
    if (pathsMatch(normalizePath(existing), target)) return { allow: true };
  }

  const bounded = input.scope.paths.slice(0, 12).join(", ");
  return {
    allow: false,
    reason: `${target} is outside this request's agreed scope. This mission is bounded to: ${bounded}. Do not ${input.operation} any other existing file. If a change there is genuinely required to finish the request, say so in your reasoning and explain why instead of making it — the user decides whether to widen the scope.`,
  };
}

/**
 * Whether two recorded paths name the same file or a file inside an allowed directory.
 *
 * Stages disagree about path form — one records an absolute path, another a project-relative one — so a
 * plain string comparison would let a bounded scope be crossed by accident of formatting. A trailing
 * directory match is honoured so a scope naming a folder covers the files in it.
 */
function pathsMatch(allowed: string, target: string): boolean {
  if (!allowed || !target) return false;
  if (allowed === target) return true;
  if (allowed.endsWith(`/${target}`) || target.endsWith(`/${allowed}`)) return true;
  return target.startsWith(`${allowed}/`) || allowed.startsWith(`${target}/`);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").trim();
}
