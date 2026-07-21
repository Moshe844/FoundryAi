# Universal Verification Architecture

Foundry treats file generation as implementation, not completion. A mission is
complete only when the strongest practical checks detected for the project have
produced evidence, or when unsupported checks are reported honestly.

## Runtime Flow

The shared orchestration flow is:

1. classify intent;
2. inspect real project files;
3. detect the ecosystem through registered adapters;
4. create an ordered verification profile;
5. plan and implement proportionally to mission size;
6. run required checks and capture command evidence;
7. repair failed checks from the failed stage;
8. re-verify repaired results;
9. report Verified, Partially verified, or Not verified.

Numeric confidence may be used internally to decide whether another repair pass
is warranted. It is not a substitute for evidence and is not the user-facing
completion status.

## Extension Boundary

Each ecosystem implements `EcosystemAdapter` and registers independently. The
runtime consumes only `VerificationProfile`; it does not branch on languages or
project identities. The registry currently contains 36 adapters spanning Node
and major web frameworks, Android/Gradle/Maven, .NET, Python, PHP, Go, Rust,
Flutter/Dart, Ruby, Swift, CMake/Meson/Make, Elixir, Scala, R, Lua, PowerShell,
shell projects, containers and infrastructure, Godot, Unity, SQL, and static web.

Profiles contain only checks supported by files found in the project. For Node
projects, scripts come from the real `package.json`; absent scripts are not
invented. Other adapters activate from ecosystem manifests and prefer checked-in
wrappers when available.

## Coverage Claims

Foundry keeps two proof levels separate:

- **Adapter contract coverage** proves every registered ecosystem can be
  detected from representative project evidence and emits either a complete
  verification profile or an explicit limitation. This matrix must cover the
  registry exactly, so a newly registered adapter cannot silently escape tests.
- **Executable lifecycle coverage** proves real commands ran successfully
  through the Local Agent. Its score includes only toolchains installed on the
  test machine and names those toolchains explicitly.

Contract coverage is not described as a real build. Missing toolchains,
credentials, device runtimes, licensed editors, and infrastructure approval
remain visible limitations instead of simulated passes.

## Truthfulness Rules

- A verified disk write is not a successful build.
- A successful build is not live workflow validation.
- Required failed or unexecuted checks prevent verified completion.
- A failed automatic repair changes the mission result instead of being hidden.
- High-risk missions establish a pre-change baseline and separate pre-existing
  failures from regressions.
- Small tasks use the focused fast path and do not inherit unrelated full-suite
  checks.

## Platform-Dependent Capability

The Local Agent exposes capability-detected runners for Playwright browser
control, screenshot comparison, Android `adb`, iOS Simulator `simctl`, and
desktop process launch. Browser runs capture console/page errors, failed network
requests, interaction steps, screenshots, and optional pixel diffs. Android can
discover devices, install and launch an APK, send focused input, capture logcat,
and take screenshots. iOS validation activates only on macOS with Xcode.

Native desktop process launch is real evidence that an application starts, but
is not semantic UI evidence. Native UI interaction remains driver-specific and
must be reported as not verified unless an application-specific automation
driver supplies that evidence. A preview URL alone is never browser workflow
evidence.
