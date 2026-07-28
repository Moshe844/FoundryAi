type Manifest = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
};

export type ManifestReconciliation = {
  content?: string;
  preservedDependencies: string[];
  preservedScripts: string[];
  issue?: string;
};

/**
 * Reconciles a generated package manifest with Foundry's already-installed scaffold.
 *
 * Foundation drift is deterministic, so throwing away an otherwise complete product batch and
 * paying a model to rediscover the existing versions is the wrong recovery strategy. Existing
 * dependencies and scripts win; genuinely new, explicitly-versioned packages are retained.
 */
export function reconcileGeneratedManifest(proposedText: string, currentText: string, protectDependency: (name: string) => boolean = () => true): ManifestReconciliation {
  try {
    const proposed = JSON.parse(proposedText) as Manifest;
    const current = JSON.parse(currentText) as Manifest;
    const proposedDependencies = { ...(proposed.dependencies ?? {}) };
    const proposedDevDependencies = { ...(proposed.devDependencies ?? {}) };
    const preservedDependencies: string[] = [];

    for (const [name, version] of Object.entries(current.dependencies ?? {})) {
      if (!protectDependency(name)) continue;
      if (proposedDependencies[name] !== version || name in proposedDevDependencies) preservedDependencies.push(name);
      proposedDependencies[name] = version;
      delete proposedDevDependencies[name];
    }
    for (const [name, version] of Object.entries(current.devDependencies ?? {})) {
      if (!protectDependency(name)) continue;
      if (proposedDevDependencies[name] !== version || name in proposedDependencies) preservedDependencies.push(name);
      proposedDevDependencies[name] = version;
      delete proposedDependencies[name];
    }

    const newEntries = {
      ...Object.fromEntries(Object.entries(proposedDependencies).filter(([name]) => !(name in (current.dependencies ?? {})))),
      ...Object.fromEntries(Object.entries(proposedDevDependencies).filter(([name]) => !(name in (current.devDependencies ?? {})))),
    };
    const floating = Object.entries(newEntries).find(([, version]) => /^latest$/i.test(version));
    if (floating) {
      return {
        preservedDependencies,
        preservedScripts: [],
        issue: `${floating[0]} uses the floating "latest" tag. Generated projects must use an explicit compatible version range.`,
      };
    }

    const proposedScripts = { ...(proposed.scripts ?? {}) };
    const preservedScripts = Object.entries(current.scripts ?? {})
      .filter(([name, command]) => proposedScripts[name] !== command)
      .map(([name]) => name);
    proposed.dependencies = proposedDependencies;
    proposed.devDependencies = proposedDevDependencies;
    proposed.scripts = { ...proposedScripts, ...(current.scripts ?? {}) };
    return {
      content: `${JSON.stringify(proposed, null, 2)}\n`,
      preservedDependencies: [...new Set(preservedDependencies)],
      preservedScripts,
    };
  } catch {
    return {
      preservedDependencies: [],
      preservedScripts: [],
      issue: "package.json must be valid JSON and preserve the verified scaffold's compatible dependency versions.",
    };
  }
}

export function isScaffoldFoundationDependency(name: string) {
  return /^(?:next|react|react-dom|react-native|expo|expo-router|typescript|tailwindcss|postcss|autoprefixer|vite|webpack|@vitejs\/|@types\/(?:node|react|react-dom)|@expo\/|@react-native\/)/i.test(name);
}
