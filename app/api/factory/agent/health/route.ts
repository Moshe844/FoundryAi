import { NextResponse } from "next/server";

type AgentHealthResponse = {
  ok?: boolean;
  approvedRoots?: unknown;
  commands?: unknown;
  error?: unknown;
};

const DEFAULT_AGENT_URL = "http://127.0.0.1:3917";
const LOCAL_AGENT_URL_PATTERN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { url?: string; token?: string };
    const agentUrl = normalizeAgentUrl(body.url);
    if (!LOCAL_AGENT_URL_PATTERN.test(agentUrl)) {
      return NextResponse.json({ ok: false, approvedRoots: [], error: "Only local agent URLs are allowed." }, { status: 400 });
    }

    const headers: Record<string, string> = {};
    if (body.token?.trim()) headers.authorization = `Bearer ${body.token.trim()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`${agentUrl}/health`, { method: "GET", headers, signal: controller.signal });
      const result = (await response.json().catch(() => ({}))) as AgentHealthResponse;
      if (!response.ok || !result.ok) {
        return NextResponse.json({
          ok: false,
          approvedRoots: [],
          error: typeof result.error === "string" ? result.error : `Agent responded with HTTP ${response.status}.`,
        });
      }

      return NextResponse.json({
        ok: true,
        approvedRoots: Array.isArray(result.approvedRoots) ? result.approvedRoots : [],
        commands: Boolean(result.commands),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return NextResponse.json({
      ok: false,
      approvedRoots: [],
      error: error instanceof Error ? error.message : "Could not reach the local agent.",
    });
  }
}

function normalizeAgentUrl(url: string | undefined) {
  return (url?.trim() || DEFAULT_AGENT_URL).replace(/\/+$/, "");
}
