import { describe, expect, it } from "vitest";

import { providerAttemptTimeoutMs, providerFallbackWindowMs } from "./dispatch";

describe("provider cost and latency policy", () => {
  it("keeps routine work inside short bounded windows", () => {
    expect(providerAttemptTimeoutMs(undefined, "fast")).toBe(40_000);
    expect(providerAttemptTimeoutMs(180_000, "fast")).toBe(50_000);
    expect(providerAttemptTimeoutMs(undefined, "builder")).toBe(70_000);
    expect(providerAttemptTimeoutMs(180_000, "builder")).toBe(80_000);
    expect(providerFallbackWindowMs(80_000, 3, "builder")).toBe(90_000);
  });

  it("allows more time only for genuinely difficult tiers", () => {
    expect(providerAttemptTimeoutMs(undefined, "architect")).toBe(105_000);
    expect(providerFallbackWindowMs(105_000, 2, "architect")).toBe(150_000);
    expect(providerAttemptTimeoutMs(undefined, "enterprise-architect")).toBe(135_000);
  });
});
