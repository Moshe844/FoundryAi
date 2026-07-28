import type { FactoryExistingProjectRequest } from "@/lib/factory/types";

/**
 * The desktop Local Agent identifies a real on-disk folder through rootLabel. Planner-first
 * execution historically looked only at localPath, so a visibly connected folder disappeared at
 * the route boundary and three paid planning attempts all failed before reading a file.
 */
export function plannerLocalPath(body: Pick<FactoryExistingProjectRequest, "localPath" | "localConnector">) {
  if (body.localPath?.trim()) return body.localPath.trim();
  const connector = body.localConnector;
  if (!connector?.rootLabel?.trim() || !connector.url) return undefined;
  try {
    const host = new URL(connector.url).hostname.toLowerCase();
    if (host === "127.0.0.1" || host === "localhost" || host === "::1") return connector.rootLabel.trim();
  } catch {
    return undefined;
  }
  return undefined;
}
