#!/usr/bin/env node
/**
 * Structural-drift guard: a write whose relative imports resolve to nothing must be rejected BEFORE
 * touching disk, with the exact missing targets named.
 *
 * The live failure this pins (2026-07-20): a repair wrote app screens importing
 * `../src/state/MoodContext` and `../src/components/MoodPicker` while the real modules lived at
 * `src/context/JournalContext.tsx` and `src/components/mood/MoodPicker.tsx`. The bundler failed after
 * the mission had already concluded, and the project shipped broken.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (mod, file) => {
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
    }).outputText,
    file,
  );
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const target = request.startsWith("@/") ? path.join(root, request.slice(2)) : request;
  try {
    return originalResolve.call(this, target, ...rest);
  } catch (error) {
    for (const extension of [".ts", ".tsx"]) if (fs.existsSync(`${target}${extension}`)) return `${target}${extension}`;
    throw error;
  }
};

const { resolveRelativeImport, relativeImportSpecifiers, unresolvedRelativeImportIssue } = require(path.join(root, "lib/ai/mission/executor.ts"));

// A fake project matching the REAL mood-journal layout at the moment of the drift.
const disk = new Set([
  "src/context/JournalContext.tsx",
  "src/components/mood/MoodPicker.tsx",
  "src/components/mood/MoodChart.tsx",
  "src/design/tokens.ts",
  "src/types/index.ts",
  "app/_layout.tsx",
]);
const access = {
  readFile: async (p) => ({ exists: disk.has(p.replace(/\\/g, "/")), content: "", totalBytes: 0 }),
};

let failures = 0;
const ok = (label, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`); };

(async () => {
  console.log("=== pure resolution ===");
  ok("../src/state/MoodContext from app/index.tsx", resolveRelativeImport("app/index.tsx", "../src/state/MoodContext") === "src/state/MoodContext");
  ok("./tokens from src/design/x.ts", resolveRelativeImport("src/design/x.ts", "./tokens") === "src/design/tokens");
  ok("../../theme from app/(tabs)/index.tsx", resolveRelativeImport("app/(tabs)/index.tsx", "../../theme") === "theme");
  ok("specifier extraction", JSON.stringify(relativeImportSpecifiers(`import { A } from '../x/A';\nconst B = require("./b");\nimport('./lazy');\nimport React from 'react';`)) === JSON.stringify(["../x/A", "./b", "./lazy"]));

  console.log("\n=== the exact live drift is REJECTED ===");
  const drift = await unresolvedRelativeImportIssue(access, "write_file", {
    path: "app/index.tsx",
    content: `import { useMood } from '../src/state/MoodContext';\nimport { MoodPicker } from '../src/components/MoodPicker';\nimport { colors } from '../src/design/tokens';`,
  }, ["app/index.tsx"]);
  ok("rejected", Boolean(drift), drift && drift.slice(0, 90));
  ok("names MoodContext as missing", Boolean(drift && drift.includes("src/state/MoodContext")));
  ok("names MoodPicker as missing", Boolean(drift && drift.includes("src/components/MoodPicker")));
  ok("does NOT flag the tokens import (it exists)", Boolean(drift && !drift.includes('design/tokens"')));

  console.log("\n=== legitimate writes are NOT rejected ===");
  ok("import of an existing module", await unresolvedRelativeImportIssue(access, "write_file", {
    path: "app/index.tsx",
    content: `import { MoodPicker } from '../src/components/mood/MoodPicker';\nimport { colors } from '../src/design/tokens';`,
  }, ["app/index.tsx"]) === undefined);
  ok("intra-batch reference (new module created in the SAME write_files)", await unresolvedRelativeImportIssue(access, "write_files", {
    files: [
      { path: "src/state/MoodContext.tsx", content: "export const x = 1;" },
      { path: "app/index.tsx", content: "import { x } from '../src/state/MoodContext';" },
    ],
  }, ["src/state/MoodContext.tsx", "app/index.tsx"]) === undefined);
  ok("directory import resolved via index", await unresolvedRelativeImportIssue(access, "write_file", {
    path: "src/screens/Home.tsx", content: "import { T } from '../types';",
  }, []) === undefined);
  ok("non-source file skipped", await unresolvedRelativeImportIssue(access, "write_file", {
    path: "README.md", content: "see ../does/not/exist",
  }, []) === undefined);
  ok("package imports ignored", await unresolvedRelativeImportIssue(access, "write_file", {
    path: "app/x.tsx", content: "import React from 'react';\nimport { View } from 'react-native';",
  }, []) === undefined);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures ? 1 : 0);
})();
