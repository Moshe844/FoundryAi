import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileMissionRepository } from "./file-repository";
import { createMissionRecord } from "./model";
import { MissionRevisionConflictError } from "./repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FileMissionRepository", () => {
  it("persists and reloads mission records", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "foundry-missions-"));
    temporaryDirectories.push(directory);
    const repository = new FileMissionRepository(directory);
    const created = await repository.create(createMissionRecord({ id: "mission-1", projectId: "project-1", objective: "test" }));

    expect(await repository.get(created.id)).toEqual(created);
  });

  it("serializes concurrent writers and rejects the stale revision", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "foundry-missions-"));
    temporaryDirectories.push(directory);
    const repository = new FileMissionRepository(directory);
    const created = await repository.create(createMissionRecord({ id: "mission-1", projectId: "project-1", objective: "test" }));
    const first = { ...created, objective: "first", revision: created.revision + 1 };
    const second = { ...created, objective: "second", revision: created.revision + 1 };

    const results = await Promise.allSettled([
      repository.save(first, created.revision),
      repository.save(second, created.revision),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(MissionRevisionConflictError);
    expect(["first", "second"]).toContain((await repository.get(created.id))?.objective);
  });
});
