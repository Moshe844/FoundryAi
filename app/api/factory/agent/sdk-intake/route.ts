import { NextResponse } from "next/server";

const DEFAULT_AGENT_URL = "http://127.0.0.1:3917";
const LOCAL_AGENT_URL_PATTERN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;

type AgentResult = {
  ok?: boolean;
  root?: string;
  cancelled?: boolean;
  error?: string;
  artifacts?: Array<{ path: string; name: string; size: number }>;
  imported?: Array<{ path: string; name: string; size: number }>;
};

async function agentPost(agentUrl: string, route: string, headers: Record<string, string>, body: object) {
  const response = await fetch(`${agentUrl}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as AgentResult;
  if (!response.ok || (!result.ok && route !== "/sdk/discover")) {
    throw new Error(result.error || `Local Agent ${route} failed with HTTP ${response.status}.`);
  }
  return result;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      url?: string;
      token?: string;
      destinationRoot?: string;
      terms?: string[];
    };
    const agentUrl = (body.url?.trim() || DEFAULT_AGENT_URL).replace(/\/+$/, "");
    if (!LOCAL_AGENT_URL_PATTERN.test(agentUrl)) {
      return NextResponse.json({ ok: false, error: "Only local Foundry Agent URLs are allowed." }, { status: 400 });
    }
    const destinationRoot = body.destinationRoot?.trim();
    if (!destinationRoot) {
      return NextResponse.json({ ok: false, error: "The project intake folder was not available." }, { status: 400 });
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (body.token?.trim()) headers.authorization = `Bearer ${body.token.trim()}`;

    await agentPost(agentUrl, "/connect", headers, { path: destinationRoot });
    const picked = await agentPost(agentUrl, "/pick-folder", headers, { purpose: "sdk-discovery" });
    if (picked.cancelled || !picked.root) return NextResponse.json({ ok: false, cancelled: true });
    const discovered = await agentPost(agentUrl, "/sdk/discover", headers, {
      root: picked.root,
      terms: Array.isArray(body.terms) ? body.terms.map(String).slice(0, 12) : [],
      maxResults: 80,
    });
    if (!discovered.artifacts?.length) {
      return NextResponse.json({ ok: false, error: "No matching SDK or specification artifacts were found in the selected folder." });
    }
    const imported = await agentPost(agentUrl, "/sdk/import", headers, {
      sourceRoot: picked.root,
      destinationRoot,
      paths: discovered.artifacts.map((artifact) => artifact.path),
    });
    if (!imported.imported?.length) {
      return NextResponse.json({ ok: false, error: "The discovered SDK files were not imported into the project." });
    }
    return NextResponse.json({ ok: true, imported: imported.imported });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "SDK intake could not reach the Foundry Local Agent.",
    });
  }
}
