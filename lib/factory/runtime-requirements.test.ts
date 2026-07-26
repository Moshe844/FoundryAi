import { describe, expect, it } from "vitest";
import { externalRuntimeRequirementKeys } from "./runtime-requirements";

describe("external runtime prerequisites", () => {
  it("does not turn an architecture preference into a credential gate", () => {
    expect(externalRuntimeRequirementKeys("Next.js + TypeScript + PostgreSQL")).toEqual([]);
    expect(externalRuntimeRequirementKeys("Use server-authoritative PostgreSQL data for users and orders.")).toEqual([]);
  });

  it("requires credentials when the user explicitly requests an external system now", () => {
    expect(externalRuntimeRequirementKeys("Connect to our existing production PostgreSQL through DATABASE_URL.")).toEqual(["DATABASE_URL"]);
    expect(externalRuntimeRequirementKeys("Use the shared hosted Redis instance via REDIS_URL.")).toEqual(["REDIS_URL"]);
  });
});
