import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type ImportedSdkArchive = { archive: string; files: string[]; platform: "android" };

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_IMPORTED_FILES = 40;

/**
 * Inspects uploaded SDK ZIPs and imports the coherent Android library set they contain. Selection is
 * convention-driven (platform + use_aar/libs directories), never provider-name-driven, so the same
 * path works for payment terminals, scanners, printers, identity SDKs, and other licensed vendors.
 */
export function importUploadedSdkArchives(projectPath: string, relativeArchives: string[], platform: string): ImportedSdkArchive[] {
  if (!/android|gradle|mobile/i.test(platform)) return [];
  const imported: ImportedSdkArchive[] = [];
  for (const relativeArchive of relativeArchives.filter((item) => /\.zip$/i.test(item))) {
    const archive = path.resolve(projectPath, relativeArchive);
    if (!archive.startsWith(path.resolve(projectPath) + path.sep) || !existsSync(archive)) continue;
    if (readFileSync(archive).byteLength > MAX_ARCHIVE_BYTES) continue;
    const listed = spawnSync("tar", ["-tf", archive], { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    if (listed.status !== 0) continue;
    const safeEntries = (listed.stdout || "").split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry && !path.posix.isAbsolute(entry) && !entry.split("/").includes(".."));
    const selected = selectAndroidSdkEntries(safeEntries);
    if (!selected.some((entry) => /\.aar$/i.test(entry))) continue;

    const extraction = mkdtempSync(path.join(tmpdir(), "foundry-sdk-"));
    try {
      const extracted = spawnSync("tar", ["-xf", archive, "-C", extraction, ...selected], { encoding: "utf8", timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
      if (extracted.status !== 0) continue;
      const destination = path.join(projectPath, "libs");
      mkdirSync(destination, { recursive: true });
      const copied: string[] = [];
      for (const entry of selected) {
        const source = path.join(extraction, ...entry.split("/"));
        if (!existsSync(source)) continue;
        const fileName = uniqueLibraryName(destination, path.basename(entry));
        copyFileSync(source, path.join(destination, fileName));
        copied.push(`libs/${fileName}`);
      }
      if (copied.length) imported.push({ archive: relativeArchive, files: copied, platform: "android" });
    } finally {
      rmSync(extraction, { recursive: true, force: true });
    }
  }
  return imported;
}

export function selectAndroidSdkEntries(entries: string[]) {
  const androidLibraries = entries.filter((entry) =>
    /\.(?:aar|jar)$/i.test(entry)
    && /(?:^|\/)android(?:\/|$)|(?:^|\/)(?:libs?|sdk)(?:\/|$)/i.test(entry)
    && !/(?:^|\/)(?:demo|sample|example|test|tests)(?:\/|$)/i.test(entry),
  );
  const aarDirectories = new Set(androidLibraries.filter((entry) => /\.aar$/i.test(entry)).map((entry) => path.posix.dirname(entry)));
  return androidLibraries
    .filter((entry) => aarDirectories.size === 0 || [...aarDirectories].some((dir) => path.posix.dirname(entry) === dir))
    .sort((left, right) => sdkEntryScore(right) - sdkEntryScore(left))
    .slice(0, MAX_IMPORTED_FILES);
}

function sdkEntryScore(entry: string) {
  let score = /\.aar$/i.test(entry) ? 100 : 20;
  if (/(?:^|\/)use_aar(?:\/|$)/i.test(entry)) score += 80;
  if (/(?:^|\/)libs?(?:\/|$)/i.test(entry)) score += 30;
  if (/(?:demo|sample|example|test)/i.test(entry)) score -= 60;
  return score;
}

function uniqueLibraryName(directory: string, requested: string) {
  if (!existsSync(path.join(directory, requested))) return requested;
  const parsed = path.parse(requested);
  let index = 2;
  while (existsSync(path.join(directory, `${parsed.name}-${index}${parsed.ext}`))) index += 1;
  return `${parsed.name}-${index}${parsed.ext}`;
}
