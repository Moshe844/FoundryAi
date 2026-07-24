#!/usr/bin/env node
/**
 * Guards the question/edit boundary in the deterministic intent guard.
 *
 * A question that merely *contains* a change verb ("how does the data move around?") must never start an
 * edit mission — that silently rewrote a user's source file. A real change request must still act, even
 * when it is phrased politely enough to look interrogative ("can you add a dark mode switch?").
 *
 * Loads the real module through the TypeScript transpiler so this tests shipping code, not a copy.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.join(__dirname, "..");

// Teach require() about TypeScript and the "@/" alias for the rest of this process.
Module._extensions[".ts"] = (mod, file) => {
  const text = fs.readFileSync(file, "utf8");
  mod._compile(
    ts.transpileModule(text, {
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
    for (const extension of [".ts", ".tsx"]) {
      if (fs.existsSync(`${target}${extension}`)) return `${target}${extension}`;
    }
    throw error;
  }
};

const loadTs = (relative) => require(path.join(root, relative));

const { deterministicMutationIntent } = loadTs("lib/ai/mission/intent-classifier.ts");
const { explicitReadOnlyConstraint, fallbackFollowUpResolution, projectBehaviorDiagnosisIntent, standaloneMutationIntent } = loadTs("lib/mission/classifyFollowUp.ts");
const projectCtx = { source: "uploaded-copy", objective: "connected project" };
const READ_ONLY_INTENTS = new Set(["question", "inspection", "diagnose", "retrospective", "status"]);

// Must NOT mutate. Every one of these carries a change verb as ordinary English.
const questions = [
  "how does the data actually move around in here",
  "How does the data actually move around in here?",
  "where does the update happen",
  "what happens when I remove an expense?",
  "is the delete button wired up?",
  "what does the add expense handler do",
  "why is the state stored in localStorage and not a database?",
  "which file should I look at to change a category?",
  "walk me through how updates propagate to the chart",
  "explain how expenses get saved",
  "Describe the current architecture and data flow of this project.",
  "so what's the difference between the store and the component state?",
  "can you see where the filter is applied?",
  "how would I add a new expense category? steps only",
  "what do you think about moving this logic into a util?",
  "tell me how the monthly totals are computed",
];

// Must STILL act. Politeness and question marks do not make these read-only.
const commands = [
  "can you add a dark mode switch?",
  "Can you add a switch on top to be able to switch from dark mode to light mode",
  "please move the filter logic into a util",
  "add a category picker",
  "how about you add a dark mode toggle?",
  "why don't you rename the store file?",
  "I'd like you to remove the chart section",
  "could you please update the totals to exclude refunds?",
  "explain the data flow, then add a comment at the top of page.tsx",
  "what does this do? also delete the unused import",
  "let's refactor the expense list",
  "i want you to install chart.js",
  // Design/restructure verbs the mutation vocabulary once lacked, so a clear change request was
  // answered as read-only inspection and the project never changed. The "?" does not make an
  // imperative a question.
  "Can you please redesign my payment test page beautifully?",
  "please restyle the checkout page",
  "switch the storage to IndexedDB",
  "convert this page to TypeScript",
  "can you rewrite the nav as a component?",
];

// Neither questions nor commands: real claims about broken behavior. The question-form guard must not
// swallow these into read-only, or a bug report stops starting a debug mission.
const defectReports = [
  "the delete button is broken",
  "the totals are wrong",
  "it crashes when I add an expense",
  "how does saving work? the delete button is broken",
  "the chart doesn't update when I change the date filter",
];

let failures = 0;
const report = (label, message, actual, ok) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  intent=${String(actual)}  ${JSON.stringify(message)}`);
};

console.log("=== questions: deterministic guard must not produce a mutating intent ===");
for (const message of questions) {
  const intent = deterministicMutationIntent(message);
  const mutating = intent === "edit" || intent === "build";
  report("question", message, intent, !mutating);
}

console.log("\n=== change requests: deterministic guard must still produce a mutating intent ===");
for (const message of commands) {
  const intent = deterministicMutationIntent(message);
  const mutating = intent === "edit" || intent === "build" || intent === "debug";
  report("command", message, intent, mutating);
}

// Questions must resolve read-only end-to-end. The deterministic OVERRIDE (explicitReadOnlyConstraint)
// may defer an ambiguous polite form to the model — that is correct — so the guarantee is the offline
// resolution, which must never be a mutation for a genuine question.
console.log("\n=== questions: must resolve read-only offline ===");
for (const message of questions) {
  const intent = fallbackFollowUpResolution(message, projectCtx).currentIntent;
  report("read-only", message, intent, READ_ONLY_INTENTS.has(intent));
}

// THE CORE ARCHITECTURAL GUARANTEE: no deterministic word list may override the model on a real
// change request. explicitReadOnlyConstraint is the ONLY thing allowed to veto a live model verdict,
// and it must never fire on a command — whatever verb it uses, listed or not.
console.log("\n=== change requests: the model-override guard must never veto them ===");
for (const message of commands) {
  const veto = explicitReadOnlyConstraint(message);
  report("no-veto", message, veto, veto === null);
}

console.log("\n=== standaloneMutationIntent agrees on both sides ===");
for (const message of questions) {
  const intent = standaloneMutationIntent(message);
  report("standalone-q", message, intent, intent !== "edit");
}
for (const message of commands) {
  const intent = standaloneMutationIntent(message);
  report("standalone-c", message, intent, intent === "edit" || intent === "debug");
}

console.log("\n=== defect reports: the model-override guard must not veto them ===");
for (const message of defectReports) {
  const veto = explicitReadOnlyConstraint(message);
  report("defect", message, veto, veto === null);
}

console.log("\n=== project behavior questions: must inspect the active project ===");
const authEvidenceQuestion = "I signed up now, and it said check your email, did it really go to my email? When I'm trying to sign in with the exact email and password, it's not working.";
report("project-diagnosis", authEvidenceQuestion, projectBehaviorDiagnosisIntent(authEvidenceQuestion), projectBehaviorDiagnosisIntent(authEvidenceQuestion));
report("generic-question", "How does email verification usually work?", projectBehaviorDiagnosisIntent("How does email verification usually work?"), !projectBehaviorDiagnosisIntent("How does email verification usually work?"));

const total = (questions.length + commands.length) * 3 + defectReports.length + 2;
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ${total} assertions`);
process.exit(failures === 0 ? 0 : 1);
