const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const engineeringReportSource = fs.readFileSync(path.join(root, "lib/factory/engineering-report.ts"), "utf8");
const workspaceShellSource = fs.readFileSync(path.join(root, "components/WorkspaceShell.tsx"), "utf8");
assert.match(engineeringReportSource, /const generic = .*implemented.*requested/s, "Engineering reports can still lead with generic model-authored completion prose.");
assert.match(workspaceShellSource, /function preciseFactoryOutcome/, "Mission handoffs do not derive a precise outcome from recorded behavior, files, and verification.");
assert.match(workspaceShellSource, /Verified by:/, "Precise completion summaries omit the actual successful verification gates.");

function loadTypeScriptModule(relativePath, aliases = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (specifier) => {
    if (aliases[specifier]) return aliases[specifier];
    return require(specifier);
  };
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require: localRequire, console, Date, Set, Map }, { filename: relativePath });
  return loadedModule.exports;
}

const permissions = loadTypeScriptModule("lib/ai/mission/command-permissions.ts");
const reports = loadTypeScriptModule("lib/factory/engineering-report.ts", {
  "@/lib/ai/mission/command-permissions": permissions,
});

function event(id, kind, status, title, extra = {}) {
  return { id, kind, status, title, timestamp: new Date().toISOString(), ...extra };
}

function verifiedResult() {
  return {
    projectId: "generic-project",
    projectName: "Generic Project",
    projectPath: "/workspace/generic-project",
    briefPath: "/workspace/generic-project/foundry-brief.md",
    stack: "Detected adapter",
    template: "Existing Project",
    sourceMode: "local-folder",
    objective: "Deploy the service and monitor its health",
    status: "passed",
    supported: true,
    events: [],
    files: [{ path: "src/entry.ts", status: "edited", size: 20, contentHash: "abc" }],
    commands: [
      { command: "npm run build", exitCode: 0, stdout: "built", stderr: "", durationMs: 100 },
      { command: "npm test", exitCode: 0, stdout: "passed", stderr: "", durationMs: 80 },
      { command: "vercel deploy --prod", exitCode: 0, stdout: "deployed", stderr: "", durationMs: 200 },
      { command: "curl https://service.invalid/health", exitCode: 0, stdout: "ok", stderr: "", durationMs: 20 },
    ],
    previewUrl: "http://127.0.0.1:3000",
    previewState: "ready",
    previewPlatform: "web",
    timeline: [
      event("understand", "inspection", "completed", "Inspected project"),
      event("plan", "planning", "completed", "Plan approved"),
      event("edit", "edit", "completed", "Edited src/entry.ts", { filePath: "src/entry.ts" }),
      event("preview", "preview", "completed", "Browser workflow passed"),
    ],
    checklist: [{ id: "delivery", label: "Deliver the requested behavior", status: "completed", evidence: "Verified" }],
    verification: [
      { check_type: "file-read", result: "pass", evidence: "Read-back fingerprint matched." },
      { check_type: "build", result: "pass", evidence: "Build exited 0." },
      { check_type: "test", result: "pass", evidence: "Tests exited 0." },
      { check_type: "preview", result: "pass", evidence: "Requested browser flow passed." },
    ],
  };
}

const completed = reports.finalizeFactoryProjectResult(verifiedResult(), "Deploy the service and monitor its health");
assert.equal(completed.engineeringReport.completion.highest, "production-ready");
assert.equal(completed.engineeringReport.publication.status, "verified");
assert.equal(completed.engineeringReport.monitoring.status, "verified");
assert.equal(completed.engineeringReport.browserValidation.status, "verified");
assert.equal(completed.lifecycle.find((phase) => phase.id === "publish").status, "completed");
assert.equal(completed.lifecycle.find((phase) => phase.id === "monitor").status, "completed");
assert.ok(completed.lifecycle.every((phase) => !phase.evidence.some((item) => /simulated|assumed/i.test(item))));

const readyIsNotValidated = verifiedResult();
readyIsNotValidated.objective = "Build the project";
readyIsNotValidated.commands = readyIsNotValidated.commands.slice(0, 1);
readyIsNotValidated.verification = readyIsNotValidated.verification.filter((item) => item.check_type !== "preview" && item.check_type !== "test");
const honestPreview = reports.finalizeFactoryProjectResult(readyIsNotValidated, "Build the project");
assert.equal(honestPreview.engineeringReport.browserValidation.status, "unverified", "A ready preview was promoted to browser validation without behavioral evidence.");
assert.equal(honestPreview.engineeringReport.completion.browserValidated, false);
assert.equal(honestPreview.engineeringReport.publication.status, "not-requested");
assert.equal(honestPreview.engineeringReport.monitoring.status, "not-requested");

const incompleteCreation = verifiedResult();
incompleteCreation.sourceMode = "new-project";
incompleteCreation.template = "Generated Project";
incompleteCreation.previewState = "stopped";
incompleteCreation.previewUrl = undefined;
incompleteCreation.verification = incompleteCreation.verification.filter((item) => item.check_type !== "preview");
const guardedCreation = reports.finalizeFactoryProjectResult(incompleteCreation, "Create a complete application");
// An incomplete created project must never cross the public completion boundary. It is held in
// autonomous recovery ("needs-clarification" with a Continue-recovery checkpoint), never reported as
// passed/production-ready, and carries an honest completion blocker.
assert.notEqual(guardedCreation.status, "passed", "A created project without a ready preview or runnable artifact crossed the public completion boundary.");
assert.equal(guardedCreation.status, "needs-clarification", "An incomplete created project was not held in autonomous recovery.");
assert.match(guardedCreation.blocker, /cannot mark this created project complete/i);
assert.ok(Array.isArray(guardedCreation.clarificationQuestions) && guardedCreation.clarificationQuestions.length > 0, "The recovery checkpoint offered no way to continue autonomous repair.");

const completeCreation = verifiedResult();
completeCreation.sourceMode = "new-project";
completeCreation.template = "Generated Project";
const acceptedCreation = reports.finalizeFactoryProjectResult(completeCreation, "Create a complete application");
assert.equal(acceptedCreation.status, "passed", "A created project with settled checklist, passing build/preview evidence, and a ready runtime was rejected.");

const staticSite = verifiedResult();
staticSite.stack = "Static HTML/CSS/JS";
staticSite.objective = "Create a static site";
staticSite.commands = [];
staticSite.files = [
  { path: "index.html", status: "created", size: 100, contentHash: "html" },
  { path: "styles.css", status: "created", size: 100, contentHash: "css" },
  { path: "script.js", status: "created", size: 100, contentHash: "js" },
];
staticSite.timeline = [
  event("preview-failed", "preview", "error", "Preview failed its first browser check"),
  event("preview-ready", "preview", "completed", "Interactive preview ready"),
  event("preview-verified", "preview", "completed", "Rendered project verified"),
];
staticSite.verification = [{ check_type: "preview", result: "pass", evidence: "Desktop and mobile browser validation passed." }];
const honestStatic = reports.finalizeFactoryProjectResult(staticSite, "Create a static site");
assert.equal(honestStatic.lifecycle.find((phase) => phase.id === "build").status, "completed", "A buildless static artifact was mislabeled as a skipped build.");
assert.match(honestStatic.lifecycle.find((phase) => phase.id === "build").evidence.join(" "), /No compilation step is required/);
assert.equal(honestStatic.lifecycle.find((phase) => phase.id === "launch").status, "completed", "A superseded preview error made the final launch phase fail.");
assert.equal(honestStatic.lifecycle.find((phase) => phase.id === "test").status, "skipped");
assert.match(honestStatic.lifecycle.find((phase) => phase.id === "test").reason, /browser validation/);
assert.equal(honestStatic.engineeringReport.actionsTaken.some((action) => /failed its first browser check/i.test(action)), false, "A superseded intermediate failure polluted the successful handoff actions.");

const failed = verifiedResult();
failed.status = "failed";
failed.blocker = "The required test failed.";
failed.verification = [
  { check_type: "build", result: "pass", evidence: "Build exited 0." },
  { check_type: "test", result: "fail", evidence: "One required test failed." },
];
failed.commands = failed.commands.slice(0, 2);
failed.previewUrl = undefined;
failed.previewState = "error";
failed.previewPlatform = "api";
const honestFailure = reports.finalizeFactoryProjectResult(failed, "Fix the failing behavior");
assert.equal(honestFailure.engineeringReport.completion.verified, false);
assert.equal(honestFailure.engineeringReport.completion.productionReady, false);
assert.ok(honestFailure.engineeringReport.remainingIssues.some((item) => /required test failed/i.test(item)));
assert.equal(honestFailure.lifecycle.find((phase) => phase.id === "test").status, "failed");

const unsupported = verifiedResult();
unsupported.status = "unsupported";
unsupported.supported = false;
unsupported.blocker = "No registered adapter can execute this stack.";
unsupported.files = [{ path: "foundry-brief.md", status: "created", size: 10, contentHash: "brief" }];
unsupported.commands = [];
unsupported.verification = [];
unsupported.previewUrl = undefined;
unsupported.previewState = "unavailable";
unsupported.previewPlatform = undefined;
unsupported.timeline = [
  event("understand", "planning", "completed", "Architecture selected"),
  event("brief", "file", "completed", "Created foundry-brief.md", { filePath: "foundry-brief.md" }),
];
const honestUnsupported = reports.finalizeFactoryProjectResult(unsupported, "Build with the detected stack");
assert.equal(honestUnsupported.engineeringReport.completion.saved, false, "Foundry's control brief was reported as user implementation work.");
assert.equal(honestUnsupported.lifecycle.find((phase) => phase.id === "implement").status, "blocked");
assert.equal(honestUnsupported.engineeringReport.actionsTaken.some((item) => /foundry-brief/i.test(item)), false);

const source = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
assert.match(source, /finalizeFactoryProjectResult\(result, result\.objective \|\| brief\)/);
assert.match(source, /finalizeFactoryProjectResult\(result, task\)/);
assert.match(source, /finalizeFactoryProjectResult\(result, `Rebuild \$\{result\.projectName\}`\)/);
assert.match(source, /result\.status = "failed";\s*result\.blocker = residualRisk;/, "Unresolved final verification can still be reported as a passed mission.");
assert.match(source, /could not verify the required outcome after an automatic repair and recheck/, "The terminal handoff does not explain the failed verification boundary.");

console.log("engineering lifecycle evaluation passed");
