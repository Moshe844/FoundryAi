import { describe, expect, it } from "vitest";
import { attachedAssetPlacement, attachedAssetPublicPath } from "./asset-placement";

const servedUrlFor = (stackId: string, fileName: string) => {
  const placement = attachedAssetPlacement(stackId);
  return attachedAssetPublicPath(`${placement.directory}/${fileName}`, placement);
};

describe("attachedAssetPlacement", () => {
  it("writes static-HTML assets where the project folder itself is served", () => {
    // Regression: `public/foundry-uploads` + a `/foundry-uploads/...` URL 404'd on every page,
    // because a static project's preview root IS the project folder.
    expect(attachedAssetPlacement("static-html").directory).toBe("foundry-uploads");
    expect(servedUrlFor("static-html", "logo.png")).toBe("/foundry-uploads/logo.png");
  });

  it("keeps framework assets under public/ and strips it from the served URL", () => {
    for (const stackId of ["nextjs", "react", "vite", "astro", "remix", "svelte", "vue", "angular"]) {
      expect(attachedAssetPlacement(stackId).directory).toBe("public/foundry-uploads");
      expect(servedUrlFor(stackId, "logo.png")).toBe("/foundry-uploads/logo.png");
    }
  });

  it("gives non-web stacks a project-relative reference, not a URL", () => {
    for (const stackId of ["android", "flutter", "python", "dotnet-desktop"]) {
      expect(attachedAssetPlacement(stackId).servedFromWebRoot).toBe(false);
      expect(servedUrlFor(stackId, "logo.png")).toBe("assets/foundry-uploads/logo.png");
    }
  });

  it("always hands web stacks an absolute URL, so nested pages resolve it too", () => {
    for (const stackId of ["static-html", "phaser", "nextjs", "react"]) {
      expect(servedUrlFor(stackId, "logo.png").startsWith("/")).toBe(true);
    }
  });
});
