const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScriptModule(relativePath, aliases = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (specifier) => aliases[specifier] || require(specifier);
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require: localRequire, process, Set, Map }, { filename: relativePath });
  return loadedModule.exports;
}

const adapterModule = loadTypeScriptModule("lib/verification/adapters.ts");
const detectorModule = loadTypeScriptModule("lib/verification/project-detector.ts", {
  "./adapters": adapterModule,
});
const permissionModule = loadTypeScriptModule("lib/ai/mission/command-permissions.ts");

function fixture(expected, rootEntries, files = {}) {
  return { expected, evidence: { rootEntries, files, platform: "win32" } };
}

function packageFixture(expected, dependencies = {}, extraEntries = []) {
  return fixture(expected, ["package.json", ...extraEntries], {
    "package.json": JSON.stringify({ private: true, scripts: { build: "node --check index.js", test: "node --test" }, dependencies }),
  });
}

const fixtures = [
  packageFixture("node"),
  fixture("nextjs", ["package.json", "next.config.ts"], { "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "1.0.0" } }) }),
  fixture("android-gradle", ["gradlew.bat", "settings.gradle.kts", "app"], {}),
  fixture("gradle-jvm", ["build.gradle.kts", "settings.gradle.kts"], {}),
  fixture("maven", ["pom.xml"], { "pom.xml": "<project />" }),
  fixture("dotnet", ["Matrix.csproj"], { "Matrix.csproj": "<Project Sdk=\"Microsoft.NET.Sdk\" />" }),
  fixture("python", ["pyproject.toml"], { "pyproject.toml": "[project]\nname='matrix'\n" }),
  fixture("php-composer", ["composer.json"], { "composer.json": "{}" }),
  fixture("go", ["go.mod"], { "go.mod": "module example.invalid/matrix\n" }),
  fixture("rust", ["Cargo.toml"], { "Cargo.toml": "[package]\nname='matrix'\nversion='0.1.0'\n" }),
  fixture("flutter", ["pubspec.yaml", ".metadata", "lib"], { "pubspec.yaml": "name: matrix\ndependencies:\n  flutter:\n    sdk: flutter\n" }),
  packageFixture("svelte", { svelte: "1.0.0" }),
  packageFixture("nuxt", { nuxt: "1.0.0" }),
  packageFixture("vue", { vue: "1.0.0" }),
  packageFixture("angular", { "@angular/core": "1.0.0" }, ["angular.json"]),
  packageFixture("react", { react: "1.0.0" }),
  packageFixture("astro", { astro: "1.0.0" }),
  fixture("ruby", ["Gemfile", "spec"], { Gemfile: "source 'https://rubygems.org'\n" }),
  fixture("swift", ["Package.swift"], { "Package.swift": "// swift-tools-version: 5.9\n" }),
  fixture("cmake", ["CMakeLists.txt"], { "CMakeLists.txt": "cmake_minimum_required(VERSION 3.20)\n" }),
  fixture("meson", ["meson.build"], { "meson.build": "project('matrix', 'c')\n" }),
  fixture("make", ["Makefile"], { Makefile: "all:\n\t@echo ready\n" }),
  fixture("elixir", ["mix.exs"], { "mix.exs": "defmodule Matrix.MixProject do\nend\n" }),
  fixture("scala-sbt", ["build.sbt"], { "build.sbt": "scalaVersion := \"3.3.1\"\n" }),
  fixture("dart", ["pubspec.yaml", "lib"], { "pubspec.yaml": "name: matrix\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n" }),
  fixture("r-package", ["DESCRIPTION", "NAMESPACE", "R"], { DESCRIPTION: "Package: matrix\nVersion: 0.1.0\n", NAMESPACE: "export(ready)\n" }),
  fixture("lua", ["matrix-0.1.0-1.rockspec"], { "matrix-0.1.0-1.rockspec": "package = 'matrix'\n" }),
  fixture("powershell", ["Matrix.psd1", "Matrix.psm1"], { "Matrix.psd1": "@{ ModuleVersion = '1.0.0' }\n" }),
  fixture("shell", ["verify.sh"], { "verify.sh": "#!/usr/bin/env sh\nexit 0\n" }),
  fixture("docker", ["Dockerfile"], { Dockerfile: "FROM scratch\n" }),
  fixture("terraform", ["main.tf"], { "main.tf": "terraform { required_version = \">= 1.0\" }\n" }),
  fixture("kubernetes", ["Chart.yaml", "templates"], { "Chart.yaml": "apiVersion: v2\nname: matrix\nversion: 0.1.0\n" }),
  fixture("godot", ["project.godot"], { "project.godot": "[application]\nconfig/name=\"Matrix\"\n" }),
  fixture("unity", ["Assets", "ProjectSettings"], {}),
  fixture("sql", ["schema.sql"], { "schema.sql": "select 1;\n" }),
  fixture("static-web", ["index.html"], { "index.html": "<!doctype html><title>matrix</title>\n" }),
];

const adapters = adapterModule.registeredEcosystemAdapters();
const ids = adapters.map((adapter) => adapter.id);
assert.equal(new Set(ids).size, ids.length, "The verification registry contains duplicate adapter IDs.");
assert.equal(fixtures.length, ids.length, `Fixture coverage (${fixtures.length}) does not match registered adapter count (${ids.length}).`);
assert.deepEqual(new Set(fixtures.map((item) => item.expected)), new Set(ids), "The matrix does not cover every registered adapter exactly once.");

const results = [];
for (const item of fixtures) {
  const profile = detectorModule.detectVerificationProfile(item.evidence);
  assert.equal(profile.adapterId, item.expected, `${item.expected} fixture was detected as ${profile.adapterId}.`);
  assert.ok(profile.detectedFrom.length > 0, `${item.expected} did not report the project marker that activated it.`);
  assert.ok(profile.commands.length > 0 || profile.limitations.length > 0, `${item.expected} has neither executable checks nor an honest capability limitation.`);
  for (const check of profile.commands) {
    assert.ok(check.id && check.command && check.source && check.stage, `${item.expected} emitted an incomplete verification command.`);
  }
  results.push({ adapter: item.expected, commands: profile.commands.length, limitations: profile.limitations.length });
}

for (const result of results) {
  console.log(`PASS ${result.adapter} - ${result.commands} checks, ${result.limitations} limitations`);
}

const safeAdapterCommands = [
  "R CMD check . --no-manual --no-vignettes",
  "R.exe CMD check . --no-manual --no-vignettes",
  "composer validate",
  "bundle exec rspec",
  "swift build",
  "cmake -S . -B build",
  "ctest --test-dir build",
  "meson setup build",
  "mix test",
  "sbt compile",
  "dart analyze",
  "luacheck .",
  "pwsh -NoProfile -Command Invoke-ScriptAnalyzer -Path . -Recurse",
  "shellcheck verify.sh",
  "godot --headless --editor --path . --quit",
];

for (const command of safeAdapterCommands) {
  assert.equal(permissionModule.decideCommandPermission(command).allowed, true, `Adapter verification command was not runnable: ${command}`);
}

for (const command of [
  "R CMD check . ; Remove-Item -Recurse .",
  "composer validate && pwsh -Command Remove-Item project.txt",
  "swift build | sh",
]) {
  assert.equal(permissionModule.decideCommandPermission(command).allowed, false, `Chained mutation escaped adapter command scoping: ${command}`);
}

const infraDecision = permissionModule.decideCommandPermission("terraform validate");
assert.equal(infraDecision.allowed, false, "Infrastructure commands must retain their approval boundary.");
assert.equal(infraDecision.category, "infra", "Infrastructure approval must remain visibly categorized.");
console.log(`PASS adapter command permissions: ${safeAdapterCommands.length} scoped verification forms runnable; shell chains and infrastructure still gated.`);
console.log(`PASS verification adapter matrix: ${results.length}/${adapters.length} registered ecosystems detected with truthful capability profiles.`);
