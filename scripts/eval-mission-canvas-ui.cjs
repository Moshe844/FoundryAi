const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.FOUNDRY_URL || "http://localhost:3001";
const storageKey = "foundry.missionThreads.v9";

function workspaceFor(state, options = {}) {
  const now = new Date().toISOString();
  const blocked = state === "waiting_for_approval";
  const complete = state === "complete";
  const providerFailure = Boolean(options.providerFailure);
  const providerFailureReason = "Model provider unavailable after retries: Network request to the AI provider failed: The operation was aborted due to timeout";
  const projectDeletion = Boolean(options.projectDeletionApproval);
  const projectPath = options.projectPath || "C:/tmp/phase-c";
  const requestText = projectDeletion ? "can you delete this project?" : "Add inventory alerts";
  const deletionCommand = `foundry:delete-project-root:${projectPath}`;
  const questions = options.questions ? [
    { question: "Which inventory source should be authoritative?", options: ["Warehouse feed", "Manual counts"] },
    { question: "How quickly should alerts appear?", options: ["Immediately", "Daily digest"] },
  ] : [];
  const timeline = providerFailure
    ? [{ id: "provider-failure", timestamp: now, tier: "flag", kind: "summary", status: "error", title: "AI providers unavailable", details: { reason: providerFailureReason, retryable: true } }]
    : blocked
    ? projectDeletion
      ? [{ id: "approval-1", timestamp: now, tier: "flag", kind: "blocked", status: "warning", title: "Permission needed to delete this project", command: deletionCommand, filePath: projectPath, details: { actionKind: "delete-project", category: "deletes", projectPath, reason: "This permanently deletes the project folder and everything inside it.", topLevelEntries: 3, discoveredFiles: 4, irreversible: true } }]
      : [{ id: "approval-1", timestamp: now, tier: "flag", kind: "blocked", status: "warning", title: "Permission needed: npm install xlsx", command: "npm install xlsx", details: { category: "package-install", reason: "Adds the parser required by the requested import." } }]
    : [{ id: "finding", timestamp: now, tier: "finding", kind: "reasoning", status: "completed", title: "Inventory quantities already exist" }];
  const plan = projectDeletion ? [
    { id: "delete-project-root", label: `Delete the project folder at ${projectPath}`, status: "blocked", phase: "Project deletion", evidence: "Waiting for explicit approval of this exact project path." },
  ] : [
    { id: "understand", label: "Inspect inventory quantities", status: "completed" },
    { id: "implement", label: "Add alert thresholds", status: complete ? "completed" : blocked ? "blocked" : "running" },
    { id: "verify", label: "Verify inventory alerts", status: complete ? "completed" : "pending" },
    ...(options.large ? Array.from({ length: 34 }, (_, index) => ({ id: `later-${index}`, phase: index < 17 ? "Data model" : "Product experience", label: `Large mission item ${index + 1}`, status: "pending" })) : []),
  ];
  const run = {
    id: "run-active", title: projectDeletion ? "Delete this project" : "Add inventory alerts", source_requirements: [requestText], state,
    verification_status: complete ? "passed" : "none", size: options.large ? "huge" : "small", plan,
    files_touched: complete ? [{ path: "src/inventory.ts", status: "edited", verified: true, evidence: "Inventory alert test passed" }] : [],
    commands_run: [], verification: complete ? [{ check_type: "test", result: "pass", evidence: "Inventory alert test passed" }] : [],
    approvals: blocked ? [{ id: "approval-1", command: projectDeletion ? deletionCommand : "npm install xlsx", category: projectDeletion ? "deletes" : "package-install", reason: projectDeletion ? "This permanently deletes the project folder and everything inside it." : "Adds the parser required by the requested import.", requestedAt: now }] : [],
    blocked_reason: providerFailure ? providerFailureReason : undefined,
    summary: complete ? "Inventory alerts are implemented and verified." : providerFailure ? providerFailureReason : "", timeline,
    preview_url: options.preview ? options.previewUrl : undefined, created_at: now, updated_at: now,
  };
  const previous = { ...run, id: "run-history", title: "Create inventory screen", source_requirements: ["Create inventory screen"], state: "complete", verification_status: "passed", approvals: [], summary: "Built and verified the inventory screen.", timeline: [], preview_url: undefined };
  const result = {
    projectId: "phase-c", projectName: "Inventory Platform", objective: requestText, projectPath,
    status: providerFailure ? "failed" : blocked ? "awaiting-approval" : questions.length ? "needs-clarification" : "passed", blocker: providerFailure ? providerFailureReason : blocked ? projectDeletion ? `Permission required to permanently delete the project at ${projectPath}.` : "Waiting for approval to run: npm install xlsx" : undefined,
    events: [], timeline, files: [{ path: "src/inventory.ts", status: "edited", size: 100 }], commands: [], verification: run.verification,
    checklist: plan, previewState: options.preview ? "ready" : "unavailable", previewPlatform: "web", previewUrl: options.preview ? options.previewUrl : undefined,
    sessionSummary: complete ? { outcome: "Inventory alerts are implemented and verified.", changes: ["Added alert thresholds"], preserved: [], flags: [] } : undefined,
    clarificationQuestions: questions.length ? questions : undefined,
  };
  const mission = {
    missionId: "phase-c", conversationTitle: "Inventory Platform", title: "Inventory Platform", objective: `Mode: Work on existing project\nLocal project path: ${projectPath}`,
    status: "active", currentStage: "ready", desiredOutcome: "project", artifactType: "project",
    messages: [{ id: "request", author: "You", initials: "Y", time: "Now", body: requestText, tone: "human", tags: ["Project request"] }],
    attachments: [], createdArtifacts: [
      { id: "brief", sourceMessageId: "request", type: "project", kind: "code", title: "Project Brief", body: "Mode: Work on existing project", description: "", createdAt: now },
      { id: "execution", sourceMessageId: "request", type: "project", kind: "code", title: "Project Execution", body: JSON.stringify(result), description: "", createdAt: now },
    ],
    sources: [], lastResult: "", executionMissions: [previous, run], activeExecutionMissionId: run.id,
    workMemory: { currentGoal: "", currentBlocker: "", completedWork: [], resolvedErrors: [], rejectedHypotheses: [], latestEvidence: [], relevantFiles: [], recommendedNextAction: "", summary: "", updatedAt: now },
    followUpContext: { type: "followUp", summary: "" }, liveWorkEvents: [], createdAt: now, updatedAt: now,
    pendingFollowUp: options.pendingFollowUp ? { task: "Make the inventory header darker", evidenceAttachments: [], queuedAt: now } : undefined,
  };
  if (options.overwrittenFollowUp) {
    const priorRequestAt = Date.now() - 60_000;
    const followUpRequestAt = Date.now() - 5_000;
    const priorRequestId = `message-${priorRequestAt}-brief`;
    const followUpRequestId = `message-${followUpRequestAt}-project-request`;
    mission.messages = [
      { id: priorRequestId, author: "You", initials: "Y", time: "Earlier", body: "Create inventory screen", tone: "human", tags: ["Project brief", "Project request"] },
      { id: followUpRequestId, author: "You", initials: "Y", time: "Now", body: "Make inventory header darker", tone: "human", tags: ["Project request"] },
    ];
    run.request_message_id = priorRequestId;
    run.source_requirements = ["Create inventory screen"];
    run.timeline = [
      { id: "prior-summary", timestamp: new Date(priorRequestAt + 1_000).toISOString(), kind: "summary", status: "completed", title: "Behavior verified" },
      { id: "followup-read", timestamp: new Date(followUpRequestAt + 1_000).toISOString(), kind: "inspection", status: "completed", title: "Read index.html" },
    ];
    mission.executionMissions = [run];
    mission.activeExecutionMissionId = run.id;
  }
  return { activeMissionId: mission.missionId, missions: [mission] };
}

async function openScenario(browser, state, viewport, options) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`${message.text()} @ ${message.location().url || page.url()}`); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  if (options?.preview && options.previewUrl) {
    // The synthetic preview fixture is not owned by Foundry's server-side preview registry. Keep
    // this browser acceptance scenario deterministic by answering its status/refresh probes with
    // the explicitly supplied fixture URL, just as a real owned preview would answer.
    await page.route("**/api/factory/preview", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ previewState: "ready", previewPlatform: "web", previewUrl: options.previewUrl }),
    }));
  }
  await page.addInitScript(({ key, workspace }) => localStorage.setItem(key, JSON.stringify(workspace)), { key: storageKey, workspace: workspaceFor(state, options) });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByLabel("Message Foundry").waitFor({ timeout: 15_000 });
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  return { context, page, consoleErrors };
}

async function openHomeScenario(browser, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`${message.text()} @ ${message.location().url || page.url()}`); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ missions: [] })), { key: storageKey });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByRole("heading", { name: "Projects", exact: true }).waitFor({ timeout: 15_000 });
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  return { context, page, consoleErrors };
}

(async () => {
  const deletionFixture = path.join(process.cwd(), "tmp", `mission-canvas-delete-${process.pid}`);
  const importFixture = path.join(process.cwd(), "tmp", `mission-canvas-import-${process.pid}`);
  fs.rmSync(deletionFixture, { recursive: true, force: true });
  fs.rmSync(importFixture, { recursive: true, force: true });
  fs.mkdirSync(path.join(deletionFixture, "src", "nested"), { recursive: true });
  fs.mkdirSync(path.join(importFixture, "src"), { recursive: true });
  fs.writeFileSync(path.join(deletionFixture, "package.json"), '{"name":"canvas-delete-fixture","private":true}\n');
  fs.writeFileSync(path.join(deletionFixture, "README.md"), "# Delete only after exact approval\n");
  fs.writeFileSync(path.join(deletionFixture, "src", "app.js"), "console.log('approval required');\n");
  fs.writeFileSync(path.join(deletionFixture, "src", "nested", "data.json"), '{"safe":true}\n');
  fs.writeFileSync(path.join(importFixture, "package.json"), '{"name":"phase-c-import-fixture","private":true}\n');
  fs.writeFileSync(path.join(importFixture, "src", "app.js"), "console.log('imported project is readable');\n");
  let previewVersion = 1;
  const previewServer = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><body style="font-family:system-ui;padding:40px;background:#f5f7f7;color:#172020"><h1>Inventory alerts</h1><p>Verified revision ${previewVersion}</p><button onclick="this.textContent='Thresholds reviewed'">Review thresholds</button></body></html>`);
  });
  await new Promise((resolve) => previewServer.listen(0, "127.0.0.1", resolve));
  const previewAddress = previewServer.address();
  const previewUrl = `http://127.0.0.1:${previewAddress.port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const starter = await openHomeScenario(browser);
    const starterCards = [
      ["Build Inventory System", "What kind of inventory?"],
      ["Build E-commerce Store", "What kind of store?"],
      ["Build POS App", "What kind of POS?"],
      ["Build Dashboard", "What kind of dashboard?"],
      ["Build Website", "What kind of website?"],
      ["Build Mobile App", "What kind of mobile app?"],
      ["Build Game", "What kind of game?"],
      ["Build API", "What kind of API?"],
      ["Build AI Application", "What kind of AI application?"],
      ["Build Desktop Application", "What kind of desktop application?"],
    ];
    for (const [cardName, question] of starterCards) {
      await starter.page.getByRole("button", { name: new RegExp(cardName) }).click();
      const dialog = starter.page.getByRole("dialog");
      await dialog.waitFor();
      assert.equal(await dialog.getByRole("heading", { name: question }).count(), 1, `${cardName} preserves its intended project shape`);
      await dialog.getByRole("button", { name: /Continue/ }).click();
      assert.equal(await dialog.getByRole("heading", { name: "Where should this live?" }).count(), 1, `${cardName} advances into the canonical location step`);
      await dialog.getByRole("button", { name: "Close" }).click();
      await dialog.waitFor({ state: "detached" });
    }
    assert.deepEqual(starter.consoleErrors, []);
    await starter.context.close();

    const custom = await openHomeScenario(browser);
    await custom.page.getByRole("button", { name: /Custom Build/ }).click();
    await custom.page.getByRole("dialog").waitFor();
    const customPrompt = custom.page.getByRole("heading", { name: "What do you want to build?" });
    assert.equal(await customPrompt.count(), 1, "custom creation begins with the freeform discovery question");
    const customDescription = custom.page.getByPlaceholder(/warehouse system tracking pallets/i);
    await customDescription.fill("A lightweight shift handoff API for a hospital operations team");
    assert.equal(await custom.page.getByRole("button", { name: /Continue/ }).isEnabled(), true, "a custom brief can advance through the same canonical flow");
    assert.deepEqual(custom.consoleErrors, []);
    await custom.context.close();

    const imported = await openHomeScenario(browser);
    await imported.page.getByRole("button", { name: /Open Existing Project/ }).first().click();
    const importDialog = imported.page.getByRole("dialog");
    await importDialog.waitFor();
    await importDialog.getByRole("button", { name: /Import Copy/ }).click();
    await importDialog.locator('input[type="file"]').setInputFiles([
      path.join(importFixture, "package.json"),
      path.join(importFixture, "src", "app.js"),
    ]);
    await importDialog.getByText(/2 selected paths/).waitFor();
    const openCopy = importDialog.getByRole("button", { name: "Open Foundry Copy" });
    assert.equal(await openCopy.isEnabled(), true, "a selected project copy can be opened");
    await openCopy.click();
    await importDialog.waitFor({ state: "detached" });
    await imported.page.getByLabel("Message Foundry").waitFor();
    const filesButton = imported.page.getByRole("button", { name: "2 files" });
    assert.equal(await filesButton.count(), 1, "the opened project visibly reports its imported file count");
    await filesButton.click();
    await imported.page.getByText("package.json", { exact: true }).click();
    await imported.page.getByText(/phase-c-import-fixture/).waitFor();
    assert.deepEqual(imported.consoleErrors, []);
    await imported.context.close();

    const active = await openScenario(browser, "waiting_for_user", { width: 1440, height: 900 });
    const activeText = await active.page.locator("body").innerText();
    assert.ok(activeText.indexOf("Create inventory screen") < activeText.indexOf("Add inventory alerts"), "prior missions are chronological rows above the active mission");
    assert.equal(await active.page.getByLabel("Add inventory alerts").count(), 1, "one active mission surface");
    assert.equal(await active.page.locator("header").locator('[role="status"]').count(), 1, "one canonical project status dot");
    assert.deepEqual(active.consoleErrors, []);
    await active.context.close();

    const providerFailure = await openScenario(browser, "blocked", { width: 1280, height: 800 }, { providerFailure: true });
    assert.ok(await providerFailure.page.getByText("Failed", { exact: true }).count() >= 1, "a provider transport outage is a failed retryable run, not a project blocker");
    assert.equal(await providerFailure.page.getByText("Blocked", { exact: true }).count(), 0, "provider transport errors never masquerade as blocked project work");
    assert.equal(await providerFailure.page.getByText(/^failure: AI providers were temporarily unreachable/).count(), 1, "the terminal handoff states the transport failure plainly instead of saying watch for");
    assert.deepEqual(providerFailure.consoleErrors, []);
    await providerFailure.context.close();

    const recoveredHistory = await openScenario(browser, "blocked", { width: 1280, height: 800 }, { overwrittenFollowUp: true });
    const recoveredText = await recoveredHistory.page.locator("body").innerText();
    assert.ok(recoveredText.indexOf("Create inventory screen") < recoveredText.indexOf("Make inventory header darker"), "a saved overwritten request is recovered as a collapsed prior row above the follow-up");
    assert.equal(await recoveredHistory.page.getByLabel("Make inventory header darker").count(), 1, "the orphaned follow-up message becomes the active mission request after reload");
    assert.equal(await recoveredHistory.page.getByRole("button", { name: /Create inventory screen/ }).count(), 1, "the first request remains visible as a collapsible history row");
    assert.deepEqual(recoveredHistory.consoleErrors, []);
    await recoveredHistory.context.close();

    const approval = await openScenario(browser, "waiting_for_approval", { width: 1280, height: 800 });
    assert.equal(await approval.page.getByRole("alertdialog").count(), 1, "exactly one approval gate");
    assert.equal(await approval.page.getByRole("button", { name: "Allow once" }).count(), 1);
    assert.equal(await approval.page.getByLabel("Message Foundry").isDisabled(), false, "composer remains available while approval is visible");
    assert.deepEqual(approval.consoleErrors, []);
    await approval.page.reload({ waitUntil: "domcontentloaded" });
    await approval.page.getByRole("alertdialog").waitFor();
    assert.equal(await approval.page.getByRole("alertdialog").count(), 1, "refresh preserves one pending approval without replaying work");
    await approval.context.close();

    const deletion = await openScenario(browser, "waiting_for_approval", { width: 1280, height: 850 }, { projectDeletionApproval: true, projectPath: deletionFixture });
    const deletionGate = deletion.page.getByRole("alertdialog", { name: /Approval required to delete project at/ });
    assert.equal(await deletionGate.count(), 1, "whole-project deletion renders one dedicated approval gate");
    assert.equal(await deletion.page.getByRole("heading", { name: "Delete this project?" }).count(), 1);
    assert.equal(await deletionGate.getByText(deletionFixture, { exact: true }).count(), 1, "the exact absolute deletion path is visible inside the approval gate");
    assert.equal(await deletion.page.getByRole("button", { name: "Delete project permanently" }).count(), 1);
    assert.equal(await deletion.page.getByRole("button", { name: "Keep project" }).count(), 1);
    assert.equal(await deletion.page.getByRole("button", { name: /Allow all deletions|Always allow exact action|Allow once/ }).count(), 0, "project deletion cannot be widened into a standing grant");
    if (process.env.FOUNDRY_DELETION_SCREENSHOT) await deletion.page.screenshot({ path: process.env.FOUNDRY_DELETION_SCREENSHOT, fullPage: true });
    const deletionResponsePromise = deletion.page.waitForResponse((response) => response.url().includes("/api/factory/existing?stream=1"), { timeout: 30_000 });
    await deletion.page.getByRole("button", { name: "Delete project permanently" }).click();
    const deletionResponse = await deletionResponsePromise;
    const deletionResponseText = await deletionResponse.text().catch(() => "<stream body unavailable to Playwright>");
    try {
      await deletion.page.getByText("The approved project was deleted", { exact: true }).waitFor({ timeout: 30_000 });
    } catch (error) {
      const visibleText = (await deletion.page.locator("body").innerText()).slice(-4_000);
      throw new Error(`approved deletion did not reach its completion UI (HTTP ${deletionResponse.status()}, rootExists=${fs.existsSync(deletionFixture)})\nResponse: ${deletionResponseText.slice(-4_000)}\nUI: ${visibleText}`, { cause: error });
    }
    assert.equal(fs.existsSync(deletionFixture), false, "the UI approval executes one verified project-root deletion");
    assert.equal(await deletion.page.getByText(/^Deleting (?:package\.json|README\.md|src\/)$/).count(), 0, "execution never fans out into file-by-file deletion rows");
    assert.equal(await deletion.page.getByRole("button", { name: "Project deleted" }).isDisabled(), true, "the deleted project no longer exposes a stale file browser");
    assert.equal(await deletion.page.getByLabel("Message Foundry").isDisabled(), true, "the deleted project cannot accept work against a missing root");
    assert.equal(await deletion.page.getByText("Add Path Safety Checks", { exact: true }).count(), 0, "Foundry does not recommend follow-up edits against a deleted project");
    assert.equal(await deletion.page.getByText("Undo the last file change", { exact: true }).count(), 0, "root deletion never masquerades as an undoable file edit");
    assert.deepEqual(deletion.consoleErrors, []);
    await deletion.context.close();

    const recovered = await openScenario(browser, "executing", { width: 1280, height: 800 }, { pendingFollowUp: true });
    await recovered.page.getByText(/A queued instruction survived the reload/).waitFor();
    await recovered.page.getByText("Stopped", { exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(await recovered.page.getByText("Stopped", { exact: true }).count(), 1, "orphaned active work becomes honestly interrupted rather than replayed");
    await recovered.page.getByRole("radio", { name: "Discard it" }).click();
    await recovered.page.getByText(/A queued instruction survived the reload/).waitFor({ state: "detached" });
    assert.equal(await recovered.page.getByText(/Queued instruction discarded without execution/).count(), 0, "discard is a control transition, not a fabricated timeline event");
    assert.deepEqual(recovered.consoleErrors, []);
    await recovered.context.close();

    const questions = await openScenario(browser, "waiting_for_user", { width: 1280, height: 800 }, { questions: true });
    assert.equal(await questions.page.getByText("Which inventory source should be authoritative?", { exact: true }).count(), 1, "only the first blocking question is visible");
    assert.equal(await questions.page.getByText("How quickly should alerts appear?", { exact: true }).count(), 0);
    await questions.page.getByRole("radio", { name: "Warehouse feed" }).click();
    assert.equal(await questions.page.getByText("Which inventory source should be authoritative?", { exact: true }).count(), 0);
    assert.equal(await questions.page.getByText("How quickly should alerts appear?", { exact: true }).count(), 1, "the later question appears only after the first answer");
    await questions.context.close();

    const completed = await openScenario(browser, "complete", { width: 1440, height: 900 }, { preview: true, previewUrl });
    if (process.env.FOUNDRY_SCREENSHOT) await completed.page.screenshot({ path: process.env.FOUNDRY_SCREENSHOT, fullPage: true });
    assert.equal(await completed.page.getByText("Done", { exact: true }).count(), 1, "one truthful terminal handoff");
    assert.equal(await completed.page.getByText(/Inventory alert test passed/).count(), 1, "verification is backed by recorded evidence");
    assert.equal(await completed.page.getByText("Local Interactive Preview", { exact: true }).count(), 1, "one preview dock");
    const previewFrame = completed.page.frameLocator('iframe[title="Interactive live preview"]');
    await previewFrame.getByRole("button", { name: "Review thresholds" }).click();
    assert.equal(await previewFrame.getByRole("button", { name: "Thresholds reviewed" }).count(), 1, "the docked preview is genuinely interactive");
    previewVersion = 2;
    await completed.page.getByTitle("Reload preview").click();
    await previewFrame.getByText("Verified revision 2", { exact: true }).waitFor();
    const spendTracker = completed.page.getByRole("status", { name: /Daily model spend:/ });
    await spendTracker.waitFor();
    assert.match(await spendTracker.textContent(), /^\$\d+\.\d{2} \/ \$\d+\.\d{2} today$/, "the composer shows a compact local daily spend tracker");
    const modelControlBox = await completed.page.getByLabel("Model intelligence").locator("..").boundingBox();
    const qualityControlBox = await completed.page.getByRole("group", { name: "Mission quality level" }).boundingBox();
    if (modelControlBox && qualityControlBox) {
      const overlaps = modelControlBox.x < qualityControlBox.x + qualityControlBox.width
        && modelControlBox.x + modelControlBox.width > qualityControlBox.x
        && modelControlBox.y < qualityControlBox.y + qualityControlBox.height
        && modelControlBox.y + modelControlBox.height > qualityControlBox.y;
      assert.equal(overlaps, false, "model intelligence and mission quality controls never collide in the narrowed preview layout");
    }
    assert.deepEqual(completed.consoleErrors, []);
    await completed.context.close();

    const large = await openScenario(browser, "waiting_for_user", { width: 1440, height: 900 }, { large: true });
    assert.equal(await large.page.getByRole("list", { name: "Mission plan" }).count(), 1, "large mission renders its real phase plan once");
    assert.equal(await large.page.getByText("Large mission item 34").count(), 0, "a 37-requirement mission keeps later work digested");
    await large.page.getByRole("button", { name: /Product experience/i }).click();
    assert.equal(await large.page.getByText("Large mission item 34").count(), 1, "all later requirements remain tracked and expand in place");
    await large.context.close();

    const mobile = await openScenario(browser, "waiting_for_user", { width: 390, height: 844 });
    const overflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `mobile canvas has ${overflow}px horizontal overflow`);
    await mobile.context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => previewServer.close(resolve));
    fs.rmSync(deletionFixture, { recursive: true, force: true });
    fs.rmSync(importFixture, { recursive: true, force: true });
  }
  console.log("mission canvas browser acceptance tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
