const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixture = path.join(root, "tmp", `follow-up-edit-${process.pid}`);
const baseUrl = process.env.FOUNDRY_URL || "http://127.0.0.1:3001";
const projectId = `local-${path.basename(fixture)}`;
let executedProjectId = projectId;

async function readStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let result;
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const payload = JSON.parse(line);
      if (payload.type === "event") events.push(payload.event);
      if (payload.type === "error") throw new Error(payload.error);
      if (payload.type === "result") result = payload.result;
    }
    if (done) return { events, result };
  }
}

(async () => {
  fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, "index.html"), '<!doctype html><html><head><title>Login</title><style>body{min-height:100vh;display:grid;place-items:center;font-family:system-ui;background:#f4f7f8}main{width:min(420px,90vw);padding:32px;background:white;border:1px solid #dbe3e6;border-radius:16px}form{display:grid;gap:16px}input,button{padding:12px;font:inherit}</style></head><body><main><h1>Welcome</h1><p>Sign in to continue to your secure project workspace and manage your account preferences.</p><form><label>Email address <input type="email" placeholder="you@example.com"></label><label>Password <input type="password"></label><label><input type="checkbox"> Remember me on this device</label><button type="submit">Sign in</button></form><p>Need help accessing your account? Contact the workspace administrator.</p></main></body></html>\n');
  const brief = `Mode: Work on existing project\nLocal project path: ${fixture}\nSelected stack: HTML5 + CSS3 + Vanilla JavaScript\nProject description: Small login page`;
  const task = "Change the visible login heading from Welcome to Welcome back. Preserve the rest of the page.";
  const response = await fetch(`${baseUrl}/api/factory/existing?stream=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      brief,
      task,
      localPath: fixture,
      modelMode: "auto",
      quality: "standard",
      followUpResolution: { currentIntent: "edit", referencedPriorAction: null, relevantFiles: ["index.html"], expectedScope: "Change only the login heading in index.html.", destructive: false, referenceConfidence: 1, plannedAction: task, continuity: "fresh_plan", rationale: "Explicit file-local follow-up." },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  assert.ok(response.ok && response.body, `follow-up request starts successfully (HTTP ${response.status})`);
  const { events, result } = await readStream(response);
  assert.ok(result, "the follow-up stream returns a final result");
  executedProjectId = result.projectId || projectId;
  assert.equal(result.status, "passed", result.blocker || "the follow-up edit should pass");
  assert.ok(result.files.some((file) => file.path === "index.html" && file.status === "edited"), "index.html is recorded as edited");
  assert.match(fs.readFileSync(path.join(fixture, "index.html"), "utf8"), /<h1>Welcome back<\/h1>/, "the requested heading change exists on disk");
  assert.equal(events.some((event) => event.title === "Mission blocked"), false, "a successful follow-up never emits a terminal blocked event");
  console.log(JSON.stringify({ passed: true, status: result.status, events: events.length, changedFiles: result.files.filter((file) => file.status === "edited").map((file) => file.path) }));
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await fetch(`${baseUrl}/api/factory/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: executedProjectId, action: "stop" }) }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 300));
  fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
