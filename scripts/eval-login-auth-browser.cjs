const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { startManagedStaticPreview } = require("./helpers/managed-static-preview.cjs");

const projectName = process.argv[2] || "login-auth-page-2";
const projectRoot = path.resolve(__dirname, "..", "projects", projectName);
const screenshotPath = path.resolve(__dirname, "..", "projects", projectName, ".foundry-artifacts", "validation", "login-auth-interaction.png");

(async () => {
  const preview = process.argv[3] ? null : await startManagedStaticPreview(projectRoot);
  const url = process.argv[3] || preview.url;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    assert.equal(response?.status(), 200, "the generated login page responds successfully");

    const semantics = await page.locator("body").evaluate((body) => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
      };
      return {
        regions: Array.from(body.querySelectorAll("main, article, section, form, nav, [role='main'], [role='form'], [role='list'], [role='listitem']")).filter(visible).length,
        controls: Array.from(body.querySelectorAll("button, input, select, textarea, a[href]")).filter(visible).length,
        textLength: (body.textContent || "").replace(/\s+/g, " ").trim().length,
      };
    });
    assert.ok(semantics.textLength >= 80, "the login page has meaningful visible content");
    assert.ok(semantics.regions >= 1 || semantics.controls >= 2, "form-driven pages satisfy semantic preview acceptance");

    let status = "";
    if (await page.locator("#authForm").count()) {
      await page.locator("#signupTab").click();
      await page.locator("#name").fill("Foundry Engineer");
      await page.locator("#email").fill("engineer@example.com");
      await page.locator("#password").fill("correct-horse");
      await page.locator("#confirmPassword").fill("correct-horse");
      await page.locator("#submitButton").click();
      await page.locator("#password").fill("correct-horse");
      await page.locator("#submitButton").click();
      status = (await page.locator("#status").textContent())?.trim() || "";
    } else {
      await page.locator("#login-email").fill("engineer@example.com");
      await page.locator("#login-password").fill("correct-horse");
      await page.locator("#login-submit").click();
      status = (await page.locator("#status-helper").textContent())?.trim() || "";
    }
    assert.match(status, /Welcome back, (?:engineer|Foundry Engineer)/i, "signup and login produce real feedback");
    assert.deepEqual(errors, [], "the login interaction has no browser or console errors");
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(JSON.stringify({ passed: true, url, semantics, status, screenshotPath, paidModelCalls: 0 }));
  } finally {
    await browser.close();
    await preview?.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
