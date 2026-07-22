import { describe, expect, it } from "vitest";
import { decideCommandPermission } from "./command-permissions";

describe("Android Gradle command permissions", () => {
  it.each(["gradlew.bat compileDebugKotlin", "gradlew.bat lintDebug", "gradlew.bat testDebugUnitTest", "gradlew.bat assembleDebug"])("allows deterministic verification: %s", (command) => {
    expect(decideCommandPermission(command).allowed).toBe(true);
  });

  it("still requires approval for wrapper and publication mutations", () => {
    expect(decideCommandPermission("gradlew.bat wrapper").allowed).toBe(false);
    expect(decideCommandPermission("gradlew.bat publish").allowed).toBe(false);
  });
});
