const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const baseUrl = process.env.FOUNDRY_BASE_URL || "http://127.0.0.1:3001";
const projectName = `RelayOps Production Canary ${Date.now()}`;
const brief = `Create Project: ${projectName}
Template: Intelligent Project Discovery
Mode: Build new project
Project source: Create inside Foundry workspace
Project name: ${projectName}
Project description: Build a production-style, multi-user incident operations platform. This is a full-stack acceptance canary for Foundry, not a static mock or a frontend-only demonstration.
Project type: Full-stack production operations application
Selected stack: Next.js 15 App Router, JavaScript, server route handlers, better-sqlite3, plain CSS
Architecture: One deployable Next.js service containing a responsive frontend and JSON/SSE backend. Keep domain logic in testable server modules. Use serverExternalPackages for better-sqlite3. Do not use hosted services, remote images, or runtime CDN dependencies.
Style direction: Polished dark operations console with restrained teal/amber/red status colors, clear typography, dense but readable tables, useful empty/loading/error states, and intentional desktop and 390px mobile layouts.

Acceptance contract — every clause is independently required:
1. Frontend: a real sign-in screen and authenticated operations dashboard. Stable IDs: login-email, login-password, login-submit, app-shell, incident-title, incident-severity, incident-submit, incident-list, job-run, job-status, realtime-status, audit-list, logout-button. The dashboard must contain navigation, KPI cards, an incident creation form, incident list, jobs status, realtime status, and an admin-only audit view; a welcome heading alone is invalid.
2. Backend: Next route handlers with stable endpoints GET /api/health, GET /api/metrics, POST /api/auth/login, POST /api/auth/logout, GET /api/session, GET+POST /api/incidents, GET /api/audit, GET /api/events, POST+GET /api/jobs, POST /api/integrations/webhook.
3. Authentication: secure httpOnly sameSite session cookies, password hashes using Node crypto (never plaintext password comparison), durable sessions, and the seeded credentials admin@relayops.local / Admin!234 and agent@relayops.local / Agent!234 for local canary testing.
4. RBAC: roles admin and agent. Both can view and create incidents. Only admin can read /api/audit and see the Audit navigation/panel. Agent requests to /api/audit must return 403.
5. Database: a real SQLite database through better-sqlite3, WAL mode, foreign keys, parameterized statements, and a durable data directory ignored by git. Do not substitute an in-memory array, localStorage, or JSON file.
6. Schema and migrations: migrations/001_initial.sql plus scripts/migrate.mjs, with migration tracking and tables for users, sessions, incidents, jobs, audit_logs, and integration_events. Migration execution must be idempotent.
7. Multi-user persistence: an incident created by the admin must remain visible after logout and login as the agent.
8. Realtime: /api/events must be a text/event-stream endpoint and the browser must visibly transition #realtime-status to Connected. Incident/job/integration changes publish an event. A heartbeat is required.
9. Background jobs: a durable database-backed queue with pending/running/completed/retrying/dead-letter states. A worker runs in-process without blocking requests. POST /api/jobs with kind report succeeds. kind always-fail retries to maxAttempts and becomes dead-letter. Queue transitions create audit records.
10. External integration: /api/integrations/webhook accepts a realistic external webhook only when x-webhook-secret equals canary-webhook-secret, rejects a wrong secret with 401, stores the event, creates an audit record, and publishes realtime notification. This is a local contract adapter; do not claim a third-party production account was connected.
11. Audit: login, logout, incident creation, job transitions, and accepted integration events append immutable audit rows including actor, action, entity type/id, timestamp, and JSON metadata.
12. Tests: npm test must run genuine node:test unit and integration suites covering password hashing/session behavior, RBAC denial, idempotent migrations, incident persistence, job retry/dead-letter, webhook authentication, and audit creation. Include tests/unit.test.mjs and tests/integration.test.mjs. Tests must use a temporary database and never depend on the dev server.
13. Browser acceptance: the seeded admin login reaches the complete dashboard; admin creates an incident named Database failover rehearsal; agent login sees that persisted incident but cannot see or fetch audit data; no console/page errors; mobile remains usable.
14. Deployment and monitoring: Dockerfile with non-root production user, .dockerignore, .env.example, GET /api/health checking database readiness, GET /api/metrics returning JSON counters/queue state, structured JSON server logging, README instructions for migrate/test/build/start and operational recovery.
15. Failure recovery: startup reruns idempotent migrations, stale running jobs return to retrying, queue attempts are bounded, failures preserve lastError, and graceful process errors are logged. Never pretend Docker was run or a remote deployment happened.

Required scripts in package.json: dev, build, start, migrate, test. Required files: next.config.mjs, app/page.js, app/globals.css, lib/db.js, lib/auth.js, lib/rbac.js, lib/events.js, lib/jobs.js, migrations/001_initial.sql, scripts/migrate.mjs, tests/unit.test.mjs, tests/integration.test.mjs, Dockerfile, .dockerignore, .env.example, README.md.
Custom instructions: Preserve this entire contract across the mock-review continuation. Prefer coordinated write_files batches. Install dependencies, run npm run migrate, npm test, and npm run build. Do not report complete unless those commands pass and the live browser flow is exercised.`;

async function streamFactory(endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, controlId: randomUUID() }),
    signal: AbortSignal.timeout(900_000),
  });
  if (!response.ok || !response.body) throw new Error(`${endpoint} failed: HTTP ${response.status} ${await response.text()}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  let buffer = "";
  let finalResult;
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const payload = JSON.parse(line);
      if (payload.type === "event") console.log(`${((Date.now() - startedAt) / 1000).toFixed(1)}s ${payload.event.status} ${payload.event.title}`);
      if (payload.type === "error") throw new Error(payload.error);
      if (payload.type === "result") finalResult = payload.result;
    }
    if (done) break;
  }
  if (!finalResult) throw new Error(`${endpoint} ended without a result.`);
  return finalResult;
}

async function spend() {
  const response = await fetch(`${baseUrl}/api/settings/models/spend`, { cache: "no-store" });
  assert.equal(response.status, 200, "spend endpoint responds");
  return (await response.json()).dailySpend;
}

function parentMissionFrom(result) {
  return {
    id: `canary-parent-${Date.now()}`,
    source_requirements: [brief],
    state: result.status === "awaiting-mock-approval" ? "waiting_for_user" : result.status === "awaiting-approval" ? "waiting_for_approval" : "failed",
    plan: result.checklist || [],
    files_touched: (result.files || []).filter((file) => ["created", "edited"].includes(file.status)).map((file) => ({ path: file.path, status: file.status, verified: true })),
    commands_run: (result.commands || []).map((command) => ({ command: command.command, exitCode: command.exitCode })),
    decisions: [],
    findings: [],
    blocked_reason: result.blocker,
    summary: result.sessionSummary?.outcome || "First production canary batch completed and is awaiting continuation.",
  };
}

function run(command, args, cwd, timeout = 300_000) {
  let executable = command;
  let executableArgs = args;
  if (process.platform === "win32" && command.toLowerCase() === "npm.cmd") {
    assert.ok(process.env.npm_execpath, "npm_execpath is available for the Windows canary runner");
    executable = process.execPath;
    executableArgs = [process.env.npm_execpath, ...args];
  }
  const result = spawnSync(executable, executableArgs, { cwd, timeout, encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_ENV: "test" } });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${[command, ...args].join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`.trim();
}

function verifyArtifacts(projectPath) {
  const required = [
    "package.json", "next.config.mjs", "app/page.js", "app/globals.css", "lib/db.js", "lib/auth.js", "lib/rbac.js", "lib/events.js", "lib/jobs.js",
    "migrations/001_initial.sql", "scripts/migrate.mjs", "tests/unit.test.mjs", "tests/integration.test.mjs", "Dockerfile", ".dockerignore", ".env.example", "README.md",
  ];
  for (const relative of required) assert.ok(existsSync(path.join(projectPath, relative)), `required production artifact exists: ${relative}`);
  const manifest = JSON.parse(readFileSync(path.join(projectPath, "package.json"), "utf8"));
  for (const script of ["dev", "build", "start", "migrate", "test"]) assert.equal(typeof manifest.scripts?.[script], "string", `package script ${script} exists`);
  assert.ok(manifest.dependencies?.["better-sqlite3"], "real SQLite dependency is declared");
  const migration = readFileSync(path.join(projectPath, "migrations", "001_initial.sql"), "utf8");
  for (const table of ["users", "sessions", "incidents", "jobs", "audit_logs", "integration_events"]) assert.match(migration, new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+${table}`, "i"), `migration creates ${table}`);
  assert.match(readFileSync(path.join(projectPath, "Dockerfile"), "utf8"), /USER\s+(?!root)/i, "container uses a non-root user");
  return required;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

async function refreshOwnedPreview(projectPath) {
  const projectId = path.basename(projectPath);
  const response = await fetch(`${baseUrl}/api/factory/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, action: "refresh" }),
    signal: AbortSignal.timeout(90_000),
  });
  assert.equal(response.status, 200, `owned preview refresh responds for ${projectId}`);
  const preview = await response.json();
  assert.equal(preview.previewState, "ready", preview.previewReason || "owned preview must become ready");
  assert.ok(preview.previewUrl, "owned preview refresh returns a URL");
  return preview.previewUrl;
}

async function verifyRuntime(previewUrl) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location();
      errors.push(`${message.text()}${location.url ? ` [${location.url}]` : ""}`);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const pageResponse = await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.equal(pageResponse?.status(), 200, "production canary preview responds");
    await page.locator("#login-email").fill("admin@relayops.local");
    await page.locator("#login-password").fill("Admin!234");
    await page.locator("#login-submit").click();
    await page.locator("#app-shell").waitFor({ timeout: 20_000 });
    await page.locator("#realtime-status").waitFor();
    await page.waitForFunction(() => /connected/i.test(document.querySelector("#realtime-status")?.textContent || ""), null, { timeout: 15_000 });
    await page.locator("#incident-title").fill("Database failover rehearsal");
    const severity = page.locator("#incident-severity");
    if (await severity.evaluate((element) => element.tagName === "SELECT")) await severity.selectOption({ index: 1 });
    else await severity.fill("high");
    await page.locator("#incident-submit").click();
    await page.getByText("Database failover rehearsal", { exact: false }).first().waitFor();

    const health = await jsonRequest(new URL("/api/health", previewUrl));
    assert.equal(health.response.status, 200, "health endpoint is ready");
    assert.match(JSON.stringify(health.body), /(?:ready|healthy|ok)/i, "health reports readiness");
    const metrics = await jsonRequest(new URL("/api/metrics", previewUrl));
    assert.equal(metrics.response.status, 200, "metrics endpoint responds");

    const wrongWebhook = await jsonRequest(new URL("/api/integrations/webhook", previewUrl), { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "wrong" }, body: JSON.stringify({ type: "monitor.alert", id: "wrong-secret" }) });
    assert.equal(wrongWebhook.response.status, 401, "webhook rejects the wrong secret");
    const acceptedWebhook = await jsonRequest(new URL("/api/integrations/webhook", previewUrl), { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "canary-webhook-secret" }, body: JSON.stringify({ type: "monitor.alert", id: `canary-${Date.now()}`, service: "database" }) });
    assert.ok([200, 201, 202].includes(acceptedWebhook.response.status), "webhook accepts the configured secret");

    const successfulJob = await page.request.post(new URL("/api/jobs", previewUrl).href, { data: { kind: "report", payload: { range: "today" } } });
    assert.ok([200, 201, 202].includes(successfulJob.status()), "report job is accepted");
    const failedJob = await page.request.post(new URL("/api/jobs", previewUrl).href, { data: { kind: "always-fail", maxAttempts: 2, payload: { canary: true } } });
    assert.ok([200, 201, 202].includes(failedJob.status()), "failure-recovery job is accepted");
    const failedJobBody = await failedJob.json();
    const failedJobId = failedJobBody.id || failedJobBody.job?.id;
    assert.ok(failedJobId, "failure-recovery job returns an id");
    await page.waitForFunction(async (id) => {
      const response = await fetch("/api/jobs");
      if (!response.ok) return false;
      const body = await response.json();
      const jobs = Array.isArray(body) ? body : body.jobs || [];
      return jobs.some((job) => String(job.id) === String(id) && /dead[-_ ]?letter/i.test(job.status));
    }, failedJobId, { timeout: 25_000 });

    await page.locator("#logout-button").click();
    await page.locator("#login-email").fill("agent@relayops.local");
    await page.locator("#login-password").fill("Agent!234");
    await page.locator("#login-submit").click();
    await page.locator("#app-shell").waitFor({ timeout: 20_000 });
    await page.getByText("Database failover rehearsal", { exact: false }).first().waitFor();
    assert.equal(await page.locator("#audit-list").count(), 0, "agent cannot see the admin audit panel");
    const forbiddenAudit = await page.request.get(new URL("/api/audit", previewUrl).href);
    assert.equal(forbiddenAudit.status(), 403, "agent receives 403 from the audit API");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const bodyWidth = await page.locator("body").evaluate((body) => ({ scroll: body.scrollWidth, client: body.clientWidth }));
    assert.ok(bodyWidth.scroll <= bodyWidth.client + 2, `mobile layout has no horizontal overflow: ${JSON.stringify(bodyWidth)}`);
    assert.deepEqual(errors, [], `browser has no console/page errors: ${errors.join(" | ")}`);
    return { health: health.body, metrics: metrics.body, mobile: bodyWidth };
  } finally {
    await browser.close();
  }
}

(async () => {
  const maxArg = process.argv.find((argument) => argument.startsWith("--max-additional="));
  const maxAdditionalUsd = maxArg ? Number(maxArg.slice("--max-additional=".length)) : 5;
  assert.ok(Number.isFinite(maxAdditionalUsd) && maxAdditionalUsd > 0 && maxAdditionalUsd <= 10, "live full-stack canary is hard-capped at the explicitly authorized maximum of $10 additional spend");
  const baseline = await spend();
  console.log("BASELINE", JSON.stringify(baseline));

  const reuseArg = process.argv.find((argument) => argument.startsWith("--reuse-path="));
  const reusePath = reuseArg?.slice("--reuse-path=".length);
  const verifyOnly = process.argv.includes("--verify-only");
  let result = reusePath && verifyOnly
    ? { status: "failed", blocker: "The canonical production build did not pass first in the model execution boundary; independent verification is running now.", projectPath: reusePath }
    : reusePath
    ? await streamFactory("/api/factory/existing?stream=1", {
        brief,
        task: "Continue and complete this exact production canary from the files already on disk. Preserve the full original brief and create every missing required artifact. Verified current state: better-sqlite3 ^12.11.1 is installed with a lockfile, npm run migrate passes, npm run build passes all routes, and package type module is set. The real npm test run still has 3/7 passing. Apply these exact root-cause repairs: in auth.getSession change SQLite datetime(\"now\") to datetime('now') because modern SQLite treats the double-quoted value as a missing identifier and throws SQLITE_ERROR; replace db.js's module-local _db/_dbPath with a globalThis registry under Symbol.for('relayops.db.state') so cache-busted ESM imports of db/auth/audit/jobs share one path-aware SQLite handle, close the old handle when DB_PATH changes, and do not leave Windows-locked temp databases. This shared handle must resolve the incident/session SQLITE_ERROR and the job/webhook missing-row plus cleanup EPERM failures. Create .env.example. Then run npm test and npm run build without pipes, 2>&1, or shell redirection. Start the owned preview and exercise the complete browser/API acceptance contract. Do not stop at source inspection or claim completion around a failed command.",
        files: [],
        localPath: reusePath,
        approvedCategories: ["dependencies", "package-runner", "database", "environment-changes"],
        modelMode: "auto",
        quality: "production",
      })
    : await streamFactory("/api/factory/create?stream=1", { brief, modelMode: "auto", quality: "production" });
  console.log(reusePath ? "REUSE_RESULT" : "CREATE_RESULT", JSON.stringify({ status: result.status, blocker: result.blocker, projectPath: result.projectPath, previewUrl: result.previewUrl }));
  if (result.status === "awaiting-mock-approval") {
    assert.ok(result.previewUrl, "first working mock exposes a preview before approval");
    const parentMission = parentMissionFrom(result);
    result = await streamFactory("/api/factory/existing?stream=1", {
      brief,
      task: "The first working mock is approved. Continue the same original production canary now. Complete every remaining backend, database, authentication, RBAC, realtime, queue, integration, audit, testing, deployment, monitoring, and recovery requirement; run the declared migration, test, build, and browser verification before reporting complete.",
      files: [],
      localPath: result.projectPath,
      parentMission,
      continuity: "carry_forward_plan",
      approvedCategories: ["dependencies", "package-runner", "database"],
      modelMode: "auto",
      quality: "production",
    });
    console.log("CONTINUATION_RESULT", JSON.stringify({ status: result.status, blocker: result.blocker, projectPath: result.projectPath, previewUrl: result.previewUrl }));
  }
  if (result.status === "awaiting-approval") {
    const blockedEvent = [...(result.timeline || [])].reverse().find((event) => event.kind === "blocked" && event.command);
    assert.ok(blockedEvent?.command, "approval pause exposes the exact structured action");
    const parentMission = parentMissionFrom(result);
    result = await streamFactory("/api/factory/existing?stream=1", {
      brief,
      task: "Approve this exact required canary action once, then continue the complete original production canary through tests, build, preview, and browser verification.",
      files: [],
      localPath: result.projectPath,
      parentMission,
      continuity: "carry_forward_plan",
      approvalResponse: {
        requestedCommand: blockedEvent.command,
        decision: "approve-once",
        category: blockedEvent.details?.category,
      },
      approvedCategories: ["dependencies", "package-runner", "database"],
      modelMode: "auto",
      quality: "production",
    });
    console.log("APPROVAL_CONTINUATION_RESULT", JSON.stringify({ status: result.status, blocker: result.blocker, projectPath: result.projectPath, previewUrl: result.previewUrl }));
  }
  const independentlyVerifiableBoundary = Boolean(reusePath && result.status === "failed" && /canonical production build did not pass first/i.test(result.blocker || ""));
  if (!independentlyVerifiableBoundary) assert.equal(result.status, "passed", result.blocker || "full-stack mission must pass");
  assert.ok(result.projectPath && existsSync(result.projectPath), "full-stack project path exists");
  const artifacts = verifyArtifacts(result.projectPath);
  const migrateOutput = run("npm.cmd", ["run", "migrate"], result.projectPath);
  const testOutput = run("npm.cmd", ["test"], result.projectPath);
  const buildOutput = run("npm.cmd", ["run", "build"], result.projectPath);
  const previewUrl = result.previewUrl || await refreshOwnedPreview(result.projectPath);
  const runtime = await verifyRuntime(previewUrl);
  const finalSpend = await spend();
  const additionalCostUsd = Number((finalSpend.actualCostUsd - baseline.actualCostUsd).toFixed(6));
  assert.ok(additionalCostUsd <= maxAdditionalUsd, `canary exceeded authorized additional spend: $${additionalCostUsd} > $${maxAdditionalUsd}`);
  console.log(JSON.stringify({ passed: true, projectName, projectPath: result.projectPath, previewUrl, orchestrationBoundarySupersededByIndependentEvidence: independentlyVerifiableBoundary, artifacts: artifacts.length, migrateOutput: migrateOutput.slice(-1000), testOutput: testOutput.slice(-2000), buildOutput: buildOutput.slice(-1500), runtime, baselineCostUsd: baseline.actualCostUsd, finalCostUsd: finalSpend.actualCostUsd, additionalCostUsd }, null, 2));
})().catch(async (error) => {
  console.error(error);
  try { console.error("FINAL_SPEND", JSON.stringify(await spend())); } catch {}
  process.exitCode = 1;
});
