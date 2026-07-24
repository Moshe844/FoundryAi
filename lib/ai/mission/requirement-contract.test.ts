import { describe, expect, it } from "vitest";
import { requiredVisibleTextsForTask } from "./requirement-contract";

describe("follow-up identity acceptance", () => {
  it("extracts unquoted person, company, and role requirements", () => {
    const texts = requiredVisibleTextsForTask("I want the portfolio to be about Moshe Ekstein, he is working at Sola Payments a processing company. He is working as an integration specialist. Also add this logo to his profile.");
    expect(texts).toContain("Moshe Ekstein");
    expect(texts).toContain("Sola Payments");
    expect(texts).toContain("integration specialist");
  });
});
