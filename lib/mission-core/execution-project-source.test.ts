import { describe, expect, it } from "vitest";
import { plannerLocalPath } from "./execution-project-source";

describe("planner execution project source", () => {
  it("keeps an explicit local path", () => {
    expect(plannerLocalPath({ localPath: " C:\\project " })).toBe("C:\\project");
  });

  it("uses the connected desktop agent root for local execution", () => {
    expect(plannerLocalPath({
      localConnector: { url: "http://127.0.0.1:3917", rootLabel: "C:\\project" },
    })).toBe("C:\\project");
  });

  it("does not reinterpret a remote connector root as a server-local path", () => {
    expect(plannerLocalPath({
      localConnector: { url: "https://agent.example.com", rootLabel: "/workspace/project" },
    })).toBeUndefined();
  });
});
