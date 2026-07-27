import { describe, expect, it } from "vitest";
import type { ExecutionMission } from "@/lib/mission/model";
import { currentActivityOf, groupExecutionUnits, groupTimeline, workEventText } from "./model";

function missionWith(event: ExecutionMission["timeline"][number]): ExecutionMission {
  return {
    id: "mission-1",
    title: "Test mission",
    source_requirements: ["Build a product"],
    state: "executing",
    verification_status: "none",
    plan: [],
    files_touched: [],
    commands_run: [],
    verification: [],
    summary: "",
    timeline: [event],
    created_at: event.timestamp,
    updated_at: event.timestamp,
  };
}

describe("mission canvas execution truth", () => {
  it("does not claim a generic edit without a verified file path", () => {
    const activity = currentActivityOf(missionWith({
      id: "edit-1",
      timestamp: "2026-07-27T12:00:00.000Z",
      kind: "edit",
      status: "warning",
      title: "edited",
    }));
    expect(activity).toEqual({ state: "thinking", label: "Awaiting a verified source change" });
  });

  it("shows which project a command actually ran in", () => {
    const event = {
      id: "command-1",
      timestamp: "2026-07-27T12:00:00.000Z",
      kind: "command" as const,
      status: "completed" as const,
      title: "Ran npm.cmd run build",
      command: "npm.cmd run build",
      cwd: "C:\\Users\\person\\Foundry\\projects\\ordering-app",
      exitCode: 0,
    };
    expect(workEventText(event)).toContain("in ordering-app");
    const units = groupExecutionUnits(groupTimeline([event])[0].events);
    expect(units[0].detail).toBe("project: ordering-app");
  });

  it("does not count a prepared project folder as a created file", () => {
    const events = groupTimeline([
      { id: "folder", timestamp: "2026-07-27T12:00:00.000Z", kind: "folder", status: "completed", title: "Created project folder", filePath: "ordering-app" },
      { id: "brief", timestamp: "2026-07-27T12:00:01.000Z", kind: "file", status: "completed", title: "Created foundry-brief.md", filePath: "foundry-brief.md" },
    ])[0].events;
    const units = groupExecutionUnits(events);
    expect(units.filter((unit) => unit.kind === "file").map((unit) => unit.label)).toEqual(["Created foundry-brief.md"]);
  });
});
