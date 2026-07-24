import { afterAll, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { materializeUploadedProjectForPreview, stopPreviewForProject } from "@/lib/factory/runtime";

const stamp = Date.now();
const created: string[] = [];
const ids: string[] = [];
afterAll(async () => {
  for (const id of ids) stopPreviewForProject(id);
  await new Promise((r) => setTimeout(r, 800));
  for (const dir of created) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

// A plain node server so the fixture needs no dependencies; `npm start` runs it.
const apiServer = `const http=require("http");http.createServer((q,s)=>{s.writeHead(200,{"content-type":"application/json"});s.end(JSON.stringify({success:true,message:"Server is running"}))}).listen(process.env.PORT||3000);`;
const pageServer = `const http=require("http");const fs=require("fs");const p=require("path");http.createServer((q,s)=>{s.writeHead(200,{"content-type":"text/html; charset=utf-8"});s.end(fs.readFileSync(p.join(__dirname,"index.html")))}).listen(process.env.PORT||3000);`;
const page = `<!doctype html><title>My Page</title><h1>This is my actual page</h1>`;

async function fixture(name: string, server: string, withPage: boolean) {
  const files = [
    { path: `${name}/package.json`, content: JSON.stringify({ name, version: "1.0.0", scripts: { start: "node server.js" } }), size: 1 },
    { path: `${name}/server.js`, content: server, size: 1 },
    ...(withPage ? [{ path: `${name}/index.html`, content: page, size: 1 }] : []),
  ] as never;
  const result = await materializeUploadedProjectForPreview(files, name);
  if (result.ok) { created.push(result.projectPath); ids.push(result.projectId); }
  return result;
}

describe("server.js vs index.html", () => {
  it("shows the page and says so when the server is an unrelated API", async () => {
    const r = await fixture(`surface-api-page-${stamp}`, apiServer, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    console.log("[api+page] state:", r.previewState, "platform:", r.previewPlatform, "url:", r.previewUrl);
    console.log("[api+page] reason:", r.previewReason);
    expect(r.previewState).toBe("ready");
    expect(r.previewReason).toMatch(/two separate things/i);
    expect(r.previewReason).toMatch(/does not serve index\.html/i);
    const page = await fetch(r.previewUrl!);
    expect(await page.text()).toContain("This is my actual page");
  }, 90_000);

  it("keeps the server as the preview when it does serve the page", async () => {
    const r = await fixture(`surface-linked-${stamp}`, pageServer, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    console.log("[linked] state:", r.previewState, "platform:", r.previewPlatform, "url:", r.previewUrl);
    console.log("[linked] reason:", r.previewReason ?? "(none - correct)");
    expect(r.previewState).toBe("ready");
    expect(r.previewPlatform).toBe("web");
    expect(r.previewReason).toBeUndefined();
  }, 90_000);

  it("offers the API playground when there is no page at all", async () => {
    const r = await fixture(`surface-api-only-${stamp}`, apiServer, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    console.log("[api only] platform:", r.previewPlatform);
    console.log("[api only] reason:", r.previewReason);
    expect(r.previewPlatform).toBe("api");
    expect(r.previewReason).toMatch(/no HTML entry file/i);
  }, 90_000);
});
