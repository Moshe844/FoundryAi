import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/providers/dispatch", () => ({ callManagedModel: vi.fn() }));
vi.mock("@/lib/ai/model-router", () => ({ resolveModelForTier: vi.fn() }));

import { classifyBlocker } from "./blocker-classifier";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier } from "@/lib/ai/model-router";

const callMock = vi.mocked(callManagedModel);
const resolveMock = vi.mocked(resolveModelForTier);

beforeEach(() => {
  callMock.mockReset();
  resolveMock.mockReset();
  resolveMock.mockReturnValue({ tier: "fast", provider: "openai", model: "test-model", effort: "low" });
});

function modelSays(args: { disposition: string; concrete_boundary?: string; required_input?: string }) {
  callMock.mockResolvedValue({
    toolCalls: [{ name: "classify_blocker", arguments: JSON.stringify({ concrete_boundary: "", required_input: "", ...args }) }],
  } as never);
}

describe("a matched signature needs no model", () => {
  it("classifies a known credential failure deterministically", async () => {
    const result = await classifyBlocker({ reason: "Missing API key for the payment provider.", apiKey: "test" });
    expect(result.source).toBe("deterministic");
    expect(result.disposition).toBe("external-dependency");
    expect(result.terminal).toBe(true);
    // A precise pattern match must not spend a model call re-deciding what it already knows.
    expect(callMock).not.toHaveBeenCalled();
  });

  it("classifies a user cancellation deterministically", async () => {
    const result = await classifyBlocker({ reason: "Stopped by the user.", apiKey: "test" });
    expect(result.source).toBe("deterministic");
    expect(result.disposition).toBe("user-stopped");
  });
});

describe("the catch-all default is where the model helps", () => {
  it("recognises an external wall the pattern list never enumerated", async () => {
    modelSays({
      disposition: "external-dependency",
      concrete_boundary: "the Figma design service rejected the workspace token",
      required_input: "Reconnect the design integration in settings, then resume.",
    });

    const result = await classifyBlocker({ reason: "The design service would not hand over the file.", apiKey: "test" });
    expect(result.source).toBe("model");
    expect(result.terminal).toBe(true);
    expect(result.nextAction).toBe("Reconnect the design integration in settings, then resume.");
  });

  it("keeps an ordinary defect recoverable", async () => {
    modelSays({ disposition: "recoverable-engineering" });
    const result = await classifyBlocker({ reason: "The checkout total renders as NaN.", apiKey: "test" });
    expect(result.terminal).toBe(false);
    expect(result.disposition).toBe("recoverable-engineering");
  });

  it("refuses a wall the model cannot actually name", async () => {
    // The bias is toward continuing: stopping when Foundry could have carried on hands the user a
    // problem it was capable of solving, so an unnameable boundary is not a boundary.
    modelSays({ disposition: "external-dependency", concrete_boundary: "", required_input: "Have a look at it." });
    const result = await classifyBlocker({ reason: "It kept failing and I could not get past it.", apiKey: "test" });
    expect(result.terminal).toBe(false);
  });

  it("supplies a next action when the model names a boundary but no instruction", async () => {
    modelSays({ disposition: "external-dependency", concrete_boundary: "the Android emulator is not installed", required_input: "" });
    const result = await classifyBlocker({ reason: "Could not launch the app.", apiKey: "test" });
    expect(result.nextAction).toContain("the Android emulator is not installed");
  });
});

describe("degrading safely", () => {
  it("stays recoverable with no provider available", async () => {
    const result = await classifyBlocker({ reason: "The checkout total renders as NaN." });
    expect(result.source).toBe("model-unavailable");
    expect(result.terminal).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
  });

  it("stays recoverable when no routable model exists", async () => {
    // resolveModelForTier throws when the live registry has no validated candidate for the tier. A
    // mission must not be declared terminally blocked because routing itself failed.
    resolveMock.mockImplementation(() => { throw new Error("no validated fast candidate"); });
    const result = await classifyBlocker({ reason: "The checkout total renders as NaN.", apiKey: "test" });
    expect(result.source).toBe("model-unavailable");
    expect(result.terminal).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
  });

  it("stays recoverable when the model returns nothing usable", async () => {
    callMock.mockResolvedValue({ toolCalls: [] } as never);
    const result = await classifyBlocker({ reason: "The checkout total renders as NaN.", apiKey: "test" });
    expect(result.terminal).toBe(false);
  });
});
