import { describe, expect, it } from "vitest";

import { customerChargeForMission } from "./customer-billing";

describe("customer mission billing", () => {
  it("charges no customer usage for incomplete outcomes", () => {
    expect(customerChargeForMission("failed", 1.12)).toBe(0);
    expect(customerChargeForMission("blocked", 1.12)).toBe(0);
    expect(customerChargeForMission("cancelled", 1.12)).toBe(0);
  });

  it("charges recorded usage only for completed work", () => {
    expect(customerChargeForMission("complete", 1.12)).toBe(1.12);
  });
});
