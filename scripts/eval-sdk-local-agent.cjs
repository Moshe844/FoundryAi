const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-sdk-agent-"));
  const project = path.join(sandbox, "project");
  const sdk = path.join(sandbox, "licensed-sdk");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(sdk, "android", "libs"), { recursive: true });
  fs.writeFileSync(path.join(sdk, "android", "libs", "PAX-POSLink-Android.aar"), "real-test-artifact");
  const port = 42000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [path.join(__dirname, "foundry-local-connector.cjs"), project, String(port)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const base = `http://127.0.0.1:${port}`;
  const post = async (route, body) => {
    const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const preflight = await fetch(`${base}/sdk/discover`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3001",
        "access-control-request-method": "POST",
        "access-control-request-private-network": "true",
      },
    });
    assert.equal(preflight.status, 200);
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
    assert.equal((await post("/connect", { path: sdk })).body.ok, true);
    const discovered = await post("/sdk/discover", { root: sdk, terms: ["PAX"], maxResults: 20 });
    assert.equal(discovered.status, 200);
    assert.equal(discovered.body.artifacts.length, 1);
    const imported = await post("/sdk/import", { sourceRoot: sdk, destinationRoot: project, paths: discovered.body.artifacts.map((item) => item.path) });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.ok, true);
    assert.equal(imported.body.imported.length, 1);
    const copied = path.join(project, imported.body.imported[0].path);
    assert.equal(fs.readFileSync(copied, "utf8"), "real-test-artifact");
    console.log("Local Agent SDK folder discovery and project intake import passed.");
  } finally {
    child.kill();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
