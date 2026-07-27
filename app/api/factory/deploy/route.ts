import { realpath } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { deploymentRecord, saveDeploymentRecord } from "@/lib/integrations/deployment-records";
import { deployVerifiedStaticSite, type HostingProvider } from "@/lib/integrations/hosting-deployment";
import { verifiedCredentialsForProject } from "@/lib/integrations/secret-store";
import { rejectCrossOrigin } from "@/lib/security/same-origin";
import { redactSensitiveText } from "@/lib/security/secret-redaction";

type DeployBody = {
  projectId?: string;
  projectName?: string;
  projectPath?: string;
  provider?: HostingProvider;
  approved?: boolean;
};

function reply(error: unknown, status = 400) {
  return NextResponse.json({ error: redactSensitiveText(error instanceof Error ? error.message : "Deployment failed.") }, { status });
}

async function safeGeneratedProjectPath(value: string) {
  const root = await realpath(path.join(process.cwd(), "projects"));
  const candidate = await realpath(value);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Production deployment is limited to generated Foundry projects in this release.");
  return candidate;
}

async function hostingCredentials(projectId: string) {
  return (await verifiedCredentialsForProject({
    userId: "local-user",
    projectId,
    environment: "development",
    location: "local",
  })).filter((record) => record.scope.provider === "vercel" || record.scope.provider === "netlify");
}

export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    if (!projectId) return reply(new Error("Project id is required."));
    const credentials = await hostingCredentials(projectId);
    return NextResponse.json({
      providers: credentials.map((record) => record.scope.provider),
      deployment: await deploymentRecord(projectId),
    });
  } catch (error) {
    return reply(error);
  }
}

export async function POST(request: Request) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;
  try {
    const body = await request.json() as DeployBody;
    if (body.approved !== true) return reply(new Error("Production deployment requires explicit approval."), 409);
    const projectId = body.projectId?.trim();
    const projectName = body.projectName?.trim();
    const projectPath = body.projectPath?.trim();
    const provider = body.provider;
    if (!projectId || !projectName || !projectPath || (provider !== "vercel" && provider !== "netlify")) return reply(new Error("Project, provider, and deployment path are required."));
    const credentials = await hostingCredentials(projectId);
    const credential = credentials.find((record) => record.scope.provider === provider);
    if (!credential?.values.token) return reply(new Error(`Connect and verify ${provider === "vercel" ? "Vercel" : "Netlify"} for this project before deployment.`), 409);
    const prior = await deploymentRecord(projectId);
    const deployment = await deployVerifiedStaticSite({
      provider,
      credential: { token: credential.values.token },
      projectPath: await safeGeneratedProjectPath(projectPath),
      projectName,
      existingProjectId: prior?.provider === "vercel" ? prior.projectId : undefined,
      existingSiteId: prior?.provider === "netlify" ? prior.siteId : undefined,
    });
    await saveDeploymentRecord(projectId, deployment);
    return NextResponse.json({ ok: true, deployment });
  } catch (error) {
    return reply(error);
  }
}
