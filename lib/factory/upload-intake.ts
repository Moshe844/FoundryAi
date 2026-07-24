import { createHash } from "node:crypto";

/**
 * Identity for a browser-uploaded project copy.
 *
 * A browser upload has no writable handle on the user's disk, so Foundry works on a copy inside its
 * own workspace. That copy is now created the moment the folder is picked — so the preview can show
 * the project immediately — which means two independent code paths (upload intake, and the first
 * mission) must agree on *one* folder. If they disagree the user gets a second copy and edits land
 * somewhere other than the folder they are watching.
 *
 * They agree by writing and matching a marker file: same upload contents plus same project name
 * means the same copy, and anything else falls back to allocating a fresh one.
 */

/**
 * Lives under `.foundry-artifacts/` because every project-file listing, stack detector, and search
 * in the codebase already ignores that directory — the marker is Foundry's bookkeeping and should
 * not appear to the user as a file in their project.
 */
export const uploadIntakeMarkerFile = ".foundry-artifacts/upload-intake.json";

export type UploadIntakeMarker = {
  version: 1;
  fingerprint: string;
  projectName: string;
  fileCount: number;
  createdAt: string;
};

/**
 * Content identity of an upload. Paths and sizes, not bytes: it must be cheap enough to run on every
 * intake, and two folders that agree on every path and length are the same project for this purpose.
 * Order-independent, so a differently-ordered file list is still recognised as the same upload.
 */
export function uploadIntakeFingerprint(files: Array<{ path: string; content: string }>): string {
  const digest = createHash("sha256");
  const normalized = files
    .map((file) => `${file.path.replace(/\\/g, "/").toLowerCase()}:${file.content.length}`)
    .sort();
  for (const entry of normalized) {
    digest.update(entry);
    digest.update("\0");
  }
  return digest.digest("hex");
}

export function buildUploadIntakeMarker(files: Array<{ path: string; content: string }>, projectName: string): UploadIntakeMarker {
  return {
    version: 1,
    fingerprint: uploadIntakeFingerprint(files),
    projectName,
    fileCount: files.length,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Whether an existing copy on disk was materialized by intake from exactly this upload.
 *
 * Matched on content alone. Intake runs before the project brief exists, so it cannot know the
 * display name the mission will later derive from that brief — keying identity on the name meant
 * the two disagreed and the user got a second copy while watching the first one in the preview.
 * The name is recorded in the marker for humans reading the folder, and ignored here.
 */
export function uploadIntakeMarkerMatches(raw: string | undefined, files: Array<{ path: string; content: string }>): boolean {
  if (!raw) return false;
  let marker: Partial<UploadIntakeMarker>;
  try {
    marker = JSON.parse(raw) as Partial<UploadIntakeMarker>;
  } catch {
    return false;
  }
  return marker.version === 1 && marker.fingerprint === uploadIntakeFingerprint(files);
}
