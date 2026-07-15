const { spawnSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const nextEnvPath = path.join(root, "next-env.d.ts");
const devRoutesReference = '/// <reference path="./.next/types/routes.d.ts" />';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    shell: false,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function restoreDevNextEnv() {
  const current = readFileSync(nextEnvPath, "utf8");
  const next = current.replace(
    /^\/\/\/ <reference path="\.\/\.next(?:-build)?\/types\/routes\.d\.ts" \/>\r?$/m,
    devRoutesReference,
  );

  if (next !== current) {
    writeFileSync(nextEnvPath, next);
  }
}

run(process.execPath, [nextBin, "typegen"], { env: { NODE_ENV: "development" } });
restoreDevNextEnv();
run(process.execPath, [
  path.join(root, "node_modules", "typescript", "bin", "tsc"),
  "--noEmit",
  "--incremental",
  "false",
]);
