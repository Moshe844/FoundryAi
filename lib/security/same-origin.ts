import "server-only";

/**
 * CSRF defense for state-changing local API routes.
 *
 * Foundry serves its own API on localhost with no session auth (single-user, local-first). That means a
 * malicious website the user merely *visits* can make their browser POST to http://localhost:3001/... to
 * delete, rotate, or inject credentials — a classic CSRF. Browsers attach an `Origin` header to every
 * cross-origin fetch, so requiring Origin to match the request's own host blocks the attack while the
 * real same-origin UI (Origin === host) and non-browser callers (no Origin at all) both pass.
 *
 * Returns null when the request is allowed, or a Response to return directly when it must be rejected.
 */
export function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null; // Non-browser caller (curl, local agent, server-to-server): no Origin sent.
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return new Response(JSON.stringify({ error: "Rejected request with a malformed Origin header." }), { status: 403, headers: { "content-type": "application/json" } });
  }
  const requestHost = request.headers.get("host") ?? new URL(request.url).host;
  if (originHost !== requestHost) {
    return new Response(JSON.stringify({ error: "Cross-origin credential operations are blocked. This request did not originate from Foundry." }), { status: 403, headers: { "content-type": "application/json" } });
  }
  return null;
}
