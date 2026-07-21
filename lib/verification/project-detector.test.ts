import { describe, expect, it } from "vitest";
import { detectVerificationProfile } from "./project-detector";

describe("Android verification detection", () => {
  it("recognizes an Android Gradle project without requiring a checked-in wrapper", () => {
    const profile = detectVerificationProfile({
      platform: "win32",
      rootEntries: ["settings.gradle.kts", "build.gradle.kts", "app"],
      files: {},
    });

    expect(profile.adapterId).toBe("android-gradle");
    expect(profile.commands.map((item) => item.command)).toEqual([
      "gradle compileDebug",
      "gradle lintDebug",
      "gradle testDebugUnitTest",
      "gradle assembleDebug",
    ]);
  });

  it("prefers the Windows wrapper when the project contains one", () => {
    const profile = detectVerificationProfile({
      platform: "win32",
      rootEntries: ["settings.gradle.kts", "build.gradle.kts", "gradlew.bat", "app"],
      files: {},
    });

    expect(profile.adapterId).toBe("android-gradle");
    expect(profile.commands[0]?.command).toBe("gradlew.bat compileDebug");
  });
});
