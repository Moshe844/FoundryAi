/**
 * Turns "iOS can't run here" into a real path forward.
 *
 * Producing an `.ipa` requires Apple's toolchain, which only runs on macOS — that is a genuine platform
 * constraint, not a Foundry limitation, and pretending otherwise would be dishonest. But dead-ending at
 * "impossible on Windows" is also wrong: Foundry can build the iOS *project*, verify everything that is
 * verifiable without the Apple compiler (types, the JS bundle, the shared UI in a web/Android preview),
 * and hand the user an exact, ordered set of next steps — including the cloud path that needs no Mac.
 */

export type IosBuildPath = {
  detectedTooling: "expo" | "react-native" | "flutter" | "native-swift" | "unknown";
  /** What Foundry can do here on this machine, stated plainly. */
  buildableHere: string;
  /** Ordered, concrete next steps to get a running iOS app. */
  nextSteps: string[];
};

function detectTooling(stack: string, dependencies: Record<string, string>): IosBuildPath["detectedTooling"] {
  const haystack = `${stack} ${Object.keys(dependencies).join(" ")}`.toLowerCase();
  if (/\bexpo\b/.test(haystack)) return "expo";
  if (/react[- ]native/.test(haystack)) return "react-native";
  if (/\bflutter\b/.test(haystack)) return "flutter";
  if (/\bswift(?:ui)?\b|\bobjective-c\b|\bxcode\b/.test(haystack)) return "native-swift";
  return "unknown";
}

/**
 * @param onMac  whether this process is running on macOS — the one platform where a local `.ipa` build
 *               is possible. Passed in rather than read here so the guidance stays pure and testable.
 */
export function iosBuildGuidance(stack: string, dependencies: Record<string, string>, onMac: boolean): IosBuildPath {
  const detectedTooling = detectTooling(stack, dependencies);

  // Expo is the one stack where iOS genuinely builds and runs from Windows, because EAS compiles on
  // Apple's hosted machines and the result installs on a device or the Expo Go client. Lead with it.
  if (detectedTooling === "expo") {
    return {
      detectedTooling,
      buildableHere: onMac
        ? "Foundry built the Expo project and can also run it locally in the iOS Simulator here."
        : "Foundry built the Expo project and verified its JavaScript bundle. A runnable iOS build does not need a Mac — Expo's cloud builders (EAS) produce it from here.",
      nextSteps: onMac
        ? [
            "Run `npx expo run:ios` to launch the app in the local iOS Simulator.",
            "Or run `npx expo start` and press `i` to open it in the Simulator with live reload.",
          ]
        : [
            "Fastest check, no build: run `npx expo start`, install **Expo Go** from the App Store on your iPhone, and scan the QR code — the app runs live on your phone in seconds.",
            "For a real installable build: run `npm install -g eas-cli`, then `eas login`, then `eas build --platform ios`. EAS compiles on Apple's cloud machines and returns an installable build — no Mac required.",
            "A free Apple ID works for development builds on your own device; the paid Apple Developer Program ($99/yr) is only needed to submit to the App Store.",
          ],
    };
  }

  if (detectedTooling === "react-native") {
    return {
      detectedTooling,
      buildableHere: onMac
        ? "Foundry built the React Native project; the iOS app can be compiled locally with Xcode here."
        : "Foundry built the React Native project and verified its JavaScript bundle. The native iOS binary needs Apple's compiler, which is macOS-only — but a cloud build avoids that.",
      nextSteps: onMac
        ? [
            "Run `cd ios && pod install`, then `npx react-native run-ios` to build and launch in the Simulator.",
          ]
        : [
            "Recommended: add Expo's build service with `npx install-expo-modules`, then `npm install -g eas-cli` and `eas build --platform ios` to compile on Apple's cloud machines from Windows.",
            "Alternative: open this project's `ios/` folder on any Mac with Xcode, run `pod install`, and build — no code changes needed.",
            "The JavaScript layer is already verified here, so only the native compile step needs the Apple toolchain.",
          ],
    };
  }

  if (detectedTooling === "flutter") {
    return {
      detectedTooling,
      buildableHere: onMac
        ? "Foundry built the Flutter project; `flutter build ios` can produce the iOS app locally here."
        : "Foundry built the Flutter project and ran `flutter analyze`. `flutter build ios` itself requires Xcode, which is macOS-only.",
      nextSteps: onMac
        ? ["Run `flutter build ios` (or `flutter run` with a Simulator open) to build and launch."]
        : [
            "Run `flutter build apk` here to get a working Android build you can test immediately.",
            "For iOS: open the project on any Mac and run `flutter build ios`, or use Codemagic/Bitrise — CI services that run `flutter build ios` on hosted Mac machines from a Windows push.",
            "All of your Dart code is shared between platforms and already analyzed, so the iOS build is a compile step, not a rewrite.",
          ],
    };
  }

  if (detectedTooling === "native-swift") {
    return {
      detectedTooling,
      buildableHere: onMac
        ? "Foundry can build this Swift/Xcode project locally with `xcodebuild` here."
        : "This is a native Swift/Xcode project. Swift's iOS compiler and Xcode are macOS-only, so the binary cannot be produced on Windows by any tool — this is Apple's constraint, not Foundry's.",
      nextSteps: onMac
        ? ["Open the `.xcodeproj`/`.xcworkspace` in Xcode, select a Simulator, and press Run — or `xcodebuild -scheme <name> -destination 'generic/platform=iOS'`."]
        : [
            "You need macOS for a native Swift build. Options: a Mac with Xcode; a cloud Mac (MacStadium, AWS EC2 Mac); or a CI service with macOS runners (GitHub Actions `macos-latest`, Codemagic, Bitrise).",
            "If avoiding a Mac matters, the most portable route is to rebuild the UI in Expo/React Native, which Foundry can run and cloud-build from Windows. Say the word and Foundry will scaffold that instead.",
            "Foundry generated the Swift source and project structure so it is ready to open and build the moment you have macOS access.",
          ],
    };
  }

  return {
    detectedTooling,
    buildableHere: onMac
      ? "Foundry built the project; iOS tooling is available on this machine."
      : "Foundry built the project. Producing an installable iOS app needs Apple's toolchain (macOS-only), but a cloud build can do it from Windows.",
    nextSteps: onMac
      ? ["Use the platform's standard iOS build command (Xcode, `expo run:ios`, or `flutter build ios`)."]
      : [
          "The most reliable Windows-friendly path to a running iOS app is Expo + EAS cloud builds — Foundry can convert or scaffold the project that way on request.",
          "Otherwise, build the iOS target on any Mac with Xcode, or on a macOS CI runner (GitHub Actions `macos-latest`, Codemagic, Bitrise).",
        ],
  };
}

/** One-paragraph rendering for the preview-unavailable surface. */
export function iosGuidanceMessage(guidance: IosBuildPath): string {
  return `${guidance.buildableHere} Next steps:\n${guidance.nextSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`;
}
