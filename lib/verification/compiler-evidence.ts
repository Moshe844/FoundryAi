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
  return relative.replace(/\\/g, "/");
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
