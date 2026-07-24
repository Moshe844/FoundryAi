/**
 * The static preview server is what the user actually sees, so its asset resolution is checked
 * against a real running server rather than by reading the source.
 *
 * Regression under test: a generated page referencing `/foundry-uploads/logo.png` while the file
 * sits at `public/foundry-uploads/logo.png` returned 404, which the browser gate reported as
 * "visibly broken image(s)" and turned into a failed mission.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-static-preview-assets-"));
const port = 4100 + Math.floor(Math.random() * 800);

fs.writeFileSync(path.join(root, "index.html"), '<html><body><img src="/foundry-uploads/logo.png"><img src="/media/hero.png"></body></html>');
fs.mkdirSync(path.join(root, "public", "foundry-uploads"), { recursive: true });
fs.writeFileSync(path.join(root, "public", "foundry-uploads", "logo.png"), "logo-bytes");
fs.mkdirSync(path.join(root, "static", "media"), { recursive: true });
fs.writeFileSync(path.join(root, "static", "media", "hero.png"), "hero-bytes");
fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.writeFileSync(path.join(root, "docs", "index.html"), "<html><body>docs</body></html>");
fs.writeFileSync(path.join(path.dirname(root), "outside-the-root.txt"), "secret");

const server = spawn(process.execPath, [path.join(__dirname, "foundry-static-preview.cjs"), root, String(port), "eval-token"], { stdio: "ignore" });

async function get(urlPath) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  return { status: response.status, body: await response.text(), token: response.headers.get("x-foundry-preview") };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const probe = await get("/");
      if (probe.status === 200) return;
    } catch {
      // The server is still binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The static preview server never became reachable.");
}

(async () => {
  await waitForServer();

  const index = await get("/");
  assert.strictEqual(index.status, 200, "The project root must serve index.html.");
  assert.strictEqual(index.token, "eval-token", "Every response must carry the preview ownership token.");

  const publicAsset = await get("/foundry-uploads/logo.png");
  assert.strictEqual(publicAsset.status, 200, "A web-root reference to a public/ asset must resolve, not 404.");
  assert.strictEqual(publicAsset.body, "logo-bytes", "The real uploaded bytes must be served, not a placeholder.");

  const literalPublic = await get("/public/foundry-uploads/logo.png");
  assert.strictEqual(literalPublic.status, 200, "The literal on-disk path must keep working.");

  const staticAsset = await get("/media/hero.png");
  assert.strictEqual(staticAsset.status, 200, "static/ is also a conventional asset root.");
  assert.strictEqual(staticAsset.body, "hero-bytes");

  const directory = await get("/docs");
  assert.strictEqual(directory.status, 200, "A directory must still serve its index.html.");

  const missing = await get("/nothing-here.png");
  assert.strictEqual(missing.status, 404, "A genuinely missing asset must still report 404 honestly.");
  assert.strictEqual(missing.token, "eval-token", "A 404 must still prove which preview answered.");

  const traversal = await get("/%2e%2e/outside-the-root.txt");
  assert.notStrictEqual(traversal.status, 200, "Asset fallback must not become a path-traversal escape.");
  assert.ok(!traversal.body.includes("secret"), "No file outside the project root may be served.");

  console.log("Static preview asset resolution checks passed.");
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(root), "outside-the-root.txt"), { force: true });
  });
