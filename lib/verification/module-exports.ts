/**
 * What a module actually exports.
 *
 * A build is written in batches, and each batch is a fresh executor that can see the project's file
 * names but not what is inside them. Observed live: one batch wrote `src/lib/auth.ts`, a later batch
 * wrote an admin route importing `getCurrentUser` and `listOrders` from it, and neither name existed.
 * The application was complete in every other respect and the build failed on two imports.
 *
 * Listing file names was not enough — a later batch needs the *contract*, not the inventory. These
 * names are read straight from the source, so the next batch imports what is really there instead of
 * what it assumes should be.
 */

/** Declarations that introduce an exported binding, capturing its name. */
const DECLARED_EXPORT = /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g;

/** Re-exported or grouped bindings: `export { a, b as c }`. The exported name is what callers import. */
const EXPORT_CLAUSE = /\bexport\s*\{([^}]*)\}/g;

/** `export * from "./x"` — real exports exist but cannot be named from this file alone. */
const STAR_REEXPORT = /\bexport\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*["']([^"']+)["']/g;

export type ModuleExports = {
  /** Every name another module can import from this file. */
  names: string[];
  /** True when the file has a default export. */
  hasDefault: boolean;
  /** Modules re-exported wholesale, whose names cannot be resolved from this file alone. */
  reexportsFrom: string[];
};

export function exportedSymbols(source: string): ModuleExports {
  // Comments can contain the word "export"; stripping them avoids inventing names no importer could
  // resolve. Strings are blanked separately, because a re-export's module specifier *is* a string and
  // blanking it before that scan would erase the very thing being read.
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const code = withoutComments
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");

  const names = new Set<string>();

  for (const match of code.matchAll(DECLARED_EXPORT)) names.add(match[1]);

  for (const match of code.matchAll(EXPORT_CLAUSE)) {
    for (const entry of match[1].split(",")) {
      const parts = entry.trim().split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0]).trim().replace(/^type\s+/, "");
      if (exported && exported !== "default" && /^[A-Za-z_$][\w$]*$/.test(exported)) names.add(exported);
    }
  }

  const reexportsFrom = [...withoutComments.matchAll(STAR_REEXPORT)].map((match) => match[1]);
  const hasDefault = /\bexport\s+default\b/.test(code) || /\bexport\s*\{[^}]*\bdefault\b/.test(code);

  return { names: [...names].sort(), hasDefault, reexportsFrom };
}

/**
 * The contract line for one module, as a later batch should read it.
 *
 * A file with no exports is still worth stating: it tells the next batch not to import from it, rather
 * than leaving it to guess that silence means "anything".
 */
export function describeModuleExports(path: string, exports: ModuleExports): string {
  const parts: string[] = [];
  if (exports.names.length) parts.push(exports.names.join(", "));
  if (exports.hasDefault) parts.push("default");
  if (exports.reexportsFrom.length) parts.push(`re-exports everything from ${exports.reexportsFrom.join(", ")}`);
  return `${path} exports: ${parts.join("; ") || "nothing — do not import from it"}`;
}

/** An import a compiler rejected because the target module does not provide the name. */
export type MissingExport = { symbol: string; module: string };

/**
 * Imports the compiler says do not exist, across the phrasings the toolchains use.
 *
 * webpack: `Attempted import error: 'getCurrentUser' is not exported from '@/lib/auth'`
 * tsc:     `error TS2305: Module '"@/lib/auth"' has no exported member 'getCurrentUser'.`
 */
export function missingExports(diagnostic: string): MissingExport[] {
  const found = new Map<string, MissingExport>();

  const webpack = /Attempted import error:\s*'([^']+)'\s*is not exported from\s*'([^']+)'/g;
  for (const match of diagnostic.matchAll(webpack)) {
    found.set(`${match[2]}::${match[1]}`, { symbol: match[1], module: match[2] });
  }

  const typescript = /error\s+TS2305:\s*Module\s+'"?([^'"]+)"?'\s*has no exported member\s*'([^']+)'/g;
  for (const match of diagnostic.matchAll(typescript)) {
    found.set(`${match[1]}::${match[2]}`, { symbol: match[2], module: match[1] });
  }

  return [...found.values()];
}

/**
 * A repair instruction naming both sides of the mismatch.
 *
 * Deliberately does not decide which side is wrong. Either the module should export the name or the
 * importer should use what exists, and only the surrounding code says which — but a compiler error
 * that names both is far more actionable than "the build failed".
 */
export function missingExportInstruction(missing: MissingExport[]): string {
  if (!missing.length) return "";

  const byModule = new Map<string, string[]>();
  for (const entry of missing) byModule.set(entry.module, [...(byModule.get(entry.module) ?? []), entry.symbol]);

  const lines = [...byModule.entries()].map(([module, symbols]) => `- ${module} is imported for ${symbols.join(", ")} but does not export ${symbols.length === 1 ? "it" : "them"}`);
  return [
    "The build fails because imports and modules disagree about what exists:",
    ...lines,
    "For each one, either add the missing export to that module or change the importer to use what the module really exports. Read the module before deciding — do not add a stub that returns nothing.",
  ].join("\n");
}
