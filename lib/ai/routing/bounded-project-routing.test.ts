import { describe, expect, it } from "vitest";

import { profileTask } from "./task-profiler";
import type { DynamicTaskAssessment } from "./types";

function assessment(overrides: Partial<DynamicTaskAssessment> = {}): DynamicTaskAssessment {
  return {
    taskType: "build",
    affectedScope: "few-files",
    estimatedFiles: 8,
    estimatedSubsystems: 2,
    difficulty: 0.78,
    uncertainty: 0.72,
    risk: 0.3,
    contextRequired: 0.65,
    securityOrPayment: false,
    migration: false,
    repetitive: false,
    projectCreation: true,
    independentReviewNeeded: false,
    visualOutcome: true,
    confidence: 0.75,
    reasons: ["classifier was uncertain"],
    source: "dynamic-fast-classifier",
    ...overrides,
  };
}

describe("bounded project routing sanity", () => {
  it.each([
    "Build a small Android utility app with three screens and local storage.",
    "Build a desktop note-taking app with local files and no cloud services.",
    "Build a small REST API with five endpoints and one local database.",
    "Build a simple browser game with three levels and local assets.",
  ])("does not promote bounded non-sensitive work to Architect: %s", (message) => {
    const profile = profileTask({ message, dynamicAssessment: assessment() });
    expect(["fast", "builder"]).toContain(profile.recommendedIntelligenceTier);
  });

  it("still escalates real cross-layer security work", () => {
    const profile = profileTask({
      message: "Build a multi-service payment platform with authentication and transaction processing.",
      dynamicAssessment: assessment({
        affectedScope: "multi-subsystem",
        estimatedFiles: 28,
        estimatedSubsystems: 5,
        difficulty: 0.88,
        uncertainty: 0.7,
        risk: 0.85,
        securityOrPayment: true,
        independentReviewNeeded: true,
      }),
    });
    expect(["architect", "enterprise-architect", "super-reasoning"]).toContain(profile.recommendedIntelligenceTier);
  });
});
