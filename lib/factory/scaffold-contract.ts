type PackageManifest = Record<string, unknown>;

export type ManifestContractReconciliation = {
  changed: boolean;
  content: string;
  restored: string[];
};

export type ManifestContractOptions = {
  authoritativeFoundation?: boolean;
};

/** Restore only missing stack-owned manifest fields. Existing project choices always win, so this
 * can repair a partially overwritten generated scaffold without hard-coding one project or
 * replacing custom scripts, dependency versions, or metadata. */
export function reconcilePackageManifestContract(currentText: string, contractText: string, options: ManifestContractOptions = {}): ManifestContractReconciliation {
  let current: PackageManifest;
  let contract: PackageManifest;
  try {
    current = JSON.parse(currentText) as PackageManifest;
    contract = JSON.parse(contractText) as PackageManifest;
  } catch {
    return { changed: false, content: currentText, restored: [] };
  }

  if (options.authoritativeFoundation) {
    const normalizedContract = `${JSON.stringify(contract, null, 2)}\n`;
    return normalizedContract === `${JSON.stringify(current, null, 2)}\n`
      ? { changed: false, content: currentText, restored: [] }
      : { changed: true, content: normalizedContract, restored: ["authoritative stack foundation"] };
  }

  const restored: string[] = [];
  for (const key of ["main", "type", "private"] as const) {
    if (current[key] !== undefined || contract[key] === undefined) continue;
    current[key] = contract[key];
    restored.push(key);
  }
  for (const section of ["scripts", "dependencies", "devDependencies"] as const) {
    const required = contract[section];
    if (!required || typeof required !== "object" || Array.isArray(required)) continue;
    const existing = current[section] && typeof current[section] === "object" && !Array.isArray(current[section])
      ? current[section] as Record<string, unknown>
      : {};
    for (const [name, value] of Object.entries(required)) {
      if (existing[name] !== undefined) continue;
      existing[name] = value;
      restored.push(`${section}.${name}`);
    }
    if (current[section] === undefined) current[section] = existing;
  }
  return restored.length
    ? { changed: true, content: `${JSON.stringify(current, null, 2)}\n`, restored }
    : { changed: false, content: currentText, restored };
}
