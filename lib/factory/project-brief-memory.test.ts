import { describe, expect, it } from "vitest";
import { acceptedProjectBriefMemory } from "./project-brief-memory";

describe("accepted project brief memory", () => {
  it("persists resolved decisions once", () => {
    const request = [
      "Resolved project decisions:",
      "- Which database should be used locally?",
      "  Answer: Use SQLite locally and keep a PostgreSQL adapter.",
      "Continue the same mission.",
    ].join("\n");
    const updated = acceptedProjectBriefMemory("# Brief\n", request, false);
    expect(updated).toContain("## Accepted project updates");
    expect(updated).toContain("Decision: Which database should be used locally?");
    expect(updated).toContain("Accepted answer: Use SQLite locally and keep a PostgreSQL adapter.");
    expect(acceptedProjectBriefMemory(updated, request, false)).toBe(updated);
  });

  it("records a concrete accepted follow-up but ignores control-only continuation", () => {
    expect(acceptedProjectBriefMemory("# Brief\n", "Add order exports.", true)).toContain("Accepted requirement: Add order exports.");
    expect(acceptedProjectBriefMemory("# Brief\n", "Continue", false)).toBe("# Brief\n");
  });
});
