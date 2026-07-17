const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, token) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`, { headers: { authorization: `Bearer ${token}` } });
      if (response.ok) return;
    } catch {
      // Connector is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Local connector did not become ready.");
}

async function post(baseUrl, token, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, `${route} failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function main() {
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), "foundry-delete-recovery-"));
  let lockedFixture;
  let locker;
  const port = await availablePort();
  const token = `deletion-recovery-${Date.now()}`;
  const baseUrl = `http://127.0.0.1:${port}`;
  await fsp.writeFile(path.join(fixture, "index.html"), "<!doctype html><title>Deletion recovery fixture</title>");

  let connector = spawn(process.execPath, [path.join(__dirname, "foundry-local-connector.cjs"), fixture, String(port), token], {
    cwd: path.dirname(__dirname),
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await waitForHealth(baseUrl, token);
    const preview = await post(baseUrl, token, "/preview/start", { root: fixture, path: "" });
    assert.equal(preview.state, "ready", `Expected a live preview, received ${JSON.stringify(preview)}`);
    assert.match(preview.previewUrl, /^http:\/\/127\.0\.0\.1:/);

    // Reproduce the production failure: the Local Agent exits while its detached preview survives.
    connector.kill();
    await new Promise((resolve) => connector.once("exit", resolve));
    const restartedPort = await availablePort();
    const restartedBaseUrl = `http://127.0.0.1:${restartedPort}`;
    connector = spawn(process.execPath, [path.join(__dirname, "foundry-local-connector.cjs"), fixture, String(restartedPort), token], {
      cwd: path.dirname(__dirname),
      stdio: "ignore",
      windowsHide: true,
    });
    await waitForHealth(restartedBaseUrl, token);

    const startedAt = Date.now();
    const deletion = await post(restartedBaseUrl, token, "/delete-root", { root: fixture });
    const deletionDuration = Date.now() - startedAt;
    assert.equal(deletion.verified, true, `Deletion was not verified: ${JSON.stringify(deletion)}`);
    assert.ok(deletionDuration < 5_000, `Deletion recovery took too long: ${deletionDuration}ms`);
    assert.equal(fs.existsSync(fixture), false, "The project root remained on disk after deletion.");

    await new Promise((resolve) => setTimeout(resolve, 100));
    await assert.rejects(fetch(preview.previewUrl), "The Foundry-owned preview remained reachable after project deletion.");
    console.log(`PASS restart recovery stopped the owned preview and verified root deletion in ${deletionDuration}ms`);

    if (process.platform === "win32") {
      connector.kill();
      await new Promise((resolve) => connector.once("exit", resolve));
      lockedFixture = await fsp.mkdtemp(path.join(os.tmpdir(), "foundry-delete-external-lock-"));
      await fsp.writeFile(path.join(lockedFixture, "index.html"), "<!doctype html><title>External lock fixture</title>");
      const lockPort = await availablePort();
      const lockBaseUrl = `http://127.0.0.1:${lockPort}`;
      connector = spawn(process.execPath, [path.join(__dirname, "foundry-local-connector.cjs"), lockedFixture, String(lockPort), token], {
        cwd: path.dirname(__dirname), stdio: "ignore", windowsHide: true,
      });
      await waitForHealth(lockBaseUrl, token);
      locker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: lockedFixture, stdio: "ignore", windowsHide: true });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const blockedDeletion = await post(lockBaseUrl, token, "/delete-root", { root: lockedFixture });
      assert.equal(blockedDeletion.verified, false, "Expected the external working-directory lock to block deletion.");
      assert.ok(blockedDeletion.lockOwners?.some((owner) => owner.pid === locker.pid), `Expected PID ${locker.pid} in ${JSON.stringify(blockedDeletion.lockOwners)}`);
      assert.match(blockedDeletion.reason, /close node, then retry deletion/i);

      const stopped = await post(lockBaseUrl, token, "/stop-root-locks", { root: lockedFixture, processIds: [locker.pid] });
      assert.equal(stopped.verified, true, `Approved lock owner was not stopped: ${JSON.stringify(stopped)}`);
      const finalDeletion = await post(lockBaseUrl, token, "/delete-root", { root: lockedFixture });
      assert.equal(finalDeletion.verified, true, `Deletion did not continue after lock approval: ${JSON.stringify(finalDeletion)}`);
      assert.equal(fs.existsSync(lockedFixture), false);
      console.log("PASS external lock names the process, stops only the approved PID, and continues deletion");
    }
  } finally {
    connector.kill();
    locker?.kill();
    if (fs.existsSync(fixture)) {
      await fsp.rm(fixture, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    }
    if (lockedFixture && fs.existsSync(lockedFixture)) await fsp.rm(lockedFixture, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
