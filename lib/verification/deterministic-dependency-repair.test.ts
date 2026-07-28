import { describe, expect, it } from "vitest";

import { modulesMissingTypeDeclarations, packagesEligibleForAutomaticInstall, planDependencyRepair, typesPackageFor } from "./deterministic-dependency-repair";

/** The exact diagnostic from the live failure this repair exists to fix. */
const LIVE_DIAGNOSTIC = `src/lib/auth.ts(1,17): error TS7016: Could not find a declaration file for module 'jsonwebtoken'. 'C:/Users/x/node_modules/jsonwebtoken/index.js' implicitly has an 'any' type.`;

describe("reading the diagnostic", () => {
  it("finds the module from the failure that caused this", () => {
    expect(modulesMissingTypeDeclarations(LIVE_DIAGNOSTIC)).toEqual(["jsonwebtoken"]);
  });

  it("finds several modules across a multi-line diagnostic", () => {
    const diagnostic = [
      `a.ts(1,1): error TS7016: Could not find a declaration file for module 'jsonwebtoken'.`,
      `b.ts(2,1): error TS7016: Could not find a declaration file for module 'bcryptjs'.`,
    ].join("\n");
    expect(modulesMissingTypeDeclarations(diagnostic)).toEqual(["jsonwebtoken", "bcryptjs"]);
  });

  it("reports each module once", () => {
    const diagnostic = `a.ts(1,1): error TS7016: module 'jsonwebtoken'.\nb.ts(1,1): error TS7016: module 'jsonwebtoken'.`;
    expect(modulesMissingTypeDeclarations(diagnostic)).toEqual(["jsonwebtoken"]);
  });

  it("ignores a project file that is simply missing", () => {
    // "Cannot find module '@/lib/db'" is a file the project never wrote. Installing something for it
    // would be nonsense, and this repair must not pretend it can fix it.
    const diagnostic = [
      `route.ts(2,20): error TS2307: Cannot find module '@/lib/db' or its corresponding type declarations.`,
      `x.ts(1,1): error TS7016: Could not find a declaration file for module './helpers'.`,
      `y.ts(1,1): error TS7016: Could not find a declaration file for module '@/lib/db'.`,
    ].join("\n");
    expect(modulesMissingTypeDeclarations(diagnostic)).toEqual([]);
  });

  it("ignores diagnostics that are not about missing declarations", () => {
    expect(modulesMissingTypeDeclarations(`a.ts(1,1): error TS2305: Module '"@/lib/auth"' has no exported member 'signToken'.`)).toEqual([]);
  });
});

describe("naming the types package", () => {
  it("maps a plain package", () => {
    expect(typesPackageFor("jsonwebtoken")).toBe("@types/jsonwebtoken");
  });

  it("flattens a scoped package the way DefinitelyTyped does", () => {
    expect(typesPackageFor("@aws-sdk/client-s3")).toBe("@types/aws-sdk__client-s3");
  });

  it("uses the package root for a deep import", () => {
    expect(typesPackageFor("lodash/fp")).toBe("@types/lodash");
  });

  it("leaves an already-types package alone", () => {
    expect(typesPackageFor("@types/node")).toBe("@types/node");
  });
});

describe("planning the install", () => {
  it("produces the one-line fix the model never applied", () => {
    const plan = planDependencyRepair({ diagnostic: LIVE_DIAGNOSTIC });
    expect(plan?.command).toBe("npm install --save-dev @types/jsonwebtoken");
    // Additive by construction, so it cannot trip the guard that protects the scaffold's pinned versions.
    expect(plan?.command).not.toContain("package.json");
  });

  it("does nothing when the types package is already declared", () => {
    const manifest = JSON.stringify({ devDependencies: { "@types/jsonwebtoken": "^9.0.0" } });
    expect(planDependencyRepair({ diagnostic: LIVE_DIAGNOSTIC, manifest })).toBeUndefined();
  });

  it("installs only what is missing", () => {
    const diagnostic = `a.ts(1,1): error TS7016: module 'jsonwebtoken'.\nb.ts(1,1): error TS7016: module 'bcryptjs'.`;
    const manifest = JSON.stringify({ devDependencies: { "@types/bcryptjs": "^2.4.0" } });
    expect(planDependencyRepair({ diagnostic, manifest })?.packages).toEqual(["@types/jsonwebtoken"]);
  });

  it("does nothing when there is no such diagnostic", () => {
    expect(planDependencyRepair({ diagnostic: "Build failed because of webpack errors" })).toBeUndefined();
  });

  it("still plans when the manifest cannot be parsed", () => {
    // An unreadable manifest is not a reason to skip a fix; the install is idempotent either way.
    expect(planDependencyRepair({ diagnostic: LIVE_DIAGNOSTIC, manifest: "{ not json" })?.packages).toEqual(["@types/jsonwebtoken"]);
  });

  it("uses the project's package manager", () => {
    expect(planDependencyRepair({ diagnostic: LIVE_DIAGNOSTIC, packageManager: "pnpm" })?.command).toBe("pnpm add -D @types/jsonwebtoken");
    expect(planDependencyRepair({ diagnostic: LIVE_DIAGNOSTIC, packageManager: "yarn" })?.command).toBe("yarn add --dev @types/jsonwebtoken");
  });

  it("explains itself in terms of the failure", () => {
    expect(planDependencyRepair({ diagnostic: LIVE_DIAGNOSTIC })?.reason).toContain("jsonwebtoken");
    expect(planDependencyRepair({ diagnostic: LIVE_DIAGNOSTIC })?.reason).toContain("without touching the scaffold's pinned versions");
  });
});

describe("guarding compiler-driven installs", () => {
  it("does not reinstall a package already declared by the project", () => {
    const manifest = JSON.stringify({ dependencies: { "better-sqlite3": "^12.0.0" } });
    expect(packagesEligibleForAutomaticInstall({ packages: ["better-sqlite3", "bcryptjs"], manifest, nodeMajor: 24 }))
      .toEqual(["bcryptjs"]);
  });

  it("routes native SQLite addons to source repair on modern Node", () => {
    expect(packagesEligibleForAutomaticInstall({
      packages: ["sqlite3", "better-sqlite3", "@types/better-sqlite3", "zod"],
      nodeMajor: 24,
    })).toEqual(["zod"]);
  });
});
