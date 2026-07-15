const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.FOUNDRY_URL || "http://127.0.0.1:3001";
const storageKey = "foundry.missionThreads.v9";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const failedLocalRequests = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => {
    if (/^https?:\/\/(?:127\.0\.0\.1|localhost)/.test(request.url())) {
      const failure = request.failure()?.errorText || "failed";
      // The client intentionally closes the NDJSON response after it has consumed the terminal
      // result. Chromium reports that completed stream cleanup as ERR_ABORTED even though the
      // mission and preview are already durably complete.
      if (request.url().includes("/api/factory/create?stream=1") && failure === "net::ERR_ABORTED") return;
      // Next.js cancels disposable React Server Component navigations when the workspace switches
      // from discovery to the live mission canvas. That is client-router cleanup, not a failed app
      // request; keep every other local failure visible to this end-to-end gate.
      if (failure === "net::ERR_ABORTED" && new URL(request.url()).searchParams.has("_rsc")) return;
      failedLocalRequests.push(`${request.method()} ${request.url()}: ${failure}`);
    }
  });

  try {
    await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ missions: [] })), { key: storageKey });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { name: "Projects", exact: true }).waitFor({ timeout: 15_000 });
    await page.waitForLoadState("load");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: /Custom Build/ }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "What do you want to build?" }).waitFor();
    await dialog.getByPlaceholder(/warehouse system tracking pallets/i).fill("A compact household chore tracker with assignments, due dates, completion filters, and local persistence");
    await dialog.getByRole("button", { name: /Continue/ }).click();
    await dialog.getByRole("heading", { name: "Where should this live?" }).waitFor();
    await dialog.getByRole("button", { name: /Continue/ }).click();

    await dialog.getByRole("heading", { name: /Pick a stack/ }).waitFor({ timeout: 60_000 });
    await dialog.getByPlaceholder(/type any language or framework/i).fill("HTML + CSS + Vanilla JS");
    await dialog.getByRole("button", { name: /Continue/ }).click();
    await dialog.getByRole("heading", { name: "What should this feel like?" }).waitFor();
    await dialog.getByRole("button", { name: "Minimal & Clean" }).click();
    await dialog.getByRole("button", { name: /Continue/ }).click();
    await dialog.getByText("Foundry's Understanding", { exact: true }).first().waitFor();
    await dialog.getByRole("button", { name: /Continue/ }).click();
    await dialog.getByRole("heading", { name: "Anything else Foundry should know?" }).waitFor();
    await dialog.getByPlaceholder(/roles, pages, workflows/i).fill("Use realistic sample chores, make every control keyboard accessible, and keep all data local to the browser.");
    await dialog.getByRole("button", { name: /Looks good.*build it/ }).click();
    await dialog.waitFor({ state: "detached" });

    await page.getByText("Done", { exact: true }).waitFor({ timeout: 240_000 });
    const preview = page.frameLocator('iframe[title="Interactive live preview"]');
    await preview.locator("body").waitFor({ timeout: 30_000 });
    const visibleText = (await preview.locator("body").innerText()).replace(/\s+/g, " ").trim();
    assert.ok(visibleText.length >= 100, `the completed preview should contain meaningful content, received ${visibleText.length} characters`);
    assert.ok((await preview.locator("button, input, select, textarea, a[href]").count()) >= 2, "the completed preview exposes real interactive controls");
    const screenshotPath = path.resolve(process.cwd(), "tmp", "live-factory-ui.png");
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    assert.deepEqual(errors, [], "the full factory UI journey has no browser/page errors");
    assert.deepEqual(failedLocalRequests, [], "the full factory UI journey has no failed local requests");

    console.log(JSON.stringify({ passed: true, baseUrl, previewTextLength: visibleText.length, interactiveControls: await preview.locator("button, input, select, textarea, a[href]").count(), screenshotPath }, null, 2));
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "<body unavailable>");
    throw new Error(`${error instanceof Error ? error.stack || error.message : String(error)}\n\nVisible UI tail:\n${body.slice(-6_000)}`);
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
