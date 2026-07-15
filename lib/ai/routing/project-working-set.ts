import type { ProjectAccess } from "@/lib/ai/mission/project-access";

export type ProjectWorkingSet = {
  projectFileCount: number;
  likelyFiles: string[];
  estimatedSubsystems: number;
  crossLayer: boolean;
  projectWide: boolean;
  evidence: string[];
};

const TERMS_TO_IGNORE = new Set(["this", "that", "with", "from", "into", "make", "change", "update", "build", "fix", "add", "the", "and", "for"]);
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
  const likelyFiles = [...new Set(hits.map((hit) => hit.path))].slice(0, 30);
  const topDirectories = new Set(likelyFiles.map((file) => file.replace(/\\/g, "/").split("/")[0]).filter(Boolean));
  const layers = new Set(likelyFiles.map(layerForPath).filter(Boolean));
  const projectWide = /\b(entire|whole|all files|project-wide|system-wide|design system|migrate|migration)\b/i.test(task);
  return {
    projectFileCount: index.fileCount,
    likelyFiles,
    estimatedSubsystems: Math.max(1, topDirectories.size),
    crossLayer: layers.size >= 2,
    projectWide,
    evidence: hits.slice(0, 12).map((hit) => `${hit.path}${hit.line ? `:${hit.line}` : ""}`),
  };
}

async function estimateFileCount(access: ProjectAccess, root: Awaited<ReturnType<ProjectAccess["listDir"]>>) {
  let count = root.filter((entry) => entry.kind === "file").length;
  for (const directory of root.filter((entry) => entry.kind === "directory").slice(0, 40)) {
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
