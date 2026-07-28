import { describe, expect, it } from "vitest";
import { isScaffoldFoundationDependency, reconcileGeneratedManifest } from "./manifest-reconciliation";

describe("generated manifest reconciliation", () => {
  it("preserves the installed foundation while retaining new application packages", () => {
    const current = JSON.stringify({
      scripts: { build: "next build", typecheck: "tsc --noEmit" },
      dependencies: { next: "^15.5.0", react: "^19.0.0" },
      devDependencies: { typescript: "^5.0.0" },
    });
    const proposed = JSON.stringify({
      scripts: { build: "next build --turbopack", test: "vitest run" },
      dependencies: { next: "^15.2.0", react: "^18.3.0", bcryptjs: "^3.0.2" },
      devDependencies: { typescript: "^5.7.0", vitest: "^3.2.0" },
    });
    const result = reconcileGeneratedManifest(proposed, current);
    const manifest = JSON.parse(result.content!);
    expect(manifest.dependencies).toEqual({ next: "^15.5.0", react: "^19.0.0", bcryptjs: "^3.0.2" });
    expect(manifest.devDependencies).toEqual({ typescript: "^5.0.0", vitest: "^3.2.0" });
    expect(manifest.scripts).toEqual({ build: "next build", test: "vitest run", typecheck: "tsc --noEmit" });
    expect(result.preservedDependencies).toEqual(expect.arrayContaining(["next", "react", "typescript"]));
    expect(result.preservedScripts).toContain("build");
    expect(result.issue).toBeUndefined();
  });

  it("rejects an unrepeatable new floating dependency", () => {
    const result = reconcileGeneratedManifest(
      JSON.stringify({ dependencies: { bcryptjs: "latest" } }),
      JSON.stringify({ dependencies: { next: "^15.5.0" } }),
    );
    expect(result.issue).toContain("floating");
    expect(result.content).toBeUndefined();
  });

  it("rejects malformed JSON instead of guessing", () => {
    expect(reconcileGeneratedManifest("{", "{}").issue).toContain("valid JSON");
  });

  it("allows a failed newly-added native dependency to be removed during recovery", () => {
    const result = reconcileGeneratedManifest(
      JSON.stringify({ dependencies: { next: "^15.2.0", bcryptjs: "^2.4.3" } }),
      JSON.stringify({ dependencies: { next: "^15.5.0", bcryptjs: "^2.4.3", "better-sqlite3": "^11.5.0" } }),
      isScaffoldFoundationDependency,
    );
    expect(JSON.parse(result.content!).dependencies).toEqual({ next: "^15.5.0", bcryptjs: "^2.4.3" });
  });
});
