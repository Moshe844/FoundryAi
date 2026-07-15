const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function main() {
  const root = path.resolve(__dirname, "..", "projects", "simple-baby-headbands-catalouge");
  const artifactDir = path.join(root, ".foundry-artifacts", "validation");
  fs.mkdirSync(artifactDir, { recursive: true });
  const screenshotPath = path.join(artifactDir, "catalogue-file-mode.png");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, "index.html")).href, { waitUntil: "load" });
    await page.getByText("Baby Boutique", { exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.locator(".card").count(), 5);
    await page.locator("#search").fill("velvet");
    assert.equal(await page.locator(".card").count(), 1);
    await page.locator("#toggle-maker").click();
    await page.getByText("Maker Panel", { exact: true }).waitFor({ state: "visible" });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ verified: true, cardsBeforeSearch: 5, cardsAfterSearch: 1, makerMode: "visible", consoleErrors, pageErrors, screenshotPath }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
