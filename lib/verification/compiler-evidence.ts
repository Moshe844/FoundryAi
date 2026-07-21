import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

const SOURCE_EXTENSION = "(?:[cm]?[jt]sx?|vue|svelte|astro|html?|css|scss|sass|less|py|pyi|rb|php|java|kt|kts|swift|go|rs|cs|fs|fsx|vb|dart|scala|lua|r|sql|graphql|proto|xaml|c|cc|cpp|cxx|h|hh|hpp|hxx|ex|exs|erl|hrl|hs|lhs|clj|cljs|cljc|edn|sol|move|zig)";
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

export type CompilerCommandEvidence = {
  command: string;
  stdout?: string;
  stderr?: string;
};

/** Compiler output is the cross-framework repair protocol. Keep the complete useful diagnostic,
 * while removing terminal control codes and repetitive stack frames that waste repair context. */
export function compilerDiagnosticOutput(command: CompilerCommandEvidence, maxLength = 24_000) {
  const output = `${command.stderr ?? ""}\n${command.stdout ?? ""}`
    .replace(ANSI_SEQUENCE, "")
    .replace(/\r/g, "")
    .trim();
  if (output.length <= maxLength) return output;
  const head = output.slice(0, Math.floor(maxLength * 0.65));
  const tail = output.slice(-Math.floor(maxLength * 0.35));
  return `${head}\n\n[diagnostic output compacted]\n\n${tail}`;
}

function normalizeCandidate(candidate: string) {
  return candidate
    .trim()
    .replace(/^file:\/\//i, "")
    .replace(/^["'`([{<]+|["'`\])}>.,;]+$/g, "")
    .replace(/[\\/]+/g, path.sep);
}

function safeRelativeSourcePath(candidate: string, projectRoot: string, fileExists: (absolutePath: string) => boolean) {
  const normalized = normalizeCandidate(candidate);
  if (!normalized || !new RegExp(`\\.${SOURCE_EXTENSION}$`, "i").test(normalized)) return undefined;
  const absolute = path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(projectRoot, normalized);
  const relative = path.relative(path.resolve(projectRoot), absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fileExists(absolute)) return undefined;
  const portable = relative.replace(/\\/g, "/");
  // Dependency and generated-output frames explain how a compiler reached the failure; they are
  // never customer-owned repair targets. Let framework adapters map generated contracts back to
  // their application source instead of sending paid repair calls into node_modules or caches.
  if (/(?:^|\/)(?:node_modules|vendor|\.next|\.next-build|dist|build|out|target|bin|obj)(?:\/|$)/i.test(portable)) return undefined;
  return portable;
}

/** Extracts real source paths from diagnostics emitted by TypeScript/Vite, Python, Rust, Go,
 * .NET, Java/Kotlin, C/C++, Ruby, PHP, Swift, Dart, and other file/line based compilers. The
 * extractor validates every candidate against the project root, so model prose can never invent
 * a repair target. */
export function extractCompilerSourcePaths(
  commandOrOutput: CompilerCommandEvidence | string,
  projectRoot: string,
  fileExists: (absolutePath: string) => boolean = existsSync,
) {
  const output = typeof commandOrOutput === "string" ? commandOrOutput.replace(ANSI_SEQUENCE, "") : compilerDiagnosticOutput(commandOrOutput);
  const candidates: string[] = [];
  const patterns = [
    new RegExp(`([A-Za-z]:[\\\\/][^\\r\\n"'<>|]*?\\.${SOURCE_EXTENSION})(?=[:\\s(),\\[\\]"']|$)`, "gi"),
    new RegExp(`((?:/[^/\\r\\n"']+)+/[^/\\r\\n"']+?\\.${SOURCE_EXTENSION})(?=[:\\s(),\\[\\]"']|$)`, "gi"),
    new RegExp(`["'](?!https?:)((?:\\.{0,2}[\\\\/])?[^"'\\r\\n]+?\\.${SOURCE_EXTENSION})["']`, "gi"),
    new RegExp(`(?:^|[\\s(\\[>])((?:\\.{0,2}[\\\\/])?(?:[A-Za-z0-9_@+ .-]+[\\\\/])+[A-Za-z0-9_@+.-]+\\.${SOURCE_EXTENSION})(?=[:\\s(),\\[\\]]|$)`, "gim"),
    new RegExp(`(?:^|[\\s(\\[>])([A-Za-z0-9_@+.-]+\\.${SOURCE_EXTENSION})(?=[:\\s(),\\[\\]]|$)`, "gim"),
  ];
  for (const pattern of patterns) {
    for (const match of output.matchAll(pattern)) if (match[1]) candidates.push(match[1]);
  }
  const resolved = candidates
    .map((candidate) => safeRelativeSourcePath(candidate, projectRoot, fileExists))
    .filter((candidate): candidate is string => Boolean(candidate));
  return [...new Set(resolved)];
}

/** A stable fingerprint detects a truly repeated compiler failure even when build duration,
 * terminal color, absolute root, or line/column numbers change between runs. File identities and
 * diagnostic text remain, so a newly exposed error is recognized as forward progress. */
export function compilerFailureFingerprint(command: CompilerCommandEvidence, projectRoot = "") {
  let normalized = compilerDiagnosticOutput(command, 40_000).toLowerCase();
  const canonicalRoot = projectRoot ? path.resolve(projectRoot).replace(/\\/g, "/").toLowerCase() : "";
  normalized = normalized.replace(/\\/g, "/");
  if (canonicalRoot) normalized = normalized.split(canonicalRoot).join("<project>");
  normalized = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^at\s+/.test(line) && !/^(?:transforming|rendering|computing gzip|✓|✔)/.test(line))
    .filter((line) => !/^\s*(?:built|compiled|finished)\s+in\s+\d/.test(line))
    .join("\n")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|seconds?)\b/g, "<duration>")
    .replace(/([:(\[])(\d+)(?::|,)(\d+)([)\]:,]?)/g, "$1<line>:<column>$4")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(`${command.command.trim().toLowerCase()}\n${normalized}`).digest("hex");
}

export function isCompilerSourcePath(filePath: string) {
  return new RegExp(`\\.${SOURCE_EXTENSION}$`, "i").test(filePath);
}

/**
 * A *structural* signature of a compiler failure: what broke and where, with the concrete type text
 * erased. compilerFailureFingerprint() hashes the full diagnostic, so a repair that only reshuffles a
 * type annotation produces a brand-new fingerprint and reads as forward progress. That is how one
 * defect burns an entire repair budget — e.g. a contextually-typed callback prop reported four times as
 *
 *   Type '(v: number) => [string]' is not assignable to type 'Formatter<…>'
 *   Type '(l: string) => string'  is not assignable to type '…'
 *
 * which is one mistake, not four. Collapsing quoted types and identifiers to placeholders makes those
 * repeats recognizable so the loop can stop paying for the same failure instead of oscillating.
 */
export function compilerFailureSignature(command: CompilerCommandEvidence, projectRoot = "") {
  let normalized = compilerDiagnosticOutput(command, 40_000).toLowerCase();
  const canonicalRoot = projectRoot ? path.resolve(projectRoot).replace(/\\/g, "/").toLowerCase() : "";
  normalized = normalized.replace(/\\/g, "/");
  if (canonicalRoot) normalized = normalized.split(canonicalRoot).join("<project>");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^at\s+/.test(line));
  // Keep only the diagnostic-bearing lines, then erase every concrete type/identifier/position so two
  // reports of the same defect hash identically.
  const structural = lines
    .filter((line) => /(?:error|warning)\b|\bts\d{4}\b|is not assignable|cannot find|module not found|can't resolve|possibly '?undefined|does not exist/.test(line))
    .map((line) =>
      line
        .replace(/'[^']*'/g, "<type>")
        .replace(/"[^"]*"/g, "<type>")
        .replace(/`[^`]*`/g, "<type>")
        .replace(/\b\d+\b/g, "<n>")
        .replace(/\s+/g, " ")
        .trim(),
    );
  const files = [...new Set(lines.flatMap((line) => line.match(new RegExp(`[\\w./<>-]+\\.${SOURCE_EXTENSION}`, "gi")) ?? []))].sort();
  const payload = `${command.command.trim().toLowerCase()}\n${files.join("|")}\n${[...new Set(structural)].sort().join("\n")}`;
  return createHash("sha256").update(payload).digest("hex");
}
