import { describe, expect, it } from "vitest";
import { shouldResumeIncompleteGeneratedProject } from "./recovery-policy";

const base = {
  isFoundryGeneratedProject: true,
  hasPreModelBrowserEvidence: false,
  isUndo: false,
  hasRunnableEntry: true,
  isControlContinuation: false,
  hasOpenPlanItems: true,
  commandOnly: false,
  deletesProject: false,
};

describe("generated project continuation", () => {
  it("continues automatically after the first runnable batch when requirements remain", () => {
    expect(shouldResumeIncompleteGeneratedProject(base)).toBe(true);
  });

  it("does not continue after all requirements are complete", () => {
    expect(shouldResumeIncompleteGeneratedProject({ ...base, hasOpenPlanItems: false })).toBe(false);
  });

  it("continues when the runnable entry is still missing", () => {
    expect(shouldResumeIncompleteGeneratedProject({ ...base, hasRunnableEntry: false, hasOpenPlanItems: false })).toBe(true);
  });

  it("leaves browser-evidenced repair and explicit destructive paths to their dedicated flows", () => {
    expect(shouldResumeIncompleteGeneratedProject({ ...base, hasPreModelBrowserEvidence: true })).toBe(false);
    expect(shouldResumeIncompleteGeneratedProject({ ...base, isUndo: true })).toBe(false);
    expect(shouldResumeIncompleteGeneratedProject({ ...base, commandOnly: true })).toBe(false);
    expect(shouldResumeIncompleteGeneratedProject({ ...base, deletesProject: true })).toBe(false);
  });
});
