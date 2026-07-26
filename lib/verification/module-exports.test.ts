import { describe, expect, it } from "vitest";

import { describeModuleExports, exportedSymbols, missingExportInstruction, missingExports } from "./module-exports";

describe("reading a module's contract", () => {
  it("finds every declaration form", () => {
    const source = `
      export function signToken() {}
      export async function verifyToken() {}
      export const SESSION_COOKIE = "sid";
      export let counter = 0;
      export class AuthError extends Error {}
      export type TokenPayload = { userId: string };
      export interface Session { id: string }
      export enum Role { Admin }
    `;
    expect(exportedSymbols(source).names).toEqual([
      "AuthError", "Role", "SESSION_COOKIE", "Session", "TokenPayload", "counter", "signToken", "verifyToken",
    ]);
  });

  it("reads a grouped export clause and its aliases", () => {
    const result = exportedSymbols(`const a = 1; const b = 2; export { a, b as currentUser };`);
    // Callers import the exported name, not the local one.
    expect(result.names).toEqual(["a", "currentUser"]);
  });

  it("records a default export", () => {
    expect(exportedSymbols("export default function Page() {}").hasDefault).toBe(true);
    expect(exportedSymbols("export const x = 1;").hasDefault).toBe(false);
  });

  it("notes a wholesale re-export it cannot resolve alone", () => {
    const result = exportedSymbols(`export * from "./products";`);
    expect(result.reexportsFrom).toEqual(["./products"]);
  });

  it("ignores the word export inside comments and strings", () => {
    // Inventing a name no importer could resolve is worse than reporting none.
    const source = `
      // export function ghost() {}
      /* export const phantom = 1; */
      const help = "export function alsoNotReal() {}";
      export const real = 1;
    `;
    expect(exportedSymbols(source).names).toEqual(["real"]);
  });

  it("does not mistake a local declaration for an exported one", () => {
    expect(exportedSymbols("function internalOnly() {}\nconst hidden = 1;").names).toEqual([]);
  });
});

describe("stating the contract to the next batch", () => {
  it("lists the names a later batch may import", () => {
    const described = describeModuleExports("src/lib/auth.ts", exportedSymbols("export function signToken() {}\nexport const SESSION = 1;"));
    expect(described).toBe("src/lib/auth.ts exports: SESSION, signToken");
  });

  it("says plainly when a module exports nothing", () => {
    // Silence would leave the next batch to assume it can import anything.
    expect(describeModuleExports("src/lib/empty.ts", exportedSymbols("const x = 1;")))
      .toContain("nothing — do not import from it");
  });
});

describe("reading the mismatch back out of a failed build", () => {
  it("reads webpack's phrasing, which is what the live failure produced", () => {
    const diagnostic = `Attempted import error: 'getCurrentUser' is not exported from '@/lib/auth' (imported as 'getCurrentUser'). Attempted import error: 'listOrders' is not exported from '@/lib/orders'.`;
    expect(missingExports(diagnostic)).toEqual([
      { symbol: "getCurrentUser", module: "@/lib/auth" },
      { symbol: "listOrders", module: "@/lib/orders" },
    ]);
  });

  it("reads TypeScript's phrasing", () => {
    const diagnostic = `__tests__/auth.test.ts(2,40): error TS2305: Module '"@/lib/auth"' has no exported member 'signToken'.`;
    expect(missingExports(diagnostic)).toEqual([{ symbol: "signToken", module: "@/lib/auth" }]);
  });

  it("reports each mismatch once", () => {
    const diagnostic = `error TS2305: Module '"@/lib/auth"' has no exported member 'signToken'.\nerror TS2305: Module '"@/lib/auth"' has no exported member 'signToken'.`;
    expect(missingExports(diagnostic)).toHaveLength(1);
  });

  it("finds nothing in an unrelated failure", () => {
    expect(missingExports("Module not found: Can't resolve '@/lib/db'")).toEqual([]);
  });
});

describe("the repair instruction", () => {
  it("groups by module and names both sides", () => {
    const instruction = missingExportInstruction([
      { symbol: "getCurrentUser", module: "@/lib/auth" },
      { symbol: "requireAdmin", module: "@/lib/auth" },
      { symbol: "listOrders", module: "@/lib/orders" },
    ]);
    expect(instruction).toContain("@/lib/auth is imported for getCurrentUser, requireAdmin");
    expect(instruction).toContain("@/lib/orders is imported for listOrders but does not export it");
  });

  it("leaves the decision to whoever can read the code", () => {
    // Either side may be wrong; only the surrounding code says which.
    const instruction = missingExportInstruction([{ symbol: "listOrders", module: "@/lib/orders" }]);
    expect(instruction).toContain("either add the missing export");
    expect(instruction).toContain("do not add a stub that returns nothing");
  });

  it("says nothing when there is no mismatch", () => {
    expect(missingExportInstruction([])).toBe("");
  });
});
