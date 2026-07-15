const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "tmp", "write-cancellation-compiled");
const fixture = path.join(root, "tmp", `write-cancellation-${process.pid}`);
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(fixture, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(fixture, { recursive: true });

const sources = [
  path.join(root, "lib", "ai", "mission", "project-access.ts"),
  path.join(root, "lib", "ai", "mission", "command-permissions.ts"),
  path.join(root, "lib", "ai", "mission", "write-verification.ts"),
];
const compile = spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), ...sources, "--outDir", out, "--module", "commonjs", "--target", "es2022", "--esModuleInterop", "--skipLibCheck"], { cwd: root, encoding: "utf8" });
if (compile.status !== 0) { console.error(compile.stdout, compile.stderr); process.exit(compile.status || 1); }

const { createServerProjectAccess } = require(path.join(out, "project-access.js"));

(async () => {
  const target = path.join(fixture, "app.js");
  fs.writeFileSync(target, "original\n");
  const controller = new AbortController();
  controller.abort();
  const access = createServerProjectAccess(fixture, "local-folder", controller.signal);
  const result = await access.writeFile("app.js", "late mutation\n");
  assert.equal(result.verified, false);
  assert.match(result.reason, /Stopped by user/);
  assert.equal(fs.readFileSync(target, "utf8"), "original\n", "an aborted edit cannot change the file");
  assert.equal(fs.existsSync(path.join(fixture, "new.js")), false);
  const newResult = await access.writeFile("new.js", "late creation\n");
  assert.equal(newResult.verified, false);
  assert.equal(fs.existsSync(path.join(fixture, "new.js")), false, "an aborted creation cannot appear");
  console.log("file-write cancellation boundary tests passed");
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(fixture, { recursive: true, force: true });
})().catch((error) => { console.error(error); process.exitCode = 1; });
