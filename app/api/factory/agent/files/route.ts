import { NextResponse } from "next/server";

const DEFAULT_AGENT_URL = "http://127.0.0.1:3917";
const LOCAL_AGENT_URL_PATTERN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;

type AgentFilesRequest = {
  url?: string;
  token?: string;
  root?: string;
  action?: "tree" | "read";
  path?: string;
  maxEntries?: number;
};

/** Server-side bridge for Local Agent file reads. Browsers may block direct page-to-loopback requests
 * under private-network policy even while Foundry's server can reach the same healthy agent. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as AgentFilesRequest;
    const agentUrl = (body.url?.trim() || DEFAULT_AGENT_URL).replace(/\/+$/, "");
    if (!LOCAL_AGENT_URL_PATTERN.test(agentUrl)) {
      return NextResponse.json({ error: "Only local agent URLs are allowed." }, { status: 400 });
    }
    if (!body.root?.trim() || (body.action !== "tree" && body.action !== "read")) {
      return NextResponse.json({ error: "A connected root and file action are required." }, { status: 400 });
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (body.token?.trim()) headers.authorization = `Bearer ${body.token.trim()}`;
    const payload = body.action === "tree"
      ? { root: body.root, maxEntries: Math.max(1, Math.min(body.maxEntries ?? 2000, 5000)) }
      : { root: body.root, path: body.path ?? "", offsetBytes: 0, limitBytes: 500_000 };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${agentUrl}/${body.action === "tree" ? "tree" : "read"}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        return NextResponse.json({ error: typeof result.error === "string" ? result.error : `Local Agent responded with HTTP ${response.status}.` }, { status: response.status });
      }
      return NextResponse.json(result);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read files from the Local Agent." }, { status: 502 });
  }
}
