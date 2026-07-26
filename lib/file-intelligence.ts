/**
 * Deciding what a file actually is, and what may honestly be claimed about it.
 *
 * Readability used to be decided by an extension allowlist, which is the wrong strategy for the job: a
 * list only ever knows the extensions somebody thought to type into it, so an uploaded .vue, .dart,
 * .proto, .graphql, .scala — or an extensionless Makefile, Dockerfile or gradlew — was classified as an
 * opaque binary and its contents were never read at all. Whether bytes are text is a property of the
 * bytes, not of the filename, so that is what this decides from.
 *
 * The second job here is honesty about limits. A compiled binary, a packaged artifact, and an archive
 * can all be inspected usefully, but none of them can be *read as source*, and every category below
 * carries an explicit statement of what Foundry can and cannot learn from it so a decompiled guess is
 * never presented as having understood the code.
 */

export type FileHandlingCategory =
  | "editable-text"
  | "structured-data"
  | "source-code"
  | "documentation"
  | "compiled-binary"
  | "packaged-artifact"
  | "archive"
  | "image"
  | "media"
  | "unknown";

export type FileStrategy = {
  category: FileHandlingCategory;
  /** Whether Foundry may read and edit this file's content directly as text. */
  editableAsText: boolean;
  /** What can genuinely be learned from this file. */
  capability: string;
  /** What cannot be learned. Present on everything Foundry cannot read as source. */
  limitation?: string;
};

/**
 * Real format signatures, not guesses.
 *
 * These are the leading bytes each format is defined to start with, so identifying a file by them is
 * reading the format rather than inferring from a name. Only formats whose category changes how Foundry
 * must handle the file are listed; anything unrecognised falls through to content sniffing.
 */
const FORMAT_SIGNATURES: Array<{ bytes: number[]; category: FileHandlingCategory; format: string }> = [
  // ZIP container. Also the physical form of jar/war/aar/apk/aab/ipa/nupkg/docx/xlsx/pptx — the
  // filename decides which of those it is, but the container is the same and is always inspectable.
  { bytes: [0x50, 0x4b, 0x03, 0x04], category: "archive", format: "zip container" },
  { bytes: [0x50, 0x4b, 0x05, 0x06], category: "archive", format: "empty zip container" },
  { bytes: [0x1f, 0x8b], category: "archive", format: "gzip" },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], category: "archive", format: "7z" },
  { bytes: [0x52, 0x61, 0x72, 0x21], category: "archive", format: "rar" },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], category: "compiled-binary", format: "ELF executable or shared object" },
  { bytes: [0x4d, 0x5a], category: "compiled-binary", format: "Windows PE executable or DLL" },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], category: "compiled-binary", format: "Java class or Mach-O fat binary" },
  { bytes: [0x25, 0x50, 0x44, 0x46], category: "documentation", format: "PDF" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], category: "image", format: "PNG" },
  { bytes: [0xff, 0xd8, 0xff], category: "image", format: "JPEG" },
  { bytes: [0x47, 0x49, 0x46, 0x38], category: "image", format: "GIF" },
  { bytes: [0x42, 0x4d], category: "image", format: "BMP" },
];

export type ContentReading = {
  isText: boolean;
  /** The decoded text, when the bytes are text. */
  text?: string;
  /** The recognised container or binary format, when the leading bytes identify one. */
  format?: string;
  /** Why this reading was reached, so a classification is never unexplained. */
  reason: string;
};

/**
 * Whether these bytes are text, decided from the bytes.
 *
 * Two signals settle it. A NUL byte does not occur in text, so its presence is conclusive. Beyond that,
 * text is overwhelmingly printable — a high proportion of other control characters means a binary format
 * that happens to contain no NUL in its first block. Invalid UTF-8 is likewise decisive, since a strict
 * decode is exactly the question "could this have been written as text?".
 */
export function readContent(bytes: Uint8Array): ContentReading {
  const signature = FORMAT_SIGNATURES.find((candidate) => startsWith(bytes, candidate.bytes));
  if (signature) {
    return { isText: false, format: signature.format, reason: `The leading bytes identify this as a ${signature.format}.` };
  }
  if (!bytes.length) return { isText: true, text: "", reason: "The file is empty." };

  if (bytes.includes(0)) {
    return { isText: false, reason: "The content contains NUL bytes, which text never does." };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { isText: false, reason: "The content is not valid UTF-8, so it cannot be read as text." };
  }

  // Tab, newline and carriage return are ordinary in text; other C0 controls are not.
  let controlCharacters = 0;
  for (const byte of bytes) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controlCharacters += 1;
  }
  if (controlCharacters / bytes.length > 0.05) {
    return { isText: false, reason: "The content is mostly control characters, so it is a binary format rather than text." };
  }

  return { isText: true, text, reason: "The content decodes as UTF-8 text." };
}

/**
 * Which of the ZIP-shaped formats a container is, from its name.
 *
 * The container bytes are identical for a jar, an aar, an apk and a .docx, so the extension is the only
 * thing that distinguishes them — and it is used *only* to refine a category already established from
 * the bytes, never to decide readability.
 */
const PACKAGED_ARTIFACT_SUFFIXES = ["jar", "war", "aar", "apk", "aab", "ipa", "nupkg", "xcframework", "framework", "dex", "class", "so", "dll", "exe", "dylib"];
const DOCUMENT_SUFFIXES = ["docx", "xlsx", "pptx", "doc", "xls", "ppt", "rtf", "odt", "ods", "odp"];

export type FileFacts = {
  fileName: string;
  /** The leading bytes. A prefix is enough; the whole file is not needed to classify it. */
  bytes: Uint8Array;
};

export function fileStrategy(facts: FileFacts): FileStrategy & { reading: ContentReading } {
  const reading = readContent(facts.bytes);
  const suffix = extensionOf(facts.fileName);

  if (reading.isText) {
    const category = textCategoryFor(suffix);
    return {
      reading,
      category,
      editableAsText: true,
      capability: category === "structured-data"
        ? "The full contents can be read, parsed as structured data, compared, and edited."
        : category === "documentation"
          ? "The full contents can be read and edited, and any requirements it states can be acted on."
          : "The full contents can be read, understood, and edited directly.",
    };
  }

  if (reading.format?.includes("zip") || reading.format === "gzip" || reading.format === "7z" || reading.format === "rar") {
    const packaged = PACKAGED_ARTIFACT_SUFFIXES.includes(suffix);
    const document = DOCUMENT_SUFFIXES.includes(suffix);
    if (packaged) {
      return {
        reading,
        category: "packaged-artifact",
        editableAsText: false,
        capability: "The archive's entry list, manifests, and any bundled text resources can be inspected to establish what this artifact provides.",
        limitation: "This is a compiled, packaged artifact. Its source code is not present and has not been read — Foundry can describe what it exposes, not how it is implemented.",
      };
    }
    if (document) {
      return {
        reading,
        category: "documentation",
        editableAsText: false,
        capability: "The document's packaged parts can be inspected to extract its text content.",
        limitation: "This is a packaged document, not plain text. Formatting, embedded objects, and revision history are not fully represented in whatever text is extracted.",
      };
    }
    return {
      reading,
      category: "archive",
      editableAsText: false,
      capability: "The archive's entry list can be read, and entries that are themselves text can be extracted and analyzed individually.",
      limitation: "Nothing inside has been analyzed until it is extracted. Entry names alone do not establish what the contents do.",
    };
  }

  if (reading.format === "PDF") {
    return {
      reading,
      category: "documentation",
      editableAsText: false,
      capability: "The document's extractable text can be read, and any requirements it states can be acted on.",
      limitation: "This is a PDF. Layout, figures, and any text present only as scanned images are not represented in the extracted text.",
    };
  }

  if (reading.format && (reading.format.includes("PNG") || reading.format.includes("JPEG") || reading.format.includes("GIF") || reading.format.includes("BMP"))) {
    return {
      reading,
      category: "image",
      editableAsText: false,
      capability: "The image can be viewed and described, and a design or screenshot in it can be compared against what the project renders.",
      limitation: "This is an image. Anything it depicts is an observation, not source — it cannot be read as code or configuration.",
    };
  }

  if (reading.format) {
    return {
      reading,
      category: "compiled-binary",
      editableAsText: false,
      capability: `Recognised as a ${reading.format}. Its identity, size, and any embedded readable strings can be reported.`,
      limitation: "This is compiled output. Foundry has NOT read its source code and must not describe its implementation as if it had.",
    };
  }

  return {
    reading,
    category: "unknown",
    editableAsText: false,
    capability: "The file's name and size are known.",
    limitation: `Its contents could not be read as text (${reading.reason.toLowerCase()}) and its format was not recognised, so nothing about what it contains has been established.`,
  };
}

/**
 * A statement of what a file contributed and what it could not.
 *
 * Written for the mission record rather than for a log, because a limitation only protects the user if
 * it travels with the claim: "read the manifest" and "understood the library" are very different, and
 * the difference has to survive into whatever Foundry says next.
 */
export function describeFileStrategy(fileName: string, strategy: FileStrategy): string {
  const parts = [`${fileName} — ${strategy.category}. ${strategy.capability}`];
  if (strategy.limitation) parts.push(`Limitation: ${strategy.limitation}`);
  return parts.join(" ");
}

const STRUCTURED_DATA_SUFFIXES = ["json", "jsonc", "json5", "xml", "yaml", "yml", "toml", "ini", "properties", "conf", "config", "csv", "tsv", "env", "lock", "plist", "graphql", "proto", "sql"];
const DOCUMENTATION_SUFFIXES = ["md", "markdown", "rst", "txt", "adoc"];

/**
 * Refines a text file into a handling category.
 *
 * Everything here is already established as editable text, so an unrecognised suffix is not a failure —
 * it simply means the file is treated as ordinary editable text, which is the correct and safe default.
 * That is the difference between this and the allowlist it replaced: being unlisted no longer costs a
 * file its readability.
 */
function textCategoryFor(suffix: string): FileHandlingCategory {
  if (STRUCTURED_DATA_SUFFIXES.includes(suffix)) return "structured-data";
  if (DOCUMENTATION_SUFFIXES.includes(suffix)) return "documentation";
  return suffix ? "source-code" : "editable-text";
}

function extensionOf(fileName: string): string {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  if (!base.includes(".")) return "";
  return base.split(".").pop()?.toLowerCase() ?? "";
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}
