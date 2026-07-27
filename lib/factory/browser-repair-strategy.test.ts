import { describe, expect, it } from "vitest";
import { browserRepairStrategy } from "./browser-repair-strategy";

describe("browser repair strategy", () => {
  it("routes missing product surfaces to coordinated implementation", () => {
    expect(browserRepairStrategy(
      "HTTP response: 404 http://127.0.0.1/login. The requested authentication experience was not completed. Requirement-directed browser acceptance covered 0/3 observable capabilities.",
    )).toBe("coordinated-product-slice");
  });

  it("keeps a concrete defect in an existing surface targeted", () => {
    expect(browserRepairStrategy(
      "The checkout button rendered, but clicking it left the order total unchanged. Console error: Cannot read properties of undefined.",
    )).toBe("targeted-source-repair");
  });
});
