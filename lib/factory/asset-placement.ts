/**
 * Where an uploaded asset must physically live so that the URL Foundry hands the model actually
 * resolves in the preview.
 *
 * This is the seam a real bug came through: static HTML projects are served straight from the
 * project folder, but their assets were written under `public/` while the model was told the URL
 * was `/foundry-uploads/<file>`. Every generated page then 404'd on the user's own uploaded logo,
 * which surfaced as "visibly broken image(s)", failed browser verification, and ended otherwise
 * healthy missions in "Ready to continue". The directory and the served URL must be decided
 * together, by the same rule, which is why they live in one function.
 */
export type AttachedAssetPlacement = {
  /** Project-relative directory the bytes are written to. */
  directory: string;
  /** True when that directory sits under the stack's web root, so the asset has an absolute URL. */
  servedFromWebRoot: boolean;
};

/** Stacks whose preview serves the project folder itself — a `public/` prefix here is a 404. */
const rootServedStacks = /^(?:static-html|phaser)/i;

/** Stacks that serve `public/` at the web root, so `public/x/y.png` is requested as `/x/y.png`. */
const publicDirectoryStacks = /^(?:nextjs|react|vite|astro|remix|svelte|vue|angular)/i;

export function attachedAssetPlacement(stackId: string): AttachedAssetPlacement {
  if (rootServedStacks.test(stackId)) return { directory: "foundry-uploads", servedFromWebRoot: true };
  if (publicDirectoryStacks.test(stackId)) return { directory: "public/foundry-uploads", servedFromWebRoot: true };
  // Non-web stacks (mobile, desktop, backend) have no web root; the project path is the reference.
  return { directory: "assets/foundry-uploads", servedFromWebRoot: false };
}

/** The reference a generated page should use for an asset written at `projectPath`. */
export function attachedAssetPublicPath(projectPath: string, placement: AttachedAssetPlacement): string {
  return placement.servedFromWebRoot ? `/${projectPath.replace(/^public\//, "")}` : projectPath;
}
