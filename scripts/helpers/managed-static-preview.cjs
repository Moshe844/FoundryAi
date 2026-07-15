const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitUntilReachable(url, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Static preview exited before it became reachable (exit ${child.exitCode}).`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = new Error(`Static preview returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Static preview did not become reachable at ${url}: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

async function startManagedStaticPreview(projectRoot) {
  const port = await reservePort();
  const script = path.resolve(__dirname, "..", "foundry-static-preview.cjs");
  const child = spawn(process.execPath, [script, projectRoot, String(port), `acceptance-${process.pid}`], {
    cwd: path.resolve(__dirname, "..", ".."),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const url = `http://127.0.0.1:${port}/index.html`;
  try {
    await waitUntilReachable(url, child);
  } catch (error) {
    child.kill();
    const details = stderr.join("").trim();
    throw new Error(`${error instanceof Error ? error.message : String(error)}${details ? `\n${details}` : ""}`);
  }
  return {
    url,
    async close() {
      if (child.exitCode !== null) return;
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    },
  };
}

module.exports = { startManagedStaticPreview };
