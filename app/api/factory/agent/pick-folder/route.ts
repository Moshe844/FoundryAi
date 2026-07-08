import { NextResponse } from "next/server";

type PickFolderResponse = {
  ok?: boolean;
  root?: unknown;
  cancelled?: unknown;
  unsupported?: unknown;
  error?: unknown;
};

const DEFAULT_AGENT_URL = "http://127.0.0.1:3917";
const LOCAL_AGENT_URL_PATTERN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { url?: string; token?: string };
    const agentUrl = normalizeAgentUrl(body.url);
    if (!LOCAL_AGENT_URL_PATTERN.test(agentUrl)) {
      return NextResponse.json({ ok: false, error: "Only local agent URLs are allowed." }, { status: 400 });
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (body.token?.trim()) headers.authorization = `Bearer ${body.token.trim()}`;

    const response = await fetch(`${agentUrl}/pick-folder`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    const result = (await response.json().catch(() => ({}))) as PickFolderResponse;
    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          unsupported: response.status === 404 || /unknown connector endpoint/i.test(String(result.error || "")),
          error: typeof result.error === "string" ? result.error : `Agent responded with HTTP ${response.status}.`,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: Boolean(result.ok),
      root: typeof result.root === "string" ? result.root : undefined,
      cancelled: Boolean(result.cancelled),
      unsupported: Boolean(result.unsupported),
      error: typeof result.error === "string" ? result.error : undefined,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not reach the local agent.",
    });
  }
}

function normalizeAgentUrl(url: string | undefined) {
  return (url?.trim() || DEFAULT_AGENT_URL).replace(/\/+$/, "");
}
