/**
 * Compiler failures that a package manager can fix without a model call.
 *
 * Observed live: a generated project failed typecheck with "Could not find a declaration file for module
 * 'jsonwebtoken'". The fix is one devDependency. Instead, a model was paid to rewrite package.json, it
 * changed the scaffold's pinned framework version doing so, a guard correctly rejected the write, the
 * model repeated the same rewrite, and the repair budget was exhausted arguing about it — while the
 * actual one-line fix was never applied.
 *
 * Two things make this the wrong job for a model. It is entirely mechanical: the diagnostic names the
 * module, and the types package name follows from it. And the model cannot know the correct version to
 * pin, so it guesses — which is what put it in conflict with the scaffold guard. The package manager
 * knows the version; asking it is both cheaper and more correct.
 */

/** TypeScript's code for "this module has no type declarations". */
const MISSING_DECLARATION = /error\s+TS7016\b[^\n]*?module\s+'([^']+)'/gi;

/**
 * Module names in a diagnostic that need a types package.
 *
 * Relative imports are excluded: a missing declaration for `./lib/db` is a missing *file* in the
 * project, not a package that can be installed, and installing something for it would be nonsense.
 */
export function modulesMissingTypeDeclarations(diagnostic: string): string[] {
  const modules = new Set<string>();
  for (const match of diagnostic.matchAll(MISSING_DECLARATION)) {
    const moduleName = match[1].trim();
    if (!moduleName || moduleName.startsWith(".") || moduleName.startsWith("/") || moduleName.startsWith("@/")) continue;
    modules.add(moduleName);
  }
  return [...modules];
}

/**
 * The DefinitelyTyped package for a module.
 *
 * A scoped module's types live under a flattened name — `@aws-sdk/client-s3` becomes
 * `@types/aws-sdk__client-s3` — which is the one part of this that is not obvious.
 */
export function typesPackageFor(moduleName: string): string {
  if (moduleName.startsWith("@types/")) return moduleName;
  if (moduleName.startsWith("@")) {
    const [scope, name] = moduleName.slice(1).split("/");
    return name ? `@types/${scope}__${name}` : `@types/${scope}`;
  }
  // Only the package root has types; a deep import resolves to its package's declarations.
  return `@types/${moduleName.split("/")[0]}`;
}

export type DependencyRepairPlan = {
  /** Types packages to install, already excluding anything the manifest lists. */
  packages: string[];
  /** The exact command to run. */
  command: string;
  reason: string;
};

/**
 * Plans the install, or returns nothing when there is nothing mechanical to do.
 *
 * The install is additive by construction — `--save-dev` with explicit package names touches no existing
 * entry — so it cannot trip the guard that protects the scaffold's pinned versions, which is precisely
 * what the model kept doing.
 */
export function planDependencyRepair(input: {
  diagnostic: string;
  /** The project's package.json, when it could be read. */
  manifest?: string;
  packageManager?: "npm" | "pnpm" | "yarn" | "bun";
}): DependencyRepairPlan | undefined {
  const modules = modulesMissingTypeDeclarations(input.diagnostic);
  if (!modules.length) return undefined;

  const declared = declaredPackages(input.manifest);
  const packages = [...new Set(modules.map(typesPackageFor))].filter((name) => !declared.has(name));
  if (!packages.length) return undefined;

  const manager = input.packageManager ?? "npm";
  const command = manager === "npm"
    ? `npm install --save-dev ${packages.join(" ")}`
    : manager === "yarn"
      ? `yarn add --dev ${packages.join(" ")}`
      : `${manager} add -D ${packages.join(" ")}`;

  return {
    packages,
    command,
    reason: `${modules.join(", ")} ${modules.length === 1 ? "has" : "have"} no bundled type declarations. Installing ${packages.join(", ")} resolves this without touching the scaffold's pinned versions.`,
  };
}

function declaredPackages(manifest?: string): Set<string> {
  if (!manifest) return new Set();
  try {
    const parsed = JSON.parse(manifest) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return new Set([...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]);
  } catch {
    // An unreadable manifest is not a reason to skip the repair — the install itself is idempotent.
    return new Set();
  }
}
