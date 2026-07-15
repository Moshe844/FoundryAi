const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");

const baseUrl = process.env.FOUNDRY_BASE_URL || "http://127.0.0.1:3001";
const brief = `Create Project: Foundry Incident Command Center Canary
Template: Intelligent Project Discovery
Mode: Build new project
Project source: Create inside Foundry workspace
Project name: Foundry Incident Command Center Canary
Project description: Build a polished responsive incident-command application for an operations team managing active service incidents.
Project type: Complex Static Operations Application
Selected stack: HTML/CSS/JS (vanilla)
Architecture: One self-contained, browser-ready index.html with semantic HTML, embedded responsive CSS, embedded JavaScript, realistic seed data, and localStorage persistence.
Style direction: Premium dark operations console with clear hierarchy, restrained teal and amber status colors, excellent spacing, accessible contrast, and intentional desktop and mobile layouts.
Main features: Responsive sidebar and top status bar; KPI cards for active incidents, critical incidents, MTTA, and resolved today; searchable and sortable incident table; severity and status filters; create-incident dialog with validation; incident detail drawer; acknowledge and resolve status transitions; activity timeline; service-health summary; useful empty state; mobile navigation; keyboard-operable interactions.
Data model/entities: Incident: id, title, service, severity, status, owner, startedAt, acknowledgedAt, resolvedAt, summary; Activity: id, incidentId, kind, message, timestamp.
Key facts: This is an interactive product, not a screenshot; every control must work; seed at least six realistic incidents across multiple services and severities; persist user-created incidents locally; never use remote images or external libraries.
Custom instructions: Preserve every requirement above. Include stable acceptance IDs: incident-search, severity-filter, status-filter, new-incident-button, incident-dialog, incident-form, incident-title, incident-service, incident-severity, incident-submit, incident-table, activity-feed. Clicking New incident must open the dialog; submitting valid data must add a visible incident row and activity entry; filters and search must update the table; the layout must remain usable at 390px width.
Factory status: create a real workspace, save the brief, generate supported files, and show actual execution results.`;

async function streamFactory(path, body) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, controlId: randomUUID() }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!response.ok || !response.body) throw new Error(`${path} failed: HTTP ${response.status} ${await response.text()}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const payload = JSON.parse(line);
      if (payload.type === "event") console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${payload.event.status} ${payload.event.title}`);
      if (payload.type === "error") throw new Error(payload.error);
      if (payload.type === "result") finalResult = payload.result;
    }
    if (done) break;
  }
  if (!finalResult) throw new Error(`${path} ended without a result.`);
  return finalResult;
}

async function spend() {
  const response = await fetch(`${baseUrl}/api/settings/models/spend`, { cache: "no-store" });
  return (await response.json()).dailySpend;
}

async function verifyComplexPreview(url, followUp = false) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assert.equal(response?.status(), 200, "complex preview responds successfully");
    await page.locator("body").waitFor();
    const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    for (const required of ["Incident", "Severity", "Activity", "New incident", "MTTA"]) {
      assert.match(bodyText, new RegExp(required, "i"), `complex product visibly includes ${required}`);
    }
    for (const id of ["incident-search", "severity-filter", "status-filter", "new-incident-button", "incident-table", "activity-feed"]) {
      assert.equal(await page.locator(`#${id}`).count(), 1, `complex acceptance control #${id} exists exactly once`);
    }
    const semantics = await page.locator("body").evaluate((body) => ({
      regions: body.querySelectorAll("main,nav,aside,header,section,article,dialog,[role='dialog']").length,
      controls: body.querySelectorAll("button,input,select,textarea,a[href]").length,
      textLength: (body.textContent || "").replace(/\s+/g, " ").trim().length,
    }));
    assert.ok(semantics.regions >= 6, "complex product has a structured multi-region layout");
    assert.ok(semantics.controls >= 8, "complex product exposes a meaningful interaction surface");
    assert.ok(semantics.textLength >= 600, "complex product contains realistic operational content");

    if (!followUp) {
      await page.locator("#new-incident-button").click();
      const dialog = page.locator("#incident-dialog");
      await dialog.waitFor({ state: "visible" });
      await page.locator("#incident-title").fill("Canary API degradation");
      const service = page.locator("#incident-service");
      if (await service.evaluate((element) => element.tagName === "SELECT")) await service.selectOption({ index: 1 });
      else await service.fill("Public API");
      await page.locator("#incident-severity").selectOption({ index: 1 });
      if (await page.locator("#incident-owner").count()) await page.locator("#incident-owner").fill("Canary Engineer");
      if (await page.locator("#incident-summary").count()) await page.locator("#incident-summary").fill("Synthetic browser canary validating the complete incident creation flow.");
      if (await page.locator("#incident-sla").count()) await page.locator("#incident-sla").fill("60");
      await page.locator("#incident-submit").click();
      await page.getByText("Canary API degradation", { exact: false }).first().waitFor();
    } else {
      assert.equal(await page.locator("#sla-risk-banner").count(), 1, "follow-up added the requested SLA risk banner");
      assert.match(await page.locator("body").innerText(), /At risk/i, "follow-up added the requested At risk filter/state");
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert.ok((await page.locator("body").boundingBox())?.width <= 390, "complex product remains bounded at mobile width");
    assert.deepEqual(errors, [], "complex product has no browser or console errors");
    return semantics;
  } finally {
    await browser.close();
  }
}

(async () => {
  const maxAdditionalArgument = process.argv.find((argument) => argument.startsWith("--max-additional="));
  const maxAdditionalUsd = maxAdditionalArgument ? Number(maxAdditionalArgument.slice("--max-additional=".length)) : 0.5;
  assert.ok(Number.isFinite(maxAdditionalUsd) && maxAdditionalUsd > 0, "max additional spend must be a positive number");
  const previewOnlyArgument = process.argv.find((argument) => argument.startsWith("--preview-only="));
  if (previewOnlyArgument) {
    const previewUrl = previewOnlyArgument.slice("--preview-only=".length);
    const semantics = await verifyComplexPreview(previewUrl, false);
    console.log(JSON.stringify({ passed: true, previewOnly: true, previewUrl, semantics }, null, 2));
    return;
  }
  const baseline = await spend();
  const reusePathArgument = process.argv.find((argument) => argument.startsWith("--reuse-path="));
  const reuseUrlArgument = process.argv.find((argument) => argument.startsWith("--reuse-url="));
  const created = reusePathArgument && reuseUrlArgument
    ? {
        projectId: require("node:path").basename(reusePathArgument.slice("--reuse-path=".length)),
        projectPath: reusePathArgument.slice("--reuse-path=".length),
        previewUrl: reuseUrlArgument.slice("--reuse-url=".length),
        status: "passed",
      }
    : await streamFactory("/api/factory/create?stream=1", { brief, modelMode: "auto", quality: "standard" });
  console.log(reusePathArgument ? "REUSED_CREATE_RESULT" : "CREATE_RESULT", JSON.stringify({ projectId: created.projectId, status: created.status, blocker: created.blocker, previewUrl: created.previewUrl, projectPath: created.projectPath }));
  assert.equal(created.status, "passed", created.blocker || "complex creation must pass");
  assert.ok(created.previewUrl, "complex creation returns a preview URL");
  const initialSemantics = process.argv.includes("--skip-initial")
    ? { skipped: true, reason: "Repair run starts from the browser-regressed artifact caught by the prior independent canary." }
    : await verifyComplexPreview(created.previewUrl, false);

  const followUpTask = "Add a polished SLA risk banner above the incident table with stable id sla-risk-banner. It must calculate and display how many active incidents are within 15 minutes of their SLA threshold. Also add a visible At risk option to the existing status filter, preserve every current feature and acceptance ID, keep the mobile layout intentional, and verify the updated interaction in the browser.";
  const followedUp = await streamFactory("/api/factory/existing?stream=1", {
    brief,
    task: followUpTask,
    files: [],
    localPath: created.projectPath,
    modelMode: "auto",
    quality: "standard",
  });
  console.log("FOLLOWUP_RESULT", JSON.stringify({ status: followedUp.status, blocker: followedUp.blocker, previewUrl: followedUp.previewUrl }));
  assert.equal(followedUp.status, "passed", followedUp.blocker || "complex follow-up must pass");
  assert.ok(followedUp.previewUrl, "complex follow-up returns a preview URL");
  const followUpSemantics = await verifyComplexPreview(followedUp.previewUrl, true);
  const finalSpend = await spend();
  const additionalCostUsd = Number((finalSpend.actualCostUsd - baseline.actualCostUsd).toFixed(6));
  assert.ok(additionalCostUsd <= maxAdditionalUsd, `live canaries exceeded the authorized $${maxAdditionalUsd.toFixed(2)} allowance: $${additionalCostUsd}`);
  console.log(JSON.stringify({ passed: true, projectId: created.projectId, initialSemantics, followUpSemantics, baselineCostUsd: baseline.actualCostUsd, finalCostUsd: finalSpend.actualCostUsd, additionalCostUsd, remainingAuthorizedUsd: finalSpend.remainingUsd }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
