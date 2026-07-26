import { describe, expect, it } from "vitest";

import { createWriteScope, evaluateWrite } from "./write-scope";

const scope = createWriteScope(["app/page.tsx", "app/styles/theme.css"]);

describe("when a boundary exists at all", () => {
  it("treats an empty file list as unbounded rather than as forbidding everything", () => {
    expect(createWriteScope([])).toBeUndefined();
    expect(createWriteScope(undefined)).toBeUndefined();
    // An unbounded mission must behave exactly as it did before this guard existed.
    expect(evaluateWrite({ path: "anything.ts", operation: "write", scope: undefined, touched: [] }).allow).toBe(true);
  });
});

describe("enforcing a bounded scope", () => {
  it("allows a write inside the scope", () => {
    expect(evaluateWrite({ path: "app/page.tsx", operation: "write", scope, touched: [] }).allow).toBe(true);
  });

  it("refuses a write outside the scope", () => {
    const verdict = evaluateWrite({ path: "app/globals.css", operation: "write", scope, touched: [] });
    expect(verdict.allow).toBe(false);
    if (verdict.allow) return;
    expect(verdict.reason).toContain("outside this request's agreed scope");
    // The refusal must point at the recorded boundary and hand the decision to the user, not just say no.
    expect(verdict.reason).toContain("app/page.tsx");
    expect(verdict.reason).toContain("the user decides whether to widen the scope");
  });

  it("refuses an out-of-scope deletion and says so as a deletion", () => {
    const verdict = evaluateWrite({ path: "app/globals.css", operation: "delete", scope, touched: [] });
    expect(verdict.allow).toBe(false);
    if (verdict.allow) return;
    expect(verdict.reason).toContain("Do not delete any other existing file");
  });

  it("matches the same file recorded in absolute and relative form", () => {
    expect(evaluateWrite({ path: "C:/work/site/app/page.tsx", operation: "write", scope, touched: [] }).allow).toBe(true);
  });

  it("ignores a leading ./ and backslash separators", () => {
    const windowsScope = createWriteScope(["app\\page.tsx"]);
    expect(evaluateWrite({ path: "./app/page.tsx", operation: "write", scope: windowsScope, touched: [] }).allow).toBe(true);
  });

  it("lets a scoped directory cover the files inside it", () => {
    const directoryScope = createWriteScope(["app/checkout"]);
    expect(evaluateWrite({ path: "app/checkout/page.tsx", operation: "write", scope: directoryScope, touched: [] }).allow).toBe(true);
    expect(evaluateWrite({ path: "app/admin/page.tsx", operation: "write", scope: directoryScope, touched: [] }).allow).toBe(false);
  });
});

describe("the mission's own work", () => {
  it("lets a second pass edit a file this mission already created", () => {
    // A multi-pass implementation must never be blocked by its own first pass.
    expect(evaluateWrite({ path: "app/new-widget.tsx", operation: "write", scope, touched: ["app/new-widget.tsx"] }).allow).toBe(true);
  });

  it("still refuses an untouched file outside the scope", () => {
    expect(evaluateWrite({ path: "app/globals.css", operation: "write", scope, touched: ["app/new-widget.tsx"] }).allow).toBe(false);
  });
});
