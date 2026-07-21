export type StaticSourceSeparationResult = {
  html: string;
  css: string;
  javascript: string;
  extractedStyleBlocks: number;
  extractedScriptBlocks: number;
};

export type StaticSourceInputFile = { path: string; content: string };
export type StaticSourcePlannedWrite = { path: string; content: string; kind: "asset" | "html" };
export type StaticSourceSeparationPlan = {
  writes: StaticSourcePlannedWrite[];
  htmlFiles: string[];
  assetFiles: string[];
  extractedStyleBlocks: number;
  extractedScriptBlocks: number;
};

const DEFAULT_CSS_PATH = "styles.css";
const DEFAULT_SCRIPT_PATH = "script.js";

/**
 * Recognizes an explicit source-layout request, not a general request to create pages or assets.
 * This deliberately stays stack-generic: it applies to any dependency-free HTML project and does
 * not inspect project names, product copy, or generated templates.
 */
export function isStaticSourceSeparationRequest(task: string): boolean {
  const asksToSeparate = /\b(?:separat(?:e|ed)|split|extract|externaliz(?:e|ed)|move)\b/i.test(task);
  const namesHtml = /\bhtml\b|index\.html/i.test(task);
  const namesCss = /\bcss\b|style(?:s|sheet)?\.css|stylesheet/i.test(task);
  const namesJs = /\b(?:js|javascript)\b|script\.js/i.test(task);
  const namesFiles = /\bfiles?\b/i.test(task);
  const namesInlineAssets = /\binline\b[^.!?\n]{0,100}\b(?:assets?|styles?|scripts?|code)\b|\b(?:assets?|styles?|scripts?)\b[^.!?\n]{0,100}\bexternal\s+files?\b/i.test(task);
  return asksToSeparate && namesFiles && ((namesHtml && namesCss && namesJs) || namesInlineAssets);
}

/**
 * Moves executable inline CSS/JavaScript out of one HTML document. Data scripts such as JSON-LD,
 * import maps, and arbitrary application/json payloads remain inline because externalizing them
 * would change browser semantics. Existing external assets are preserved and extended.
 */
export function separateStaticHtmlSource(input: {
  html: string;
  existingCss?: string;
  existingJavascript?: string;
  cssPath?: string;
  scriptPath?: string;
  ensureCssReference?: boolean;
  ensureScriptReference?: boolean;
}): StaticSourceSeparationResult {
  const cssPath = input.cssPath ?? DEFAULT_CSS_PATH;
  const scriptPath = input.scriptPath ?? DEFAULT_SCRIPT_PATH;
  const extractedCss: string[] = [];
  const extractedJavascript: string[] = [];

  const alreadyLinksCss = stylesheetReferencePattern(cssPath).test(input.html);
  let insertedStylesheet = alreadyLinksCss;
  let html = input.html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_block, content: string) => {
    const normalized = content.trim();
    if (normalized) extractedCss.push(normalized);
    if (insertedStylesheet) return "";
    insertedStylesheet = true;
    return `<link rel="stylesheet" href="${cssPath}">`;
  });

  const alreadyLoadsScript = scriptReferencePattern(scriptPath).test(html);
  let insertedScript = alreadyLoadsScript;
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (block, rawAttributes: string, content: string) => {
    if (/\bsrc\s*=/i.test(rawAttributes) || !isExecutableInlineScript(rawAttributes)) return block;
    const normalized = content.trim();
    if (normalized) extractedJavascript.push(normalized);
    if (insertedScript) return "";
    insertedScript = true;
    const type = rawAttributes.match(/\btype\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
    const typeAttribute = type && /^module$/i.test(type) ? ' type="module"' : "";
    return `<script${typeAttribute} src="${scriptPath}"></script>`;
  });

  // A request for three source files should remain deterministic even when one concern was empty.
  // Add missing references without inventing any product-specific code or styling.
  if (!insertedStylesheet && input.ensureCssReference !== false) {
    html = insertBeforeClosingTag(html, "head", `  <link rel="stylesheet" href="${cssPath}">\n`);
  }
  if (!insertedScript && input.ensureScriptReference !== false) {
    html = insertBeforeClosingTag(html, "body", `  <script src="${scriptPath}"></script>\n`);
  }

  return {
    html: normalizeDocumentSpacing(html),
    css: mergeExternalSource(input.existingCss, extractedCss),
    javascript: mergeExternalSource(input.existingJavascript, extractedJavascript),
    extractedStyleBlocks: extractedCss.length,
    extractedScriptBlocks: extractedJavascript.length,
  };
}

/**
 * Builds one dependency-first refactor plan for any number of HTML documents. File names come from
 * the request, existing local references, or the HTML entry's own stem (in that order). The plan is
 * pure: callers can inspect every read and write before touching disk, then commit or roll it back.
 */
export function planStaticSourceSeparation(input: {
  documents: StaticSourceInputFile[];
  assets: StaticSourceInputFile[];
  requestedPaths?: string[];
}): StaticSourceSeparationPlan {
  const documents = uniqueFiles(input.documents);
  const requestedPaths = (input.requestedPaths ?? []).map(normalizeProjectPath);
  const requestedHtml = requestedPaths.filter((file) => /\.html?$/i.test(file));
  const requestedCss = requestedPaths.filter((file) => /\.css$/i.test(file));
  const requestedJavascript = requestedPaths.filter((file) => /\.(?:js|mjs|cjs)$/i.test(file));
  const selectedDocuments = requestedHtml.length
    ? documents.filter((document) => requestedHtml.some((requested) => sameRequestedFile(requested, document.path)))
    : documents;

  const originalAssets = new Map(uniqueFiles(input.assets).map((file) => [normalizeProjectPath(file.path), file.content]));
  const plannedAssets = new Map(originalAssets);
  const htmlWrites: StaticSourcePlannedWrite[] = [];
  const touchedAssets = new Set<string>();
  let extractedStyleBlocks = 0;
  let extractedScriptBlocks = 0;
  const targets = selectedDocuments.map((document, index) => {
    const htmlPath = normalizeProjectPath(document.path);
    return {
      css: chooseAssetTarget(htmlPath, document.content, "css", requestedCss, selectedDocuments.length, index),
      javascript: chooseAssetTarget(htmlPath, document.content, "javascript", requestedJavascript, selectedDocuments.length, index),
    };
  });
  const javascriptTargetUses = new Map<string, number>();
  for (const target of targets) javascriptTargetUses.set(target.javascript.projectPath, (javascriptTargetUses.get(target.javascript.projectPath) ?? 0) + 1);

  for (let index = 0; index < selectedDocuments.length; index += 1) {
    const document = selectedDocuments[index];
    const htmlPath = normalizeProjectPath(document.path);
    const cssTarget = targets[index].css;
    const javascriptTarget = targets[index].javascript;
    const separated = separateStaticHtmlSource({
      html: document.content,
      existingCss: plannedAssets.get(cssTarget.projectPath),
      existingJavascript: plannedAssets.get(javascriptTarget.projectPath),
      cssPath: cssTarget.reference,
      scriptPath: javascriptTarget.reference,
      ensureCssReference: hasInlineStyles(document.content) || requestedCss.length > 0,
      ensureScriptReference: hasExecutableInlineScripts(document.content) || requestedJavascript.length > 0,
    });
    extractedStyleBlocks += separated.extractedStyleBlocks;
    extractedScriptBlocks += separated.extractedScriptBlocks;

    if (separated.extractedStyleBlocks > 0 || requestedCss.length > 0) {
      plannedAssets.set(cssTarget.projectPath, separated.css);
      touchedAssets.add(cssTarget.projectPath);
    }
    if (separated.extractedScriptBlocks > 0 || requestedJavascript.length > 0) {
      const sharedAcrossEntries = (javascriptTargetUses.get(javascriptTarget.projectPath) ?? 0) > 1;
      const javascript = sharedAcrossEntries && separated.extractedScriptBlocks > 0
        ? mergeExternalSource(plannedAssets.get(javascriptTarget.projectPath), [scopeExecutableScriptsToEntry(htmlPath, executableInlineScriptSources(document.content))])
        : separated.javascript;
      plannedAssets.set(javascriptTarget.projectPath, javascript);
      touchedAssets.add(javascriptTarget.projectPath);
    }
    if (separated.html !== document.content) htmlWrites.push({ path: htmlPath, content: separated.html, kind: "html" });
  }

  const orderedAssets = [...touchedAssets].sort(compareStaticAssetPaths);
  const assetWrites = orderedAssets
    .map((assetPath) => ({ path: assetPath, content: plannedAssets.get(assetPath) ?? "", kind: "asset" as const }));
  return {
    writes: [...assetWrites, ...htmlWrites],
    htmlFiles: selectedDocuments.map((document) => normalizeProjectPath(document.path)),
    assetFiles: orderedAssets,
    extractedStyleBlocks,
    extractedScriptBlocks,
  };
}

function compareStaticAssetPaths(left: string, right: string): number {
  const rank = (assetPath: string) => /\.css$/i.test(assetPath) ? 0 : /\.(?:js|mjs|cjs)$/i.test(assetPath) ? 1 : 2;
  return rank(left) - rank(right) || left.localeCompare(right);
}

export function hasInlineStyles(html: string): boolean {
  return /<style\b[^>]*>[\s\S]*?<\/style\s*>/i.test(html);
}

export function hasExecutableInlineScripts(html: string): boolean {
  const pattern = /<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    if (!/\bsrc\s*=/i.test(match[1]) && isExecutableInlineScript(match[1])) return true;
  }
  return false;
}

function executableInlineScriptSources(html: string): string[] {
  const sources: string[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    if (/\bsrc\s*=/i.test(match[1]) || !isExecutableInlineScript(match[1])) continue;
    const source = match[2].trim();
    if (source) sources.push(source);
  }
  return sources;
}

function scopeExecutableScriptsToEntry(htmlPath: string, sources: string[]): string {
  const expectedPath = `/${normalizeProjectPath(htmlPath)}`;
  const body = sources.join("\n\n").split("\n").map((line) => `    ${line}`).join("\n");
  return `{
  let foundryEntryPath = globalThis.location?.pathname || "";
  try { foundryEntryPath = decodeURIComponent(foundryEntryPath); } catch { /* Preserve the encoded browser path. */ }
  if (foundryEntryPath.replace(/\\/+$/, "").endsWith(${JSON.stringify(expectedPath)})) {
${body}
  }
}`;
}

function chooseAssetTarget(
  htmlPath: string,
  html: string,
  kind: "css" | "javascript",
  explicitPaths: string[],
  documentCount: number,
  documentIndex: number,
): { projectPath: string; reference: string } {
  const explicit = explicitPaths.length === 1
    ? explicitPaths[0]
    : explicitPaths.length === documentCount
      ? explicitPaths[documentIndex]
      : undefined;
  if (explicit) return targetFromProjectPath(htmlPath, explicit);

  const existingReference = localAssetReferences(html, kind)[0];
  if (existingReference) return targetFromReference(htmlPath, existingReference);

  const directory = projectDirectory(htmlPath);
  const stem = projectBasename(htmlPath).replace(/\.html?$/i, "") || "page";
  const fileName = `${stem}.${kind === "css" ? "css" : "js"}`;
  return { projectPath: directory ? `${directory}/${fileName}` : fileName, reference: fileName };
}

function localAssetReferences(html: string, kind: "css" | "javascript"): string[] {
  const references: string[] = [];
  const pattern = kind === "css"
    ? /<link\b(?=[^>]*\brel\s*=\s*(["'])stylesheet\1)[^>]*\bhref\s*=\s*(["'])(.*?)\2[^>]*>/gi
    : /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const value = (kind === "css" ? match[3] : match[2])?.trim();
    if (value && isLocalReference(value)) references.push(value);
  }
  return references;
}

function isLocalReference(value: string): boolean {
  return !/^(?:[a-z]+:)?\/\//i.test(value) && !/^(?:data:|blob:|#)/i.test(value);
}

function targetFromReference(htmlPath: string, reference: string): { projectPath: string; reference: string } {
  const cleanReference = reference.split(/[?#]/, 1)[0].replace(/\\/g, "/");
  const directory = projectDirectory(htmlPath);
  return { projectPath: resolveProjectPath(directory, cleanReference), reference: cleanReference };
}

function targetFromProjectPath(htmlPath: string, projectPath: string): { projectPath: string; reference: string } {
  const normalizedTarget = normalizeProjectPath(projectPath);
  const directory = projectDirectory(htmlPath);
  return { projectPath: normalizedTarget, reference: relativeProjectPath(directory, normalizedTarget) };
}

function resolveProjectPath(directory: string, reference: string): string {
  const segments = `${directory ? `${directory}/` : ""}${reference}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

function relativeProjectPath(fromDirectory: string, target: string): string {
  const from = fromDirectory ? fromDirectory.split("/") : [];
  const to = target.split("/");
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  const relative = [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/");
  return relative || projectBasename(target);
}

function sameRequestedFile(requested: string, actual: string): boolean {
  const normalizedActual = normalizeProjectPath(actual);
  return requested.includes("/") ? requested.toLowerCase() === normalizedActual.toLowerCase() : projectBasename(normalizedActual).toLowerCase() === requested.toLowerCase();
}

function uniqueFiles(files: StaticSourceInputFile[]): StaticSourceInputFile[] {
  const unique = new Map<string, StaticSourceInputFile>();
  for (const file of files) unique.set(normalizeProjectPath(file.path), { path: normalizeProjectPath(file.path), content: file.content });
  return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeProjectPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
}

function projectDirectory(value: string): string {
  const normalized = normalizeProjectPath(value);
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "" : normalized.slice(0, separator);
}

function projectBasename(value: string): string {
  return normalizeProjectPath(value).split("/").at(-1) ?? "";
}

function isExecutableInlineScript(attributes: string): boolean {
  const type = attributes.match(/\btype\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim().toLowerCase();
  if (!type || type === "module") return true;
  return /^(?:text|application)\/(?:javascript|ecmascript)$/.test(type);
}

function mergeExternalSource(existing: string | undefined, extracted: string[]): string {
  const parts: string[] = [];
  const current = existing?.trim();
  if (current) parts.push(current);
  for (const source of extracted) {
    if (!parts.includes(source)) parts.push(source);
  }
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

function stylesheetReferencePattern(cssPath: string): RegExp {
  return new RegExp(`<link\\b[^>]*\\bhref\\s*=\\s*(["'])${escapeRegExp(cssPath)}(?:[?#][^"']*)?\\1`, "i");
}

function scriptReferencePattern(scriptPath: string): RegExp {
  return new RegExp(`<script\\b[^>]*\\bsrc\\s*=\\s*(["'])${escapeRegExp(scriptPath)}(?:[?#][^"']*)?\\1`, "i");
}

function insertBeforeClosingTag(html: string, tag: "head" | "body", insertion: string): string {
  const closing = new RegExp(`(^[ \\t]*)<\\/${tag}\\s*>`, "im");
  if (closing.test(html)) return html.replace(closing, `${insertion}$1</${tag}>`);
  return tag === "head" ? `${insertion}${html}` : `${html.replace(/\s*$/, "")}\n${insertion}`;
}

function normalizeDocumentSpacing(html: string): string {
  return `${html.replace(/(?:\r?\n){3,}/g, "\n\n").trim()}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
