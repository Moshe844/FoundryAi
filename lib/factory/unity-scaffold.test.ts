import { describe, expect, it } from "vitest";
import { unityScaffoldFiles, validateUnityScaffold } from "./unity-scaffold";

describe("Unity factory scaffold", () => {
  it("provides the complete create, play, test, and package foundation", () => {
    const files = unityScaffoldFiles("Survival Exploration");
    expect(validateUnityScaffold(files)).toEqual({ complete: true, missing: [] });
    expect(files["Assets/Foundry/Runtime/FoundryGameBootstrap.cs"]).toMatch(/RuntimeInitializeOnLoadMethod|Foundry Player/);
    expect(files["Assets/Foundry/Editor/Build.cs"]).toMatch(/BuildPipeline\.BuildPlayer|static class Foundry|static void Build/);
    expect(files["Assets/Foundry/Tests/EditMode/FoundryFoundationTests.cs"]).toMatch(/\[Test\]|BootstrapCreatesPlayablePlayer/);
    expect(JSON.parse(files["Packages/manifest.json"]).dependencies["com.unity.test-framework"]).toBeTruthy();
  });
});
