import { describe, expect, it } from "vitest";

import { interpretationConfirmation, normalizeFollowUpResolution } from "./classifyFollowUp";

describe("interpretationConfirmation", () => {
  it("executes a high-confidence typo correction without a confirmation ritual", () => {
    expect(interpretationConfirmation({
      originalRequest: "compltely resdign the UX",
      interpretedRequest: "completely redesign the UX",
      kind: "meaning-bearing",
      confidence: 0.94,
    })).toBeNull();
  });

  it("still pauses when a meaning-bearing interpretation is uncertain", () => {
    expect(interpretationConfirmation({
      originalRequest: "take it out",
      interpretedRequest: "delete the current project",
      kind: "meaning-bearing",
      confidence: 0.54,
    })).not.toBeNull();
  });

  it("always pauses genuine ambiguity even at high confidence", () => {
    expect(interpretationConfirmation({
      originalRequest: "change that one",
      interpretedRequest: "change the first navigation item",
      kind: "ambiguous",
      confidence: 0.95,
    })).not.toBeNull();
  });
});

describe("normalizeFollowUpResolution", () => {
  it("does not turn a resolved non-destructive project edit into a pronoun clarification", () => {
    const resolution = normalizeFollowUpResolution({
      currentIntent: "edit",
      referencedPriorAction: null,
      relevantFiles: [],
      expectedScope: "Redesign the connected page while preserving its task behavior.",
      destructive: false,
      referenceConfidence: 0,
      plannedAction: "Inspect the connected page and make it feel like a polished task product.",
      continuity: "fresh_plan",
      rationale: "The requested outcome is clear; project discovery owns file selection.",
      clarifyingQuestion: "",
      clarifyingOptions: [],
    }, "Take this rough page and make it feel polished.", {});

    expect(resolution.currentIntent).toBe("edit");
  });

  it("strips mutation-plan continuity from a read-only project inspection", () => {
    const resolution = normalizeFollowUpResolution({
      currentIntent: "inspection",
      referencedPriorAction: {
        executionId: "failed-build",
        description: "Revalidate the exact failed mission cheaply.",
      },
      relevantFiles: ["index.html"],
      expectedScope: "Inspect the current project and explain what it does.",
      destructive: false,
      referenceConfidence: 1,
      plannedAction: "Read the project and answer without changing files.",
      continuity: "carry_forward_plan",
      rationale: "The user asked what the project does.",
      clarifyingQuestion: "",
      clarifyingOptions: [],
    }, "what does this project do?", {
      recentMissionMemory: [{
        id: "failed-build",
        task: "Revalidate the exact failed mission cheaply.",
        status: "failed",
        filesChanged: [{ path: "index.html" }],
      }],
    });

    expect(resolution.currentIntent).toBe("inspection");
    expect(resolution.continuity).toBe("not_applicable");
  });
});
