import { describe, expect, it } from "vitest";

import { isPresentationOnlyAuthSurface, isSmallClientOnlyWebRequest, requiresFunctionalAuthentication } from "./requirement-intent";

describe("architecture-changing requirement intent", () => {
  it.each(["simple login page", "admin sign-in screen", "design a registration form"])("keeps %s client-only", (brief) => {
    expect(isPresentationOnlyAuthSurface(brief)).toBe(true);
    expect(requiresFunctionalAuthentication(brief)).toBe(false);
    expect(isSmallClientOnlyWebRequest(brief)).toBe(true);
  });

  it.each([
    "authenticate users and protect routes with sessions",
    "login page backed by an API and database",
    "sign-in form with password hashing and httpOnly cookies",
  ])("recognizes explicit backend authentication in %s", (brief) => {
    expect(requiresFunctionalAuthentication(brief)).toBe(true);
    expect(isSmallClientOnlyWebRequest(brief)).toBe(false);
  });
});
