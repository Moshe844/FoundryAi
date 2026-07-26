import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/providers/dispatch", () => ({ callManagedModel: vi.fn() }));
vi.mock("@/lib/ai/model-router", () => ({ resolveModelForTier: vi.fn() }));

import { verifyAgainstReference, verifyAgainstReferences, visualRepairInstruction } from "./visual-acceptance";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier } from "@/lib/ai/model-router";

const callMock = vi.mocked(callManagedModel);
const resolveMock = vi.mocked(resolveModelForTier);

beforeEach(() => {
  callMock.mockReset();
  resolveMock.mockReset();
  resolveMock.mockReturnValue({ tier: "builder", provider: "openai", model: "test-model", effort: "low" });
});

const reference = { fileName: "mockup.png", dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" };
const rendered = { dataUrl: "data:image/png;base64,BBBB", mediaType: "image/png" };

function modelSays(args: { satisfied?: boolean; mismatches?: string[]; summary?: string; comparable?: boolean }) {
  callMock.mockResolvedValue({
    toolCalls: [{
      name: "report_visual_comparison",
      arguments: JSON.stringify({ satisfied: true, mismatches: [], summary: "", comparable: true, ...args }),
    }],
  } as never);
}

const compare = () => verifyAgainstReference({ reference, rendered, request: "build the page from this design", apiKey: "test" });

describe("accepting a correct implementation", () => {
  it("accepts when the render delivers the design", async () => {
    modelSays({ satisfied: true, summary: "Both show a hero, three cards and a footer." });
    const verdict = await compare();
    expect(verdict.status).toBe("satisfied");
    expect(verdict.mismatches).toEqual([]);
  });

  it("sends both images, reference first", async () => {
    modelSays({ satisfied: true });
    await compare();
    const content = callMock.mock.calls[0][0].messages[0].content as Array<{ type: string; fileName?: string }>;
    const images = content.filter((part) => part.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0].fileName).toBe("mockup.png");
    expect(images[1].fileName).toBe("rendered-page.png");
  });
});

describe("refusing to fail correct work", () => {
  it("does not fail when nothing concrete can be named", async () => {
    // "Not satisfied" with no nameable difference is the shape of a false failure. A mockup and a real
    // page never match pixel for pixel, so an unnameable difference must not fail the mission.
    modelSays({ satisfied: false, mismatches: [], summary: "They look somewhat different." });
    expect((await compare()).status).toBe("satisfied");
  });

  it("does not use an image that is not a design for this page", async () => {
    // A logo the user attached to be embedded is an asset, not an acceptance criterion.
    modelSays({ comparable: false, satisfied: false, mismatches: ["the page is not a logo"] });
    const verdict = await compare();
    expect(verdict.status).toBe("unchecked");
    expect(verdict.mismatches).toEqual([]);
  });

  it("reports unchecked rather than failed when no provider is available", async () => {
    const verdict = await verifyAgainstReference({ reference, rendered, request: "anything" });
    expect(verdict.status).toBe("unchecked");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("reports unchecked when the comparison call cannot run", async () => {
    resolveMock.mockImplementation(() => { throw new Error("no routable model"); });
    expect((await compare()).status).toBe("unchecked");
  });

  it("reports unchecked when the model returns nothing usable", async () => {
    callMock.mockResolvedValue({ toolCalls: [] } as never);
    expect((await compare()).status).toBe("unchecked");
  });
});

describe("reporting a real mismatch", () => {
  it("fails only with specific, actionable differences", async () => {
    modelSays({ satisfied: false, mismatches: ["the pricing table shown in the design is missing", "the nav sits below the hero instead of above it"] });
    const verdict = await compare();
    expect(verdict.status).toBe("mismatched");
    expect(verdict.mismatches).toHaveLength(2);
  });

  it("turns the mismatch into a repair instruction naming the differences", async () => {
    modelSays({ satisfied: false, mismatches: ["the pricing table is missing"] });
    const instruction = visualRepairInstruction(await compare());
    expect(instruction).toContain("the pricing table is missing");
    expect(instruction).toContain("Fix these specific differences");
  });

  it("produces no instruction for an accepted render", async () => {
    modelSays({ satisfied: true });
    expect(visualRepairInstruction(await compare())).toBe("");
  });
});

describe("several attached references", () => {
  it("stops at the first real mismatch", async () => {
    callMock
      .mockResolvedValueOnce({ toolCalls: [{ name: "report_visual_comparison", arguments: JSON.stringify({ satisfied: true, mismatches: [], summary: "ok", comparable: true }) }] } as never)
      .mockResolvedValueOnce({ toolCalls: [{ name: "report_visual_comparison", arguments: JSON.stringify({ satisfied: false, mismatches: ["the footer is missing"], summary: "no", comparable: true }) }] } as never);

    const verdict = await verifyAgainstReferences({
      references: [reference, { ...reference, fileName: "second.png" }, { ...reference, fileName: "third.png" }],
      rendered,
      request: "build these screens",
      apiKey: "test",
    });

    expect(verdict.status).toBe("mismatched");
    // The third image is never compared — one concrete difference is a better repair instruction than
    // a list, and each extra comparison is another paid vision call.
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it("reports unchecked when no attached image was a design", async () => {
    modelSays({ comparable: false });
    const verdict = await verifyAgainstReferences({ references: [reference], rendered, request: "use this logo", apiKey: "test" });
    expect(verdict.status).toBe("unchecked");
  });

  it("reports unchecked with no references at all", async () => {
    const verdict = await verifyAgainstReferences({ references: [], rendered, request: "anything", apiKey: "test" });
    expect(verdict.status).toBe("unchecked");
    expect(callMock).not.toHaveBeenCalled();
  });
});
