const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const foundryUrl = process.env.FOUNDRY_URL || "http://127.0.0.1:3001";
const projectId = process.env.PROJECT_ID || "simple-web-login-page-ui-first";

(async () => {
  const previewResponse = await fetch(`${foundryUrl}/api/factory/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, action: "refresh" }),
  });
  const preview = await previewResponse.json();
  assert.equal(preview.previewState, "ready", preview.previewReason || "preview should be ready");
  assert.ok(preview.previewUrl, "preview URL is returned");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(preview.previewUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    assert.ok(response && response.ok(), `preview responds successfully (${response && response.status()})`);

    const signup = page.locator("button:visible, a:visible, [role='button']:visible, [role='tab']:visible").filter({ hasText: /sign\s*up|create account/i }).first();
    assert.ok(await signup.count(), "signup entry is visible");
    await signup.click();
    assert.ok(await page.locator("#name:visible").count(), "signup mode exposes the name field");
    const login = page.locator("button:visible, a:visible, [role='button']:visible, [role='tab']:visible").filter({ hasText: /sign\s*in|log\s*in/i }).first();
    assert.ok(await login.count(), "signup mode provides a route back to sign in");
    await login.click();
    await page.locator("input[type='email']:visible").fill("engineer@example.com");
    await page.locator("input[type='password']:visible").fill("Foundry-preview-42");
    await page.locator("button[type='submit']:visible").click();
    const dashboard = page.locator("[data-dashboard]:visible");
    await dashboard.waitFor({ state: "visible", timeout: 3_000 });
    const metrics = await dashboard.evaluate((element) => ({
      textLength: (element.textContent || "").replace(/\s+/g, " ").trim().length,
      structuredRegions: element.querySelectorAll("header, nav, aside, main, section, article, [role='navigation'], [role='list'], [role='listitem'], .card, [class*='card']").length,
      interactiveControls: element.querySelectorAll("button, a[href], input, select, textarea").length,
    }));
    assert.ok(metrics.textLength >= 140, `dashboard content is substantial (${metrics.textLength})`);
    assert.ok(metrics.structuredRegions >= 3, `dashboard has intentional structure (${metrics.structuredRegions})`);
    assert.ok(metrics.interactiveControls >= 2, `dashboard has meaningful controls (${metrics.interactiveControls})`);
    assert.deepEqual(errors, [], `preview has no browser errors: ${errors.join("; ")}`);
    const screenshotPath = path.resolve(__dirname, "..", "projects", "simple-web-login-page-ui-first", ".foundry-artifacts", "validation", "dashboard-acceptance.png");
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(JSON.stringify({ passed: true, previewUrl: preview.previewUrl, metrics, screenshotPath }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
