import { describe, expect, it } from "vitest";
import { explicitProjectNameFromPrompt } from "./project-discovery";

describe("explicit project identity", () => {
  it("preserves an admin dashboard subtype before its purpose clause", () => {
    expect(explicitProjectNameFromPrompt("Admin dashboard to create tasks for users")).toBe("Admin Dashboard");
  });

  it("preserves an operations dashboard subtype with a build verb", () => {
    expect(explicitProjectNameFromPrompt("Build an operations dashboard for regional teams")).toBe("Operations Dashboard");
  });

  it("still honors explicitly named products", () => {
    expect(explicitProjectNameFromPrompt("Build a dashboard named Northstar Admin using Next.js")).toBe("Northstar Admin");
  });
});
