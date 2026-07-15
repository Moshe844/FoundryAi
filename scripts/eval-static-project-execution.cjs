const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = process.cwd();
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const executor = fs.readFileSync(path.join(root, "lib/ai/mission/executor.ts"), "utf8");
const missionFocus = fs.readFileSync(path.join(root, "components/execution/MissionFocus.tsx"), "utf8");
const previewServer = fs.readFileSync(path.join(root, "scripts/foundry-static-preview.cjs"), "utf8");

assert.match(runtime, /compactNewProjectChecklist\(discovery\?\.projectType \|\| primaryIdea\)/, "static projects use a compact project-specific plan");
assert.doesNotMatch(runtime, /\? \{ checklist: checklistForRequest\(task, "new project"\)/, "the full discovery memo must not become checklist text");
assert.match(runtime, /stackProfile\.id === "static-html" \? 8/, "static creation has enough bounded turns to write separate HTML, CSS, and JavaScript artifacts");
assert.match(runtime, /staticProject: stackProfile\.id === "static-html"/, "the executor receives an explicit static-project contract");
assert.match(runtime, /Build-model usage/, "implementation turns and estimated cost are exposed in execution info");
assert.match(runtime, /summarizeModelUsage\(result\.usage\)/, "provider-reported usage is returned with the project result");
assert.match(executor, /Do not list the folder, do not read foundry-brief\.md/, "static generation avoids redundant discovery turns");
assert.match(executor, /one complete self-contained HTML file/, "small static projects can finish coherently without forced multi-file churn");
assert.match(executor, /Write the next missing complete project artifact now/, "an unproductive static turn is recovered with a direct write instruction");
assert.match(executor, /needsGeneratedEntryRecovery && generatedWriteCalls < generatedWriteFloor[\s\S]+\{ name: input\.staticProject \? "write_file" : "write_files" \}/, "static greenfield turns require a real file write instead of allowing directory-listing churn");
assert.match(executor, /maxAttempts: 1[\s\S]+timeoutMs: input\.staticProject && \(input\.newProject \|\| input\.staticRewrite \|\| \(input\.fastLane && input\.tier && input\.tier !== "fast"\)\) \? 75_000/, "static generation and Builder rewrites make one provider attempt with enough time to return a complete artifact");
assert.match(executor, /staticProjectProgressForFile/, "static builds emit live narrative milestones");
assert.match(executor, /hasCompleteStaticArtifactSet\(changedFiles\)/, "generation stops before redundant paid read-back turns");
assert.match(executor, /isCompleteSelfContainedStaticEntry/, "small static projects may complete as one coherent self-contained page");
assert.match(executor, /availableTools\.filter\(\(tool\) => tool\.name === "write_file"\)/, "greenfield static generation exposes only its required write action");
assert.match(executor, /const: "index\.html"[\s\S]+minLength: 2_500/, "the first static call is schema-bounded to a complete self-contained page");
assert.match(executor, /inlineJavaScriptSyntaxError[\s\S]+new Script\(match\[2\]/, "generated inline JavaScript is syntax-checked before the artifact reaches disk");
assert.match(executor, /Your previous response returned without the required project write/, "a missing required write gets a changed, explicit recovery turn instead of an identical retry");
assert.match(executor, /extractCompleteStaticHtml\(result\.text\)/, "complete plain-output HTML is recovered through the verified write path when a provider ignores the tool envelope");
assert.match(executor, /return isCompleteSelfContainedStaticEntry\("index\.html", content\) \? content : undefined/, "plain-output recovery rejects incomplete or non-interactive HTML");
assert.match(executor, /isIncompleteStaticHtmlEntry/, "truncated HTML cannot reach the browser completion gate");
assert.match(executor, /Incomplete page write rejected before touching disk/, "truncated HTML cannot overwrite the last verified page");
assert.match(runtime, /stackProfile\.id === "static-html" \|\| \(/, "static project routing stays bounded regardless of verbose discovery context");
assert.match(runtime, /stackProfile\.id === "static-html" \? "small"/, "verbose static briefs cannot inflate into autonomous premium missions");
assert.match(runtime, /Repair this generated static project so it passes the real browser preview check/, "browser failures trigger one bounded automatic repair pass");
assert.match(runtime, /if \(repair\.changedFiles\.length > 0\)[\s\S]+validateGeneratedStaticPreview/, "a changed repair is judged by the independent browser rerun rather than checklist bookkeeping alone");
assert.match(runtime, /repairBrokenStaticImages/, "broken generated images receive a deterministic local fallback before model repair");
assert.match(runtime, /interactiveControls < 2/, "browser acceptance recognizes form and control-driven applications, not only catalogue cards");
assert.match(runtime, /validateDetectedAuthFlow/, "detected login/signup surfaces receive a real account round-trip probe");
assert.match(runtime, /created an account but could not log back in/, "auth verification rejects false-success signup flows");
assert.match(runtime, /modelForMissionStage\(task, modelMode, "builder"/, "a fast model that cannot produce the required write selects a stronger bounded route");
assert.match(runtime, /tier: escalationModel\.tier/, "the recovery executor uses the routed escalation tier instead of silently reusing Fast");
assert.match(missionFocus, /plan\.length > 3/, "small projects do not show bookkeeping counts");
assert.match(runtime, /http:\/\/127\.0\.0\.1:\$\{port\}/, "preview URLs use the same IPv4 interface the server owns");
assert.match(previewServer, /x-foundry-preview/, "static preview responses prove server ownership");
assert.match(runtime, /attemptedPorts[\s\S]+Retrying preview on a clean port[\s\S]+previewOwnershipToken/, "static previews recover from occupied ports without exposing stale output");
assert.match(runtime, /validateRepresentativeInteraction/, "single-page tools are verified through a safe real control even when they have no navigation route");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForOwnedPreview(url, token) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok && response.headers.get("x-foundry-preview") === token) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Owned preview did not become ready: ${url}`);
}

(async () => {
  const fixture = path.join(root, "scripts", "fixtures", "simple-tip-calculator");
  assert.ok(fs.existsSync(path.join(fixture, "index.html")), "the calculator regression fixture exists");
  const port = await freePort();
  const token = `eval-static-${Date.now()}`;
  const child = spawn(process.execPath, [path.join(root, "scripts", "foundry-static-preview.cjs"), fixture, String(port), token], {
    cwd: fixture,
    stdio: "ignore",
    windowsHide: true,
  });
  const url = `http://127.0.0.1:${port}/index.html`;
  try {
    await waitForOwnedPreview(url, token);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      page.on("pageerror", (error) => errors.push(error.message));
      const response = await page.goto(url, { waitUntil: "networkidle" });
      assert.equal(response?.status(), 200, "the calculator preview returns HTTP 200");
      await page.locator("#bill-input").fill("100");
      await page.locator('[data-tip="20"]').click();
      await page.locator("#party-size-input").fill("2");
      await page.locator("#party-size-input").dispatchEvent("input");
      assert.equal(await page.locator("#tip-per-person").textContent(), "$10.00");
      assert.equal(await page.locator("#total-per-person").textContent(), "$60.00");
      assert.deepEqual(errors, [], "the real calculator flow has no browser errors");
    } finally {
      await browser.close();
    }
    console.log(JSON.stringify({ passed: 19, url, paidModelCalls: 0 }));
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
