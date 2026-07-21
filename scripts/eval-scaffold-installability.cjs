#!/usr/bin/env node
/**
 * Verifies every npm-based stack scaffold can actually resolve its dependency tree.
 *
 * The Expo scaffold shipped for weeks with react 19.1.0 + react-native 0.81.x — a pair npm rejects with
 * ERESOLVE — so every generated Expo project was born unable to install anything, and missions then paid
 * models to code against packages that could never exist. That bug class is not stack-specific: any
 * scaffold's pinned versions can drift into conflict as upstream packages move.
 *
 * `npm install --package-lock-only` fully resolves the tree (including peer ranges) without downloading
 * a single package, so this catches the born-broken class deterministically. Run it whenever scaffold
 * manifests change, and periodically — the ecosystem moves underneath fixed pins.
 *
 * Python/.NET scaffolds use different resolvers and are not covered here; their manifests use ranges
 * that pip/nuget resolve at install time.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCAFFOLDS = {
  "nextjs": {
    dependencies: { next: "^15.5.0", react: "^19.0.0", "react-dom": "^19.0.0" },
    devDependencies: { typescript: "^5.0.0", "@types/node": "^20.0.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", tailwindcss: "^3.4.0", postcss: "^8.0.0", autoprefixer: "^10.0.0" },
  },
  "nextjs+prisma": {
    dependencies: { next: "^15.5.0", react: "^19.0.0", "react-dom": "^19.0.0", "@prisma/client": "^6.0.0" },
    devDependencies: { typescript: "^5.0.0", "@types/node": "^20.0.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", tailwindcss: "^3.4.0", postcss: "^8.0.0", autoprefixer: "^10.0.0", prisma: "^6.0.0" },
  },
  "react-vite": {
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
    devDependencies: { "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "@vitejs/plugin-react": "^4.3.0", typescript: "^5.7.0", vite: "^6.0.0", vitest: "^3.0.0" },
  },
  "node-express": {
    dependencies: { express: "^5.0.0" },
    devDependencies: { "@types/express": "^5.0.0", "@types/node": "^22.0.0", tsx: "^4.0.0", typescript: "^5.7.0" },
  },
  "expo-react-native": {
    dependencies: {
      "@expo/vector-icons": "^15.0.3", expo: "^54.0.0", "expo-router": "^6.0.0", "expo-status-bar": "^3.0.0",
      react: "^19.1.4", "react-dom": "^19.1.4", "react-native": "^0.81.5", "react-native-safe-area-context": "~5.6.0",
      "react-native-screens": "~4.16.0", "react-native-web": "~0.21.0",
    },
    devDependencies: { "@types/react": "^19.1.0", "babel-preset-expo": "^54.0.0", typescript: "^5.9.0" },
  },
  // The pair that shipped broken, kept as a canary: if this ever starts PASSING, npm's resolution
  // changed and the fixture should be refreshed to a new known-bad pair.
  "expo-KNOWN-BAD (canary)": {
    expectFail: true,
    dependencies: {
      expo: "^54.0.0", react: "19.1.0", "react-dom": "19.1.0", "react-native": "^0.81.5",
    },
    devDependencies: {},
  },
};

let failures = 0;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-scaffold-audit-"));
for (const [name, scaffold] of Object.entries(SCAFFOLDS)) {
  const dir = path.join(scratch, name.replace(/[^a-z0-9-]/gi, "_"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "audit", version: "0.0.0", private: true, dependencies: scaffold.dependencies, devDependencies: scaffold.devDependencies }, null, 2));
  let resolved = true;
  let detail = "";
  try {
    execSync("npm install --package-lock-only --no-audit --no-fund", { cwd: dir, stdio: "pipe", timeout: 120_000 });
  } catch (error) {
    resolved = false;
    detail = String(error.stderr || error.message).split("\n").find((line) => /ERESOLVE|peer|conflict|ETARGET|notarget/i.test(line)) || "resolution failed";
  }
  const expected = !scaffold.expectFail;
  const ok = resolved === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(28)} ${resolved ? "resolves" : `DOES NOT RESOLVE — ${detail.trim().slice(0, 100)}`}`);
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL PASS — every shipped scaffold resolves; the known-bad canary still fails as expected" : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
