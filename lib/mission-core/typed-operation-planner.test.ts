import { describe, expect, it } from "vitest";
import { normalizeOperations, parsePlanArguments } from "./typed-operation-planner";

describe("typed operation planner", () => {
  it("rejects malformed planner output", () => {
    expect(parsePlanArguments("not-json")).toEqual({ operations: [], unsupportedReason: "Planner returned invalid operation JSON." });
  });

  it("keeps only executable operations and valid backward dependencies", () => {
    const operations = normalizeOperations([
      { id: "read-app", kind: "read_file", title: "Read app", target: "app.ts", dependsOn: [], requirementIds: [], risk: "safe" },
      { id: "write-app", kind: "write_file", title: "Write app", target: "app.ts", content: "export const ok = true;", dependsOn: ["read-app", "future"], requirementIds: ["r1"], risk: "modification" },
      { id: "future", kind: "verify", title: "Verify", dependsOn: ["write-app"], requirementIds: ["r1"], risk: "safe" },
    ]);
    expect(operations).toHaveLength(3);
    expect(operations[1].dependsOn).toEqual(["read-app"]);
    expect(operations[1].input?.content).toContain("ok");
    expect(operations[2].dependsOn).toEqual(["write-app"]);
  });

  it("drops patch operations and unsafe incomplete writes", () => {
    const operations = normalizeOperations([
      { id: "patch", kind: "patch_file", title: "Patch", target: "a.ts", dependsOn: [], requirementIds: [], risk: "modification" },
      { id: "write", kind: "write_file", title: "Write", target: "a.ts", dependsOn: [], requirementIds: [], risk: "modification" },
    ]);
    expect(operations).toEqual([]);
  });
});
