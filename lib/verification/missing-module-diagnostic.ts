/**
 * Reading "this module does not exist" out of a compiler's own wording.
 *
 * Every toolchain says it differently, and the differences cost a real mission. A generated project
 * imported `@/lib/db` and never wrote it. The bundler's phrasing — "Can't resolve" — was recognised, so
 * the final build produced a usable instruction. TypeScript's phrasing — "Cannot find module" — was not,
 * so every typecheck repair before that ran without knowing a file was missing, and the model was left
 * to guess at an error whose answer was "create this file".
 *
 * Matching all three phrasings is the whole fix. The set is small and closed: a compiler either has a
 * name it cannot resolve or it does not.
 */

export type MissingModuleImport = {
  /** The file doing the importing, when the diagnostic names it. */
  importer?: string;
  /** The specifier that could not be resolved. */
  specifier: string;
};

/** esbuild and Vite: `Could not resolve "./x" from "src/y.ts"`. Names both sides. */
const RESOLVE_WITH_IMPORTER = /Could not resolve\s+["']([^"']+)["']\s+from\s+["']([^"']+)["']/gi;

/** webpack and Next: `Module not found: Can't resolve '@/lib/db'`. Names only the specifier. */
const RESOLVE_WITHOUT_IMPORTER = /(?:Module not found:\s*)?(?:Can't|Cannot)\s+resolve\s+["']([^"']+)["']/gi;

/**
 * TypeScript: `src/app/route.ts(2,20): error TS2307: Cannot find module '@/lib/db' or its corresponding
 * type declarations.` The importer is the path prefix on the same line, which is why this is matched per
 * line rather than across the whole output.
 */
const TS_CANNOT_FIND_MODULE = /^\s*(\S+?)\((\d+),\s*\d+\):\s*error\s+TS2307:\s*Cannot find module\s+["']([^"']+)["']/i;

/**
 * Every unresolved import the diagnostic reports, in the order encountered.
 *
 * Deduplicated by specifier: one missing file usually produces the same complaint from several importers,
 * and creating it once resolves all of them.
 */
export function missingModuleImports(diagnostic: string): MissingModuleImport[] {
  const found = new Map<string, MissingModuleImport>();

  for (const line of diagnostic.split(/\r?\n/)) {
    const typescript = TS_CANNOT_FIND_MODULE.exec(line);
    if (typescript) {
      const specifier = typescript[3];
      if (!found.has(specifier)) found.set(specifier, { importer: typescript[1].replace(/\\/g, "/"), specifier });
    }
  }

  for (const match of diagnostic.matchAll(RESOLVE_WITH_IMPORTER)) {
    const specifier = match[1];
    // A phrasing that names the importer is strictly more useful than one that does not, so it wins.
    found.set(specifier, { importer: match[2].replace(/\\/g, "/"), specifier });
  }

  for (const match of diagnostic.matchAll(RESOLVE_WITHOUT_IMPORTER)) {
    const specifier = match[1];
    if (!found.has(specifier)) found.set(specifier, { specifier });
  }

  return [...found.values()];
}

/**
 * Where a specifier should live in the project, or nothing when it is not the project's own file.
 *
 * A bare package name is a dependency question, not a missing-file question, and answering it by
 * creating `node_modules/...` would be nonsense — those are filtered out.
 *
 * Alias resolution reads the project's own tsconfig `paths` rather than assuming `@/` means `src/`.
 * A project that maps `@/*` to its root would otherwise have files created one directory too deep,
 * which leaves the original import just as unresolved.
 */
export function resolveProjectModulePath(input: {
  specifier: string;
  /** The importing file, relative to the project root. Needed for a relative specifier. */
  importer?: string;
  /** Raw tsconfig.json contents, when available. */
  tsconfig?: string;
}): string | undefined {
  const { specifier } = input;

  if (specifier.startsWith(".")) {
    if (!input.importer) return undefined;
    const importerDirectory = input.importer.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    return normalizeProjectPath(`${importerDirectory}/${specifier}`);
  }

  const aliasRoot = aliasTargetFor(specifier, input.tsconfig);
  return aliasRoot ? normalizeProjectPath(aliasRoot) : undefined;
}

/**
 * The directory an aliased specifier maps to, from tsconfig `paths`.
 *
 * Falls back to the near-universal `@/*` → `src/*` convention only when the config cannot be read, since
 * guessing is still better than ignoring an alias entirely — but the config is believed when present.
 */
function aliasTargetFor(specifier: string, tsconfig?: string): string | undefined {
  const paths = tsconfigPaths(tsconfig);

  for (const [pattern, targets] of Object.entries(paths)) {
    if (!pattern.endsWith("/*") || !targets.length) continue;
    const prefix = pattern.slice(0, -1);
    if (!specifier.startsWith(prefix)) continue;
    const target = targets[0].replace(/^\.\//, "");
    // A root mapping's target is a bare "*", not "dir/*", so match on the wildcard itself.
    if (!target.endsWith("*")) continue;
    return `${target.slice(0, -1)}${specifier.slice(prefix.length)}`;
  }

  if (Object.keys(paths).length) return undefined;
  return specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : undefined;
}

function tsconfigPaths(tsconfig?: string): Record<string, string[]> {
  if (!tsconfig) return {};
  try {
    // tsconfig permits comments and trailing commas, which JSON.parse does not.
    const stripped = tsconfig
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(stripped) as { compilerOptions?: { paths?: Record<string, string[]> } };
    return parsed.compilerOptions?.paths ?? {};
  } catch {
    return {};
  }
}

/** Collapses `.` and `..` segments without touching the filesystem, and rejects escapes from the root. */
function normalizeProjectPath(candidate: string): string | undefined {
  const segments: string[] = [];
  for (const segment of candidate.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length ? segments.join("/") : undefined;
}
