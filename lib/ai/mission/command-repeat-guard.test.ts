import { describe, expect, it } from "vitest";

import {
  clearFailedCommand,
  commandFailureFingerprint,
  commandRepeatKey,
  createCommandRepeatState,
  evaluateCommandRepeat,
  recordFailedCommand,
} from "./command-repeat-guard";

describe("command identity", () => {
  it("treats risk-neutral install variations as the same command", () => {
    expect(commandRepeatKey("npm i dayjs --save", "")).toBe(commandRepeatKey("npm install dayjs", ""));
  });

  it("keeps genuinely different commands distinct", () => {
    expect(commandRepeatKey("npm run build", "")).not.toBe(commandRepeatKey("npm run test", ""));
  });

  it("separates the same command run in different directories", () => {
    expect(commandRepeatKey("npm run build", "packages/web")).not.toBe(commandRepeatKey("npm run build", "packages/api"));
  });

  it("ignores a trailing separator in the directory", () => {
    expect(commandRepeatKey("npm run build", "packages/web/")).toBe(commandRepeatKey("npm run build", "packages/web"));
  });
});

describe("failure identity", () => {
  it("reads the same error at a different port and timestamp as the same failure", () => {
    const first = commandFailureFingerprint("", "2026-07-26T10:00:00Z EADDRINUSE http://localhost:3100 took 1200 ms");
    const second = commandFailureFingerprint("", "2026-07-26T11:30:00Z EADDRINUSE http://localhost:3241 took 87 ms");
    expect(first).toBe(second);
  });

  it("reads a different error as different", () => {
    expect(commandFailureFingerprint("", "Cannot find module 'dayjs'")).not.toBe(commandFailureFingerprint("", "Type error in app/page.tsx"));
  });
});

describe("repeat policy", () => {
  it("allows a command that has not failed yet", () => {
    expect(evaluateCommandRepeat({ mutationsNow: 0 }).allow).toBe(true);
  });

  it("refuses an unchanged repeat of a failed command", () => {
    const state = createCommandRepeatState();
    recordFailedCommand(state, { command: "npm run build", cwd: "", stderr: "Type error in app/page.tsx", mutationsNow: 2 });

    const verdict = evaluateCommandRepeat({ previous: state.get(commandRepeatKey("npm run build", "")), mutationsNow: 2 });
    expect(verdict.allow).toBe(false);
    if (verdict.allow) return;
    // The refusal has to be actionable, not just a "no" — it names the failure and the ways forward.
    expect(verdict.guidance).toContain("Type error in app/page.tsx");
    expect(verdict.guidance).toContain("fix the cause in the source");
  });

  it("allows the repeat once the project has actually changed", () => {
    const state = createCommandRepeatState();
    recordFailedCommand(state, { command: "npm run build", cwd: "", stderr: "Type error in app/page.tsx", mutationsNow: 2 });

    // A source edit is the new evidence that makes re-running the build a genuine new check.
    const verdict = evaluateCommandRepeat({ previous: state.get(commandRepeatKey("npm run build", "")), mutationsNow: 3 });
    expect(verdict.allow).toBe(true);
    expect(verdict.reason).toContain("1 file(s) edited");
  });

  it("stops blocking a command after it succeeds", () => {
    const state = createCommandRepeatState();
    recordFailedCommand(state, { command: "npm run build", cwd: "", stderr: "boom", mutationsNow: 1 });
    clearFailedCommand(state, "npm run build", "");
    expect(evaluateCommandRepeat({ previous: state.get(commandRepeatKey("npm run build", "")), mutationsNow: 1 }).allow).toBe(true);
  });

  it("counts consecutive identical failures and restarts on a new error", () => {
    const state = createCommandRepeatState();
    recordFailedCommand(state, { command: "npm run build", cwd: "", stderr: "Type error in app/page.tsx", mutationsNow: 1 });
    const second = recordFailedCommand(state, { command: "npm run build", cwd: "", stderr: "Type error in app/page.tsx", mutationsNow: 2 });
    expect(second.attempts).toBe(2);

    const different = recordFailedCommand(state, { command: "npm run build", cwd: "", stderr: "Cannot find module 'dayjs'", mutationsNow: 3 });
    // Progress: a different error means the previous one was fixed, so this is attempt one of a new problem.
    expect(different.attempts).toBe(1);
  });
});
