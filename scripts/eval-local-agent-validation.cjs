const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { validationCapabilities, runBrowserValidation, runIosValidation } = require("./local-agent-validation.cjs");

const root = path.resolve(__dirname, "..", "tmp", "local-agent-validation-test");
fs.mkdirSync(root, { recursive: true });
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><button id='continue' onclick=\"document.querySelector('#result').textContent='Completed'\">Continue</button><p id='result'>Waiting</p>");
});

server.listen(0, "127.0.0.1", async () => {
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    const capabilities = validationCapabilities();
    assert.equal(capabilities.browser.available, true);
    const result = await runBrowserValidation({
      root,
      url: `http://127.0.0.1:${address.port}`,
      viewport: { width: 390, height: 844 },
      actions: [{ action: "click", selector: "#continue" }, { action: "assert-text", text: "Completed" }],
      screenshotName: "smoke.png",
    });
    assert.equal(result.verified, true);
    assert.equal(result.consoleErrors.length, 0);
    assert.equal(result.failedRequests.length, 0);
    assert.deepEqual(result.viewport, { width: 390, height: 844 });
    assert.ok(fs.existsSync(result.screenshotPath));
    const normalizedArtifact = await runBrowserValidation({
      root,
      url: `http://127.0.0.1:${address.port}`,
      actions: [{ action: "assert-count", selector: "#continue", expected: 1 }],
      screenshotName: "null",
    });
    assert.equal(normalizedArtifact.verified, true);
    assert.match(normalizedArtifact.screenshotPath, /\.png$/i);
    const ios = await runIosValidation({ action: "devices", root });
    if (process.platform !== "darwin") assert.equal(ios.available, false);
    console.log("local agent browser and platform capability tests passed");
  } finally {
    server.close();
  }
});
