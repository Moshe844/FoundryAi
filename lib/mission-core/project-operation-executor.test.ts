import { describe, expect, it } from "vitest";
import type { ProjectAccess } from "@/lib/ai/mission/project-access";
import { createMissionRecord, type PlannedOperation } from "./model";
import { ProjectOperationExecutor } from "./project-operation-executor";

function operation(input: Partial<PlannedOperation> & Pick<PlannedOperation, "id" | "kind" | "title">): PlannedOperation {
  const now = "2026-07-27T12:00:00.000Z";
  return {
    missionId: "m1",
    dependsOn: [],
    requirementIds: [],
    risk: "safe",
    status: "pending",
    attempt: 0,
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
    ...input,
    id: input.id,
    kind: input.kind,
    title: input.title,
  };
}

function access(overrides: Partial<ProjectAccess> = {}): ProjectAccess {
  return {
    mode: "local-folder",
    rootLabel: "test",
    capabilities: { canRunCommands: true, canSearch: true, canBrowserValidate: true },
    listDir: async () => [],
    readFile: async () => ({ exists: true, content: "hello", truncated: false, totalBytes: 5, contentHash: "hash" }),
    writeFile: async () => ({ existedBefore: true, verified: true, contentChanged: true, modifiedAt: "now" }),
    runCommand: async () => ({ exitCode: 0, stdout: "ok", stderr: "", durationMs: 10, timedOut: false }),
    deleteFile: async () => ({ existed: true, verified: true }),
    validateBrowser: async (input) => ({ available: true, verified: true, url: input.url, title: "Ready" }),
    ...overrides,
  };
}

const mission = createMissionRecord({ id: "m1", projectId: "p1", objective: "test" });

describe("ProjectOperationExecutor", () => {
  it("writes and verifies a file", async () => {
    const executor = new ProjectOperationExecutor(access());
    const result = await executor.execute(operation({ id: "write", kind: "write_file", title: "Write", target: "a.txt", input: { content: "new" } }), mission);
    expect(result.status).toBe("succeeded");
    expect(result.changed).toBe(true);
  });

  it("treats a root-directory read as project inspection instead of a missing file", async () => {
    const executor = new ProjectOperationExecutor(access({
      listDir: async () => [{ name: "package.json", kind: "file", size: 100 }],
      readFile: async () => ({ exists: false, content: "", truncated: false, totalBytes: 0 }),
    }));
    const result = await executor.execute(operation({ id: "inspect", kind: "read_file", title: "Inspect root", target: "." }), mission);
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("Inspected project root");
    expect(result.evidence).toContain("file:package.json");
  });

  it("preserves permission-required as an approval wait", async () => {
    const executor = new ProjectOperationExecutor(access({
      runCommand: async () => ({ exitCode: null, stdout: "", stderr: "", durationMs: 0, timedOut: false, skipped: "permission-required", reason: "approval required", category: "dependencies" }),
    }));
    const result = await executor.execute(operation({ id: "install", kind: "run_command", title: "Install", command: "npm install" }), mission);
    expect(result.status).toBe("awaiting_approval");
    expect(result.evidence).toContain("dependencies");
  });

  it("does not pretend unsupported patch application succeeded", async () => {
    const executor = new ProjectOperationExecutor(access());
    const result = await executor.execute(operation({ id: "patch", kind: "patch_file", title: "Patch", target: "a.txt", input: { patch: "@@" } }), mission);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("patch-adapter-required");
  });

  it("requires browser evidence for browser operations", async () => {
    const executor = new ProjectOperationExecutor(access());
    const result = await executor.execute(operation({ id: "browser", kind: "browser_action", title: "Browser", input: { browser: { url: "http://localhost:3000" } } }), mission);
    expect(result.status).toBe("succeeded");
    expect(result.evidence).toContain("http://localhost:3000");
  });
});
