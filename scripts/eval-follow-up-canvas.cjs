const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.FOUNDRY_URL || "http://127.0.0.1:3001";
const storageKey = "foundry.missionThreads.v9";
const projectPath = path.resolve(process.cwd(), "projects", "simple-web-login-page-ui-first");

function legacyOverwrittenWorkspace() {
  const priorRequestAt = Date.now() - 60_000;
  const followUpRequestAt = Date.now() - 5_000;
  const priorRequestId = `message-${priorRequestAt}-brief`;
  const followUpRequestId = `message-${followUpRequestAt}-project-request`;
  const now = new Date().toISOString();
  const run = {
    id: "run-overwritten",
    title: "Make the login card darker",
    source_requirements: ["simple login page"],
    state: "blocked",
    verification_status: "failed",
    plan: [{ id: "edit", label: "Make the login card darker", status: "blocked", evidence: "The first edit pass stopped after reading." }],
    files_touched: [],
    commands_run: [],
    approvals: [],
    verification: [],
    blocked_reason: "The first edit pass stopped after reading.",
    summary: "",
    request_message_id: priorRequestId,
    timeline: [
      { id: "prior-summary", timestamp: new Date(priorRequestAt + 1_000).toISOString(), kind: "summary", status: "completed", title: "Behavior verified" },
      { id: "followup-read", timestamp: new Date(followUpRequestAt + 1_000).toISOString(), kind: "inspection", status: "completed", title: "Read index.html" },
      { id: "followup-blocked", timestamp: new Date(followUpRequestAt + 2_000).toISOString(), kind: "summary", status: "error", title: "Mission blocked" },
    ],
    created_at: new Date(priorRequestAt).toISOString(),
    updated_at: now,
  };
  const result = {
    projectId: "simple-web-login-page-ui-first",
    projectName: "Simple Web Login Page",
    projectPath,
    briefPath: path.join(projectPath, "foundry-brief.md"),
    stack: "Static HTML/CSS/JS",
    template: "custom",
    status: "failed",
    blocker: run.blocked_reason,
    events: [],
    timeline: run.timeline,
    files: [{ path: "index.html", status: "unchanged", size: 9447 }],
    commands: [],
    checklist: run.plan,
    verification: [],
    previewState: "unavailable",
    previewPlatform: "web",
  };
  const mission = {
    missionId: "login-follow-up",
    conversationTitle: "Simple Web Login Page",
    title: "Simple Web Login Page",
    objective: `Mode: Build new project\nLocal project path: ${projectPath}\nProject description: simple login page`,
    status: "active",
    currentStage: "ready",
    desiredOutcome: "project",
    artifactType: "project",
    messages: [
      { id: priorRequestId, author: "You", initials: "ME", time: "Earlier", body: "Project description: simple login page\nMode: Build new project", tone: "human", tags: ["Project brief", "Project request"] },
      { id: followUpRequestId, author: "You", initials: "ME", time: "Now", body: "Make the login card darker", tone: "human", tags: ["Project request"] },
    ],
    attachments: [],
    createdArtifacts: [
      { id: "brief", sourceMessageId: priorRequestId, type: "project", kind: "code", title: "Project Brief", body: `Mode: Build new project\nLocal project path: ${projectPath}`, description: "", createdAt: now },
      { id: "result", sourceMessageId: followUpRequestId, type: "project", kind: "code", title: "Project Execution", body: JSON.stringify(result), description: "", createdAt: now },
    ],
    sources: [],
    lastResult: "",
    executionMissions: [run],
    activeExecutionMissionId: run.id,
    workMemory: { currentGoal: "", currentBlocker: run.blocked_reason, completedWork: [], resolvedErrors: [], rejectedHypotheses: [], latestEvidence: [], relevantFiles: ["index.html"], recommendedNextAction: "", summary: "", updatedAt: now },
    followUpContext: { type: "followUp", summary: "" },
    liveWorkEvents: [],
    createdAt: new Date(priorRequestAt).toISOString(),
    updatedAt: now,
  };
  return { activeMissionId: mission.missionId, missions: [mission] };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ key, workspace }) => localStorage.setItem(key, JSON.stringify(workspace)), { key: storageKey, workspace: legacyOverwrittenWorkspace() });
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByLabel("Message Foundry").waitFor({ timeout: 15_000 });
    await page.getByLabel("Make the login card darker").waitFor();
    const body = await page.locator("body").innerText();
    assert.ok(body.indexOf("simple login page") < body.indexOf("Make the login card darker"), "the original request is collapsed above the active follow-up");
    assert.equal(await page.getByRole("button", { name: /simple login page/i }).count(), 1, "the original request is a visible collapsible history row");
    assert.equal(await page.getByLabel("Make the login card darker").count(), 1, "the follow-up message is the active mission heading");
    assert.deepEqual(errors, [], "the recovered canvas has no browser errors");
    console.log(JSON.stringify({ passed: true, recoveredPriorRequests: 1, activeFollowUps: 1 }));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
