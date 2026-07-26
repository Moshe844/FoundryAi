import { describe, expect, it } from "vitest";

import { forcedToolAfterTruncation, guidanceForTruncatedWrite } from "./truncated-write-recovery";

const creating = (attempt = 1) => guidanceForTruncatedWrite({ tool: "write_files", creating: true, attempt });
const editing = (attempt = 1) => guidanceForTruncatedWrite({ tool: "write_file", path: "src/app/page.tsx", creating: false, attempt });

describe("creating a project", () => {
  it("never tells the model to patch files that do not exist", () => {
    // The live failure: a greenfield batch was told to use replace_in_file, could not, and fell back to
    // writing whatever few small files fit — a project with no application in it.
    expect(creating()).not.toContain("Use replace_in_file with");
    expect(creating()).toContain("replace_in_file cannot be used on them");
  });

  it("asks for fewer files per call, which is the real constraint", () => {
    expect(creating()).toContain("at most 3 complete files");
    expect(creating()).toContain("write_files again");
  });

  it("says more turns are coming, so nothing has to be crammed in", () => {
    expect(creating()).toContain("further turns");
  });

  it("narrows to one file after a second failure", () => {
    expect(creating(2)).toContain("send ONE complete file");
  });

  it("names the tool to switch to for the record", () => {
    expect(forcedToolAfterTruncation(true)).toContain("fewer files per call");
  });
});

describe("editing an existing file", () => {
  it("keeps the targeted-patch advice, which is correct there", () => {
    expect(editing()).toContain("Use replace_in_file");
    expect(editing()).toContain("Do NOT rewrite src/app/page.tsx in full");
  });

  it("narrows further after a second failure", () => {
    expect(editing(2)).toContain("smallest possible replacement");
  });

  it("still works when the path could not be recovered", () => {
    const guidance = guidanceForTruncatedWrite({ tool: "write_file", creating: false, attempt: 1 });
    expect(guidance).toContain("Do NOT rewrite the whole file");
  });

  it("names replace_in_file for the record", () => {
    expect(forcedToolAfterTruncation(false)).toBe("replace_in_file");
  });
});

describe("both paths", () => {
  it("explain that the content was cut off, not rejected", () => {
    for (const guidance of [creating(), editing()]) {
      expect(guidance).toContain("cut off mid-write");
    }
  });
});
