import path from "node:path";

const IMPLEMENTATION_EXTENSIONS = new Set([
  ".astro", ".c", ".cc", ".cpp", ".cs", ".dart", ".fs", ".gd", ".go", ".html",
  ".java", ".js", ".jsx", ".kt", ".kts", ".lua", ".php", ".py", ".rb", ".rs",
  ".svelte", ".swift", ".ts", ".tsx", ".unity", ".vue",
]);

const ROOT_SCAFFOLD_FILES = new Set([
  "app/layout.js", "app/layout.jsx", "app/layout.ts", "app/layout.tsx",
  "src/app/layout.js", "src/app/layout.jsx", "src/app/layout.ts", "src/app/layout.tsx",
  "src/layout.js", "src/layout.jsx", "src/layout.ts", "src/layout.tsx",
]);

/**
 * Whether a changed path can contain product behavior or a real user-facing surface.
 *
 * A clean package build only proves that the files on disk compile. Framework metadata, a root
 * layout, and global CSS are useful scaffolding, but they do not prove that a product exists.
 */
export function isProductImplementationPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").toLowerCase();
  if (!normalized || normalized.includes("/node_modules/") || normalized.startsWith("node_modules/")) return false;
  if (ROOT_SCAFFOLD_FILES.has(normalized)) return false;

  const base = path.posix.basename(normalized);
  if (
    base === "foundry-brief.md"
    || base === "package.json"
    || base === "package-lock.json"
    || base === "npm-shrinkwrap.json"
    || base === "pnpm-lock.yaml"
    || base === "yarn.lock"
    || base === "bun.lock"
    || base === "bun.lockb"
    || base === "next-env.d.ts"
    || base === "readme.md"
    || base === "license"
    || base === ".gitignore"
    || /^tsconfig(?:\..+)?\.json$/.test(base)
    || /^(?:next|vite|vitest|jest|eslint|prettier|postcss|tailwind|webpack|rollup|babel|metro)\.config\./.test(base)
    || /\.(?:css|scss|sass|less|styl)$/.test(base)
    || /\.(?:md|mdx|txt|lock|log|map)$/.test(base)
    || /\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)$/.test(base)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(base)
  ) return false;

  return IMPLEMENTATION_EXTENSIONS.has(path.posix.extname(base));
}

export function productImplementationFiles(filePaths: string[]): string[] {
  return [...new Set(filePaths.filter(isProductImplementationPath))];
}

export function hasProductImplementationEvidence(filePaths: string[]): boolean {
  return productImplementationFiles(filePaths).length > 0;
}
