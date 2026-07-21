type JsonRecord = Record<string, unknown>;

const EXPO_LOCAL_ASSET_PATHS = [
  ["icon"],
  ["splash", "image"],
  ["web", "favicon"],
  ["android", "adaptiveIcon", "foregroundImage"],
  ["android", "adaptiveIcon", "backgroundImage"],
  ["android", "adaptiveIcon", "monochromeImage"],
  ["notification", "icon"],
] as const;

function objectAt(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

/** Expo treats configured local artwork as a build contract. Generated projects must not retain
 * guessed asset paths: if the exact referenced file is absent, remove only that optional reference
 * and let Expo use its documented default rather than paying a model to rediscover the same JSON. */
export function pruneMissingExpoAssetReferences(rawConfig: string, fileExists: (relativePath: string) => boolean) {
  let parsed: JsonRecord;
  try {
    parsed = JSON.parse(rawConfig) as JsonRecord;
  } catch {
    return { changed: false, content: rawConfig, removed: [] as string[] };
  }
  const expo = objectAt(parsed.expo);
  if (!expo) return { changed: false, content: rawConfig, removed: [] as string[] };

  const removed: string[] = [];
  for (const path of EXPO_LOCAL_ASSET_PATHS) {
    let owner: JsonRecord | undefined = expo;
    for (const segment of path.slice(0, -1)) owner = objectAt(owner?.[segment]);
    const key = path.at(-1)!;
    const configured = owner?.[key];
    if (typeof configured !== "string" || !configured.trim().startsWith(".")) continue;
    if (fileExists(configured.trim())) continue;
    delete owner![key];
    removed.push(`expo.${path.join(".")}: ${configured}`);
  }
  return {
    changed: removed.length > 0,
    content: removed.length ? `${JSON.stringify(parsed, null, 2)}\n` : rawConfig,
    removed,
  };
}

/** Static HTML export is optional for an Expo mobile app. If Expo Router itself reports that SSR
 * cannot render a route, fall back to its standard single-page web output. This preserves the
 * native application and produces a real interactive browser preview without inventing app code. */
export function repairExpoConfigForBuild(rawConfig: string, diagnostic: string, fileExists: (relativePath: string) => boolean) {
  const assetRepair = pruneMissingExpoAssetReferences(rawConfig, fileExists);
  let parsed: JsonRecord;
  try {
    parsed = JSON.parse(assetRepair.content) as JsonRecord;
  } catch {
    return assetRepair;
  }
  const expo = objectAt(parsed.expo);
  const web = objectAt(expo?.web);
  const removed = [...assetRepair.removed];
  if (/Failed to statically export route/i.test(diagnostic) && web?.output === "static") {
    web.output = "single";
    removed.push("expo.web.output: static → single");
  }
  return {
    changed: removed.length > 0,
    content: removed.length ? `${JSON.stringify(parsed, null, 2)}\n` : rawConfig,
    removed,
  };
}
