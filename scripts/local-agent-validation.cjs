const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ownedDesktopProcesses = new Map();

function pathIsInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function projectsOverlap(left, right) {
  return pathIsInside(left, right) || pathIsInside(right, left);
}

function processIsAlive(processId) {
  try { process.kill(processId, 0); return true; } catch { return false; }
}

function killProcessTree(processId) {
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(processId), "/t", "/f"], { stdio: "ignore", windowsHide: true, timeout: 8000 });
    return;
  }
  try { process.kill(processId, "SIGTERM"); } catch { /* Verify below. */ }
}

async function waitForExit(processId, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(processId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processIsAlive(processId);
}

function commandProducesBuildArtifacts(command) {
  const normalized = String(command || "").trim().replace(/\s+/g, " ");
  return /\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:build|compile|package)\b/i.test(normalized)
    || /\bdotnet\s+(?:build|publish|pack|test)\b/i.test(normalized)
    || /\b(?:msbuild|xbuild)(?:\.exe)?\b/i.test(normalized)
    || /\b(?:cargo|swift)\s+(?:build|test)\b/i.test(normalized)
    || /\bgo\s+(?:build|install|test)\b/i.test(normalized)
    || /\b(?:gradle|gradlew)(?:\.bat)?\b[^\r\n]*(?:build|assemble|bundle|test)\b/i.test(normalized)
    || /\bmvnw?(?:\.cmd)?\b[^\r\n]*(?:package|verify|install|test)\b/i.test(normalized)
    || /\b(?:cmake\s+--build|ninja\b|make\b|xcodebuild\b|flutter\s+build\b|python(?:3)?\s+-m\s+build\b|mix\s+(?:compile|test)\b)/i.test(normalized);
}

async function suspendOwnedDesktopProcesses(projectPath) {
  const matching = Array.from(ownedDesktopProcesses.values()).filter((record) => projectsOverlap(projectPath, record.projectPath));
  const suspended = [];
  const failed = [];
  for (const record of matching) {
    if (!processIsAlive(record.processId)) {
      ownedDesktopProcesses.delete(record.processId);
      continue;
    }
    killProcessTree(record.processId);
    if (await waitForExit(record.processId)) {
      suspended.push(record);
      ownedDesktopProcesses.delete(record.processId);
    } else {
      failed.push(record);
    }
  }
  return { suspended, failed };
}

async function resumeOwnedDesktopProcesses(records) {
  const resumed = [];
  const failed = [];
  for (const record of records) {
    if (!fs.existsSync(record.executable)) {
      failed.push({ record, reason: "The rebuilt executable was not produced." });
      continue;
    }
    try {
      const child = spawn(record.executable, record.args, { cwd: path.dirname(record.executable), windowsHide: false, detached: true, stdio: "ignore" });
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
      });
      if (!child.pid) throw new Error("The operating system did not return a process id.");
      const resumedRecord = { ...record, processId: child.pid };
      ownedDesktopProcesses.set(child.pid, resumedRecord);
      child.once("exit", () => ownedDesktopProcesses.delete(child.pid));
      child.unref();
      resumed.push(resumedRecord);
    } catch (error) {
      failed.push({ record, reason: error instanceof Error ? error.message : "The desktop app could not be relaunched." });
    }
  }
  return { resumed, failed };
}

function executableAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { windowsHide: true, encoding: "utf8", timeout: 5000 });
  return !result.error && result.status === 0;
}

function validationCapabilities() {
  let playwright = false;
  try { require.resolve("playwright"); playwright = true; } catch { /* dependency unavailable */ }
  return {
    browser: { available: playwright, engine: playwright ? "playwright-chromium" : undefined, reason: playwright ? undefined : "Playwright is not installed in the Local Agent." },
    android: { available: executableAvailable("adb", ["version"]), adb: executableAvailable("adb", ["version"]), reason: executableAvailable("adb", ["version"]) ? undefined : "Android platform-tools (adb) were not found." },
    ios: { available: process.platform === "darwin" && executableAvailable("xcrun", ["simctl", "help"]), reason: process.platform === "darwin" ? "Xcode simctl was not found." : "iOS simulation requires a macOS Local Agent with Xcode." },
    desktop: {
      available: true,
      platform: process.platform,
      interaction: process.platform === "win32",
      driver: process.platform === "win32" ? "windows-ui-automation" : undefined,
      reason: process.platform === "win32"
        ? "Native launch and named-control interaction are available through Windows UI Automation."
        : "Native app launch is available; semantic UI interaction requires a host accessibility driver.",
    },
  };
}

function assertLoopbackUrl(rawUrl) {
  const parsed = new URL(String(rawUrl || ""));
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Browser validation only supports HTTP(S) URLs.");
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) throw new Error("The Local Agent only browser-tests loopback preview URLs.");
  return parsed.toString();
}

function safeArtifactPath(root, relativePath) {
  const artifactsRoot = path.resolve(root, ".foundry-artifacts", "validation");
  const target = path.resolve(artifactsRoot, String(relativePath || "artifact.png").replace(/^[/\\]+/, ""));
  if (target !== artifactsRoot && !target.startsWith(`${artifactsRoot}${path.sep}`)) throw new Error("Artifact path escapes the validation directory.");
  return target;
}

function screenshotArtifactName(value) {
  const requested = String(value || "").trim();
  if (!requested || /^(?:null|undefined|none)$/i.test(requested)) return `browser-${Date.now()}.png`;
  return /\.(?:png|jpe?g|webp)$/i.test(requested) ? requested : `${requested}.png`;
}

async function runBrowserValidation(input) {
  const { chromium } = require("playwright");
  const url = assertLoopbackUrl(input.url);
  const viewport = { width: Math.max(320, Math.min(3840, Number(input.viewport?.width || 1440))), height: Math.max(320, Math.min(2160, Number(input.viewport?.height || 900))) };
  const browser = await chromium.launch({ headless: input.headless !== false });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  const steps = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText || "request failed" }));
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.max(3000, Math.min(120000, Number(input.timeoutMs || 30000))) });
    await page.locator("body").waitFor({ state: "visible", timeout: 5000 });
    steps.push({ action: "navigate", target: url, ok: Boolean(response?.ok()), status: response?.status() });
    for (const raw of Array.isArray(input.actions) ? input.actions.slice(0, 50) : []) {
      const action = String(raw.action || "");
      const selector = String(raw.selector || "");
      if (action === "click") await page.locator(selector).click();
      else if (action === "fill") await page.locator(selector).fill(String(raw.value || ""));
      else if (action === "type") await page.locator(selector).pressSequentially(String(raw.value || ""));
      else if (action === "press") await page.locator(selector || "body").press(String(raw.key || "Enter"));
      else if (action === "check") await page.locator(selector).check();
      else if (action === "select") await page.locator(selector).selectOption(String(raw.value || ""));
      else if (action === "wait") await page.waitForTimeout(Math.max(0, Math.min(10000, Number(raw.ms || 500))));
      else if (action === "assert-text") await page.getByText(String(raw.text || ""), { exact: Boolean(raw.exact) }).first().waitFor({ state: "visible" });
      else if (action === "assert-count") { const count = await page.locator(selector).count(); if (count !== Number(raw.expected)) throw new Error(`Expected ${selector} to match ${raw.expected} element(s), but found ${count}.`); }
      else throw new Error(`Unsupported browser action: ${action}`);
      steps.push({ action, target: selector || raw.text || "page", ok: true });
    }
    const screenshotPath = safeArtifactPath(input.root, screenshotArtifactName(input.screenshotName));
    await fsp.mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: input.fullPage !== false });
    const title = await page.title();
    const visibleText = (await page.locator("body").innerText()).slice(0, 12000);
    const actualViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const viewportMatched = actualViewport.width === viewport.width && actualViewport.height === viewport.height;
    const result = { available: true, verified: Boolean(response?.ok()) && viewportMatched && consoleErrors.length === 0 && failedRequests.length === 0, url: page.url(), title, viewport: actualViewport, steps, consoleErrors, failedRequests, screenshotPath, visibleText, reason: viewportMatched ? undefined : `Requested ${viewport.width}x${viewport.height}, but browser rendered ${actualViewport.width}x${actualViewport.height}.` };
    if (input.baselineScreenshot) result.visualComparison = await compareScreenshots(input.root, input.baselineScreenshot, screenshotPath, input.diffName);
    return result;
  } finally {
    await browser.close();
  }
}

async function compareScreenshots(root, baselineRelativePath, actualPath, diffName = `diff-${Date.now()}.png`) {
  const { PNG } = require("pngjs");
  const pixelmatch = (await import("pixelmatch")).default;
  const baselinePath = safeArtifactPath(root, baselineRelativePath);
  const baseline = PNG.sync.read(await fsp.readFile(baselinePath));
  const actual = PNG.sync.read(await fsp.readFile(actualPath));
  if (baseline.width !== actual.width || baseline.height !== actual.height) return { comparable: false, reason: `Image sizes differ: ${baseline.width}x${baseline.height} vs ${actual.width}x${actual.height}.` };
  const diff = new PNG({ width: actual.width, height: actual.height });
  const changedPixels = pixelmatch(baseline.data, actual.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
  const diffPath = safeArtifactPath(root, diffName);
  await fsp.mkdir(path.dirname(diffPath), { recursive: true });
  await fsp.writeFile(diffPath, PNG.sync.write(diff));
  return { comparable: true, changedPixels, changedRatio: changedPixels / (actual.width * actual.height), diffPath };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timeout); resolve(result); };
    const timeout = setTimeout(() => { child.kill(); finish({ exitCode: null, stdout, stderr: `${stderr}\nTimed out.`.trim(), durationMs: Date.now() - startedAt }); }, options.timeoutMs || 30000);
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish({ exitCode: null, stdout, stderr: error.message, durationMs: Date.now() - startedAt }));
    child.on("close", (exitCode) => finish({ exitCode, stdout, stderr, durationMs: Date.now() - startedAt }));
  });
}

function safeIdentifier(value, label) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_.%\-/$]+$/.test(text)) throw new Error(`${label} contains unsupported characters.`);
  return text;
}

async function runAndroidValidation(input) {
  if (!validationCapabilities().android.available) return { available: false, verified: false, reason: "Android platform-tools (adb) were not found." };
  const action = String(input.action || "devices");
  if (action === "devices") return { available: true, action, ...(await runProcess("adb", ["devices", "-l"])) };
  if (action === "install") { const apk = path.resolve(input.root, String(input.apkPath || "")); if (apk !== path.resolve(input.root) && !apk.startsWith(`${path.resolve(input.root)}${path.sep}`)) throw new Error("APK must be inside the connected project."); return { available: true, action, ...(await runProcess("adb", ["install", "-r", apk], { timeoutMs: 120000 })) }; }
  if (action === "launch") return { available: true, action, ...(await runProcess("adb", ["shell", "am", "start", "-W", "-n", safeIdentifier(input.component, "Android component")])) };
  if (action === "tap") return { available: true, action, ...(await runProcess("adb", ["shell", "input", "tap", String(Math.round(Number(input.x))), String(Math.round(Number(input.y))) ])) };
  if (action === "text") return { available: true, action, ...(await runProcess("adb", ["shell", "input", "text", safeIdentifier(String(input.text || "").replace(/ /g, "%s"), "Android input text")])) };
  if (action === "keyevent") return { available: true, action, ...(await runProcess("adb", ["shell", "input", "keyevent", safeIdentifier(input.key || "KEYCODE_ENTER", "Android key event")])) };
  if (action === "logcat") return { available: true, action, ...(await runProcess("adb", ["logcat", "-d", "-t", String(Math.max(1, Math.min(1000, Number(input.lines || 300))))])) };
  if (action === "screenshot") { const output = safeArtifactPath(input.root, input.screenshotName || `android-${Date.now()}.png`); await fsp.mkdir(path.dirname(output), { recursive: true }); const binary = spawnSync("adb", ["exec-out", "screencap", "-p"], { encoding: null, maxBuffer: 20_000_000 }); if (binary.status === 0) await fsp.writeFile(output, binary.stdout); return { available: true, verified: binary.status === 0, screenshotPath: output, exitCode: binary.status, stderr: binary.stderr?.toString() || "" }; }
  throw new Error(`Unsupported Android action: ${action}`);
}

async function runIosValidation(input) {
  if (!validationCapabilities().ios.available) return { available: false, verified: false, reason: process.platform === "darwin" ? "Xcode simctl was not found." : "iOS simulation requires a macOS Local Agent with Xcode." };
  const action = String(input.action || "devices");
  if (action === "devices") return { available: true, action, ...(await runProcess("xcrun", ["simctl", "list", "devices", "--json"])) };
  if (action === "launch") return { available: true, action, ...(await runProcess("xcrun", ["simctl", "launch", safeIdentifier(input.device || "booted", "Simulator device"), safeIdentifier(input.bundleId, "Bundle id")])) };
  if (action === "screenshot") { const output = safeArtifactPath(input.root, input.screenshotName || `ios-${Date.now()}.png`); await fsp.mkdir(path.dirname(output), { recursive: true }); const result = await runProcess("xcrun", ["simctl", "io", safeIdentifier(input.device || "booted", "Simulator device"), "screenshot", output]); return { available: true, verified: result.exitCode === 0, screenshotPath: output, ...result }; }
  throw new Error(`Unsupported iOS action: ${action}`);
}

async function runDesktopValidation(input) {
  const executable = path.resolve(input.root, String(input.executable || ""));
  if (executable !== path.resolve(input.root) && !executable.startsWith(`${path.resolve(input.root)}${path.sep}`)) throw new Error("Desktop executable must be inside the connected project.");
  if (!fs.existsSync(executable)) return { available: true, verified: false, reason: "Desktop executable was not found." };
  const child = spawn(executable, Array.isArray(input.args) ? input.args.map(String) : [], { cwd: path.dirname(executable), windowsHide: false, detached: true, stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, Math.max(500, Math.min(10000, Number(input.observeMs || 2000)))));
  let running = child.exitCode === null && !child.killed;
  const actions = Array.isArray(input.actions) ? input.actions.filter((action) => action && typeof action === "object") : [];
  let interaction = { verified: false, reason: actions.length ? "Desktop interaction is unavailable on this host." : "No semantic desktop interaction was requested.", steps: [], windowTitles: [] };
  if (running && actions.length && process.platform === "win32" && child.pid) {
    const actionsBase64 = Buffer.from(JSON.stringify(actions), "utf8").toString("base64");
    const automation = await runProcess("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", path.join(__dirname, "validate-windows-desktop-ui.ps1"),
      "-ProcessId", String(child.pid),
      "-ActionsBase64", actionsBase64,
      "-TimeoutMs", String(Math.max(1000, Math.min(15000, Number(input.interactionTimeoutMs || 8000)))),
    ], { timeoutMs: Math.max(5000, Math.min(20000, Number(input.interactionTimeoutMs || 8000) + 5000)) });
    try {
      interaction = JSON.parse(automation.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}");
    } catch {
      interaction = { verified: false, reason: automation.stderr || automation.stdout || "Windows UI Automation returned no readable result.", steps: [], windowTitles: [] };
    }
    running = child.exitCode === null && !child.killed;
  }
  if (running && child.pid) {
    ownedDesktopProcesses.set(child.pid, {
      projectPath: path.resolve(input.root),
      executable,
      args: Array.isArray(input.args) ? input.args.map(String) : [],
      processId: child.pid,
    });
    child.once("exit", () => ownedDesktopProcesses.delete(child.pid));
    child.unref();
  }
  const interactionVerified = actions.length > 0 && Boolean(interaction.verified);
  return {
    available: true,
    verified: running && (!actions.length || interactionVerified),
    exitCode: child.exitCode,
    pid: child.pid,
    running,
    interactionVerified,
    steps: interaction.steps,
    windowTitles: interaction.windowTitles,
    reason: !running
      ? `The process exited with code ${child.exitCode}.`
      : actions.length
        ? interaction.reason
        : "The process launched and remained alive during the observation window; semantic UI interaction was not requested.",
  };
}

module.exports = {
  validationCapabilities,
  runBrowserValidation,
  compareScreenshots,
  runAndroidValidation,
  runIosValidation,
  runDesktopValidation,
  commandProducesBuildArtifacts,
  suspendOwnedDesktopProcesses,
  resumeOwnedDesktopProcesses,
};
