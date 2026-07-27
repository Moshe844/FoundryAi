import { describe, expect, it } from "vitest";

import { hasProductImplementationEvidence, productImplementationFiles } from "./product-evidence";

describe("product implementation evidence", () => {
  it("does not mistake an empty Next scaffold for a product", () => {
    const files = [
      "foundry-brief.md",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "next-env.d.ts",
      "postcss.config.mjs",
      "tailwind.config.ts",
      "src/app/layout.tsx",
      "src/app/globals.css",
    ];
    expect(productImplementationFiles(files)).toEqual([]);
    expect(hasProductImplementationEvidence(files)).toBe(false);
  });

  it("recognizes implementation surfaces across project families", () => {
    expect(productImplementationFiles([
      "src/app/page.tsx",
      "desktop/MainWindow.xaml.cs",
      "unity/Assets/Scripts/PlayerController.cs",
      "godot/player.gd",
      "android/app/src/main/java/com/example/MainActivity.kt",
      "api/server.py",
    ])).toHaveLength(6);
  });

  it("does not count tests or styling alone as the application", () => {
    expect(hasProductImplementationEvidence(["src/app/globals.css", "src/cart.test.ts", "README.md"])).toBe(false);
  });
});
