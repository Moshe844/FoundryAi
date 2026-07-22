import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";

/**
 * Real Android emulator preview. A mobile app is not a web page, so its "preview" is the app running
 * on an actual Android Virtual Device — a native window on the user's machine — not an iframe. This
 * mirrors the desktop-app launch flow (build → locate artifact → launch on demand) rather than the
 * web dev-server flow. iOS has no equivalent here: the iOS Simulator only exists inside Xcode on
 * macOS, so it is genuinely impossible on Windows/Linux and must be reported as such, not faked.
 */

export type AndroidTools = { sdkRoot: string; emulator: string; adb: string };

const EXE = process.platform === "win32" ? ".exe" : "";

function candidateSdkRoots(): string[] {
  const roots = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME].filter((value): value is string => Boolean(value && value.trim()));
  const localAppData = process.env.LOCALAPPDATA;
  const home = process.env.USERPROFILE || process.env.HOME;
  if (localAppData) roots.push(path.join(localAppData, "Android", "Sdk"));
  if (home) {
    roots.push(path.join(home, "AppData", "Local", "Android", "Sdk")); // Windows
    roots.push(path.join(home, "Library", "Android", "sdk")); // macOS
    roots.push(path.join(home, "Android", "Sdk")); // Linux
  }
  return [...new Set(roots)];
}

/** Locate a usable Android SDK (emulator + adb) without depending on PATH or env being configured. */
export function resolveAndroidTools(): AndroidTools | undefined {
  for (const sdkRoot of candidateSdkRoots()) {
    const emulator = path.join(sdkRoot, "emulator", `emulator${EXE}`);
    const adb = path.join(sdkRoot, "platform-tools", `adb${EXE}`);
    if (existsSync(emulator) && existsSync(adb)) return { sdkRoot, emulator, adb };
  }
  return undefined;
}

export function listAvds(tools: AndroidTools): string[] {
  const result = spawnSync(tools.emulator, ["-list-avds"], { encoding: "utf8", timeout: 10_000 });
  return (result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^INFO\b/i.test(line));
}

/** Serials of devices/emulators adb currently sees in the "device" (booted) state. */
export function attachedDevices(tools: AndroidTools): string[] {
  const result = spawnSync(tools.adb, ["devices"], { encoding: "utf8", timeout: 10_000 });
  return (result.stdout || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === "device")
    .map((parts) => parts[0]);
}

function bootCompleted(tools: AndroidTools, serial?: string): boolean {
  const args = [...(serial ? ["-s", serial] : []), "shell", "getprop", "sys.boot_completed"];
  const result = spawnSync(tools.adb, args, { encoding: "utf8", timeout: 8_000 });
  return (result.stdout || "").trim() === "1";
}

/** The first debug APK produced by a Gradle/React Native Android build, if the app has been built. */
export function findApk(projectPath: string): string | undefined {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || found.length > 40) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (["node_modules", ".git", ".gradle", ".idea"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.toLowerCase().endsWith(".apk")) found.push(full);
    }
  };
  walk(projectPath, 0);
  if (!found.length) return undefined;
  // Prefer a debug build under the conventional Gradle output path, then any debug APK, then any APK.
  const rank = (file: string) => {
    const lower = file.toLowerCase().replace(/\\/g, "/");
    if (/build\/outputs\/apk\/debug\/.*\.apk$/.test(lower)) return 0;
    if (/debug.*\.apk$/.test(lower)) return 1;
    if (/build\/outputs\/apk\//.test(lower)) return 2;
    return 3;
  };
  return found.sort((left, right) => rank(left) - rank(right))[0];
}

/** Parse the app's applicationId from a Gradle build file so we can launch it after install. */
export function readApplicationId(projectPath: string): string | undefined {
  const candidates = [
    path.join(projectPath, "app", "build.gradle"),
    path.join(projectPath, "app", "build.gradle.kts"),
    path.join(projectPath, "android", "app", "build.gradle"),
    path.join(projectPath, "android", "app", "build.gradle.kts"),
    path.join(projectPath, "build.gradle"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    const match = content.match(/applicationId\s*=?\s*["']([\w.]+)["']/) || content.match(/namespace\s*=?\s*["']([\w.]+)["']/);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * A JDK modern enough to run the Android Gradle Plugin (17+).
 *
 * Machines very often have an ancient Java *JRE* first on PATH (a jre1.8 left by an installer) while a
 * perfectly good JDK sits beside Android Studio. Building with the PATH java then fails with a version
 * error that looks like "you must install a JDK" when one is already present — so resolve it explicitly
 * instead of trusting PATH. Android Studio's bundled JBR is preferred because it is the JDK Google
 * ships and tests the Android toolchain against.
 */
export function resolveJavaHome(): { javaHome: string; version: number; source: string } | undefined {
  const candidates: Array<{ home: string; source: string }> = [];
  const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramW6432].filter((value): value is string => Boolean(value));
  for (const base of programFiles) {
    candidates.push({ home: path.join(base, "Android", "Android Studio", "jbr"), source: "Android Studio bundled JDK" });
    for (const vendor of ["Eclipse Adoptium", "Java", "Microsoft", "Amazon Corretto", "Zulu"]) {
      const vendorDir = path.join(base, vendor);
      let entries: string[] = [];
      try {
        entries = readdirSync(vendorDir);
      } catch {
        continue;
      }
      for (const entry of entries) candidates.push({ home: path.join(vendorDir, entry), source: `${vendor} ${entry}` });
    }
  }
  if (process.env.JAVA_HOME) candidates.unshift({ home: process.env.JAVA_HOME, source: "JAVA_HOME" });

  let best: { javaHome: string; version: number; source: string } | undefined;
  for (const candidate of candidates) {
    const javaBin = path.join(candidate.home, "bin", `java${EXE}`);
    if (!existsSync(javaBin)) continue;
    const probe = spawnSync(javaBin, ["-version"], { encoding: "utf8", timeout: 10_000 });
    const output = `${probe.stdout || ""}${probe.stderr || ""}`;
    // "21.0.10" / "1.8.0_491" — the legacy 1.x scheme means the real major is the second component.
    const match = output.match(/version\s+"(\d+)(?:\.(\d+))?[^"]*"/i);
    if (!match) continue;
    const major = match[1] === "1" ? Number(match[2] ?? 0) : Number(match[1]);
    if (!Number.isFinite(major) || major < 17) continue;
    if (!best || major > best.version) best = { javaHome: candidate.home, version: major, source: candidate.source };
    if (candidate.source === "Android Studio bundled JDK") return { javaHome: candidate.home, version: major, source: candidate.source };
  }
  return best;
}

/** Environment for Android/Gradle commands: a usable JDK plus the SDK location, neither of which can
 * be assumed to be configured on the machine. Returns undefined when the toolchain is incomplete. */
export function androidToolchainEnv(): NodeJS.ProcessEnv | undefined {
  const tools = resolveAndroidTools();
  const jdk = resolveJavaHome();
  if (!tools || !jdk) return undefined;
  const separator = process.platform === "win32" ? ";" : ":";
  const trustStore = ensureGradleTrustStore(jdk.javaHome);
  return {
    ...process.env,
    JAVA_HOME: jdk.javaHome,
    ANDROID_HOME: tools.sdkRoot,
    ANDROID_SDK_ROOT: tools.sdkRoot,
    PATH: [path.join(jdk.javaHome, "bin"), path.join(tools.sdkRoot, "platform-tools"), process.env.PATH ?? ""].join(separator),
    ...(trustStore ? { GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ""} -Djavax.net.ssl.trustStore=${trustStore.replace(/\\/g, "/")} -Djavax.net.ssl.trustStorePassword=changeit`.trim() } : {}),
  };
}

function ensureGradleTrustStore(javaHome: string): string | undefined {
  if (process.platform !== "win32" || typeof tls.getCACertificates !== "function") return undefined;
  const target = path.join(os.tmpdir(), "foundry-gradle-truststore.p12");
  if (existsSync(target)) return target;
  const source = path.join(javaHome, "lib", "security", "cacerts");
  const keytool = path.join(javaHome, "bin", "keytool.exe");
  if (!existsSync(source) || !existsSync(keytool)) return undefined;
  const temporary = mkdtempSync(path.join(os.tmpdir(), "foundry-gradle-trust-"));
  try {
    copyFileSync(source, target);
    for (const [index, certificate] of tls.getCACertificates("system").entries()) {
      const certificatePath = path.join(temporary, `${index}.pem`);
      writeFileSync(certificatePath, certificate, "utf8");
      const imported = spawnSync(keytool, ["-importcert", "-noprompt", "-trustcacerts", "-alias", `foundry-system-${index}`, "-file", certificatePath, "-keystore", target, "-storepass", "changeit"], { encoding: "utf8", timeout: 15_000, windowsHide: true });
      if (imported.status !== 0) { rmSync(target, { force: true }); return undefined; }
    }
    return target;
  } catch {
    rmSync(target, { force: true });
    return undefined;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function cachedGradleExecutable(): string | undefined {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return undefined;
  const root = path.join(home, ".gradle", "wrapper", "dists");
  const candidates: string[] = [];
  const walk = (directory: string, depth: number) => {
    if (depth > 4) return;
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.toLowerCase() === (process.platform === "win32" ? "gradle.bat" : "gradle")) candidates.push(full);
    }
  };
  walk(root, 0);
  return candidates.sort((left, right) => {
    const preferred = (value: string) => value.includes(`${path.sep}gradle-8.7-`) ? 0 : 1;
    return preferred(left) - preferred(right) || left.localeCompare(right);
  })[0];
}

/** Create the portable Gradle wrapper before model execution, using a locally cached Gradle runtime.
 * `--no-validate-url` is deliberate: restricted/corporate machines can have a working system network
 * but a Java trust chain that cannot validate services.gradle.org during wrapper generation. The
 * wrapper itself retains Gradle's official HTTPS distribution URL for portable future builds. */
export function ensureAndroidGradleWrapper(projectPath: string): { ok: boolean; created: string[]; error?: string } {
  const expected = ["gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.jar", "gradle/wrapper/gradle-wrapper.properties"];
  if (expected.every((relativePath) => existsSync(path.join(projectPath, relativePath)))) return { ok: true, created: [] };
  const gradle = cachedGradleExecutable();
  const env = androidToolchainEnv();
  if (!gradle || !env) return { ok: false, created: [], error: "A cached Gradle runtime and Android JDK 17+ are required to create the project wrapper." };
  const result = process.platform === "win32"
    ? spawnSync(gradle, ["-p", projectPath, "wrapper", "--gradle-version", "8.7", "--no-validate-url"], { encoding: "utf8", timeout: 120_000, env, shell: true, windowsHide: true })
    : spawnSync(gradle, ["-p", projectPath, "wrapper", "--gradle-version", "8.7", "--no-validate-url"], { encoding: "utf8", timeout: 120_000, env });
  if (result.status !== 0) return { ok: false, created: [], error: `${result.stdout || ""}\n${result.stderr || ""}`.trim() };
  return { ok: true, created: expected.filter((relativePath) => existsSync(path.join(projectPath, relativePath))) };
}

/** Honest, actionable description of what the machine can and cannot do for mobile builds. */
export function describeAndroidToolchain(): { ready: boolean; sdk: boolean; jdk?: { version: number; source: string }; avds: string[]; message: string } {
  const tools = resolveAndroidTools();
  const jdk = resolveJavaHome();
  const avds = tools ? listAvds(tools) : [];
  if (!tools) {
    return { ready: false, sdk: false, avds, message: "Android Studio (with the SDK and an emulator) is not installed, so there is no device to run a mobile app on." };
  }
  if (!jdk) {
    return { ready: false, sdk: true, avds, message: "The Android SDK is installed but no JDK 17+ was found. Install Android Studio's bundled JDK or a current Temurin/Adoptium JDK so Gradle can build the app." };
  }
  if (!avds.length) {
    return { ready: false, sdk: true, jdk: { version: jdk.version, source: jdk.source }, avds, message: "The Android SDK and JDK are ready, but no virtual device exists. Create one in Android Studio's Device Manager and Foundry will boot it automatically." };
  }
  return {
    ready: true,
    sdk: true,
    jdk: { version: jdk.version, source: jdk.source },
    avds,
    message: `Ready to build and run on a real Android emulator (JDK ${jdk.version} from ${jdk.source}, device "${avds[0]}").`,
  };
}

export type AndroidLaunchResult =
  | { ok: true; serial: string; avd?: string; apk: string; applicationId?: string; launched: boolean; alreadyRunning: boolean }
  | { ok: false; error: string; needs?: "sdk" | "avd" | "apk" };

/**
 * Boot an AVD if none is running, install the built APK, and launch it — leaving the emulator window
 * available to Foundry's embedded Preview surface. Returns a structured result so the UI can explain any missing piece
 * (SDK, an AVD, or a built APK) instead of silently failing.
 */
export async function launchAndroidEmulator(input: { projectPath: string; preferredAvd?: string; bootTimeoutMs?: number }): Promise<AndroidLaunchResult> {
  const tools = resolveAndroidTools();
  if (!tools) {
    return { ok: false, needs: "sdk", error: "No Android SDK found. Install Android Studio (or the command-line SDK) and create a virtual device, then Foundry can run the app on a real emulator." };
  }

  const apk = findApk(input.projectPath);
  if (!apk) {
    return { ok: false, needs: "apk", error: "No built APK was found in the project. Build the Android app first (e.g. `./gradlew assembleDebug`), then launch it on the emulator." };
  }

  let serial = attachedDevices(tools)[0];
  let avd: string | undefined;
  let alreadyRunning = Boolean(serial);

  if (!serial) {
    const avds = listAvds(tools);
    if (!avds.length) {
      return { ok: false, needs: "avd", error: "The Android SDK is installed but has no virtual device. Create one in Android Studio's Device Manager, then Foundry can boot it." };
    }
    avd = input.preferredAvd && avds.includes(input.preferredAvd) ? input.preferredAvd : avds[0];
    const child = spawn(tools.emulator, ["-avd", avd, "-netdelay", "none", "-netspeed", "full", "-no-window", "-no-audio"], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();

    // Wait for adb to see the device, then for Android to finish booting.
    const deadline = Date.now() + (input.bootTimeoutMs ?? 120_000);
    while (Date.now() < deadline && !serial) {
      await delay(2_000);
      serial = attachedDevices(tools)[0];
    }
    if (!serial) return { ok: false, error: `The emulator "${avd}" did not come online before the timeout.` };
    while (Date.now() < deadline && !bootCompleted(tools, serial)) {
      await delay(2_000);
    }
    if (!bootCompleted(tools, serial)) return { ok: false, error: `The emulator "${avd}" booted its device but the Android system was not ready before the timeout.` };
    alreadyRunning = false;
  }

  const install = spawnSync(tools.adb, ["-s", serial, "install", "-r", "-t", apk], { encoding: "utf8", timeout: 180_000 });
  const installOutput = `${install.stdout || ""}${install.stderr || ""}`;
  if (install.status !== 0 && !/Success/i.test(installOutput)) {
    return { ok: false, error: `Installing the APK on the emulator failed: ${installOutput.replace(/\s+/g, " ").trim().slice(0, 300) || "unknown adb error"}` };
  }

  const applicationId = readApplicationId(input.projectPath);
  let launched = false;
  if (applicationId) {
    const start = spawnSync(tools.adb, ["-s", serial, "shell", "monkey", "-p", applicationId, "-c", "android.intent.category.LAUNCHER", "1"], { encoding: "utf8", timeout: 20_000 });
    launched = start.status === 0 && !/No activities found/i.test(`${start.stdout || ""}${start.stderr || ""}`);
  }

  return { ok: true, serial, avd, apk, applicationId, launched, alreadyRunning };
}

export function captureAndroidEmulatorFrame(serial?: string): { ok: true; imageBase64: string; serial: string } | { ok: false; error: string } {
  const tools = resolveAndroidTools();
  if (!tools) return { ok: false, error: "No Android SDK is available." };
  const activeSerial = serial || attachedDevices(tools)[0];
  if (!activeSerial) return { ok: false, error: "No running Android emulator is available." };
  const frame = spawnSync(tools.adb, ["-s", activeSerial, "exec-out", "screencap", "-p"], { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
  if (frame.status !== 0 || !Buffer.isBuffer(frame.stdout) || frame.stdout.length < 100) {
    return { ok: false, error: "The running emulator did not return a display frame." };
  }
  return { ok: true, imageBase64: frame.stdout.toString("base64"), serial: activeSerial };
}

export function sendAndroidEmulatorTap(x: number, y: number, serial?: string): { ok: true } | { ok: false; error: string } {
  const tools = resolveAndroidTools();
  if (!tools) return { ok: false, error: "No Android SDK is available." };
  const activeSerial = serial || attachedDevices(tools)[0];
  if (!activeSerial) return { ok: false, error: "No running Android emulator is available." };
  if (![x, y].every(Number.isFinite) || x < 0 || y < 0) return { ok: false, error: "Invalid emulator coordinates." };
  const tapped = spawnSync(tools.adb, ["-s", activeSerial, "shell", "input", "tap", String(Math.round(x)), String(Math.round(y))], { encoding: "utf8", timeout: 10_000 });
  return tapped.status === 0 ? { ok: true } : { ok: false, error: "The emulator did not accept the touch input." };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
