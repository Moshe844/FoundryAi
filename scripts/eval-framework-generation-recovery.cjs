const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const compiled = ts.transpileModule(source("lib/verification/compiler-evidence.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require });

const deterministicCompiled = ts.transpileModule(source("lib/verification/deterministic-source-repair.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const deterministicLoaded = { exports: {} };
vm.runInNewContext(deterministicCompiled, { module: deterministicLoaded, exports: deterministicLoaded.exports, require });

const adaptersCompiled = ts.transpileModule(source("lib/verification/adapters.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const adaptersLoaded = { exports: {} };
vm.runInNewContext(adaptersCompiled, { module: adaptersLoaded, exports: adaptersLoaded.exports, require, process });

const autonomyCompiled = ts.transpileModule(source("lib/ai/mission/autonomy-contract.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const autonomyLoaded = { exports: {} };
vm.runInNewContext(autonomyCompiled, { module: autonomyLoaded, exports: autonomyLoaded.exports, require });

const { extractCompilerSourcePaths, compilerFailureFingerprint } = loaded.exports;
const projectRoot = path.resolve("C:/work/example");
const virtualFiles = new Set([
  "src/App.svelte",
  "src/main.tsx",
  "app/service.py",
  "src/main.rs",
  "src/Program.cs",
  "Views/MainWindow.xaml",
  "src/main/java/demo/App.java",
  "cmd/server/main.go",
].map((file) => path.resolve(projectRoot, file).toLowerCase()));
const fileExists = (absolutePath) => virtualFiles.has(path.resolve(absolutePath).toLowerCase());

const diagnostics = [
  ["Svelte/Vite", "[vite-plugin-svelte] src/App.svelte (197:29): C:/work/example/src/App.svelte:197:29 Expected as", "src/App.svelte"],
  ["TypeScript", "src/main.tsx:42:17 - error TS2322: Type 'string' is not assignable to type 'number'.", "src/main.tsx"],
  ["Python", "File \"C:/work/example/app/service.py\", line 18, in <module>\nSyntaxError: invalid syntax", "app/service.py"],
  ["Rust", "error[E0308]: mismatched types\n --> src/main.rs:12:5", "src/main.rs"],
  [".NET", "C:/work/example/src/Program.cs(31,14): error CS1002: ; expected", "src/Program.cs"],
  ["WPF/XAML", "C:/work/example/Views/MainWindow.xaml(256,33): error MC3074: The tag 'Export' does not exist in XML namespace. Line 256 Position 33.", "Views/MainWindow.xaml"],
  ["Java", "[ERROR] C:/work/example/src/main/java/demo/App.java:[22,9] cannot find symbol", "src/main/java/demo/App.java"],
  ["Go", "cmd/server/main.go:27:14: undefined: handler", "cmd/server/main.go"],
];
for (const [ecosystem, diagnostic, expected] of diagnostics) {
  assert.deepEqual(Array.from(extractCompilerSourcePaths(diagnostic, projectRoot, fileExists)), [expected], `${ecosystem} diagnostic did not resolve its real source file.`);
}

const first = { command: "npm.cmd run build", stderr: "src/App.svelte (197:29): Expected as\nBuild failed in 841ms" };
const sameMoved = { command: "npm.cmd run build", stderr: "src/App.svelte (201:33): Expected as\nBuild failed in 607ms" };
const newFailure = { command: "npm.cmd run build", stderr: "src/App.svelte (201:33): Unexpected token" };
assert.equal(compilerFailureFingerprint(first, projectRoot), compilerFailureFingerprint(sameMoved, projectRoot), "Location and duration noise must not buy another equivalent repair route.");
assert.notEqual(compilerFailureFingerprint(first, projectRoot), compilerFailureFingerprint(newFailure, projectRoot), "A newly exposed compiler diagnostic must count as repair progress.");

const xamlDiagnostic = "C:/work/example/Views/MainWindow.xaml(2,33): error MC3074: The tag 'Export' does not exist in XML namespace. Line 2 Position 33.";
const xamlContent = '<Window>\r\n  <Button Content="{ } Export JSON" />\r\n  <Export />\r\n</Window>';
const xamlRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "Views/MainWindow.xaml", content: xamlContent, diagnostic: xamlDiagnostic });
assert.ok(xamlRepair, "The compiler-proven malformed WPF label should be repaired without a model call.");
assert.match(xamlRepair.content, /Content="Export JSON"/);
assert.match(xamlRepair.content, /<Export \/>/, "A real XAML element must never be rewritten by the label repair.");
assert.equal(deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "Views/MainWindow.xaml", content: xamlContent, diagnostic: "error CS1002: ; expected" }), undefined);

const invalidXmlDiagnostic = "C:/work/example/Views/MainWindow.xaml(2,50): error MC3000: Name cannot begin with the '+' character. Line 2, position 50. XML is not valid.";
const invalidXmlContent = '<Window>\r\n  <TextBlock Text="Click \\"+ Add Folder\\" to continue" />\r\n</Window>';
const invalidXmlRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "Views/MainWindow.xaml", content: invalidXmlContent, diagnostic: invalidXmlDiagnostic });
assert.ok(invalidXmlRepair, "Compiler-identified invalid XML quote escaping should be repaired deterministically.");
assert.match(invalidXmlRepair.content, /Text="Click &quot;\+ Add Folder&quot; to continue"/);

const winFormsDiagnostic = "C:/work/example/ViewModels/AddFolderViewModel.cs(20,41): error CS0234: The type or namespace name 'Forms' does not exist in the namespace 'System.Windows' [C:/work/example/AIFileOrganizer/AIFileOrganizer_cbj0cee0_wpftmp.csproj]";
const wpfProject = '<Project Sdk="Microsoft.NET.Sdk">\r\n  <PropertyGroup>\r\n    <TargetFramework>net8.0-windows</TargetFramework>\r\n    <UseWPF>true</UseWPF>\r\n  </PropertyGroup>\r\n</Project>';
const winFormsRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "AIFileOrganizer/AIFileOrganizer.csproj", content: wpfProject, diagnostic: winFormsDiagnostic });
assert.ok(winFormsRepair, "Compiler-identified Windows Forms interop in a WPF project should enable the required SDK reference deterministically.");
assert.match(winFormsRepair.content, /<UseWPF>true<\/UseWPF>\r?\n\s*<UseWindowsForms>true<\/UseWindowsForms>/);
assert.match(winFormsRepair.content, /<Using Remove="System\.Windows\.Forms" \/>/);
assert.match(winFormsRepair.content, /<Using Remove="System\.Drawing" \/>/);
assert.equal(deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "AIFileOrganizer/AIFileOrganizer.csproj", content: wpfProject, diagnostic: "error CS1002: ; expected" }), undefined);

const ambiguityDiagnostic = "C:/work/example/Converters/Converters.cs(36,48): error CS0104: 'Color' is an ambiguous reference between 'System.Drawing.Color' and 'System.Windows.Media.Color' [C:/work/example/AIFileOrganizer/AIFileOrganizer_k4ub5h4x_wpftmp.csproj]";
const interopProject = wpfProject.replace("<UseWPF>true</UseWPF>", "<UseWPF>true</UseWPF>\r\n    <UseWindowsForms>true</UseWindowsForms>");
const ambiguityRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "AIFileOrganizer/AIFileOrganizer.csproj", content: interopProject, diagnostic: ambiguityDiagnostic });
assert.ok(ambiguityRepair, "Compiler-identified WPF/WinForms namespace ambiguity should be repaired in the project policy instead of by patching individual source lines.");
assert.match(ambiguityRepair.content, /<Using Remove="System\.Windows\.Forms" \/>/);
assert.match(ambiguityRepair.content, /<Using Remove="System\.Drawing" \/>/);

const missingIconDiagnostic = "CSC : error CS7064: Error opening icon file C:/work/example/AIFileOrganizer/Resources/app.ico -- Could not find a part of the path [C:/work/example/AIFileOrganizer/AIFileOrganizer_e4pmraqp_wpftmp.csproj]";
const missingIconProject = '<Project Sdk="Microsoft.NET.Sdk">\r\n  <PropertyGroup>\r\n    <ApplicationIcon>Resources\\app.ico</ApplicationIcon>\r\n  </PropertyGroup>\r\n  <ItemGroup>\r\n    <None Update="Resources\\app.ico">\r\n      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>\r\n    </None>\r\n  </ItemGroup>\r\n</Project>';
const missingIconRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "AIFileOrganizer/AIFileOrganizer.csproj", content: missingIconProject, diagnostic: missingIconDiagnostic });
assert.ok(missingIconRepair, "A compiler-identified missing optional .NET application icon should be removed from the manifest deterministically.");
assert.doesNotMatch(missingIconRepair.content, /ApplicationIcon|Resources\\app\.ico/);

const staticDiagnostic = "C:/work/example/Views/MainWindow.xaml.cs(81,22): error CS0176: Member 'UndoRedoService.Serialize(object)' cannot be accessed with an instance reference; qualify it with a type name instead [C:/work/example/AIFileOrganizer/AIFileOrganizer_cbj0cee0_wpftmp.csproj]";
const staticContent = "namespace Demo;\r\n" + Array.from({ length: 79 }, () => "").join("\r\n") + "\r\n        var before = Services.UndoRedoService.Serialize(rec);\r\n}";
const staticRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "Views/MainWindow.xaml.cs", content: staticContent, diagnostic: staticDiagnostic });
assert.ok(staticRepair, "A compiler-identified static member called through an instance should be qualified deterministically.");
assert.match(staticRepair.content, /var before = UndoRedoService\.Serialize\(rec\);/);
assert.doesNotMatch(staticRepair.content, /Services\.UndoRedoService\.Serialize/);

const dotnetAdapter = adaptersLoaded.exports.registeredEcosystemAdapters().find((adapter) => adapter.id === "dotnet");
const dotnetProfile = dotnetAdapter.buildProfile({
  rootEntries: ["AIFileOrganizer.sln", "DesktopApp.sln", "AIFileOrganizer"],
  files: {
    "AIFileOrganizer.sln": 'Project("{GUID}") = "AIFileOrganizer", "AIFileOrganizer\\AIFileOrganizer.csproj", "{GUID}"',
    "DesktopApp.sln": 'Project("{GUID}") = "DesktopApp", "DesktopApp.csproj", "{GUID}"',
  },
  platform: "win32",
});
assert.equal(dotnetProfile.commands[0].command, 'dotnet restore "AIFileOrganizer.sln"', "Ambiguous .NET roots must resolve to an evidence-backed explicit solution.");
assert.equal(dotnetProfile.commands[1].command, 'dotnet build "AIFileOrganizer.sln" --no-restore');
assert.doesNotMatch(dotnetProfile.commands.map((item) => item.command).join("\n"), /^dotnet (?:restore|build)$/m, "The .NET adapter must never emit a bare ambiguous command when a target exists.");

assert.deepEqual(JSON.parse(JSON.stringify(autonomyLoaded.exports.assessAutonomousBlocker("dotnet build failed: error CS1002"))), {
  disposition: "recoverable-engineering",
  terminal: false,
});
assert.equal(autonomyLoaded.exports.assessAutonomousBlocker("NO_PROGRESS_AFTER_MUTATION").terminal, false);
assert.equal(autonomyLoaded.exports.assessAutonomousBlocker("Missing API key for deployment").disposition, "external-dependency");
assert.equal(autonomyLoaded.exports.assessAutonomousBlocker("Approval is required before deleting this folder").disposition, "authority-required");
assert.match(autonomyLoaded.exports.terminalBlockerWithNextAction("Missing API key for deployment"), /Next action:/);

const executor = source("lib/ai/mission/executor.ts");
const runtime = source("lib/factory/runtime.ts");
const adapters = source("lib/verification/adapters.ts");
assert.doesNotMatch(executor, /normalizeSvelteTemplateAssertions|svelte-normalization/, "Framework-specific source rewriting must not sit in the generic executor.");
assert.match(runtime, /compilerFailureAttempts/);
assert.match(runtime, /failureAttempt > 2/);
assert.match(runtime, /maxTurns:\s*1/);
assert.match(runtime, /compilerDiagnosticOutput\(deterministicBuildFailure\)/);
assert.match(runtime, /paidRepeatPrevented:\s*true/);
assert.match(runtime, /extractCompilerSourcePaths\(output, projectPath\)/);
assert.match(runtime, /generatedVerificationProfile/);
assert.match(runtime, /Required \$\{generatedVerificationProfile\.ecosystem\} verification/);
assert.match(runtime, /ecosystemFailureAttempts/);
assert.match(runtime, /runRequiredVerificationProfile/);
assert.match(runtime, /applyDeterministicCompilerRepairs/);
assert.match(runtime, /paidModelCalls: 0/);
assert.match(runtime, /verificationFiles\[entry\] = read\.content/);
assert.match(executor, /mainwindow\\\.xaml/);
assert.match(executor, /fix\\\.txt/);
assert.match(executor, /existingProjectManifestPaths/);
assert.match(executor, /competingProjectManifestPath/);
assert.match(executor, /Repair the existing project in place/);
assert.match(executor, /Recoverable engineering failure returned to execution/);
assert.match(executor, /assessAutonomousBlocker\(reason\)/);
assert.match(runtime, /FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES/);
assert.match(runtime, /attemptedRecoveryFingerprints/);
assert.match(runtime, /Skipped a repeated paid recovery attempt/);
assert.match(runtime, /preflightIncompleteGeneratedBuild\(executorAccess, verificationProfile, workspaceProjectPath, execution\)/);
assert.match(runtime, /Applied a compiler-proven recovery repair before model routing/);
assert.match(runtime, /discoverNestedManifestPaths\(access\)/);
assert.match(runtime, /deterministicRecoveryPass < 8/);
assert.match(adapters, /id:\s*"python"/);
assert.match(adapters, /id:\s*"dotnet"/);
assert.match(adapters, /id:\s*"rust"/);
assert.match(adapters, /id:\s*"go"/);
assert.match(adapters, /id:\s*"maven"/);

console.log("Cross-ecosystem compiler recovery regression checks passed.");
