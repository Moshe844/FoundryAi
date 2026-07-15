const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { startManagedStaticPreview } = require("./helpers/managed-static-preview.cjs");

const projectName = process.argv[2] || "simple-baby-headbands-catalogue-3";
const root = path.resolve(__dirname, "..", "projects", projectName);

(async () => {
  const preview = process.argv[3] ? null : await startManagedStaticPreview(root);
  const url = process.argv[3] || preview.url;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const consoleErrors = [];
    const failedRequests = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`));

    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    assert.equal(response?.status(), 200, "the generated catalogue responds successfully");
    const heading = (await page.locator("h1").first().textContent())?.trim();
    assert.ok(heading, "the catalogue has a visible brand heading");

    const search = page.locator('input[type="search"], input[id*="search" i], input[placeholder*="search" i]').first();
    await search.waitFor({ state: "visible" });
    const cards = page.locator("main .card, main .product-card, main article");
    const initialCount = await cards.count();
    assert.ok(initialCount >= 3, `the catalogue should render at least three products, received ${initialCount}`);
    const firstTitle = (await cards.first().locator(".title, h2, h3").first().textContent())?.trim();
    assert.ok(firstTitle, "the first product has a searchable title");

    await search.fill(firstTitle);
    await page.waitForTimeout(250);
    const filteredCount = await cards.count();
    assert.equal(filteredCount, 1, `searching for the exact first product should return one card, received ${filteredCount}`);
    assert.equal((await cards.first().locator(".title, h2, h3").first().textContent())?.trim(), firstTitle);

    const action = cards.first().locator("button, a").first();
    if (await action.count()) await action.click();
    await page.waitForTimeout(100);
    assert.deepEqual(consoleErrors, [], "the real catalogue flow has no browser errors");
    assert.deepEqual(failedRequests, [], "the real catalogue flow has no failed local requests");

    const screenshotPath = path.join(root, ".foundry-validation", "catalogue-mobile.png");
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(JSON.stringify({ verified: true, heading, initialCount, filteredCount, firstTitle, screenshotPath }, null, 2));
  } finally {
    await browser.close();
    await preview?.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
