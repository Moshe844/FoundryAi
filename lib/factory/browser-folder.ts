"use client";

import { checklistForRequest } from "@/lib/factory/language-adapters";
import type { FactoryExecutionEvent, FactoryObjectiveChecklistItem, FactoryProjectResult, FactorySessionSummary, FactoryUploadedFile } from "@/lib/factory/types";

export type BrowserFolderHandle = FileSystemDirectoryHandle;
type BrowserPermissionMode = "read" | "readwrite";
type PermissionCapableDirectoryHandle = BrowserFolderHandle & {
  queryPermission(options: { mode: BrowserPermissionMode }): Promise<PermissionState>;
  requestPermission(options: { mode: BrowserPermissionMode }): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
};

const dbName = "foundry-browser-folders";
const storeName = "handles";
const maxFileSize = 240_000;
const maxTotalSize = 1_500_000;

type BrowserFolderRecord = {
  id: string;
  name: string;
  handle: BrowserFolderHandle;
  updatedAt: string;
};

type BrowserProjectDetection = {
  stack: string;
  markers: string[];
  primaryLanguages: string[];
  entryFiles: string[];
  packageManager: string;
};

export function supportsBrowserFolderAccess() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window && typeof indexedDB !== "undefined";
}

export async function pickBrowserFolder() {
  const picker = (window as Window & { showDirectoryPicker?: () => Promise<BrowserFolderHandle> }).showDirectoryPicker;
  if (!picker) throw new Error("This browser does not support live folder access.");
  const handle = await picker.call(window);
  const permission = await ensureBrowserFolderPermission(handle, true);
  if (!permission) throw new Error("Folder permission was not granted.");
  const id = `folder-${Date.now()}-${slugify(handle.name) || "project"}`;
  await saveBrowserFolderHandle(id, handle);
  return { id, name: handle.name, handle };
}

export async function saveBrowserFolderHandle(id: string, handle: BrowserFolderHandle) {
  const db = await openFolderDb();
  await idbRequest(db.transaction(storeName, "readwrite").objectStore(storeName).put({ id, name: handle.name, handle, updatedAt: new Date().toISOString() }));
  db.close();
}

export async function getBrowserFolderHandle(id: string) {
  const db = await openFolderDb();
  const record = await idbRequest<BrowserFolderRecord | undefined>(db.transaction(storeName, "readonly").objectStore(storeName).get(id));
  db.close();
  return record?.handle;
}

export async function ensureBrowserFolderPermission(handle: BrowserFolderHandle, writable: boolean) {
  const mode: BrowserPermissionMode = writable ? "readwrite" : "read";
  const permissionHandle = handle as PermissionCapableDirectoryHandle;
  if ((await permissionHandle.queryPermission({ mode })) === "granted") return true;
  return (await permissionHandle.requestPermission({ mode })) === "granted";
}

export async function readBrowserFolderFiles(handle: BrowserFolderHandle): Promise<FactoryUploadedFile[]> {
  const files: FactoryUploadedFile[] = [];
  let totalSize = 0;

  async function walk(directory: BrowserFolderHandle, prefix = "") {
    for await (const [name, entry] of (directory as PermissionCapableDirectoryHandle).entries()) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (!isUsefulPath(relativePath)) continue;
      if (entry.kind === "directory") {
        await walk(entry, relativePath);
        continue;
      }
      const file = await entry.getFile();
      if (file.size > maxFileSize || totalSize + file.size > maxTotalSize) continue;
      files.push({ path: relativePath, content: await file.text(), size: file.size });
      totalSize += file.size;
    }
  }

  await walk(handle);
  return files;
}

export async function executeBrowserFolderTask(brief: string, task: string, handleId: string, onEvent?: (event: FactoryExecutionEvent) => void, approvedCategories: string[] = []): Promise<FactoryProjectResult> {
  const handle = await getBrowserFolderHandle(handleId);
  if (!handle) throw new Error("Live folder handle was not found. Re-open the local folder.");
  if (!(await ensureBrowserFolderPermission(handle, true))) throw new Error("Local folder editing is not available yet.");

  const timeline: FactoryExecutionEvent[] = [];
  const emit = async (event: Omit<FactoryExecutionEvent, "id" | "timestamp">) => {
    const next = { ...event, id: `browser-${Date.now()}-${timeline.length}`, timestamp: new Date().toISOString() };
    timeline.push(next);
    onEvent?.(next);
    await pauseForLiveStream();
  };

  await emit({ kind: "planning", status: "completed", title: "Connected live local folder", filePath: handle.name, details: { sourceMode: "Connected live folder", task } });
  // This deterministic adapter only verifies styling/asset-separation/exact-file-write outcomes — it never
  // claims to verify semantic bugfix/feature/refactor work, so those scaffold items would otherwise sit
  // permanently unfulfilled and fail every mission regardless of whether the real work succeeded.
  const unverifiableByThisAdapter = new Set(["bugfix-verified", "feature-verified", "refactor-verified"]);
  const checklist = checklistForRequest(task, "the connected local folder").filter((item) => !unverifiableByThisAdapter.has(item.id));
  await emit({
    kind: "planning",
    status: "completed",
    title: "Parsed objective checklist",
    internal: true,
    details: { objective: task, checklist: checklist.map((item) => item.label) },
  });
  const files = await readBrowserFolderFiles(handle);
  await emit({ kind: "inspection", status: "completed", title: "Read project files", details: { files: files.length } });
  markChecklist(checklist, "understand-goal", "completed", "Converted the natural-language request into an engineering objective.");
  markChecklist(checklist, "read-project", "completed", `Read ${files.length} files from the connected local folder.`);

  const result = await runServerMissionForBrowserFolder(brief, task, files, checklist, emit, approvedCategories);
  const verifiedFiles: string[] = [];
  const failedWrites: string[] = [];
  for (const [filePath, content] of result.contents.entries()) {
    if (!result.changedFiles.includes(filePath)) continue;
    const before = await tryReadBrowserFile(handle, filePath);
    let readBack: string | null = null;
    let stats: { size: number; lastModified: number } = { size: 0, lastModified: Date.now() };
    try {
      await writeBrowserFile(handle, filePath, content);
      readBack = await tryReadBrowserFile(handle, filePath);
      stats = await readBrowserFileStats(handle, filePath);
    } catch {
      failedWrites.push(filePath);
      await emit({
        kind: "inspection",
        status: "error",
        title: `Verification failed for ${baseName(filePath)}`,
        filePath,
        details: { reason: "Local folder editing is not available yet." },
      });
      continue;
    }
    const contentChanged = before === null ? true : before !== readBack;
    if (readBack === content && contentChanged) {
      verifiedFiles.push(filePath);
      const existedBefore = before !== null;
      const diff = simpleBrowserDiff(before ?? "", content);
      await emit({
        kind: existedBefore ? "edit" : "file",
        status: "completed",
        title: `${existedBefore ? "Edited" : "Created"} ${baseName(filePath)}`,
        fileName: baseName(filePath),
        filePath,
        output: diff.text,
        beforeContent: before ?? "",
        details: {
          bytes: stats.size,
          modifiedAt: new Date(stats.lastModified).toISOString(),
          contentChanged: true,
          lineRange: diff.lineRange,
        },
      });
      await emit({
        kind: "inspection",
        status: "completed",
        title: `Verified ${baseName(filePath)} on disk`,
        filePath,
        details: { bytes: stats.size, modifiedAt: new Date(stats.lastModified).toISOString() },
      });
    } else {
      failedWrites.push(filePath);
      await emit({
        kind: "inspection",
        status: "error",
        title: `Verification failed for ${baseName(filePath)}`,
        filePath,
        details: { reason: readBack !== content ? "Read-back content did not match expected edited content." : "Write succeeded but file content did not change." },
      });
    }
  }
  if (result.projectId) await cleanupServerScratchProject(result.projectId);
  const finalStatus: FactoryProjectResult["status"] = failedWrites.length ? "failed" : result.status;
  let finalStatusMutable: FactoryProjectResult["status"] = finalStatus;
  let finalBlocker = failedWrites.length ? `Local folder editing is not available yet. Could not verify writes for ${failedWrites.join(", ")}.` : result.blocker;
  if (!failedWrites.length && finalStatusMutable === "passed") {
    const referenceFailures = await validateBrowserReferencesOnDisk(handle, Array.from(result.contents.keys()).filter((filePath) => /\.html$/i.test(filePath)), emit);
    if (referenceFailures.length) {
      finalStatusMutable = "failed";
      finalBlocker = `Disk reference check failed: ${referenceFailures.join(", ")}`;
    }
    const objectiveVerification = await verifyBrowserObjectiveCompletionOnDisk(handle, task, verifiedFiles, checklist, emit);
    if (!objectiveVerification.passed) {
      finalStatusMutable = "failed";
      finalBlocker = objectiveVerification.blocker;
    }
  }
  markChecklist(checklist, "references-checked", finalStatusMutable === "passed" ? "completed" : "blocked", finalBlocker || "Re-read HTML files from disk and confirmed local CSS/JS references exist.");
  markChecklist(checklist, "files-on-disk", !failedWrites.length && verifiedFiles.length === result.changedFiles.length ? "completed" : "blocked", verifiedFiles.length ? `Verified ${verifiedFiles.join(", ")}` : finalBlocker);
  if (finalStatusMutable === "passed") {
    const unresolved = checklist.filter((item) => item.id !== "final-result" && item.status !== "completed");
    if (unresolved.length) {
      finalStatusMutable = "failed";
      finalBlocker = `Objective checklist still has incomplete item(s): ${unresolved.map((item) => item.label).join("; ")}`;
      unresolved.forEach((item) => markChecklist(checklist, item.id, "blocked", finalBlocker));
      await emit({ kind: "summary", status: "error", title: "Objective checklist incomplete", details: { blocker: finalBlocker } });
    }
  }
  finishBrowserChecklist(checklist, finalStatusMutable, finalBlocker);
  const diskFiles = await readBrowserFolderFiles(handle);
  await emit({ kind: "summary", status: finalStatusMutable === "passed" ? "completed" : "error", title: finalStatusMutable === "passed" ? "Live folder task complete" : "Live folder task failed verification", details: { changedFiles: verifiedFiles, verifiedFiles, blocker: finalBlocker } });

  return {
    projectId: handleId,
    projectName: titleFromBrief(brief) || handle.name,
    projectPath: handle.name,
    briefPath: `${handle.name}/foundry-brief.md`,
    stack: detectBrowserProject(files).stack,
    template: "Existing Project",
    sourceMode: "local-folder",
    objective: `Complete goal: ${task.trim() || "project request"}`,
    checklist,
    status: finalStatusMutable,
    supported: finalStatusMutable !== "unsupported",
    blocker: finalBlocker,
    events: timeline.map((event) => event.title),
    files: diskFiles.map((file) => ({ ...file, status: verifiedFiles.includes(file.path) ? (result.originalPaths.has(file.path) ? "edited" : "created") : "uploaded" })),
    commands: [],
    timeline,
    sessionSummary: result.sessionSummary,
  };
}

function simpleBrowserDiff(before: string, after: string) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const rows: string[] = [];
  let firstChangedLine: number | undefined;
  let lastChangedLine: number | undefined;
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    const previous = beforeLines[index] ?? "";
    const next = afterLines[index] ?? "";
    if (previous === next) continue;
    if (firstChangedLine === undefined) firstChangedLine = index + 1;
    lastChangedLine = index + 1;
    if (previous && rows.length < 80) rows.push(`- ${previous}`);
    if (next && rows.length < 80) rows.push(`+ ${next}`);
  }
  const lineRange =
    firstChangedLine && lastChangedLine
      ? firstChangedLine === lastChangedLine
        ? `Line ${firstChangedLine}`
        : `Lines ${firstChangedLine}-${lastChangedLine}`
      : undefined;
  return { text: rows.join("\n"), lineRange };
}

async function runServerMissionForBrowserFolder(
  brief: string,
  task: string,
  files: FactoryUploadedFile[],
  checklist: FactoryObjectiveChecklistItem[],
  emit: (event: Omit<FactoryExecutionEvent, "id" | "timestamp">) => Promise<void>,
  approvedCategories: string[] = [],
) {
  const response = await fetch("/api/factory/existing?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief, task, files, approvedCategories }),
  });
  if (!response.ok || !response.body) {
    return {
      status: "unsupported" as const,
      contents: new Map(files.map((file) => [file.path, file.content])),
      changedFiles: [],
      originalPaths: new Set(files.map((file) => file.path)),
      blocker: `General project executor request failed with HTTP ${response.status}.`,
      projectId: undefined,
      sessionSummary: undefined,
    };
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  const missionState: { result?: FactoryProjectResult } = {};

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    const errorResult = await processServerMissionLines(lines, emit, (result) => { missionState.result = result; });
    if (errorResult) return errorResult(files);
  }
  if (buffer.trim()) {
    const errorResult = await processServerMissionLines([buffer], emit, (result) => { missionState.result = result; });
    if (errorResult) return errorResult(files);
  }

  const serverResult = missionState.result;
  if (!serverResult) {
    return {
      status: "unsupported" as const,
      contents: new Map(files.map((file) => [file.path, file.content])),
      changedFiles: [],
      originalPaths: new Set(files.map((file) => file.path)),
      blocker: "General project executor did not return a result.",
      projectId: undefined,
      sessionSummary: undefined,
    };
  }

  checklist.splice(0, checklist.length, ...(serverResult.checklist ?? checklist));
  const originalPaths = new Set(files.map((file) => file.path));
  const contents = new Map(files.map((file) => [file.path, file.content]));
  const changedFiles: string[] = [];
  for (const file of serverResult.files) {
    if ((file.status === "edited" || file.status === "created") && typeof file.content === "string") {
      contents.set(file.path, file.content);
      changedFiles.push(file.path);
    }
  }

  if (!changedFiles.length && serverResult.status === "passed") {
    return {
      status: "unsupported" as const,
      contents,
      changedFiles,
      originalPaths,
      blocker: "General project executor reported success but returned no changed file contents to write back.",
      projectId: serverResult.projectId,
      sessionSummary: serverResult.sessionSummary,
    };
  }

  return {
    status: serverResult.status === "passed" ? "passed" as const : "unsupported" as const,
    contents,
    changedFiles,
    originalPaths,
    blocker: serverResult.blocker,
    projectId: serverResult.projectId,
    sessionSummary: serverResult.sessionSummary,
  };
}

async function processServerMissionLines(
  lines: string[],
  emit: (event: Omit<FactoryExecutionEvent, "id" | "timestamp">) => Promise<void>,
  setResult: (result: FactoryProjectResult) => void,
): Promise<null | ((files: FactoryUploadedFile[]) => { status: "unsupported"; contents: Map<string, string>; changedFiles: string[]; originalPaths: Set<string>; blocker: string; projectId: undefined; sessionSummary?: FactorySessionSummary })> {
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = safeJsonParse(line);
    if (!message) continue;
    if (message.type === "event" && message.event) {
      const event = message.event as FactoryExecutionEvent;
      const isScratchCopyDetail = event.kind === "file" && event.title.startsWith("Copied");
      await emit({
        tier: event.tier,
        kind: event.kind,
        status: event.status,
        title: event.title,
        narrative: event.narrative,
        fileName: event.fileName,
        filePath: event.filePath,
        command: event.command,
        cwd: event.cwd,
        output: event.output,
        stdout: event.stdout,
        stderr: event.stderr,
        beforeContent: event.beforeContent,
        exitCode: event.exitCode,
        durationMs: event.durationMs,
        rationale: event.rationale,
        details: event.details,
        internal: event.internal || isScratchCopyDetail,
      });
    }
    if (message.type === "result" && message.result) {
      setResult(message.result as FactoryProjectResult);
    }
    if (message.type === "error") {
      return (files) => ({
        status: "unsupported" as const,
        contents: new Map(files.map((file) => [file.path, file.content])),
        changedFiles: [],
        originalPaths: new Set(files.map((file) => file.path)),
        blocker: String(message.error ?? "General project executor failed."),
        projectId: undefined,
        sessionSummary: undefined,
      });
    }
  }
  return null;
}

async function cleanupServerScratchProject(projectId: string) {
  try {
    await fetch("/api/factory/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
  } catch {
    // Best-effort cleanup of the temporary server-side workspace. The real edits already landed in the connected folder above.
  }
}

async function writeBrowserFile(root: BrowserFolderHandle, filePath: string, content: string) {
  const parts = filePath.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return;
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
  const file = await current.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readBrowserFile(root: BrowserFolderHandle, filePath: string) {
  const parts = filePath.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return "";
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part);
  return (await (await current.getFileHandle(fileName)).getFile()).text();
}

async function tryReadBrowserFile(root: BrowserFolderHandle, filePath: string) {
  try {
    return await readBrowserFile(root, filePath);
  } catch {
    return null;
  }
}

async function readBrowserFileStats(root: BrowserFolderHandle, filePath: string) {
  const parts = filePath.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return { size: 0, lastModified: Date.now() };
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part);
  const file = await (await current.getFileHandle(fileName)).getFile();
  return { size: file.size, lastModified: file.lastModified };
}

async function validateBrowserReferencesOnDisk(root: BrowserFolderHandle, htmlPaths: string[], emit: (event: Omit<FactoryExecutionEvent, "id" | "timestamp">) => Promise<void>) {
  const missing: string[] = [];
  for (const htmlPath of htmlPaths) {
    const html = await tryReadBrowserFile(root, htmlPath);
    if (html === null) {
      missing.push(`${htmlPath} -> missing HTML file`);
      continue;
    }
    const htmlDir = dirName(htmlPath);
    const refs = [
      ...Array.from(html.matchAll(/<link\b[^>]*href=["']([^"']+\.css(?:[?#][^"']*)?)["']/gi)).map((match) => match[1]),
      ...Array.from(html.matchAll(/<script\b[^>]*src=["']([^"']+\.js(?:[?#][^"']*)?)["']/gi)).map((match) => match[1]),
    ];
    for (const ref of refs) {
      if (!ref || /^(https?:)?\/\//i.test(ref) || ref.startsWith("#") || ref.startsWith("data:")) continue;
      const target = normalizeReferencePath(htmlDir, ref);
      if ((await tryReadBrowserFile(root, target)) === null) missing.push(`${htmlPath} -> ${ref}`);
    }
  }
  await emit({
    kind: "inspection",
    status: missing.length ? "error" : "completed",
    title: missing.length ? "Disk reference check failed" : "Verified local references on disk",
    details: missing.length ? { missing } : { checked: htmlPaths.length },
  });
  return missing;
}

async function verifyBrowserObjectiveCompletionOnDisk(
  root: BrowserFolderHandle,
  task: string,
  verifiedChangedFiles: string[],
  checklist: FactoryObjectiveChecklistItem[],
  emit: (event: Omit<FactoryExecutionEvent, "id" | "timestamp">) => Promise<void>,
) {
  const taskText = task.toLowerCase();
  const wantsCssSeparation = wantsAssetSeparation(taskText) && /\b(css|style|styling)\b/.test(taskText);
  const wantsJsSeparation = wantsAssetSeparation(taskText) && /\b(js|javascript|script)\b/.test(taskText);
  const wantsStyling = isStylingRequest(taskText);
  const wantsCenteredBorderedForm = /\bcenter(?:ed)?|cnetered\b/.test(taskText) && /\bbordered?|boredered\b/.test(taskText) && /\bform\b/.test(taskText);
  const requiredCssPath = requestedAssetPath(task, ".css", "");
  const requiredJsPath = requestedAssetPath(task, ".js", "");
  const diskFiles = await readBrowserFolderFiles(root);
  const htmlFiles = diskFiles.filter((file) => /\.html$/i.test(file.path));
  const cssFiles = diskFiles.filter((file) => /\.css$/i.test(file.path));
  const jsFiles = diskFiles.filter((file) => /\.(js|mjs|cjs)$/i.test(file.path));
  const verifiedSet = new Set(verifiedChangedFiles);
  const blockers: string[] = [];

  if (wantsCssSeparation) {
    const linkedCss = linkedBrowserReferences(htmlFiles, "css");
    const relevantCssLinks = requiredCssPath ? linkedCss.filter((ref) => ref.target === requiredCssPath) : linkedCss;
    const missingCss: string[] = [];
    for (const ref of relevantCssLinks) {
      if ((await tryReadBrowserFile(root, ref.target)) === null) missingCss.push(`${ref.htmlPath} -> ${ref.reference}`);
    }
    const inlineStyleFiles = htmlFiles.filter((file) => /<style\b/i.test(file.content)).map((file) => file.path);
    const inlineStyleAttributeFiles = htmlFiles.filter((file) => /\sstyle\s*=/i.test(file.content)).map((file) => file.path);
    const cssExists = requiredCssPath ? (await tryReadBrowserFile(root, requiredCssPath)) !== null : relevantCssLinks.length > 0 && missingCss.length === 0;
    if (requiredCssPath && !cssExists) blockers.push(`${requiredCssPath} does not exist on disk.`);
    if (requiredCssPath && !verifiedSet.has(requiredCssPath)) blockers.push(`${requiredCssPath} was not verified as a changed file from disk.`);
    if (!relevantCssLinks.length) blockers.push(requiredCssPath ? `No HTML file links ${requiredCssPath}.` : "No local stylesheet link was found in the HTML after the edit.");
    if (missingCss.length) blockers.push(`Stylesheet link target missing on disk: ${missingCss.join(", ")}`);
    if (inlineStyleFiles.length) blockers.push(`Inline <style> blocks remain in: ${inlineStyleFiles.join(", ")}`);
    if (inlineStyleAttributeFiles.length) blockers.push(`Inline style attributes remain in: ${inlineStyleAttributeFiles.join(", ")}`);
    if (cssExists && relevantCssLinks.length && !missingCss.length && !inlineStyleFiles.length && !inlineStyleAttributeFiles.length && (!requiredCssPath || verifiedSet.has(requiredCssPath))) {
      markChecklist(checklist, "stylesheet-exists", "completed", `Verified ${requiredCssPath || relevantCssLinks.map((ref) => ref.target).join(", ")} exists on disk.`);
      markChecklist(checklist, "html-links-css", "completed", `Verified HTML stylesheet link(s): ${relevantCssLinks.map((ref) => `${ref.htmlPath} -> ${ref.reference}`).join(", ")}.`);
      markChecklist(checklist, "inline-css-removed", "completed", "Re-read HTML from disk and found no inline <style> blocks or style attributes.");
      markChecklist(checklist, "css-separated", "completed", `Verified stylesheet link(s) from disk: ${relevantCssLinks.map((ref) => ref.reference).join(", ")}.`);
      await emit({ kind: "inspection", status: "completed", title: "Verified CSS link", details: { links: relevantCssLinks.map((ref) => `${ref.htmlPath} -> ${ref.reference}`), inlineStyleBlocks: 0 } });
      await emit({ kind: "inspection", status: "completed", title: "Verified inline CSS removed", details: { htmlFiles: htmlFiles.map((file) => file.path), inlineStyleBlocks: 0, inlineStyleAttributes: 0 } });
    } else {
      markChecklist(checklist, "stylesheet-exists", cssExists ? "completed" : "blocked", cssExists ? `Verified ${requiredCssPath || "a linked stylesheet"} exists on disk.` : blockers.at(-1));
      markChecklist(checklist, "html-links-css", relevantCssLinks.length && !missingCss.length ? "completed" : "blocked", relevantCssLinks.length ? `Verified HTML stylesheet link(s): ${relevantCssLinks.map((ref) => ref.reference).join(", ")}.` : blockers.at(-1));
      markChecklist(
        checklist,
        "inline-css-removed",
        inlineStyleFiles.length || inlineStyleAttributeFiles.length ? "blocked" : "completed",
        inlineStyleFiles.length
          ? `Inline <style> blocks remain in: ${inlineStyleFiles.join(", ")}`
          : inlineStyleAttributeFiles.length
            ? `Inline style attributes remain in: ${inlineStyleAttributeFiles.join(", ")}`
            : "No inline <style> blocks or style attributes remain.",
      );
      markChecklist(checklist, "css-separated", "blocked", blockers.at(-1));
    }
  }

  if (wantsJsSeparation) {
    const linkedJs = linkedBrowserReferences(htmlFiles, "js");
    const relevantJsLinks = requiredJsPath ? linkedJs.filter((ref) => ref.target === requiredJsPath) : linkedJs;
    const missingJs: string[] = [];
    for (const ref of relevantJsLinks) {
      if ((await tryReadBrowserFile(root, ref.target)) === null) missingJs.push(`${ref.htmlPath} -> ${ref.reference}`);
    }
    const inlineScriptFiles = htmlFiles.filter((file) => /<script(?![^>]*\bsrc=)[^>]*>/i.test(file.content)).map((file) => file.path);
    const jsExists = requiredJsPath ? (await tryReadBrowserFile(root, requiredJsPath)) !== null : relevantJsLinks.length > 0 && missingJs.length === 0;
    if (requiredJsPath && !jsExists) blockers.push(`${requiredJsPath} does not exist on disk.`);
    if (requiredJsPath && !verifiedSet.has(requiredJsPath)) blockers.push(`${requiredJsPath} was not verified as a changed file from disk.`);
    if (!relevantJsLinks.length) blockers.push(requiredJsPath ? `No HTML file loads ${requiredJsPath}.` : "No local script tag was found in the HTML after the edit.");
    if (missingJs.length) blockers.push(`Script tag target missing on disk: ${missingJs.join(", ")}`);
    if (inlineScriptFiles.length) blockers.push(`Inline <script> blocks remain in: ${inlineScriptFiles.join(", ")}`);
    if (jsExists && relevantJsLinks.length && !missingJs.length && !inlineScriptFiles.length && (!requiredJsPath || verifiedSet.has(requiredJsPath))) {
      markChecklist(checklist, "script-exists", "completed", `Verified ${requiredJsPath || relevantJsLinks.map((ref) => ref.target).join(", ")} exists on disk.`);
      markChecklist(checklist, "html-loads-js", "completed", `Verified HTML script tag(s): ${relevantJsLinks.map((ref) => `${ref.htmlPath} -> ${ref.reference}`).join(", ")}.`);
      markChecklist(checklist, "inline-js-removed", "completed", "Re-read HTML from disk and found no inline <script> blocks.");
      markChecklist(checklist, "js-separated", "completed", `Verified script tag(s) from disk: ${relevantJsLinks.map((ref) => ref.reference).join(", ")}.`);
      await emit({ kind: "inspection", status: "completed", title: "Verified JS script", details: { scripts: relevantJsLinks.map((ref) => `${ref.htmlPath} -> ${ref.reference}`), inlineScriptBlocks: 0 } });
      await emit({ kind: "inspection", status: "completed", title: "Verified inline JS removed", details: { htmlFiles: htmlFiles.map((file) => file.path), inlineScriptBlocks: 0 } });
    } else {
      markChecklist(checklist, "script-exists", jsExists ? "completed" : "blocked", jsExists ? `Verified ${requiredJsPath || "a linked script"} exists on disk.` : blockers.at(-1));
      markChecklist(checklist, "html-loads-js", relevantJsLinks.length && !missingJs.length ? "completed" : "blocked", relevantJsLinks.length ? `Verified HTML script tag(s): ${relevantJsLinks.map((ref) => ref.reference).join(", ")}.` : blockers.at(-1));
      markChecklist(checklist, "inline-js-removed", inlineScriptFiles.length ? "blocked" : "completed", inlineScriptFiles.length ? `Inline <script> blocks remain in: ${inlineScriptFiles.join(", ")}` : "No inline <script> blocks remain.");
      markChecklist(checklist, "js-separated", "blocked", blockers.at(-1));
    }
  }

  if (wantsStyling) {
    const changedCss = verifiedChangedFiles.filter((filePath) => /\.css$/i.test(filePath));
    const changedHtml = verifiedChangedFiles.filter((filePath) => /\.html$/i.test(filePath));
    const cssText = cssFiles.map((file) => file.content).join("\n");
    const requestedColor = colorForTask(task);
    const requestedDeclarations = cssDeclarationsForTask(task);
    const expectedSelectors = selectorsForTask(task, htmlFiles.map((file) => file.content).join("\n"));
    const styleEvidence = /border|box-shadow|padding|background|font|form|input|button|textarea|select|label|cursor/i.test(cssText);
    const requestedTargetEvidence =
      !requestedDeclarations.length ||
      !expectedSelectors.length ||
      (requestedDeclarations.every((declaration) => cssText.includes(`${declaration.property}: ${declaration.value}`)) && expectedSelectors.some((selector) => cssText.includes(selector)));
    const centeredBorderedFormEvidence = /form\s*\{[\s\S]*?(border|box-shadow)[\s\S]*?\}/i.test(cssText) && /form\s*\{[\s\S]*?(margin(?:-inline)?\s*:\s*[^;]*auto|width\s*:\s*min|max-width)[\s\S]*?\}/i.test(cssText);
    if (!changedCss.length && !changedHtml.length) blockers.push("No verified CSS or HTML styling change was found on disk.");
    if (!styleEvidence) blockers.push("No styling evidence was found in CSS after the edit.");
    if (!requestedTargetEvidence) blockers.push(`Requested ${requestedColor?.name ?? "style"} target was not verified in CSS.`);
    if (wantsCenteredBorderedForm && !centeredBorderedFormEvidence) blockers.push("Centered bordered form styling was not verified in CSS.");
    if ((changedCss.length || changedHtml.length) && styleEvidence && requestedTargetEvidence && (!wantsCenteredBorderedForm || centeredBorderedFormEvidence)) {
      markChecklist(checklist, "styling-improved", "completed", `Verified styling changes on disk in ${[...changedCss, ...changedHtml].join(", ")}.`);
      await emit({ kind: "inspection", status: "completed", title: wantsCenteredBorderedForm ? "Improved centered bordered form styling" : "Verified UX styling evidence", details: { changedCss, changedHtml, checkedCssFiles: cssFiles.map((file) => file.path), requestedColor: requestedColor?.name, requestedDeclarations: requestedDeclarations.map((declaration) => `${declaration.property}: ${declaration.value}`), requestedSelectors: expectedSelectors, centeredBorderedForm: wantsCenteredBorderedForm ? centeredBorderedFormEvidence : undefined } });
    } else {
      markChecklist(checklist, "styling-improved", "blocked", blockers.at(-1));
    }
  }

  if (!blockers.length) {
    await emit({
      kind: "summary",
      status: "completed",
      title: "Objective verified from disk",
      details: { changedFiles: verifiedChangedFiles, htmlFiles: htmlFiles.map((file) => file.path), cssFiles: cssFiles.map((file) => file.path), jsFiles: jsFiles.map((file) => file.path) },
    });
    return { passed: true };
  }

  const blocker = blockers.join(" ");
  await emit({ kind: "summary", status: "error", title: "Objective verification failed", details: { blocker, changedFiles: verifiedChangedFiles } });
  return { passed: false, blocker };
}

function linkedBrowserReferences(files: FactoryUploadedFile[], type: "css" | "js") {
  return files.flatMap((file) => {
    const htmlDir = dirName(file.path);
    const expression =
      type === "css"
        ? /<link\b[^>]*href=["']([^"']+\.css(?:[?#][^"']*)?)["'][^>]*>/gi
        : /<script\b[^>]*src=["']([^"']+\.js(?:[?#][^"']*)?)["'][^>]*>\s*<\/script>/gi;
    return Array.from(file.content.matchAll(expression))
      .map((match) => match[1] ?? "")
      .filter((reference) => reference && !/^(https?:)?\/\//i.test(reference) && !reference.startsWith("#") && !reference.startsWith("data:"))
      .map((reference) => ({ htmlPath: file.path, reference, target: normalizeReferencePath(htmlDir, reference) }));
  });
}

function openFolderDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest<T = unknown>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function isUsefulPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)(node_modules|\.git|\.next|dist|build|coverage|target|bin|obj)(\/|$)/.test(normalized)) return false;
  if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|cargo\.lock)$/.test(normalized)) return true;
  return /\.(html|css|js|mjs|cjs|json|md|txt|ts|tsx|jsx|vue|svelte|py|php|cs|java|kt|kts|go|rs|rb|swift|dart|xml|toml|gradle|properties|yml|yaml)$/i.test(normalized);
}

function wantsAssetSeparation(text: string) {
  return /\b(separate|seperate|saparate|split|extract|move)\b/.test(text) || /\bseparat(?:e|ed|ing)?\s+files?\b/.test(text);
}

function isStylingRequest(text: string) {
  return /\b(style|styling|design|nicer|modern|polish|beautiful|responsive|mobile|ux|ui|form|bordered|color|colour|background|bg|green|red|blue|yellow|orange|purple|pink|black|white|gray|grey|button|buttons|input|inputs|header|heading|title|label|labels|cursor|pointer|hand|hover|clickable|rounded|radius|shadow|spacing|padding|margin|font|size)\b/.test(text);
}

function safeRelativePath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === ".." || part.includes(":"))) return "";
  return parts.join("/");
}

function detectBrowserProject(files: FactoryUploadedFile[]): BrowserProjectDetection {
  const paths = files.map((file) => file.path.replace(/\\/g, "/"));
  const lower = paths.map((filePath) => filePath.toLowerCase());
  const markers: string[] = [];
  const languages = new Set<string>();
  for (const filePath of lower) {
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) languages.add("TypeScript");
    if (filePath.endsWith(".js") || filePath.endsWith(".jsx") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) languages.add("JavaScript");
    if (filePath.endsWith(".cs")) languages.add("C#");
    if (filePath.endsWith(".java")) languages.add("Java");
    if (filePath.endsWith(".kt") || filePath.endsWith(".kts")) languages.add("Kotlin");
    if (filePath.endsWith(".py")) languages.add("Python");
    if (filePath.endsWith(".php")) languages.add("PHP");
    if (filePath.endsWith(".go")) languages.add("Go");
    if (filePath.endsWith(".rs")) languages.add("Rust");
    if (filePath.endsWith(".dart")) languages.add("Dart");
    if (filePath.endsWith(".gd")) languages.add("GDScript");
  }
  const entryFiles = paths.filter((filePath) => /(^|\/)(index|main|app)\.html$/i.test(filePath) || /\.html$/i.test(filePath)).slice(0, 8);
  const packageManager = lower.some((filePath) => filePath.endsWith("pnpm-lock.yaml"))
    ? "pnpm"
    : lower.some((filePath) => filePath.endsWith("yarn.lock"))
      ? "yarn"
      : lower.some((filePath) => filePath.endsWith("package-lock.json") || filePath.endsWith("package.json"))
        ? "npm"
        : "";
  let stack = "Unknown";
  if (lower.some((filePath) => /next\.config\.(js|mjs|ts)$/.test(filePath))) {
    stack = "Next.js";
    markers.push("next.config");
  } else if (lower.some((filePath) => /vite\.config\.(js|ts)$/.test(filePath))) {
    stack = "Vite";
    markers.push("vite.config");
  } else if (lower.some((filePath) => filePath.endsWith("angular.json"))) {
    stack = "Angular";
    markers.push("angular.json");
  } else if (lower.some((filePath) => filePath.endsWith("pubspec.yaml"))) {
    stack = "Flutter/Dart";
    markers.push("pubspec.yaml");
  } else if (lower.some((filePath) => filePath.endsWith("androidmanifest.xml") || filePath.endsWith("build.gradle") || filePath.endsWith("build.gradle.kts"))) {
    stack = "Android/Gradle";
    markers.push("Gradle/Android markers");
  } else if (lower.some((filePath) => filePath.endsWith(".sln") || filePath.endsWith(".csproj"))) {
    stack = ".NET/C#";
    markers.push(".sln/.csproj");
  } else if (lower.some((filePath) => filePath.endsWith("requirements.txt") || filePath.endsWith("pyproject.toml") || filePath.endsWith("manage.py"))) {
    stack = "Python";
    markers.push("Python project markers");
  } else if (lower.some((filePath) => filePath.endsWith("composer.json") || filePath.endsWith("artisan"))) {
    stack = "PHP/Laravel";
    markers.push("composer/artisan");
  } else if (lower.some((filePath) => filePath.endsWith("go.mod"))) {
    stack = "Go";
    markers.push("go.mod");
  } else if (lower.some((filePath) => filePath.endsWith("cargo.toml"))) {
    stack = "Rust";
    markers.push("Cargo.toml");
  } else if (lower.some((filePath) => filePath.endsWith("project.godot"))) {
    stack = "Godot";
    markers.push("project.godot");
  } else if (lower.some((filePath) => filePath.endsWith("package.json"))) {
    stack = "JavaScript project";
    markers.push("package.json");
  } else if (entryFiles.length) {
    stack = "Static HTML/CSS/JS";
    markers.push("HTML entry file");
  }

  return { stack, markers, primaryLanguages: Array.from(languages).sort(), entryFiles, packageManager };
}

function titleFromBrief(brief: string) {
  return firstMatch(brief, /^Create Project:\s*(.+)$/im);
}

function firstMatch(value: string, expression: RegExp) {
  return value.match(expression)?.[1]?.trim() ?? "";
}

function dirName(filePath: string) {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/");
}

function baseName(filePath: string) {
  return filePath.split("/").pop() || filePath;
}

function normalizeReferencePath(fromDir: string, reference: string) {
  if (/^(https?:)?\/\//i.test(reference) || reference.startsWith("data:")) return reference;
  const parts = [...fromDir.split("/"), ...reference.split(/[?#]/)[0].split("/")].filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function requestedAssetPath(task: string, extension: ".css" | ".js", htmlDir: string) {
  const escaped = extension.replace(".", "\\.");
  const matches = Array.from(task.matchAll(new RegExp(`(?:^|\\s|[\`"'])((?:[\\w.-]+\\/)*[\\w.-]+${escaped})(?=\\s|$|[\`"',.;:!?])`, "gi")))
    .map((match) => safeRelativePath(match[1] ?? ""))
    .filter(Boolean);
  const explicit = matches.find((filePath) => filePath.toLowerCase().endsWith(extension));
  if (!explicit) return "";
  if (explicit.includes("/")) return explicit;
  return htmlDir ? `${htmlDir}/${explicit}` : explicit;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markChecklist(checklist: FactoryObjectiveChecklistItem[], id: string, status: FactoryObjectiveChecklistItem["status"], evidence?: string) {
  const item = checklist.find((entry) => entry.id === id);
  if (!item) return;
  item.status = status;
  item.evidence = evidence;
}

function finishBrowserChecklist(checklist: FactoryObjectiveChecklistItem[], status: FactoryProjectResult["status"], blocker?: string) {
  for (const item of checklist) {
    if (item.status === "running") item.status = status === "passed" ? "completed" : "blocked";
    if (item.status === "pending" && status !== "passed") {
      item.status = "blocked";
      item.evidence = blocker || "Stopped because the objective could not be completed with the available live-folder executor.";
    }
  }
  markChecklist(checklist, "final-result", status === "passed" ? "completed" : "blocked", status === "passed" ? "Final summary maps to the requested goal." : blocker);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function selectorsForTask(task: string, html = "") {
  const text = task.toLowerCase();
  const selectors: string[] = [];
  selectors.push(...selectorsForMentionedElements(text, html));
  if (/\b(cursor|pointer|hand|clickable)\b/.test(text)) selectors.push(...interactiveSelectorsFromHtml(html));
  if (!selectors.length && /\bbackground|page|body\b/.test(text)) selectors.push("body");
  if (!selectors.length && cssDeclarationsForTask(task).length) selectors.push(...interactiveSelectorsFromHtml(html));
  return Array.from(new Set(selectors));
}

function cssDeclarationsForTask(task: string) {
  const declarations = explicitCssDeclarationsForTask(task);
  if (declarations.length) return declarations;
  return semanticCssDeclarationsForTask(task);
}

function explicitCssDeclarationsForTask(task: string) {
  const declarations: Array<{ property: string; value: string }> = [];
  const properties = supportedCssProperties().sort((a, b) => b.length - a.length);
  for (const property of properties) {
    const propertyWords = property.replace(/-/g, " ");
    const patterns = [
      new RegExp(`\\b${escapeRegExp(property)}\\b\\s*(?::|=|to|as|be|become)\\s*([^,.!?;]+)`, "i"),
      propertyWords === property ? null : new RegExp(`\\b${escapeRegExp(propertyWords)}\\b\\s*(?::|=|to|as|be|become)\\s*([^,.!?;]+)`, "i"),
    ].filter(Boolean) as RegExp[];
    const match = patterns.map((pattern) => task.match(pattern)).find(Boolean);
    if (!match?.[1]) continue;
    for (const candidate of cssValueCandidates(property, match[1])) {
      if (cssSupports(property, candidate)) {
        declarations.push({ property, value: candidate });
        break;
      }
    }
  }
  return dedupeCssDeclarations(declarations);
}

function semanticCssDeclarationsForTask(task: string) {
  const declarations: Array<{ property: string; value: string }> = [];
  const color = colorForTask(task);
  if (color) {
    declarations.push(
      { property: "background", value: color.value },
      { property: "color", value: readableTextColor(color.value) },
      { property: "border-color", value: color.value },
    );
  }
  if (/\b(cursor|pointer|hand|clickable)\b/i.test(task)) {
    declarations.push({ property: "cursor", value: "pointer" });
  }
  return dedupeCssDeclarations(declarations);
}

function dedupeCssDeclarations(declarations: Array<{ property: string; value: string }>) {
  return declarations.filter((declaration, index, all) =>
    all.findIndex((entry) => entry.property === declaration.property && entry.value === declaration.value) === index,
  );
}

function selectorsForMentionedElements(text: string, html: string) {
  if (!html) return [];
  const selectors: string[] = [];
  const elements = elementsFromHtml(html);
  for (const element of elements) {
    if (!mentionsElement(text, element.tag)) continue;
    selectors.push(element.tag, ...selectorsFromAttributes(element.attrs));
  }
  return selectors;
}

function interactiveSelectorsFromHtml(html: string) {
  if (!html) return [];
  const selectors: string[] = [];
  for (const element of elementsFromHtml(html)) {
    if (isInteractiveElement(element.tag, element.attrs)) selectors.push(element.tag, ...selectorsFromAttributes(element.attrs));
  }
  return selectors.length ? selectors : ["button", "a", "[role=\"button\"]"];
}

function elementsFromHtml(html: string) {
  return Array.from(html.matchAll(/<([a-z][\w:-]*)([^<>]*)>/gi))
    .filter((match) => !/^(script|style|meta|link|br|hr|img)$/i.test(match[1] ?? ""))
    .map((match) => ({ tag: (match[1] ?? "").toLowerCase(), attrs: match[2] ?? "" }));
}

function mentionsElement(text: string, tag: string) {
  const plural = tag.endsWith("s") ? tag : `${tag}s`;
  return new RegExp(`\\b(${escapeRegExp(tag)}|${escapeRegExp(plural)})\\b`, "i").test(text);
}

function isInteractiveElement(tag: string, attrs: string) {
  if (/^(a|button|summary|select|textarea)$/.test(tag)) return true;
  if (tag === "input" && !/\btype=(["']?)hidden\1/i.test(attrs)) return true;
  return /\b(onclick|role=(["']?)button\2|tabindex=|href=)/i.test(attrs);
}

function supportedCssProperties() {
  if (typeof document === "undefined") return fallbackCssProperties;
  const style = document.documentElement.style;
  const properties = Array.from(style).filter((property) => property && !property.startsWith("-"));
  return properties.length ? properties : fallbackCssProperties;
}

function cssValueCandidates(property: string, rawValue: string) {
  const cleaned = rawValue
    .toLowerCase()
    .replace(/\b(instead of|rather than|not)\b[\s\S]*$/i, "")
    .replace(/\bplease\b/g, "")
    .trim();
  const firstToken = cleaned.split(/\s+/)[0] ?? "";
  return Array.from(new Set([
    cleaned,
    cssNaturalValueAlias(property, cleaned),
    firstToken,
    cssNaturalValueAlias(property, firstToken),
  ].filter(Boolean)));
}

function cssNaturalValueAlias(property: string, value: string) {
  if (property === "cursor" && /\b(hand|clickable)\b/i.test(value)) return "pointer";
  if (property === "cursor" && /\barrow\b/i.test(value)) return "default";
  return value;
}

function cssSupports(property: string, value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") return CSS.supports(property, value);
  return Boolean(property && value);
}

const fallbackCssProperties = [
  "accent-color",
  "align-items",
  "background",
  "background-color",
  "border",
  "border-color",
  "border-radius",
  "box-shadow",
  "color",
  "cursor",
  "display",
  "font",
  "font-size",
  "font-weight",
  "gap",
  "height",
  "justify-content",
  "line-height",
  "margin",
  "max-width",
  "min-height",
  "opacity",
  "padding",
  "text-align",
  "text-decoration",
  "transform",
  "transition",
  "width",
];

function selectorsFromAttributes(attrs: string) {
  const selectors: string[] = [];
  const id = attrs.match(/\bid=(["'])([\s\S]*?)\1/i)?.[2] ?? attrs.match(/\bid=([^\s>]+)/i)?.[1] ?? "";
  const classValue = attrs.match(/\bclass=(["'])([\s\S]*?)\1/i)?.[2] ?? attrs.match(/\bclass=([^\s>]+)/i)?.[1] ?? "";
  if (id) selectors.push(cssIdSelector(id));
  for (const className of classValue.split(/\s+/).filter(Boolean).slice(0, 4)) {
    selectors.push(cssClassSelector(className));
  }
  return selectors;
}

function cssIdSelector(value: string) {
  return /^[A-Za-z_][\w-]*$/.test(value) ? `#${value}` : `[id="${escapeCssString(value)}"]`;
}

function cssClassSelector(value: string) {
  return /^[A-Za-z_][\w-]*$/.test(value) ? `.${value}` : `[class~="${escapeCssString(value)}"]`;
}

function escapeCssString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function colorForTask(task: string) {
  const text = task.toLowerCase();
  const named: Record<string, string> = {
    green: "#16a34a",
    red: "#dc2626",
    blue: "#2563eb",
    yellow: "#ca8a04",
    orange: "#ea580c",
    purple: "#7c3aed",
    pink: "#db2777",
    black: "#111827",
    white: "#ffffff",
    gray: "#6b7280",
    grey: "#6b7280",
  };
  const hex = text.match(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i)?.[0];
  if (hex) return { name: hex, value: hex };
  const name = Object.keys(named).find((entry) => new RegExp(`\\b${entry}\\b`, "i").test(task));
  return name ? { name, value: named[name] } : null;
}

function readableTextColor(background: string) {
  const normalized = background.replace("#", "");
  const hex = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#ffffff";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111827" : "#ffffff";
}

function pauseForLiveStream() {
  return new Promise((resolve) => window.setTimeout(resolve, 90));
}
