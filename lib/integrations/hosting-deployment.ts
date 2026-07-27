import "server-only";

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import type { FactoryDeployment } from "@/lib/factory/types";

export type HostingProvider = FactoryDeployment["provider"];
export type HostingDeploymentInput = {
  provider: HostingProvider;
  credential: { token: string };
  projectPath: string;
  projectName: string;
  existingProjectId?: string;
  existingSiteId?: string;
  teamId?: string;
};

type PublishFile = { path: string; bytes: Uint8Array };
const IGNORED_SEGMENTS = new Set([".git", ".next", ".foundry-artifacts", "node_modules"]);
const MAX_FILES = 25_000;
const MAX_BYTES = 100 * 1024 * 1024;

export async function resolvePublishDirectory(projectPath: string) {
  for (const candidate of ["dist", "out", "build", "."]) {
    const directory = path.resolve(projectPath, candidate);
    try {
      if ((await stat(path.join(directory, "index.html"))).isFile()) return directory;
    } catch {
      // Try the next conventional static output directory.
    }
  }
  throw new Error("No deployable static output was found. Foundry requires index.html in dist, out, build, or the project root after verification.");
}

async function collectPublishFiles(directory: string): Promise<PublishFile[]> {
  const files: PublishFile[] = [];
  let totalBytes = 0;
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_SEGMENTS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = new Uint8Array(await readFile(absolute));
      totalBytes += bytes.byteLength;
      if (files.length >= MAX_FILES || totalBytes > MAX_BYTES) {
        throw new Error("The deployment output exceeds Foundry's safe direct-upload limit (25,000 files or 100 MB).");
      }
      files.push({ path: path.relative(directory, absolute).replace(/\\/g, "/"), bytes });
    }
  }
  await walk(directory);
  if (!files.length) throw new Error("The deployable output directory is empty.");
  return files;
}

function providerError(provider: HostingProvider, response: Response, body: unknown) {
  const payload = body as { error?: { message?: string }; message?: string } | undefined;
  return new Error(`${provider === "vercel" ? "Vercel" : "Netlify"} rejected the deployment: ${payload?.error?.message || payload?.message || `HTTP ${response.status}`}`);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "foundry-site";
}

export async function deployVerifiedStaticSite(input: HostingDeploymentInput): Promise<FactoryDeployment> {
  if (!input.credential.token) throw new Error("A verified hosting credential is required.");
  const directory = await resolvePublishDirectory(input.projectPath);
  const files = await collectPublishFiles(directory);
  return input.provider === "vercel" ? deployToVercel(input, files) : deployToNetlify(input, files);
}

async function deployToVercel(input: HostingDeploymentInput, files: PublishFile[]): Promise<FactoryDeployment> {
  const query = input.teamId ? `?teamId=${encodeURIComponent(input.teamId)}` : "";
  const response = await fetch(`https://api.vercel.com/v13/deployments${query}`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.credential.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: slug(input.projectName),
      target: "production",
      ...(input.existingProjectId ? { project: input.existingProjectId } : {}),
      files: files.map((file) => ({ file: file.path, data: Buffer.from(file.bytes).toString("base64"), encoding: "base64" })),
      projectSettings: { framework: null },
    }),
  });
  const created = await response.json().catch(() => ({})) as { id?: string; url?: string; inspectorUrl?: string; projectId?: string };
  if (!response.ok || !created.id || !created.url) throw providerError("vercel", response, created);
  const ready = await pollVercelDeployment(created.id, input.credential.token, input.teamId);
  return verifiedDeployment({
    provider: "vercel",
    deploymentId: created.id,
    projectId: ready.projectId || created.projectId || input.existingProjectId,
    url: `https://${ready.url || created.url}`,
    dashboardUrl: ready.inspectorUrl || created.inspectorUrl,
    createdAt: new Date().toISOString(),
  });
}

async function pollVercelDeployment(id: string, token: string, teamId?: string) {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}${query}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { url?: string; inspectorUrl?: string; projectId?: string; readyState?: string; errorMessage?: string };
    if (!response.ok) throw providerError("vercel", response, payload);
    if (payload.readyState === "READY") return payload;
    if (payload.readyState === "ERROR" || payload.readyState === "CANCELED") throw new Error(`Vercel deployment failed${payload.errorMessage ? `: ${payload.errorMessage}` : "."}`);
    await delay(750);
  }
  throw new Error("Vercel did not finish the production deployment within Foundry's verification window.");
}

async function deployToNetlify(input: HostingDeploymentInput, files: PublishFile[]): Promise<FactoryDeployment> {
  const headers = { authorization: `Bearer ${input.credential.token}` };
  let siteId = input.existingSiteId;
  let siteUrl: string | undefined;
  if (!siteId) {
    const response = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: slug(input.projectName) }),
    });
    const site = await response.json().catch(() => ({})) as { id?: string; ssl_url?: string; url?: string };
    if (!response.ok || !site.id) throw providerError("netlify", response, site);
    siteId = site.id;
    siteUrl = site.ssl_url || site.url;
  }
  const archive = zipSync(Object.fromEntries(files.map((file) => [file.path, file.bytes])), { level: 6 });
  const response = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/deploys?production=true`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/zip" },
    body: Buffer.from(archive),
  });
  const created = await response.json().catch(() => ({})) as { id?: string; admin_url?: string };
  if (!response.ok || !created.id) throw providerError("netlify", response, created);
  const ready = await pollNetlifyDeployment(siteId, created.id, input.credential.token);
  const url = ready.ssl_url || ready.deploy_ssl_url || siteUrl || ready.url;
  if (!url) throw new Error("Netlify completed the deployment without returning a public URL.");
  return verifiedDeployment({
    provider: "netlify",
    deploymentId: created.id,
    siteId,
    url,
    dashboardUrl: ready.admin_url || created.admin_url,
    createdAt: new Date().toISOString(),
  });
}

async function pollNetlifyDeployment(siteId: string, deployId: string, token: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { state?: string; ssl_url?: string; deploy_ssl_url?: string; url?: string; admin_url?: string; error_message?: string };
    if (!response.ok) throw providerError("netlify", response, payload);
    if (payload.state === "ready") return payload;
    if (payload.state === "error" || payload.state === "rejected") throw new Error(`Netlify deployment failed${payload.error_message ? `: ${payload.error_message}` : "."}`);
    await delay(750);
  }
  throw new Error("Netlify did not finish the production deployment within Foundry's verification window.");
}

async function verifiedDeployment(deployment: Omit<FactoryDeployment, "state" | "production" | "verificationStatus" | "verifiedAt" | "verificationEvidence">): Promise<FactoryDeployment> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(deployment.url, { method: "GET", redirect: "follow", cache: "no-store", signal: controller.signal });
    const body = await response.text();
    if (!response.ok || !/<(?:html|!doctype)\b/i.test(body.slice(0, 4096))) throw new Error(`The production URL responded with HTTP ${response.status} but did not serve an HTML document.`);
    return {
      ...deployment,
      state: "ready",
      production: true,
      verificationStatus: "verified",
      verifiedAt: new Date().toISOString(),
      verificationEvidence: `Production URL returned HTTP ${response.status} and served HTML (${createHash("sha256").update(body).digest("hex").slice(0, 12)}).`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
