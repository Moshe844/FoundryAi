import { describe, expect, it } from "vitest";

import { profileTask } from "./task-profiler";
import type { DynamicTaskAssessment } from "./types";

function inflatedStaticAssessment(): DynamicTaskAssessment {
  return {
    taskType: "build",
    affectedScope: "project-wide",
    estimatedFiles: 15,
    estimatedSubsystems: 3,
    difficulty: 0.8,
    uncertainty: 0.55,
    risk: 0.25,
    contextRequired: 0.75,
    securityOrPayment: false,
    migration: false,
    repetitive: false,
    projectCreation: true,
    independentReviewNeeded: false,
    visualOutcome: true,
    confidence: 0.86,
    reasons: ["many listed pages and content requirements"],
    source: "dynamic-fast-classifier",
  };
}

describe("explicit static-site routing", () => {
  it("does not let an inflated dynamic estimate turn a static site into architect work", () => {
    const profile = profileTask({
      message: "Build a responsive static HTML + CSS + JavaScript business website. Use local mock data. No backend, database, authentication, payments, API, or external integrations.",
      dynamicAssessment: inflatedStaticAssessment(),
    });

    expect(profile.recommendedIntelligenceTier).toBe("builder");
    expect(profile.scope.estimatedSubsystems).toBe(1);
    expect(profile.scope.crossLayer).toBe(false);
    expect(profile.scope.projectWide).toBe(false);
    expect(profile.expectedFiles).toBe(8);
  });

  it("keeps a small static landing site on fast", () => {
    const profile = profileTask({
      message: "Create a static HTML + CSS + JavaScript landing page with no backend or external integrations.",
      dynamicAssessment: { ...inflatedStaticAssessment(), estimatedFiles: 3 },
    });

    expect(profile.recommendedIntelligenceTier).toBe("fast");
    expect(profile.expectedFiles).toBe(3);
  });

  it("does not downgrade a real backend project just because it also uses HTML and CSS", () => {
    const profile = profileTask({
      message: "Build an HTML + CSS + JavaScript storefront with a backend API, database, login, and payments.",
      dynamicAssessment: inflatedStaticAssessment(),
    });

    expect(profile.recommendedIntelligenceTier).toBe("architect");
    expect(profile.scope.projectWide).toBe(true);
  });
});
