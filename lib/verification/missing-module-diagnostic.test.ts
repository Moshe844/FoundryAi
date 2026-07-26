import { describe, expect, it } from "vitest";

import { missingModuleImports, resolveProjectModulePath } from "./missing-module-diagnostic";

/** Verbatim from the live failure this exists to fix. */
const LIVE_TYPECHECK = `> complete-customer-ordering-web-app@0.1.0 typecheck
src/app/api/auth/login/route.ts(2,20): error TS2307: Cannot find module '@/lib/db' or its corresponding type declarations.
src/app/api/auth/session/route.ts(3,20): error TS2307: Cannot find module '@/lib/db' or its corresponding type declarations.
src/app/api/auth/signup/route.ts(2,20): error TS2307: Cannot find module '@/lib/db' or its corresponding type declarations.`;

const LIVE_BUILD = `Failed to compile. Module not found: Can't resolve '@/lib/db' > Build failed because of webpack errors`;

describe("reading every compiler's phrasing", () => {
  it("reads TypeScript's wording, which was previously missed entirely", () => {
    // This is the gap that cost the live mission: every typecheck repair ran without knowing a file was
    // missing, because only the bundler's phrasing was recognised.
    const found = missingModuleImports(LIVE_TYPECHECK);
    expect(found).toHaveLength(1);
    expect(found[0].specifier).toBe("@/lib/db");
    expect(found[0].importer).toBe("src/app/api/auth/login/route.ts");
  });

  it("reads webpack's wording", () => {
    expect(missingModuleImports(LIVE_BUILD)[0].specifier).toBe("@/lib/db");
  });

  it("reads esbuild's wording and keeps the importer it names", () => {
    const found = missingModuleImports(`✘ [ERROR] Could not resolve "./helpers" from "src/app/page.tsx"`);
    expect(found[0]).toEqual({ importer: "src/app/page.tsx", specifier: "./helpers" });
  });

  it("reports one missing file once, however many importers complain", () => {
    // Three routes import @/lib/db; creating it once resolves all three.
    expect(missingModuleImports(LIVE_TYPECHECK)).toHaveLength(1);
  });

  it("prefers the phrasing that names the importer", () => {
    const combined = `${LIVE_BUILD}\n✘ [ERROR] Could not resolve "@/lib/db" from "src/app/api/auth/login/route.ts"`;
    expect(missingModuleImports(combined)[0].importer).toBe("src/app/api/auth/login/route.ts");
  });

  it("finds nothing in an unrelated diagnostic", () => {
    expect(missingModuleImports(`route.ts(2,20): error TS2305: Module '"@/lib/auth"' has no exported member 'signToken'.`)).toEqual([]);
  });

  it("reports several distinct missing modules", () => {
    const diagnostic = [
      `a.ts(1,1): error TS2307: Cannot find module '@/lib/db'.`,
      `b.ts(1,1): error TS2307: Cannot find module '@/lib/cache'.`,
    ].join("\n");
    expect(missingModuleImports(diagnostic).map((item) => item.specifier)).toEqual(["@/lib/db", "@/lib/cache"]);
  });
});

describe("deciding where the file belongs", () => {
  const tsconfig = JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } });

  it("resolves the alias from the project's own tsconfig", () => {
    expect(resolveProjectModulePath({ specifier: "@/lib/db", tsconfig })).toBe("src/lib/db");
  });

  it("believes a tsconfig that maps the alias to the root", () => {
    // Assuming @/ means src/ would create the file one directory too deep, leaving the import just as
    // unresolved as before.
    const rootAlias = JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } });
    expect(resolveProjectModulePath({ specifier: "@/lib/db", tsconfig: rootAlias })).toBe("lib/db");
  });

  it("reads a tsconfig containing comments and trailing commas", () => {
    const messy = `{
      // Next.js default
      "compilerOptions": {
        /* path aliases */
        "paths": { "@/*": ["./src/*"], },
      },
    }`;
    expect(resolveProjectModulePath({ specifier: "@/lib/db", tsconfig: messy })).toBe("src/lib/db");
  });

  it("falls back to the common convention when there is no config", () => {
    expect(resolveProjectModulePath({ specifier: "@/lib/db" })).toBe("src/lib/db");
  });

  it("resolves a relative import against its importer", () => {
    expect(resolveProjectModulePath({ specifier: "./helpers", importer: "src/app/page.tsx" })).toBe("src/app/helpers");
    expect(resolveProjectModulePath({ specifier: "../lib/db", importer: "src/app/page.tsx" })).toBe("src/lib/db");
  });

  it("refuses a relative import with no importer to resolve against", () => {
    expect(resolveProjectModulePath({ specifier: "./helpers" })).toBeUndefined();
  });

  it("refuses to escape the project root", () => {
    expect(resolveProjectModulePath({ specifier: "../../../etc/passwd", importer: "src/app/page.tsx" })).toBeUndefined();
  });

  it("ignores a package name, which is a dependency question", () => {
    // Creating node_modules/react would be nonsense; that failure is answered by installing.
    expect(resolveProjectModulePath({ specifier: "react", importer: "src/app/page.tsx", tsconfig })).toBeUndefined();
    expect(resolveProjectModulePath({ specifier: "@aws-sdk/client-s3", tsconfig })).toBeUndefined();
  });
});
