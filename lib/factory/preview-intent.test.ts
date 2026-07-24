import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isPreviewRestartRequest } from "./preview-intent";
import { explicitReadOnlyProjectIntent, standaloneMutationIntent } from "@/lib/mission/classifyFollowUp";

describe("preview restart intent", () => {
  it.each([
    "The local preview stopped running can you please start it again",
    "Can you please start the server?",
    "Would you get the server running again for me?",
    "restart the preview",
    "reopen the local preview",
    "the dev server is not running",
    "The site can't be reached, can you please start it?",
    "start the site",
    "the website refused to connect, restart it",
  ])("routes %s directly to preview control", (task) => {
    expect(isPreviewRestartRequest(task)).toBe(true);
    expect(explicitReadOnlyProjectIntent(task)).toBeNull();
    expect(standaloneMutationIntent(task)).toBe("edit");
  });

  it.each([
    "fix the broken preview layout",
    "build the app and start the preview",
    "test the preview in a browser",
    "change the preview header",
  ])("keeps implementation work out of the operational fast path: %s", (task) => {
    expect(isPreviewRestartRequest(task)).toBe(false);
  });

  it("hard-gates runtime control before discovery, models, or source-changing work", () => {
    const runtime = readFileSync(path.join(process.cwd(), "lib/factory/runtime.ts"), "utf8");
    const missionStart = runtime.indexOf("async function runExistingProjectMissionWithAccess");
    const gate = runtime.indexOf('if (followUpResolution?.runtimeOperation === "preview_refresh" || isPreviewRestartRequest(requestedTask))', missionStart);
    const discovery = runtime.indexOf("discoverProjectWorkingSet(access, task)", missionStart);
    expect(gate).toBeGreaterThan(missionStart);
    expect(gate).toBeLessThan(discovery);
    const branch = runtime.slice(gate, runtime.indexOf("const originalTask", gate));
    expect(branch).toContain("paidModelCalls: 0");
    expect(branch).toContain("changedFiles: []");
    expect(branch).toContain("startProjectPreview");
    expect(branch).toContain("preview,");
    expect(branch).not.toContain("runMissionExecutor");
    expect(runtime).toContain('!isPreviewRestartRequest(task) && detected.stack === "Static HTML/CSS/JS"');
    expect(runtime).toContain('!isPreviewRestartRequest(task) && mission.stackLabel === "Static HTML/CSS/JS"');
  });
});
