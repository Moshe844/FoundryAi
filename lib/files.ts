export type FileUploadStatus = "readable" | "image" | "unsupported" | "error";

export type EvidenceKind =
  | "log"
  | "json"
  | "xml"
  | "csv"
  | "spreadsheet"
  | "pdf"
  | "word-document"
  | "screenshot"
  | "photo"
  | "diagram"
  | "source-code"
  | "project-archive"
  | "video"
  | "audio"
  | "markdown"
  | "text"
  | "unknown";

export type WorkspaceAttachment = {
  fileId: string;
  fileName: string;
  fileType: string;
  evidenceKind: EvidenceKind;
  size: number;
  messageId: string;
  missionId: string;
  rawText: string;
  parsedStructure?: unknown;
  evidenceIndex: FileEvidenceFact[];
  dataUrl?: string;
  uploadStatus: FileUploadStatus;
  createdAt: string;
};

export type FileEvidenceFact = {
  path: string;
  kind: "native" | "hex" | "tlv" | "nested-json" | "nested-xml" | "text";
  key?: string;
  rawValue: string;
  decodedValue?: string;
  decimalValue?: number;
  asciiValue?: string;
  tlvTag?: string;
  tlvLength?: number;
  parentContext?: string;
  controlHint?: string;
  suppressed?: boolean;
  suppressReason?: string;
};

const textExtensions = new Set(["txt", "json", "xml", "csv", "yaml", "yml", "md", "markdown", "log"]);
const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

export async function ingestFile(file: File, missionId: string): Promise<WorkspaceAttachment> {
  const createdAt = new Date().toISOString();
  const fileType = detectFileType(file);
  const base = {
    fileId: `${file.name}:${file.size}:${file.lastModified}`,
    fileName: file.name,
    fileType,
    evidenceKind: classifyEvidenceKind(file.name, fileType, file.type),
    size: file.size,
    messageId: "",
    missionId,
    rawText: "",
    evidenceIndex: [],
    uploadStatus: "unsupported" as FileUploadStatus,
    createdAt,
  };

  try {
    if (file.type.startsWith("image/") || imageExtensions.has(extensionFor(file.name))) {
      return {
        ...base,
        dataUrl: await readAsDataUrl(file),
        uploadStatus: "image",
      };
    }

    if (!isReadableTextFile(file)) {
      return base;
    }

    const rawText = await file.text();
    const parsedStructure = parseReadableContent(rawText, fileType);

    return {
      ...base,
      rawText,
      parsedStructure,
      evidenceIndex: buildEvidenceIndex(parsedStructure, rawText, fileType),
      uploadStatus: "readable",
    };
  } catch {
    return {
      ...base,
      uploadStatus: "error",
    };
  }
}

export function classifyEvidenceKind(fileName: string, fileType = "", mimeType = ""): EvidenceKind {
  const extension = extensionFor(fileName);
  const type = fileType.toLowerCase() || extension;
  const mime = mimeType.toLowerCase();
  const name = fileName.toLowerCase();

  if (type === "log" || name.endsWith(".log")) return "log";
  if (type === "json") return "json";
  if (type === "xml") return "xml";
  if (type === "csv") return "csv";
  if (["xls", "xlsx", "ods"].includes(type) || /spreadsheet|excel/.test(mime)) return "spreadsheet";
  if (type === "pdf" || mime === "application/pdf") return "pdf";
  if (["doc", "docx", "rtf"].includes(type) || /wordprocessingml|msword/.test(mime)) return "word-document";
  if (["zip", "7z", "rar", "tar", "gz"].includes(type) || /zip|compressed|archive/.test(mime)) return "project-archive";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(type) || mime.startsWith("video/")) return "video";
  if (["mp3", "wav", "m4a", "ogg", "flac"].includes(type) || mime.startsWith("audio/")) return "audio";
  if (["md", "markdown"].includes(type)) return "markdown";
  if (isSourceCodeExtension(type)) return "source-code";
  if (mime.startsWith("image/") || imageExtensions.has(extension)) {
    if (/\b(screen\s*shot|screenshot|screen capture|capture)\b/i.test(name)) return "screenshot";
    if (/\b(diagram|flow|architecture|wireframe|mockup|sketch)\b/i.test(name)) return "diagram";
    return "photo";
  }
  if (type === "txt" || mime.startsWith("text/")) return "text";
  return "unknown";
}

export function buildEvidenceIndex(parsedStructure: unknown, rawText: string, fileType: string): FileEvidenceFact[] {
  const facts: FileEvidenceFact[] = [];

  walkValue(parsedStructure, "$", facts, "");

  if (rawText && fileType !== "json") {
    extractLineFacts(rawText, facts);
  }

  if (facts.length === 0 && rawText) {
    facts.push({
      path: "$",
      kind: "text",
      rawValue: rawText.slice(0, 12000),
    });
  }

  if (fileType === "xml") {
    extractXmlTextFacts(rawText, facts);
  }

  return facts.slice(0, 5000);
}

export function describeAttachmentStatus(attachment: WorkspaceAttachment) {
  if (attachment.uploadStatus === "readable") return "Readable";
  if (attachment.uploadStatus === "image") return "Visual evidence";
  if (attachment.uploadStatus === "error") return "Could not read";
  return "Unsupported";
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function detectFileType(file: File) {
  const extension = extensionFor(file.name);
  if (extension) return extension;
  if (file.type) return file.type;
  return "unknown";
}

function extensionFor(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function isReadableTextFile(file: File) {
  const extension = extensionFor(file.name);
  return file.type.startsWith("text/") || textExtensions.has(extension) || isSourceCodeExtension(extension);
}

function isSourceCodeExtension(extension: string) {
  return [
    "js",
    "jsx",
    "ts",
    "tsx",
    "mjs",
    "cjs",
    "java",
    "kt",
    "kts",
    "swift",
    "py",
    "rb",
    "php",
    "go",
    "rs",
    "cs",
    "cpp",
    "cc",
    "c",
    "h",
    "hpp",
    "sql",
    "html",
    "css",
    "scss",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "bat",
    "cmd",
    "gradle",
    "properties",
    "toml",
    "ini",
    "env",
  ].includes(extension);
}

function parseReadableContent(rawText: string, fileType: string) {
  if (fileType === "json") return parseJson(rawText);
  if (fileType === "csv") return parseCsv(rawText);
  if (fileType === "xml") return parseXml(rawText);
  if (fileType === "yaml" || fileType === "yml") return parseYaml(rawText);
  if (fileType === "log") return parseLog(rawText);
  if (fileType === "md" || fileType === "markdown") return parseMarkdown(rawText);
  return parseText(rawText);
}

function parseJson(rawText: string) {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return { parseError: "Invalid JSON", preview: rawText.slice(0, 2000) };
  }
}

function parseCsv(rawText: string) {
  const rows = rawText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(",").map((cell) => cell.trim()));

  return {
    rowCount: rows.length,
    headers: rows[0] ?? [],
    rows: rows.slice(1).map((cells, index) => ({
      row: index + 2,
      cells,
    })),
  };
}

function parseXml(rawText: string) {
  const tagNames = Array.from(rawText.matchAll(/<\/?([A-Za-z_][\w:.-]*)\b/g)).map((match) => match[1]);
  const uniqueTags = Array.from(new Set(tagNames));

  return {
    tagCount: tagNames.length,
    tags: uniqueTags.slice(0, 80),
    preview: rawText.slice(0, 4000),
  };
}

function parseYaml(rawText: string) {
  const entries = rawText
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter((line) => /^\s*[^#\s][^:]*:\s*/.test(line.text))
    .slice(0, 120);

  return {
    entries,
    preview: rawText.slice(0, 4000),
  };
}

function parseLog(rawText: string) {
  const lines = rawText.split(/\r?\n/);
  const notableLines = lines
    .map((text, index) => ({ line: index + 1, text }))
    .filter((line) => /\b(error|fail|failed|exception|warn|timeout|denied|fatal)\b/i.test(line.text))
    .slice(0, 80);

  return {
    lineCount: lines.length,
    notableLines,
    preview: lines.slice(0, 80).join("\n"),
  };
}

function parseMarkdown(rawText: string) {
  const headings = rawText
    .split(/\r?\n/)
    .map((text, index) => ({ line: index + 1, text }))
    .filter((line) => /^#{1,6}\s+/.test(line.text))
    .slice(0, 80);

  return {
    headings,
    preview: rawText.slice(0, 4000),
  };
}

function parseText(rawText: string) {
  const lines = rawText.split(/\r?\n/);

  return {
    lineCount: lines.length,
    preview: lines.slice(0, 120).join("\n"),
  };
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error(`Could not read ${file.name}.`)));
    reader.addEventListener("abort", () => reject(new Error(`Reading ${file.name} was cancelled.`)));
    reader.readAsDataURL(file);
  });
}

function walkValue(value: unknown, path: string, facts: FileEvidenceFact[], parentContext: string) {
  if (Array.isArray(value)) {
    const context = summarizeContainer(value);
    value.forEach((item, index) => walkValue(item, `${path}[${index}]`, facts, context));
    return;
  }

  if (value && typeof value === "object") {
    const context = summarizeContainer(value);
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      walkValue(child, `${path}.${escapePathKey(key)}`, facts, context);
    });
    return;
  }

  const key = keyFromPath(path);
  const rawValue = stringifyPrimitive(value);

  if (!rawValue) return;

  facts.push({
    path,
    key,
    kind: "native",
    rawValue,
    decimalValue: typeof value === "number" && Number.isFinite(value) ? value : undefined,
    parentContext,
    controlHint: controlHintFor(path, value),
  });

  if (typeof value !== "string") return;

  inspectStringValue(value, path, key, facts, parentContext);
}

function inspectStringValue(value: string, path: string, key: string | undefined, facts: FileEvidenceFact[], parentContext = "") {
  const trimmed = value.trim();

  if (!trimmed) return;

  const nested = parseNestedJson(trimmed);
  if (nested !== undefined) {
    facts.push({
      path,
      key,
      kind: "nested-json",
      rawValue: trimmed.slice(0, 4000),
      decodedValue: "Nested JSON string",
      parentContext,
    });
    walkValue(nested, `${path}<json>`, facts, parentContext);
  }

  if (looksLikeXml(trimmed)) {
    facts.push({
      path,
      key,
      kind: "nested-xml",
      rawValue: trimmed.slice(0, 4000),
      decodedValue: "Nested XML string",
      parentContext,
      suppressed: isNoisePath(path) && true,
      suppressReason: isNoisePath(path) ? "key/certificate/hash-like field" : undefined,
    });
    extractXmlTextFacts(trimmed, facts, `${path}<xml>`);
  }

  const hex = normalizeHex(trimmed);
  if (!hex || hex.length < 4 || hex.length % 2 !== 0) return;

  const suppressed = isNoisePath(path);
  const suppressReason = suppressed ? "key/certificate/hash-like field" : undefined;

  facts.push({
    path,
    key,
    kind: "hex",
    rawValue: trimmed,
    decodedValue: hex,
    decimalValue: hex.length <= 12 ? parseInt(hex, 16) : undefined,
    asciiValue: hexToAscii(hex),
    parentContext,
    controlHint: controlHintFor(path, value),
    suppressed,
    suppressReason,
  });

  if (suppressed) return;

  decodeTlv(hex).forEach((tlv, index) => {
    facts.push({
      path: `${path}<tlv>[${index}]`,
      key,
      kind: "tlv",
      rawValue: tlv.raw,
      decodedValue: tlv.value,
      decimalValue: tlv.value.length <= 12 ? parseInt(tlv.value || "0", 16) : undefined,
      asciiValue: hexToAscii(tlv.value),
      tlvTag: tlv.tag,
      tlvLength: tlv.length,
      parentContext,
      controlHint: "decoded numeric/config candidate",
    });
  });
}

function decodeTlv(hex: string) {
  const records: Array<{ tag: string; length: number; value: string; raw: string }> = [];
  let index = 0;

  while (index + 4 <= hex.length && records.length < 200) {
    const start = index;
    let tag = hex.slice(index, index + 2);
    index += 2;

    if ((parseInt(tag, 16) & 0x1f) === 0x1f) {
      while (index + 2 <= hex.length) {
        const next = hex.slice(index, index + 2);
        tag += next;
        index += 2;
        if ((parseInt(next, 16) & 0x80) === 0) break;
      }
    }

    if (index + 2 > hex.length) break;

    const firstLengthByte = parseInt(hex.slice(index, index + 2), 16);
    index += 2;
    let length = firstLengthByte;

    if ((firstLengthByte & 0x80) !== 0) {
      const lengthByteCount = firstLengthByte & 0x7f;
      if (lengthByteCount === 0 || lengthByteCount > 3 || index + lengthByteCount * 2 > hex.length) break;
      length = parseInt(hex.slice(index, index + lengthByteCount * 2), 16);
      index += lengthByteCount * 2;
    }

    const valueLength = length * 2;
    if (length < 0 || index + valueLength > hex.length) break;

    const value = hex.slice(index, index + valueLength);
    index += valueLength;

    records.push({
      tag,
      length,
      value,
      raw: hex.slice(start, index),
    });
  }

  if (records.length === 0 || index !== hex.length) return [];

  return records;
}

function extractXmlTextFacts(rawText: string, facts: FileEvidenceFact[], basePath = "$<xml>") {
  Array.from(rawText.matchAll(/<([A-Za-z_][\w:.-]*)\b[^>]*>([^<]+)<\/\1>/g)).forEach((match, index) => {
    const text = match[2]?.trim();
    if (!text) return;
    const path = `${basePath}.${escapePathKey(match[1])}[${index}]`;
    facts.push({
      path,
      key: match[1],
      kind: "native",
      rawValue: text,
      decimalValue: Number.isFinite(Number(text)) ? Number(text) : undefined,
      parentContext: `XML tag ${match[1]}`,
      controlHint: controlHintFor(path, text),
      suppressed: isNoisePath(path),
      suppressReason: isNoisePath(path) ? "key/certificate/hash-like field" : undefined,
    });
    inspectStringValue(text, path, match[1], facts, `XML tag ${match[1]}`);
  });
}

function extractLineFacts(rawText: string, facts: FileEvidenceFact[]) {
  rawText
    .split(/\r?\n/)
    .slice(0, 5000)
    .forEach((line, index) => {
      const text = line.trim();
      if (!text) return;
      const path = `$<line>[${index + 1}]`;
      facts.push({
        path,
        kind: "text",
        rawValue: text,
        decimalValue: Number.isFinite(Number(text)) ? Number(text) : undefined,
        controlHint: controlHintFor(path, text),
      });
      inspectStringValue(text, path, undefined, facts, `Line ${index + 1}`);
    });
}

function parseNestedJson(value: string) {
  if (!((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]")))) return undefined;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function looksLikeXml(value: string) {
  return /^<([A-Za-z_][\w:.-]*)\b[\s\S]*<\/\1>$/.test(value);
}

function normalizeHex(value: string) {
  const withoutCommonPrefixes = value.replace(/0x/gi, "");
  const compact = withoutCommonPrefixes.replace(/[\s:._-]/g, "");
  if (!/^[A-Fa-f0-9]+$/.test(compact)) return "";
  return compact.toUpperCase();
}

function isNoisePath(path: string) {
  return /(?:capk|modulus|rsa|publickey|privatekey|certificate|cert|hash|checksum|serial|uid|signature|digest|exponent|sha|md5|token|secret|salt)/i.test(path);
}

function stringifyPrimitive(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function escapePathKey(key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function keyFromPath(path: string) {
  const match = path.match(/(?:\.([^.[<]+)|\["([^"]+)"\])(?:\[\d+\])?(?:<[^>]+>)?$/);
  return match?.[1] ?? match?.[2];
}

function summarizeContainer(value: unknown) {
  if (Array.isArray(value)) return `Array with ${value.length} item(s)`;
  if (!value || typeof value !== "object") return "";

  return Object.entries(value as Record<string, unknown>)
    .slice(0, 24)
    .map(([key, child]) => `${key}=${summarizeValue(child)}`)
    .join("; ");
}

function summarizeValue(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.length} item(s)]`;
  if (typeof value === "object") return "{...}";
  const text = String(value).replace(/\s+/g, " ");
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function hexToAscii(hex: string) {
  if (hex.length < 2 || hex.length % 2 !== 0) return undefined;

  const chars: string[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    const code = parseInt(hex.slice(index, index + 2), 16);
    if (!Number.isFinite(code) || code < 32 || code > 126) return undefined;
    chars.push(String.fromCharCode(code));
  }

  const value = chars.join("");
  return /[A-Za-z0-9]/.test(value) ? value : undefined;
}

function controlHintFor(path: string, value: unknown) {
  const text = `${path} ${String(value)}`;

  if (/\b(enable|enabled|disable|disabled|available|availability|allow|allowed|support|supported|capability|active|inactive|on|off)\b/i.test(text)) {
    return "availability/enablement candidate";
  }

  if (/\b(limit|threshold|max|min|amount|floor|ceiling|cap|timeout|duration|interval|retry|count)\b/i.test(text)) {
    return "limit/threshold/timing candidate";
  }

  if (/\b(mode|type|profile|level|behavior|behaviour|setting|config|option|policy|rule)\b/i.test(text)) {
    return "mode/configuration candidate";
  }

  if (typeof value === "boolean") {
    return "boolean control candidate";
  }

  if (typeof value === "number") {
    return "numeric configuration candidate";
  }

  return undefined;
}
