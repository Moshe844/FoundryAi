import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deployVerifiedStaticSite, resolvePublishDirectory } from "@/lib/integrations/hosting-deployment";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function project(files: Record<string, string>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "foundry-deploy-"));
  temporaryDirectories.push(directory);
  await Promise.all(Object.entries(files).map(async ([name, content]) => {
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }));
  return directory;
}

describe("production hosting deployment", () => {
  it("prefers verified build output over source files", async () => {
    const directory = await project({ "index.html": "source", "dist/index.html": "built" });
    await expect(resolvePublishDirectory(directory)).resolves.toBe(path.join(directory, "dist"));
  });

  it("refuses projects without a static entrypoint", async () => {
    const directory = await project({ "README.md": "not a website" });
    await expect(deployVerifiedStaticSite({
      provider: "vercel",
      credential: { token: "verified" },
      projectPath: directory,
      projectName: "Missing site",
    })).rejects.toThrow("No deployable static output");
  });

  it("publishes to Vercel production and verifies the returned URL", async () => {
    const directory = await project({ "dist/index.html": "<!doctype html><title>Live</title>" });
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/v2/files") && init?.method === "POST") {
        expect(new Headers(init.headers).get("x-vercel-digest")).toMatch(/^[a-f0-9]{40}$/);
        expect(init.body).toBeInstanceOf(Buffer);
        return Response.json({});
      }
      if (target.endsWith("/v13/deployments") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.target).toBe("production");
        expect(body.files[0]).toMatchObject({ file: "index.html", size: expect.any(Number), sha: expect.stringMatching(/^[a-f0-9]{40}$/) });
        return Response.json({ id: "deployment-1", url: "site.vercel.app", projectId: "project-1" });
      }
      if (target.includes("/v13/deployments/deployment-1")) return Response.json({ readyState: "READY", url: "site.vercel.app", projectId: "project-1" });
      if (target === "https://site.vercel.app") return new Response("<!doctype html><title>Live</title>");
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", request);
    const deployment = await deployVerifiedStaticSite({
      provider: "vercel",
      credential: { token: "verified" },
      projectPath: directory,
      projectName: "A Real Site",
    });
    expect(deployment).toMatchObject({ provider: "vercel", production: true, state: "ready", verificationStatus: "verified", url: "https://site.vercel.app" });
  });

  it("creates a Netlify site, deploys a zip, and verifies production", async () => {
    const directory = await project({ "index.html": "<html><title>Netlify</title></html>", "assets/app.js": "true" });
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/api/v1/sites") && init?.method === "POST") return Response.json({ id: "site-1", ssl_url: "https://site.netlify.app" });
      if (target.includes("/sites/site-1/deploys?production=true")) {
        expect(init?.headers).toMatchObject({ "content-type": "application/zip" });
        expect(init?.body).toBeInstanceOf(Buffer);
        return Response.json({ id: "deploy-1", admin_url: "https://app.netlify.com/sites/site-1" });
      }
      if (target.includes("/sites/site-1/deploys/deploy-1")) return Response.json({ state: "ready", ssl_url: "https://site.netlify.app" });
      if (target === "https://site.netlify.app") return new Response("<html><title>Netlify</title></html>");
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", request);
    const deployment = await deployVerifiedStaticSite({
      provider: "netlify",
      credential: { token: "verified" },
      projectPath: directory,
      projectName: "A Real Site",
    });
    expect(deployment).toMatchObject({ provider: "netlify", siteId: "site-1", production: true, verificationStatus: "verified", url: "https://site.netlify.app" });
  });
});
