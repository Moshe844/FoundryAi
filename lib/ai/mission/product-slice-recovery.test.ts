import { describe, expect, it } from "vitest";

import { productEntryPath, productSliceInstruction } from "./product-slice-recovery";

describe("finding the entry route a refusal should name", () => {
  it("finds the Next.js App Router entry the scaffold already wrote", () => {
    // The live failure: this exact file existed, and the refusal never mentioned it.
    expect(productEntryPath(["src/lib/types.ts", "src/app/layout.tsx", "src/app/page.tsx"])).toBe("src/app/page.tsx");
  });

  it("handles the other conventional entries", () => {
    expect(productEntryPath(["pages/index.tsx"])).toBe("pages/index.tsx");
    expect(productEntryPath(["src/App.tsx"])).toBe("src/App.tsx");
    expect(productEntryPath(["index.html"])).toBe("index.html");
  });

  it("normalizes separators and leading ./", () => {
    expect(productEntryPath(["./src\\app\\page.tsx"])).toBe("src/app/page.tsx");
  });

  it("returns nothing when the project has no recognisable entry yet", () => {
    expect(productEntryPath(["src/lib/cart.ts", "package.json"])).toBeUndefined();
  });
});

describe("what the model is told when its batch had no screen", () => {
  it("names the file to fill rather than only what was wrong", () => {
    const note = productSliceInstruction({ entryPath: "src/app/page.tsx", occurrence: 1 });
    expect(note).toContain("src/app/page.tsx");
    expect(note).toContain("the actual screen a person sees and uses");
  });

  it("still names a target when the project has no entry yet", () => {
    expect(productSliceInstruction({ occurrence: 1 })).toContain("src/app/page.tsx");
  });

  it("changes the shape of the request on a repeat instead of restating it", () => {
    // Repeating a composition requirement that already failed twice is the loop this prevents.
    const note = productSliceInstruction({ entryPath: "src/app/page.tsx", occurrence: 2 });
    expect(note).toContain("Change approach");
    expect(note).toContain("by itself in this turn");
    expect(note).toContain("write_file");
  });

  it("does not accept a heading or a promise as the screen", () => {
    // The live run shipped "The runnable foundation is ready for the requested workflows."
    const note = productSliceInstruction({ entryPath: "src/app/page.tsx", occurrence: 2 });
    expect(note).toContain("not a heading, a summary of what is coming");
  });

  it("defers the supporting files rather than forbidding them", () => {
    expect(productSliceInstruction({ entryPath: "src/app/page.tsx", occurrence: 2 })).toContain("next turn");
  });
});
