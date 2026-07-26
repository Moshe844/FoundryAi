import { describe, expect, it } from "vitest";

import { guidanceForRejectedWrite } from "./rejected-write-strategy";

/** The guard message from the live failure this exists to prevent. */
const SCAFFOLD_REFUSAL = "The verified scaffold already pins next at ^15.5.0. Preserve its compatible foundation versions and add only genuinely required packages; do not replace the scaffold dependency set.";

const context = (overrides: Partial<Parameters<typeof guidanceForRejectedWrite>[0]> = {}) => guidanceForRejectedWrite({
  tool: "write_file",
  path: "package.json",
  reason: SCAFFOLD_REFUSAL,
  occurrence: 2,
  ...overrides,
});

describe("a first refusal is left alone", () => {
  it("says nothing extra on the first attempt", () => {
    // The guard's own message is a fair chance to self-correct; piling on immediately would be noise.
    expect(context({ occurrence: 1 })).toBeUndefined();
  });
});

describe("a repeated refusal changes the shape of the edit", () => {
  it("tells a repeated manifest rewrite to add rather than replace", () => {
    const guidance = context();
    expect(guidance?.note).toContain("Stop rewriting this manifest wholesale");
    expect(guidance?.note).toContain("replace_in_file");
    expect(guidance?.note).toContain("leaving every existing version string exactly as it is");
  });

  it("points a manifest refusal away from the fix the runtime performs itself", () => {
    // The live failure was a missing type declaration. The runtime installs those deterministically, so
    // the model editing the manifest for it is wasted budget and a guaranteed refusal.
    expect(context()?.note).toContain("the runtime installs those itself");
  });

  it("quotes the refusal so the next attempt reasons about the real objection", () => {
    expect(context()?.note).toContain("already pins next at ^15.5.0");
  });

  it("states plainly that repeating cannot work", () => {
    expect(context()?.note).toContain("cannot succeed");
  });

  it("narrows an ordinary source rewrite too", () => {
    const guidance = context({ path: "src/lib/auth.ts", reason: "That write would remove working behavior." });
    expect(guidance?.note).toContain("Change the shape of the edit, not its wording");
    expect(guidance?.note).toContain("replace_in_file");
  });

  it("offers stopping as a legitimate answer", () => {
    expect(context({ path: "src/lib/auth.ts", reason: "refused" })?.note).toContain("say so plainly and stop");
  });
});

describe("what it does not apply to", () => {
  it("leaves a malformed path to the existing guidance", () => {
    // A blank path is a broken call, not a content objection — the fix is a real path, not a smaller edit.
    expect(guidanceForRejectedWrite({ tool: "run_command", path: "", reason: "path was empty", occurrence: 3 })).toBeUndefined();
  });

  it("applies to a coordinated batch as well as a single write", () => {
    expect(context({ tool: "write_files", path: "(coordinated batch)" })?.note).toContain("Change the shape of the edit");
  });
});

describe("exhaustion", () => {
  it("is not exhausted on the first adaptation", () => {
    expect(context({ occurrence: 2 })?.exhausted).toBe(false);
  });

  it("is exhausted once a narrower edit was also refused", () => {
    expect(context({ occurrence: 3 })?.exhausted).toBe(true);
  });
});
