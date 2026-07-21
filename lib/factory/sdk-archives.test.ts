import { describe, expect, it } from "vitest";
import { selectAndroidSdkEntries } from "./sdk-archives";

describe("uploaded SDK archive selection", () => {
  it("selects one coherent Android AAR distribution without provider hardcoding", () => {
    expect(selectAndroidSdkEntries([
      "vendor/libs/android/use_aar/device-sdk.aar",
      "vendor/libs/android/use_aar/transport.jar",
      "vendor/libs/android/use_jar/device-sdk.jar",
      "vendor/libs/windows/device-sdk.jar",
      "vendor/demo/libs/demo.aar",
      "../escape.aar",
    ])).toEqual([
      "vendor/libs/android/use_aar/device-sdk.aar",
      "vendor/libs/android/use_aar/transport.jar",
    ]);
  });
});
