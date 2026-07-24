import { afterAll, describe, expect, it } from "vitest";
import { rm, readdir } from "node:fs/promises";
import { materializeUploadedProjectForPreview, stopPreviewForProject } from "@/lib/factory/runtime";

const stamp = Date.now();
const files = [
  { path: `intake-probe-${stamp}/index.html`, content: `<!doctype html><title>Uploaded Site</title><link rel="stylesheet" href="/styles.css"><h1>Hello from the uploaded project</h1>`, size: 1 },
  { path: `intake-probe-${stamp}/styles.css`, content: `body{color:#0aa}`, size: 1 },
  { path: `intake-probe-${stamp}/public/data/seed.json`, content: `{"ok":true}`, size: 1 },
] as never;

let created = "";
let createdId = "";
afterAll(async () => {
  if (createdId) stopPreviewForProject(createdId);
  await new Promise((r) => setTimeout(r, 600));
  if (created) await rm(created, { recursive: true, force: true }).catch(() => undefined);
});

describe("upload intake", () => {
  it("materializes a copy and previews it immediately", async () => {
    const first = await materializeUploadedProjectForPreview(files, "Existing Project");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    created = first.projectPath;
    createdId = first.projectId;

    console.log("projectPath:", first.projectPath);
    console.log("root entries:", await readdir(first.projectPath));
    console.log("preview:", first.previewState, first.previewUrl);

    // The picked folder must not wrap the copy — the copy's root is the project's root.
    expect(await readdir(first.projectPath)).toContain("index.html");
    expect(await readdir(first.projectPath)).not.toContain("upload-intake.json");
    expect(first.previewState).toBe("ready");

    const page = await fetch(first.previewUrl!);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Hello from the uploaded project");

    // A root-absolute reference from the uploaded page resolves.
    const css = await fetch(new URL("/styles.css", first.previewUrl!));
    console.log("/styles.css ->", css.status);
    expect(css.status).toBe(200);

    // ...including one that lives under the project's public/ web root.
    const seed = await fetch(new URL("/data/seed.json", first.previewUrl!));
    console.log("/data/seed.json ->", seed.status);
    expect(seed.status).toBe(200);

    // The first mission must land in this copy, not fork a second one.
    const second = await materializeUploadedProjectForPreview(files, "A Completely Different Name");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.projectPath).toBe(first.projectPath);
    expect(second.reusedIntakeCopy).toBe(true);
  }, 60_000);
});
