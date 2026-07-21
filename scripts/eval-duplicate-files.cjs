#!/usr/bin/env node
/**
 * Duplicate/conflict detection, tested against the real wreckage from the interrupted SwiftUI build:
 * 3 `@main` entry points, 2 divergent ContentView.swift, 2 divergent HistoryView.swift.
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

const { detectDuplicateFiles, duplicateFileProblem, safelyRemovableDuplicatePaths } = require(path.join(root, "lib/verification/duplicate-files.ts"));

let failures = 0;
const ok = (label, cond, detail) => {
  if (!cond) failures += 1;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

// The real Swift wreckage (content shapes match the actual files: 3 @main, divergent view sizes).
const swiftWreck = [
  { path: "WellnessApp/App/WellnessApp.swift", content: "@main\nstruct WellnessApp: App { var body: some Scene { WindowGroup { ContentView() } } }" },
  { path: "WellnessApp/WellnessAppApp.swift", content: "@main\nstruct WellnessAppApp: App { var body: some Scene { WindowGroup { RootTabView() } } }" },
  { path: "WorkoutTrackersCalorieCountersMeditationTimersApp.swift", content: "@main\nstruct WorkoutApp: App { var body: some Scene { WindowGroup { ContentView() } } }" },
  { path: "WellnessApp/App/ContentView.swift", content: "struct ContentView: View {\n" + "  // 248 lines of real implementation\n".repeat(120) + "}" },
  { path: "WellnessApp/ContentView.swift", content: "struct ContentView: View { var body: some View { Text(\"stub\") } }" },
  { path: "WellnessApp/Views/History/HistoryView.swift", content: "struct HistoryView: View {\n" + "  // 189 lines\n".repeat(90) + "}" },
  { path: "WellnessApp/Views/HistoryView.swift", content: "struct HistoryView: View {\n" + "  // 46 lines\n".repeat(22) + "}" },
  { path: "WellnessApp/ViewModels/WorkoutViewModel.swift", content: "class WorkoutViewModel: ObservableObject {}" },
  { path: "WellnessApp/Models/UserProfile+CoreDataClass.swift", content: "class UserProfile {}" },
];

console.log("=== the real SwiftUI wreckage ===");
const findings = detectDuplicateFiles(swiftWreck);
const entry = findings.find((f) => f.kind === "entry-point-conflict");
ok("detects the 3 @main entry-point conflict", entry && entry.paths.length === 3, entry && entry.paths.join(", "));
ok("entry conflict is NOT auto-collapsible (divergent)", entry && entry.autoCollapsible === false);
const contentViewDup = findings.find((f) => f.kind === "duplicate-basename" && /contentview/i.test(f.paths[0]));
ok("detects the 2 divergent ContentView.swift", Boolean(contentViewDup));
ok("largest ContentView is listed first (the real one)", contentViewDup && /App\/ContentView/.test(contentViewDup.paths[0]));
const historyDup = findings.find((f) => f.kind === "duplicate-basename" && /historyview/i.test(f.paths[0]));
ok("detects the 2 divergent HistoryView.swift", Boolean(historyDup));
ok("problem summary flags a compile-blocking conflict", /will not compile/i.test(duplicateFileProblem(swiftWreck) || ""));
ok("divergent wreckage is NOT auto-removed", safelyRemovableDuplicatePaths(swiftWreck).length === 0, "divergent code is flagged, never deleted");

console.log("\n=== byte-identical duplicates ARE safe to collapse ===");
const identical = [
  { path: "src/util/format.ts", content: "export const f = (x) => x + 1;" },
  { path: "src/helpers/format.ts", content: "export const f = (x) => x + 1;" },
  { path: "src/index.ts", content: "console.log('app');" },
];
const removable = safelyRemovableDuplicatePaths(identical);
ok("one identical copy is marked for removal", removable.length === 1, removable.join(", "));
ok("the shallower path is kept", removable[0] === "src/helpers/format.ts");

console.log("\n=== clean projects and legitimate repeats produce NO findings ===");
const clean = [
  { path: "src/app/page.tsx", content: "export default function Page(){return null}" },
  { path: "src/components/index.ts", content: "export * from './a';" },
  { path: "src/features/index.ts", content: "export * from './b';" },
  { path: "src/a.py", content: "if __name__ == '__main__':\n  run()" },
  { path: "pkg/__init__.py", content: "" },
  { path: "sub/__init__.py", content: "" },
];
ok("no duplicate findings for a clean project", detectDuplicateFiles(clean).length === 0, JSON.stringify(detectDuplicateFiles(clean).map((f) => f.kind)));
ok("legitimate repeated basenames (index.ts, __init__.py) are ignored", duplicateFileProblem(clean) === undefined);
ok("a single Python __main__ is not a conflict", !detectDuplicateFiles(clean).some((f) => f.kind === "entry-point-conflict"));

console.log("\n=== REGRESSION: a real Next.js App Router app must NOT be flagged (the login-auth-page break) ===");
const nextApp = [
  { path: "src/app/page.tsx", content: "export default function Home(){return <div>home</div>}" },
  { path: "src/app/dashboard/page.tsx", content: "export default function Dashboard(){return <div>dash</div>}" },
  { path: "src/app/admin/invoices/page.tsx", content: "export default function Invoices(){return <div>inv</div>}" },
  { path: "src/app/admin/users/page.tsx", content: "export default function Users(){return <div>users</div>}" },
  { path: "src/app/layout.tsx", content: "export default function Root({children}){return <html>{children}</html>}" },
  { path: "src/app/admin/layout.tsx", content: "export default function AdminLayout({children}){return <section>{children}</section>}" },
  { path: "src/app/api/users/route.ts", content: "export async function GET(){return Response.json([])}" },
  { path: "src/app/api/invoices/route.ts", content: "export async function POST(){return Response.json({})}" },
  { path: "src/app/admin/actions.ts", content: "'use server'; export async function delUser(){}" },
  { path: "src/app/dashboard/actions.ts", content: "'use server'; export async function refresh(){}" },
];
ok("Next.js multi-route app produces NO blocking problem", duplicateFileProblem(nextApp) === undefined,
  JSON.stringify(detectDuplicateFiles(nextApp).map((f) => `${f.kind}:${f.paths[0]}`)));
ok("Next.js route conventions are not even flagged as findings", detectDuplicateFiles(nextApp).length === 0);

console.log("\n=== a genuine entry-point conflict STILL blocks (real drift is still caught) ===");
ok("2 divergent @main entry points still block the build", /conflicting entry points/.test(duplicateFileProblem(swiftWreck) || ""));
ok("divergent same-basename WITHOUT an entry conflict does NOT block", duplicateFileProblem([
  { path: "a/helper.tsx", content: "export const x = " + "1;\n".repeat(30) },
  { path: "b/helper.tsx", content: "export const y = " + "2;\n".repeat(30) },
]) === undefined);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
