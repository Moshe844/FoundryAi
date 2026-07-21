/**
 * Detects duplicate and conflicting source files left behind when a build fails partway and resumes.
 *
 * Each failed batch writes files, then the resume — not perfectly reconciled with the partial output —
 * writes them again in a slightly different place or name. Observed on a SwiftUI app: THREE `@main`
 * entry points, two `ContentView.swift`, two `HistoryView.swift`, and a root-level structure duplicating
 * the nested one. Three `@main` structs is a guaranteed compile error; the project cannot build.
 *
 * Two failure modes, handled differently by safety:
 *  - **Byte-identical duplicates** are safe to collapse to one copy automatically.
 *  - **Divergent duplicates** (same role, different content) must be *flagged*, never auto-deleted —
 *    deleting the wrong 248-line implementation in favor of a 14-line stub destroys real work. The
 *    caller resolves these with knowledge the file system alone doesn't have.
 */

export type ProjectFile = { path: string; content: string };

// Basenames that legitimately repeat across a project and must never be treated as duplicates.
// This includes framework file-conventions where per-folder repetition IS the design — a Next.js App
// Router app has one page.tsx per route, a SvelteKit app one +page.svelte per route. Flagging those as
// "duplicates" failed correctly-structured projects (observed: a Next.js app reported "10 duplicate
// page.tsx"). The production build is the real arbiter of genuine file conflicts.
const LEGITIMATELY_REPEATED = new Set([
  "index.ts", "index.tsx", "index.js", "index.jsx", "index.html", "index.css",
  "mod.rs", "lib.rs", "main.rs", "__init__.py", "types.ts", "utils.ts", "styles.css",
  "contents.json", "package.json", "readme.md", "dockerfile", "makefile", ".gitignore",
  // Next.js App Router / Pages Router conventions — one per route folder by design.
  "page.tsx", "page.jsx", "page.ts", "page.js", "layout.tsx", "layout.jsx", "layout.ts", "layout.js",
  "route.ts", "route.js", "loading.tsx", "loading.jsx", "error.tsx", "error.jsx", "not-found.tsx",
  "template.tsx", "default.tsx", "actions.ts", "actions.tsx", "middleware.ts", "head.tsx", "opengraph-image.tsx",
  "sitemap.ts", "robots.ts", "manifest.ts",
  // SvelteKit / Remix / Astro / Nuxt route conventions.
  "+page.svelte", "+page.ts", "+page.js", "+layout.svelte", "+layout.ts", "+server.ts", "+error.svelte",
]);

// One line-based "this file is an application entry point" marker per language. More than one file
// carrying the marker for the same stack is a build-breaking conflict, not extra content.
const ENTRY_POINT_MARKERS: { extensions: string[]; label: string; pattern: RegExp }[] = [
  { extensions: [".swift"], label: "SwiftUI @main app", pattern: /^\s*@main\b/m },
  { extensions: [".py"], label: 'Python `__main__` entry', pattern: /^\s*if\s+__name__\s*==\s*["']__main__["']\s*:/m },
  { extensions: [".kt"], label: "Kotlin main()", pattern: /\bfun\s+main\s*\(/ },
  { extensions: [".go"], label: "Go main()", pattern: /^\s*func\s+main\s*\(\s*\)\s*\{/m },
  { extensions: [".rs"], label: "Rust main()", pattern: /^\s*fn\s+main\s*\(\s*\)/m },
  { extensions: [".cs"], label: "C# top-level/Main entry", pattern: /\bstatic\s+(?:async\s+)?(?:void|Task|int)\s+Main\s*\(/ },
];

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function extension(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

export type DuplicateFinding = {
  kind: "entry-point-conflict" | "duplicate-basename" | "identical-duplicate";
  /** Files involved, most-complete (largest) first so a caller can prefer the substantive one. */
  paths: string[];
  detail: string;
  /** True only when every file in the group is byte-identical — the sole case safe to auto-collapse. */
  autoCollapsible: boolean;
};

/** Groups files by an equality/role key, returning only the groups with more than one member. */
function groupsOf<T>(files: ProjectFile[], key: (file: ProjectFile) => T | undefined): Map<T, ProjectFile[]> {
  const groups = new Map<T, ProjectFile[]>();
  for (const file of files) {
    const k = key(file);
    if (k === undefined) continue;
    const list = groups.get(k) ?? [];
    list.push(file);
    groups.set(k, list);
  }
  for (const [k, list] of groups) if (list.length < 2) groups.delete(k);
  return groups;
}

const byContentLengthDesc = (a: ProjectFile, b: ProjectFile) => b.content.length - a.content.length;

export function detectDuplicateFiles(files: ProjectFile[]): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  const seen = new Set<string>();

  // 1. Entry-point conflicts — the build-breaking case. Per language, more than one entry file.
  for (const marker of ENTRY_POINT_MARKERS) {
    const entries = files.filter((file) => marker.extensions.includes(extension(file.path)) && marker.pattern.test(file.content));
    if (entries.length < 2) continue;
    const paths = entries.sort(byContentLengthDesc).map((file) => file.path);
    paths.forEach((path) => seen.add(path));
    findings.push({
      kind: "entry-point-conflict",
      paths,
      detail: `${entries.length} ${marker.label} entry points exist; a project can have exactly one. Keep a single entry point and remove the rest.`,
      autoCollapsible: false,
    });
  }

  // 2. Identical duplicates — same bytes in more than one path. Always safe to collapse to one.
  for (const [, group] of groupsOf(files, (file) => file.content.trim() && file.content.length > 0 ? file.content : undefined)) {
    if (group.length < 2) continue;
    if (group.some((file) => seen.has(file.path))) continue;
    const paths = group.map((file) => file.path).sort();
    paths.forEach((path) => seen.add(path));
    findings.push({
      kind: "identical-duplicate",
      paths,
      detail: `${group.length} byte-identical copies of the same file. Keep one and remove the others.`,
      autoCollapsible: true,
    });
  }

  // 3. Divergent duplicate basenames — same filename in different directories, different content.
  for (const [name, group] of groupsOf(files, (file) => basename(file.path).toLowerCase())) {
    if (LEGITIMATELY_REPEATED.has(name)) continue;
    const unseen = group.filter((file) => !seen.has(file.path));
    if (unseen.length < 2) continue;
    const paths = unseen.sort(byContentLengthDesc).map((file) => file.path);
    paths.forEach((path) => seen.add(path));
    findings.push({
      kind: "duplicate-basename",
      paths,
      detail: `${unseen.length} files named "${basename(paths[0])}" in different folders with different content — likely one real implementation and leftover copies from an interrupted build. Consolidate into one.`,
      autoCollapsible: false,
    });
  }

  return findings;
}

/**
 * The subset of duplicates safe to remove with no judgement: byte-identical extras. Returns the paths
 * to delete (keeping one canonical copy per group — the shortest path, i.e. the least nested). Divergent
 * conflicts are deliberately excluded; collapsing those requires knowing which copy is real.
 */
export function safelyRemovableDuplicatePaths(files: ProjectFile[]): string[] {
  const remove: string[] = [];
  for (const finding of detectDuplicateFiles(files)) {
    if (!finding.autoCollapsible) continue;
    const keep = [...finding.paths].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    for (const path of finding.paths) if (path !== keep) remove.push(path);
  }
  return remove;
}

/**
 * A build-BLOCKING problem, or undefined. Only entry-point conflicts qualify: multiple `@main`/`main()`
 * genuinely cannot compile in any language, so failing on them is safe. Divergent same-basename files
 * are a *heuristic* guess about resume-drift — in a Next.js/SvelteKit/Remix app they are the normal
 * per-route convention — so they must NEVER fail a build. The production compiler is the real arbiter of
 * genuine file conflicts; this check only pre-empts the one class the compiler's error is cryptic about.
 */
export function duplicateFileProblem(files: ProjectFile[]): string | undefined {
  const blocking = detectDuplicateFiles(files).filter((finding) => finding.kind === "entry-point-conflict");
  if (!blocking.length) return undefined;
  return `The generated project has conflicting entry points and will not compile as-is. ${blocking.map((finding) => finding.detail).join(" ")}`;
}

/** Advisory, non-blocking duplicate observations (divergent same-basename files) for logging/telemetry
 * only — deliberately separate from duplicateFileProblem so a heuristic guess can never fail a build. */
export function advisoryDuplicateFindings(files: ProjectFile[]): string[] {
  return detectDuplicateFiles(files)
    .filter((finding) => finding.kind === "duplicate-basename")
    .map((finding) => finding.detail);
}
