import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeDirectMission } from "./direct-execution";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("direct typed mission execution", () => {
  it("executes dependent file operations without the legacy runtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "foundry-direct-"));
    temporaryDirectories.push(root);
    const mission = await executeDirectMission({
      missionId: `direct-${Date.now()}`,
      objective: "Create and verify a small file",
      localPath: root,
      operations: [
        { id: "write", kind: "write_file", title: "Write file", target: "hello.txt", input: { content: "hello" }, risk: "safe" },
        { id: "read", kind: "read_file", title: "Read file", target: "hello.txt", dependsOn: ["write"] },
      ],
    });

    expect(mission.status).toBe("completed");
    expect(mission.operations.every((operation) => operation.status === "succeeded")).toBe(true);
    expect(await readFile(path.join(root, "hello.txt"), "utf8")).toBe("hello");
  });

  it("pauses at a permission boundary before modifying a project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "foundry-direct-"));
    temporaryDirectories.push(root);
    const mission = await executeDirectMission({
      missionId: `approval-${Date.now()}`,
      objective: "Write a protected file",
      localPath: root,
      operations: [
        { id: "write", kind: "write_file", title: "Write file", target: "protected.txt", input: { content: "secret" }, risk: "modification" },
      ],
    });

    expect(mission.status).toBe("awaiting_approval");
    expect(mission.approvals).toHaveLength(1);
    await expect(readFile(path.join(root, "protected.txt"), "utf8")).rejects.toThrow();
  });

  it("keeps uploaded project execution read-only", async () => {
    const mission = await executeDirectMission({
      missionId: `uploaded-${Date.now()}`,
      objective: "Inspect uploaded source",
      uploadedFiles: [{ path: "index.txt", content: "hello", size: 5 }],
      operations: [{ id: "read", kind: "read_file", title: "Read source", target: "index.txt" }],
    });

    expect(mission.status).toBe("completed");
    expect(mission.operations[0].result?.output).toBe("hello");
  });
});
