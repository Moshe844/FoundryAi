import { describe, expect, it } from "vitest";
import { rejectCrossOrigin } from "@/lib/security/same-origin";
import { oauthStart, verifyOAuthState } from "@/lib/integrations/oauth";
import { createHmac } from "node:crypto";

describe("CSRF same-origin guard for state-changing credential routes", () => {
  const make = (headers: Record<string, string>) => new Request("http://localhost:3001/api/integrations/credentials", { method: "POST", headers });

  it("allows a same-origin request (Origin host === request host)", () => {
    expect(rejectCrossOrigin(make({ origin: "http://localhost:3001", host: "localhost:3001" }))).toBeNull();
  });
  it("allows a non-browser request with no Origin header (curl, local agent)", () => {
    expect(rejectCrossOrigin(make({ host: "localhost:3001" }))).toBeNull();
  });
  it("blocks a cross-origin browser request (the CSRF attack)", async () => {
    const blocked = rejectCrossOrigin(make({ origin: "https://evil.example.com", host: "localhost:3001" }));
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(403);
  });
  it("blocks a malformed Origin header", () => {
    expect(rejectCrossOrigin(make({ origin: "not a url", host: "localhost:3001" }))!.status).toBe(403);
  });
});

describe("OAuth state signing key is not a forgeable public constant", () => {
  const def = { id: "github", name: "GitHub", oauthProvider: "github" } as never;

  it("a state forged with the old hardcoded key is rejected", () => {
    // Reproduce the pre-fix vulnerability: an attacker signs their own state with the public constant.
    const payload = Buffer.from(JSON.stringify({ scope: "x", provider: "github", nonce: "deadbeef", expires: Date.now() + 60000 })).toString("base64url");
    const forgedSig = createHmac("sha256", "foundry-development-oauth-state").update(payload).digest("base64url");
    expect(() => verifyOAuthState(`${payload}.${forgedSig}`)).toThrow(/verification failed/i);
  });

  it("a legitimately issued state still round-trips", () => {
    process.env.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "test-client-id";
    const { state } = oauthStart(def, "scope-value", "http://localhost:3001/api/integrations/oauth/callback");
    const verified = verifyOAuthState(state);
    expect(verified.provider).toBe("github");
  });
});
