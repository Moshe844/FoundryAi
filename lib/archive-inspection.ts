import { unzipSync } from "fflate";

import { fileStrategy, type FileHandlingCategory } from "@/lib/file-intelligence";

/**
 * Inspecting an archive without pretending to have understood it.
 *
 * An AAR, JAR, APK or ZIP can be inspected usefully: its entry list says what it provides, and any
 * entries that are themselves text — manifests, build metadata, configuration — can be read directly.
 * What cannot happen is reading compiled entries as source. Both halves are reported here, because a
 * capability claim without its limitation is how "read the manifest" becomes "understood the library".
 *
 * Extraction is bounded on entry count, per-entry size and total decompressed bytes. An archive is
 * untrusted input, and every bound that is exceeded is reported as a limitation rather than silently
 * dropping content — a listing that quietly omitted half an archive would be worse than no listing.
 */

export type ArchiveEntry = {
  path: string;
  /** Decompressed size as declared by the archive. */
  bytes: number;
  category: FileHandlingCategory;
  editableAsText: boolean;
};

export type ArchiveInspection = {
  readable: boolean;
  entries: ArchiveEntry[];
  /** Text entries whose content was safely extracted in full. */
  extracted: Array<{ path: string; text: string }>;
  /** What this inspection could not establish. Always populated for a compiled archive. */
  limitations: string[];
};

export type ArchiveInspectionLimits = {
  maxEntries?: number;
  maxEntryBytes?: number;
  maxTotalTextBytes?: number;
};

const DEFAULT_LIMITS: Required<ArchiveInspectionLimits> = {
  maxEntries: 2_000,
  maxEntryBytes: 512 * 1024,
  maxTotalTextBytes: 2 * 1024 * 1024,
};

export function inspectZipArchive(bytes: Uint8Array, limits: ArchiveInspectionLimits = {}): ArchiveInspection {
  const bounds = { ...DEFAULT_LIMITS, ...limits };
  const limitations: string[] = [];

  let listed: Array<{ path: string; bytes: number }>;
  try {
    listed = listEntries(bytes);
  } catch {
    return {
      readable: false,
      entries: [],
      extracted: [],
      limitations: ["The archive could not be opened, so nothing about its contents has been established."],
    };
  }

  // An archive entry naming an absolute path or escaping its own root is never extracted. Reported
  // rather than dropped quietly, because a hostile entry is something the user should know about.
  const unsafe = listed.filter((entry) => isUnsafeEntryPath(entry.path));
  const safe = listed.filter((entry) => !isUnsafeEntryPath(entry.path));
  if (unsafe.length) {
    limitations.push(`${unsafe.length} entr${unsafe.length === 1 ? "y" : "ies"} use unsafe paths that escape the archive root and were not read.`);
  }

  const visible = safe.slice(0, bounds.maxEntries);
  if (safe.length > visible.length) {
    limitations.push(`Only the first ${visible.length} of ${safe.length} entries are listed.`);
  }

  const entries: ArchiveEntry[] = visible.map((entry) => {
    // Classify each entry by name alone at this stage; a small text entry is re-classified from its real
    // bytes below, where the content is actually available.
    const strategy = fileStrategy({ fileName: entry.path, bytes: new Uint8Array() });
    return { path: entry.path, bytes: entry.bytes, category: strategy.category, editableAsText: strategy.editableAsText };
  });

  const candidates = visible.filter((entry) => entry.bytes > 0 && entry.bytes <= bounds.maxEntryBytes);
  const oversized = visible.filter((entry) => entry.bytes > bounds.maxEntryBytes);
  if (oversized.length) {
    limitations.push(`${oversized.length} entr${oversized.length === 1 ? "y was" : "ies were"} larger than the read limit and were listed but not opened.`);
  }

  const extracted: Array<{ path: string; text: string }> = [];
  let totalTextBytes = 0;
  let budgetExhausted = false;

  if (candidates.length) {
    const wanted = new Set(candidates.map((entry) => entry.path));
    let contents: Record<string, Uint8Array> = {};
    try {
      contents = unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
    } catch {
      limitations.push("Some entries could not be decompressed and were listed but not read.");
    }

    for (const entry of candidates) {
      const content = contents[entry.path];
      if (!content) continue;
      // The entry's real bytes decide whether it is text — the same rule applied to any other file.
      const strategy = fileStrategy({ fileName: entry.path, bytes: content });
      const index = entries.findIndex((item) => item.path === entry.path);
      if (index >= 0) entries[index] = { ...entries[index], category: strategy.category, editableAsText: strategy.editableAsText };
      if (!strategy.editableAsText || !strategy.reading.text) continue;

      if (totalTextBytes + content.byteLength > bounds.maxTotalTextBytes) {
        budgetExhausted = true;
        continue;
      }
      totalTextBytes += content.byteLength;
      extracted.push({ path: entry.path, text: strategy.reading.text });
    }
  }

  if (budgetExhausted) {
    limitations.push("The total text-extraction budget was reached, so some readable entries were listed but not extracted.");
  }

  const compiled = entries.filter((entry) => entry.category === "compiled-binary" || entry.category === "packaged-artifact");
  if (compiled.length) {
    limitations.push(`${compiled.length} entr${compiled.length === 1 ? "y is" : "ies are"} compiled output. Their source code is not present in this archive and has not been read.`);
  }

  return { readable: true, entries, extracted, limitations };
}

/**
 * A statement of what the archive contributed.
 *
 * Deliberately leads with the entry count and the extracted files, then the limitations, so a reader
 * cannot take the useful half without the caveat attached to it.
 */
export function describeArchiveInspection(fileName: string, inspection: ArchiveInspection): string {
  if (!inspection.readable) return `${fileName}: ${inspection.limitations[0]}`;

  const parts = [`${fileName}: ${inspection.entries.length} entr${inspection.entries.length === 1 ? "y" : "ies"} listed`];
  parts.push(inspection.extracted.length
    ? `${inspection.extracted.length} readable entr${inspection.extracted.length === 1 ? "y" : "ies"} extracted (${inspection.extracted.map((entry) => entry.path).slice(0, 8).join(", ")})`
    : "no readable entries were extracted");
  if (inspection.limitations.length) parts.push(`Limitations: ${inspection.limitations.join(" ")}`);
  return `${parts.join(". ")}`;
}

/**
 * Entry names and declared sizes, without decompressing anything.
 *
 * fflate exposes each entry to the filter before deciding whether to inflate it, so returning false for
 * everything yields the central directory's listing at no decompression cost.
 */
function listEntries(bytes: Uint8Array): Array<{ path: string; bytes: number }> {
  const found: Array<{ path: string; bytes: number }> = [];
  unzipSync(bytes, {
    filter: (file) => {
      // A directory entry carries no content of its own and is not worth listing as a file.
      if (!file.name.endsWith("/")) found.push({ path: file.name, bytes: file.originalSize ?? 0 });
      return false;
    },
  });
  return found;
}

function isUnsafeEntryPath(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) return true;
  return normalized.split("/").includes("..");
}
