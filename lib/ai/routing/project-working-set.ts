import type { ProjectAccess } from "@/lib/ai/mission/project-access";

export type ProjectWorkingSet = {
  projectFileCount: number;
  likelyFiles: string[];
  estimatedSubsystems: number;
  crossLayer: boolean;
  projectWide: boolean;
  evidence: string[];
};

const TERMS_TO_IGNORE = new Set([
  "this", "that", "with", "from", "into", "after", "make", "change", "update", "build", "fix", "add", "edit", "editing", "implement", "proceed", "project", "require", "user", "not", "the", "and", "for",
]);
const GENERATED_PATH_PATTERN = /(^|\/)(node_modules|\.git|\.next|\.next-build|\.turbo|\.cache|\.pytest_cache|__pycache__|\.mypy_cache|\.ruff_cache|\.tox|\.nox|\.venv|venv|site-packages|dist|build|out|coverage|target|bin|obj)(\/|$)/i;
const INDEX_TTL_MS = 60_000;
const repositoryIndexCache = new Map<string, { expiresAt: number; root: Awaited<ReturnType<ProjectAccess["listDir"]>>; fileCount: number; searches: Map<string, Awaited<ReturnType<NonNullable<ProjectAccess["searchFiles"]>>>> }>();

export async function discoverProjectWorkingSet(access: ProjectAccess, task: string): Promise<ProjectWorkingSet> {
  let index = repositoryIndexCache.get(access.rootLabel);
  if (!index || index.expiresAt < Date.now()) {
    const root = await access.listDir("");
    index = { expiresAt: Date.now() + INDEX_TTL_MS, root, fileCount: await estimateFileCount(access, root), searches: new Map() };
    repositoryIndexCache.set(access.rootLabel, index);
  }
  const terms = [...new Set(task.toLowerCase().replace(/[^a-z0-9_.-]+/g, " ").split(/\s+/).filter((term) => term.length >= 3 && !TERMS_TO_IGNORE.has(term)))].slice(0, 8);
  const hits = access.searchFiles
    ? (await Promise.all(terms.map(async (term) => {
        const cached = index.searches.get(term);
        if (cached) return cached;
        const found = await access.searchFiles!(term, { maxResults: 12 }).catch(() => []);
        index.searches.set(term, found);
        return found;
      }))).flat()
    : [];
  const sourceHits = hits.filter((hit) => !GENERATED_PATH_PATTERN.test(hit.path.replace(/\\/g, "/")));
  const behavioralTask = /\b(?:click|button|form|upload|process|interaction|handler|submit|navigate|open|close|enable|disable)\b/i.test(task);
  const hitCounts = new Map<string, { count: number; first: number }>();
  sourceHits.forEach((hit, index) => {
    const current = hitCounts.get(hit.path);
    hitCounts.set(hit.path, current ? { count: current.count + 1, first: current.first } : { count: 1, first: index });
  });
  const likelyFiles = Array.from(hitCounts.entries())
    .sort(([leftPath, left], [rightPath, right]) => {
      const score = (filePath: string, value: { count: number }) => value.count * 10
        + (behavioralTask && /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html)$/i.test(filePath) ? 8 : 0)
        - (/\.(?:md|mdx|rst|txt)$/i.test(filePath) ? 12 : 0);
      return score(rightPath, right) - score(leftPath, left) || left.first - right.first;
    })
    .map(([filePath]) => filePath)
    .slice(0, 30);
  const topDirectories = new Set(likelyFiles.map((file) => file.replace(/\\/g, "/").split("/")[0]).filter(Boolean));
  const layers = new Set(likelyFiles.map(layerForPath).filter(Boolean));
  const projectWide = /\b(entire|whole|all files|project-wide|system-wide|design system|migrate|migration)\b/i.test(task);
  return {
    projectFileCount: index.fileCount,
    likelyFiles,
    estimatedSubsystems: Math.max(1, topDirectories.size),
    crossLayer: layers.size >= 2,
    projectWide,
    evidence: sourceHits.slice(0, 12).map((hit) => `${hit.path}${hit.line ? `:${hit.line}` : ""}`),
  };
}

async function estimateFileCount(access: ProjectAccess, root: Awaited<ReturnType<ProjectAccess["listDir"]>>) {
  let count = root.filter((entry) => entry.kind === "file").length;
  for (const directory of root.filter((entry) => entry.kind === "directory" && !GENERATED_PATH_PATTERN.test(`${entry.name}/`)).slice(0, 40)) {
    const children = await access.listDir(directory.name).catch(() => []);
    count += children.filter((entry) => entry.kind === "file").length;
    count += children.filter((entry) => entry.kind === "directory").length * 5;
  }
  return count;
}

function layerForPath(file: string) {
  const normalized = file.toLowerCase();
  if (/\b(api|server|backend|routes?)\b/.test(normalized)) return "api";
  if (/\b(db|database|prisma|migrations?|models?)\b/.test(normalized)) return "data";
  if (/\b(ui|components?|pages?|frontend|app)\b/.test(normalized)) return "ui";
  if (/\b(infra|deploy|terraform|docker|k8s)\b/.test(normalized)) return "infra";
  return "core";
}
