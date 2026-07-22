import { describe, expect, it } from "vitest";
import { integrationProvidersFromEvidence, integrationRequirementPrompt, integrationRequirementsForBrief, missingIntegrationRequirements } from "./requirements";

describe("integration requirements", () => {
  it("requires a real email provider for password reset", () => {
    const requirements = integrationRequirementsForBrief("Build signup, login, password reset, and email verification.");
    expect(requirements.some((item) => item.id === "transactional-email")).toBe(true);
    expect(requirements.some((item) => item.id === "authentication")).toBe(true);
    expect(missingIntegrationRequirements(requirements, [])).toHaveLength(2);
    expect(integrationRequirementPrompt(requirements[0]).question).toContain("Credentials & Integrations");
  });

  it("recognizes named providers and environment variables", () => {
    expect(integrationRequirementsForBrief("Charge subscriptions with Stripe").some((item) => item.candidates[0]?.id === "stripe")).toBe(true);
    expect(integrationRequirementsForBrief("Use process.env.OPENAI_API_KEY").some((item) => item.candidates[0]?.id === "openai")).toBe(true);
    expect(integrationRequirementsForBrief("Store data in PostgreSQL").some((item) => item.candidates[0]?.id === "postgresql")).toBe(true);
  });

  it("does not prompt for ordinary local SDKs or explicitly excluded providers", () => {
    expect(integrationRequirementsForBrief("Build a local SQLite CLI with no OpenAI")).toEqual([]);
  });

  it("accepts only a verified candidate for a generic capability", () => {
    const requirements = integrationRequirementsForBrief("Build a chatbot using a hosted AI model");
    expect(missingIntegrationRequirements(requirements, ["openai"])).toEqual([]);
    expect(missingIntegrationRequirements(requirements, ["stripe"])).toHaveLength(1);
  });

  it("stops real PAX builds for licensed SDK and device setup but allows an honest simulator", () => {
    const hardware = integrationRequirementsForBrief("Build a PAX Android checkout app with barcode scanning and terminal payments");
    expect(hardware.some((item) => item.candidates[0]?.id === "pax")).toBe(true);
    expect(hardware.some((item) => item.id === "payments")).toBe(false);
    expect(integrationRequirementPrompt(hardware.find((item) => item.candidates[0]?.id === "pax")!).options).toContain("Build simulator-only mode");
    expect(integrationRequirementsForBrief("Build a simulator-only PAX Android checkout app without a terminal").some((item) => item.candidates[0]?.id === "pax")).toBe(false);
    expect(integrationRequirementsForBrief("Build a real PAX Android checkout app. Do not make simulator claims as real hardware validation.").some((item) => item.candidates[0]?.id === "pax")).toBe(true);
  });

  it("accepts a real imported SDK artifact but not a folder-selection answer", () => {
    const requirements = integrationRequirementsForBrief("Build a PAX Android checkout app with terminal payments");
    expect(integrationProvidersFromEvidence(requirements, ["I selected my SDK folder"])).toEqual([]);
    expect(integrationProvidersFromEvidence(requirements, [".foundry-input/sdk/PAX-POSLink-Android.aar"])).toEqual(["pax"]);
  });

  it("infers credentialed capabilities across unrelated application domains", () => {
    expect(integrationRequirementsForBrief("Build signup and social login with a real identity provider").some((item) => item.id === "authentication")).toBe(true);
    expect(integrationRequirementsForBrief("Send mobile push notifications for new messages").some((item) => item.id === "push-notifications")).toBe(true);
    expect(integrationRequirementsForBrief("Add production crash reporting and error monitoring").some((item) => item.id === "monitoring")).toBe(true);
  });

  it("applies the SDK evidence gate to hardware families, not only PAX", () => {
    const requirements = integrationRequirementsForBrief("Build an Android checkout for a Verifone payment terminal");
    const verifone = requirements.find((item) => item.candidates[0]?.id === "verifone");
    expect(verifone).toBeDefined();
    expect(integrationRequirementPrompt(verifone!).question).toContain("SDK/specifications");
    expect(requirements.some((item) => item.id === "payments")).toBe(false);
  });
});
