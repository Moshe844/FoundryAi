import { describe, expect, it } from "vitest";
import { firstUserFacingSourcePath } from "./executor";

describe("generated product source batches", () => {
  it("does not confuse tests, manifests, or isolated libraries with a user-facing product", () => {
    expect(firstUserFacingSourcePath([
      { path: "package.json", content: "{\"scripts\":{\"test\":\"vitest\"}}" },
      { path: "__tests__/auth.test.ts", content: "describe('auth', () => {})" },
      { path: "src/lib/auth.ts", content: "export function login() { return true; }" },
    ])).toBeUndefined();
  });

  it("recognizes a real route or screen in a coordinated batch", () => {
    expect(firstUserFacingSourcePath([
      { path: "src/app/page.tsx", content: "export default function Page(){ return (<main><button>Order now</button></main>); }" },
      { path: "src/lib/cart.ts", content: "export const cart = [];" },
    ])).toBe("src/app/page.tsx");
  });
});
