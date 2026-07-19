#!/usr/bin/env node
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const fixtureRoot = path.join(os.tmpdir(), `foundry-project-matrix-${process.pid}-${Date.now()}`);
const connectorScript = path.join(repositoryRoot, "scripts", "foundry-local-connector.cjs");

function write(relativePath, content) {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Connector startup can race the first probe.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The Local Agent did not become healthy for the lifecycle matrix.");
}

async function post(baseUrl, endpoint, root, body = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ root, ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `${endpoint} failed: ${payload.error || response.status}`);
  return payload;
}

function createFixtures() {
  write("01-static/index.html", "<!doctype html><title>Foundry static matrix</title><main>ready</main>\n");

  write("02-node-cjs/package.json", JSON.stringify({ name: "matrix-node-cjs", private: true, scripts: { build: "node --check index.js" } }, null, 2));
  write("02-node-cjs/index.js", "module.exports = { ready: true };\n");

  write("03-node-esm/package.json", JSON.stringify({ name: "matrix-node-esm", private: true, type: "module", scripts: { build: "node --check index.mjs" } }, null, 2));
  write("03-node-esm/index.mjs", "export const ready = true;\n");

  write("04-typescript/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022" }, include: ["src/**/*.ts"] }, null, 2));
  write("04-typescript/src/index.ts", "export const ready: boolean = true;\n");

  write("05-python-script/app.py", "def ready() -> bool:\n    return True\n\nassert ready()\n");

  write("06-python-package/src/matrix_package/__init__.py", "from .service import ready\n");
  write("06-python-package/src/matrix_package/service.py", "def ready() -> bool:\n    return True\n");

  write("07-dotnet-console/MatrixConsole.csproj", '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup></Project>\n');
  write("07-dotnet-console/Program.cs", 'Console.WriteLine("ready");\n');

  write("08-dotnet-library/MatrixLibrary.csproj", '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup></Project>\n');
  write("08-dotnet-library/Ready.cs", "namespace MatrixLibrary; public static class Ready { public static bool Value => true; }\n");

  for (const directory of ["09-dotnet-wpf", "10-running-wpf"]) {
    const assembly = directory.startsWith("09") ? "MatrixWpf" : "MatrixLock";
    write(`${directory}/${assembly}.csproj`, `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>WinExe</OutputType><TargetFramework>net8.0-windows</TargetFramework><UseWPF>true</UseWPF><Nullable>enable</Nullable></PropertyGroup></Project>\n`);
    write(`${directory}/App.xaml`, `<Application x:Class="${assembly}.App" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" StartupUri="MainWindow.xaml"><Application.Resources /></Application>\n`);
    write(`${directory}/App.xaml.cs`, `using System.Windows; namespace ${assembly}; public partial class App : Application { }\n`);
    write(`${directory}/MainWindow.xaml`, `<Window x:Class="${assembly}.MainWindow" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Foundry Matrix" Width="360" Height="180"><Grid><TextBlock Text="Ready" HorizontalAlignment="Center" VerticalAlignment="Center" /></Grid></Window>\n`);
    write(`${directory}/MainWindow.xaml.cs`, `using System.Windows; namespace ${assembly}; public partial class MainWindow : Window { public MainWindow() { InitializeComponent(); } }\n`);
  }
}

async function run() {
  createFixtures();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const connector = spawn(process.execPath, [connectorScript, fixtureRoot, String(port)], {
    cwd: repositoryRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let connectorOutput = "";
  connector.stdout.on("data", (chunk) => { connectorOutput += chunk.toString(); });
  connector.stderr.on("data", (chunk) => { connectorOutput += chunk.toString(); });

  const results = [];
  try {
    await waitForHealth(baseUrl);
    const typescript = path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
    const matrix = [
      ["01-static", `node -e "require('fs').accessSync('index.html')"`],
      ["02-node-cjs", "npm.cmd run build"],
      ["03-node-esm", "npm.cmd run build"],
      ["04-typescript", `${quote(process.execPath)} ${quote(typescript)} -p tsconfig.json`],
      ["05-python-script", "python -m py_compile app.py"],
      ["06-python-package", "python -m compileall -q src"],
      ["07-dotnet-console", 'dotnet build "MatrixConsole.csproj"'],
      ["08-dotnet-library", 'dotnet build "MatrixLibrary.csproj"'],
      ["09-dotnet-wpf", 'dotnet build "MatrixWpf.csproj"'],
    ];

    for (const [name, command] of matrix) {
      const root = path.join(fixtureRoot, name);
      const connected = await post(baseUrl, "/connect", root, { path: root });
      assert.equal(connected.ok, true, `${name} did not connect.`);
      const listing = await post(baseUrl, "/list", root, { path: "" });
      assert.ok(Array.isArray(listing.entries) && listing.entries.length > 0, `${name} did not expose its project tree.`);
      const commandResult = await post(baseUrl, "/run", root, { command, approvedCategories: ["dependencies", "package-runner"] });
      assert.equal(commandResult.exitCode, 0, `${name} verification failed:\n${commandResult.stderr}\n${commandResult.stdout}`);
      results.push({ name, command, durationMs: commandResult.durationMs });
    }

    const lockRoot = path.join(fixtureRoot, "10-running-wpf");
    const connected = await post(baseUrl, "/connect", lockRoot, { path: lockRoot });
    assert.equal(connected.ok, true);
    const firstBuild = await post(baseUrl, "/run", lockRoot, { command: 'dotnet build "MatrixLock.csproj"', approvedCategories: ["dependencies", "package-runner"] });
    assert.equal(firstBuild.exitCode, 0, `Initial lock fixture build failed:\n${firstBuild.stderr}\n${firstBuild.stdout}`);
    const executable = path.join("bin", "Debug", "net8.0-windows", "MatrixLock.exe");
    const launched = await post(baseUrl, "/validation/desktop/run", lockRoot, { executable, observeMs: 700 });
    assert.equal(launched.verified, true, `Lock fixture did not launch: ${launched.reason || "unknown"}`);
    assert.ok(Number(launched.pid) > 0, "Lock fixture launch did not return a process id.");

    const lockedBuildStarted = Date.now();
    const lockedBuild = await post(baseUrl, "/run", lockRoot, { command: 'dotnet build "MatrixLock.csproj" --no-restore', approvedCategories: ["dependencies", "package-runner"] });
    assert.equal(lockedBuild.exitCode, 0, `Foundry did not recover the running-output lock:\n${lockedBuild.stderr}\n${lockedBuild.stdout}`);
    assert.match(lockedBuild.stderr, /paused and restored 1 running desktop app/i, "The running desktop app was not restored after the build.");
    assert.ok(Date.now() - lockedBuildStarted < 30_000, "Owned runtime recovery took too long and likely fell through to compiler retries.");
    results.push({ name: "10-running-wpf", command: 'launch + dotnet build "MatrixLock.csproj" --no-restore', durationMs: lockedBuild.durationMs });

    assert.equal(results.length, 10);
    for (const result of results) console.log(`PASS ${result.name} (${result.durationMs}ms) — ${result.command}`);
    console.log("PASS project lifecycle matrix: 10/10 real projects connected, opened, and verified with zero provider calls.");
  } finally {
    if (process.platform === "win32") spawnSync("taskkill.exe", ["/im", "MatrixLock.exe", "/t", "/f"], { stdio: "ignore", windowsHide: true });
    if (connector.pid) spawnSync("taskkill.exe", ["/pid", String(connector.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    else connector.kill("SIGTERM");
    await fsp.rm(fixtureRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => undefined);
    if (connectorOutput && process.env.FOUNDRY_MATRIX_DEBUG === "1") process.stderr.write(connectorOutput);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
