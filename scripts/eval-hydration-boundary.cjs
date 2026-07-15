const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.FOUNDRY_URL || "http://127.0.0.1:3001";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const hydrationWarnings = [];
  const pageErrors = [];

  await page.addInitScript(() => {
    const simulateExtension = () => {
      document.documentElement?.setAttribute("data-browser-extension", "active");
      if (document.body) {
        document.body.setAttribute("data-browser-extension-body", "active");
        return;
      }
      requestAnimationFrame(simulateExtension);
    };
    simulateExtension();
  });

  page.on("console", (message) => {
    if (/hydrated|server rendered HTML|didn't match/i.test(message.text())) hydrationWarnings.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { name: "Projects", exact: true }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);

    assert.equal(await page.locator("html").getAttribute("data-browser-extension"), "active", "the simulated extension changed the document root before hydration");
    assert.equal(await page.locator("body").getAttribute("data-browser-extension-body"), "active", "the simulated extension changed the body before hydration");
    assert.deepEqual(hydrationWarnings, [], "extension-owned root attributes do not produce a React hydration mismatch");
    assert.deepEqual(pageErrors, [], "the hydrated Foundry shell has no page errors");

    console.log(JSON.stringify({ passed: true, baseUrl, simulatedRootMutations: 2, hydrationWarnings: 0 }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
