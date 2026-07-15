const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "tmp", "evidence-reconciliation-compiled");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const source = path.join(root, "lib", "factory", "evidence-reconciliation.ts");
const compiled = ts.transpileModule(fs.readFileSync(source, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  reportDiagnostics: true,
});
const errors = (compiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
if (errors.length) throw new Error(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
fs.writeFileSync(path.join(out, "evidence-reconciliation.js"), compiled.outputText);

const { reconcileBlockedCommandChecklist } = require(path.join(out, "evidence-reconciliation.js"));
const passingTest = [{ command: "npm test", exitCode: 0, stdout: "ok", stderr: "" }];

const verified = [{ id: "verify", label: "Run npm test and confirm the suite passes without modifying package.json", status: "blocked" }];
reconcileBlockedCommandChecklist(verified, passingTest, ["request-id.cjs", "server.cjs", "server.test.cjs"]);
assert.equal(verified[0].status, "completed");
assert.match(verified[0].evidence, /npm test exited with code 0; package\.json remained unchanged/);

const preservationFailed = [{ id: "verify", label: "Run npm test without modifying package.json", status: "blocked" }];
reconcileBlockedCommandChecklist(preservationFailed, passingTest, ["package.json"]);
assert.equal(preservationFailed[0].status, "blocked", "a passing test cannot override a broken preservation promise");

const implementation = [{ id: "feature", label: "Integrate request IDs into the server", status: "blocked" }];
reconcileBlockedCommandChecklist(implementation, passingTest, ["server.cjs"]);
assert.equal(implementation[0].status, "blocked", "command evidence cannot complete unrelated implementation work");

const failedTest = [{ id: "verify", label: "Run npm test", status: "blocked" }];
reconcileBlockedCommandChecklist(failedTest, [{ ...passingTest[0], exitCode: 1 }], []);
assert.equal(failedTest[0].status, "blocked");

fs.rmSync(out, { recursive: true, force: true });
console.log("runtime evidence reconciliation tests passed");
