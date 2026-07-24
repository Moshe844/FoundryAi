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

const mobileRecoveryCompiled = ts.transpileModule(source("lib/factory/mobile-recovery.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mobileRecoveryLoaded = { exports: {} };
vm.runInNewContext(mobileRecoveryCompiled, { module: mobileRecoveryLoaded, exports: mobileRecoveryLoaded.exports, require });

const scaffoldContractCompiled = ts.transpileModule(source("lib/factory/scaffold-contract.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const scaffoldContractLoaded = { exports: {} };
vm.runInNewContext(scaffoldContractCompiled, { module: scaffoldContractLoaded, exports: scaffoldContractLoaded.exports, require });

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

const overwrittenPropertyDiagnostic = "src/store/entityStore.ts(2,31): error TS2783: 'id' is specified more than once, so this usage will be overwritten.";
const overwrittenPropertyContent = "export function merge(id: string, current: { id: string }) {\n  return check({ id, ...current });\n}\n";
const overwrittenPropertyRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "src/store/entityStore.ts", content: overwrittenPropertyContent, diagnostic: overwrittenPropertyDiagnostic });
assert.ok(overwrittenPropertyRepair, "A compiler-proven overwritten shorthand property should be removed without a model call.");
assert.match(overwrittenPropertyRepair.content, /check\(\{ \.\.\.current \}\)/);

const nextRouteDiagnostic = ".next-build/types/app/api/assets/[id]/route.ts:49:7 Type error: Type '{ __tag__: \"GET\"; __param_type__: { params: { id: string; }; }; }' does not satisfy the constraint 'ParamCheck<RouteContext>'. Type '{ id: string; }' is missing the following properties from type 'Promise<any>': then, catch, finally";
const nextRouteContent = "export async function GET(_req: Request, { params }: { params: { id: string } }) {\n  return Response.json({ id: params.id })\n}\nexport async function PATCH(req: Request, { params }: { params: { id: string } }) {\n  return Response.json({ id: params.id })\n}\n";
const nextRouteRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "src/app/api/assets/[id]/route.ts", content: nextRouteContent, diagnostic: nextRouteDiagnostic });
assert.ok(nextRouteRepair, "Next.js-generated async RouteContext evidence should repair old dynamic route signatures deterministically.");
assert.match(nextRouteRepair.content, /params: Promise<\{ id: string \}>/);
assert.equal((nextRouteRepair.content.match(/\(await params\)\.id/g) || []).length, 2);
assert.equal(deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "src/app/api/assets/[id]/route.ts", content: nextRouteContent, diagnostic: "error TS1002: expected" }), undefined);
const nextPageDiagnostic = ".next-build/types/app/assets/[id]/page.ts:34:29 Type error: Type '{ params: { id: string; }; }' does not satisfy the constraint 'PageProps'. Type '{ id: string; }' is missing the following properties from type 'Promise<any>': then, catch, finally";
const nextPageContent = "export default function AssetPage({ params }: { params: { id: string } }) {\n  return <div>{params.id}</div>\n}\n";
const nextPageRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "src/app/assets/[id]/page.tsx", content: nextPageContent, diagnostic: nextPageDiagnostic });
assert.ok(nextPageRepair, "Next.js-generated async PageProps evidence should repair old dynamic page signatures deterministically.");
assert.match(nextPageRepair.content, /export default async function AssetPage/);
assert.match(nextPageRepair.content, /params: Promise<\{ id: string \}>/);
assert.match(nextPageRepair.content, /\(await params\)\.id/);
const nextSearchParamsDiagnostic = ".next-build/types/app/auth/magic/page.ts:34:29 Type error: Type '{ searchParams: { token?: string | undefined; }; }' does not satisfy the constraint 'PageProps'. Type '{ token?: string | undefined; }' is missing the following properties from type 'Promise<any>': then, catch, finally";
const nextSearchParamsContent = "export default function MagicPage({ searchParams }: { searchParams: { token?: string } }) {\n  return <div>{searchParams.token || ''}</div>\n}\n";
const nextSearchParamsRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "src/app/auth/magic/page.tsx", content: nextSearchParamsContent, diagnostic: nextSearchParamsDiagnostic });
assert.ok(nextSearchParamsRepair, "Next.js-generated async searchParams evidence should repair the owning page without a model call.");
assert.match(nextSearchParamsRepair.content, /searchParams: Promise<\{ token\?: string \}>/);
assert.match(nextSearchParamsRepair.content, /export default async function MagicPage/);
assert.match(nextSearchParamsRepair.content, /\(await searchParams\)\.token/);

const dependencyTrace = "node_modules/jose/dist/webapi/index.js\n.next-build/types/app/auth/magic/page.ts\nsrc/app/auth/magic/page.tsx";
assert.deepEqual(Array.from(extractCompilerSourcePaths(dependencyTrace, "C:/project", () => true)), ["src/app/auth/magic/page.tsx"], "Compiler repair evidence must exclude dependencies and generated framework caches.");
const prismaJsonDiagnostic = "./src/app/api/work-orders/[id]/route.ts:74:7 Type error: Type 'Record<string, unknown>' is not assignable to type 'NullableJsonNullValueInput | InputJsonValue | undefined'.";
const prismaJsonContent = "import { prisma } from '@/lib/db'\nconst changes: Record<string, unknown> = {}\nchanges.status = { from: 'OPEN', to: 'DONE' }\nvoid prisma.auditLog.create({ data: { changes } })\n";
const prismaJsonRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "src/app/api/work-orders/[id]/route.ts", content: prismaJsonContent, diagnostic: prismaJsonDiagnostic });
assert.ok(prismaJsonRepair, "A compiler-proven Prisma JSON input mismatch should tighten the accumulator type deterministically.");
assert.match(prismaJsonRepair.content, /import type \{ Prisma \} from '@prisma\/client'/);
assert.match(prismaJsonRepair.content, /const changes: Record<string, Prisma\.InputJsonValue \| null> = \{\}/);
const nextCookiesDiagnostic = "./src/lib/session.ts:12:28 Type error: Property 'get' does not exist on type 'Promise<ReadonlyRequestCookies>'.";
const nextCookiesContent = "import { cookies } from 'next/headers'\nexport async function session() {\n  const store = cookies()\n  return store.get('user')\n}\n";
const nextCookiesRepair = deterministicLoaded.exports.deterministicCompilerSourceRepair({ sourcePath: "src/lib/session.ts", content: nextCookiesContent, diagnostic: nextCookiesDiagnostic });
assert.ok(nextCookiesRepair, "Next.js request-store Promise evidence should add the required await deterministically.");
assert.match(nextCookiesRepair.content, /const store = await cookies\(\)/);

const expoConfig = JSON.stringify({ expo: { icon: "./assets/icon.png", splash: { image: "./assets/splash.png", backgroundColor: "#000" }, web: { output: "static", favicon: "./assets/favicon.png" } } });
const expoRepair = mobileRecoveryLoaded.exports.repairExpoConfigForBuild(expoConfig, "Error: Failed to statically export route:", () => false);
assert.equal(expoRepair.changed, true, "Missing optional Expo artwork and an unrenderable static route should be repaired without a model call.");
const repairedExpoConfig = JSON.parse(expoRepair.content);
assert.equal(repairedExpoConfig.expo.icon, undefined);
assert.equal(repairedExpoConfig.expo.splash.image, undefined);
assert.equal(repairedExpoConfig.expo.web.favicon, undefined);
assert.equal(repairedExpoConfig.expo.web.output, "single", "Expo Router SSR failure should fall back to its standard SPA export.");
assert.equal(repairedExpoConfig.expo.splash.backgroundColor, "#000", "Unrelated valid Expo configuration must be preserved.");
const validExpoRepair = mobileRecoveryLoaded.exports.repairExpoConfigForBuild(expoConfig, "Build passed", () => true);
assert.equal(validExpoRepair.changed, false, "Existing Expo assets and a healthy build must remain untouched.");

const manifestContract = scaffoldContractLoaded.exports.reconcilePackageManifestContract(
  JSON.stringify({ name: "any-project", scripts: { start: "custom-start" }, dependencies: { react: "custom-version" } }),
  JSON.stringify({ private: true, main: "framework-entry", scripts: { start: "framework-start", build: "framework-build", typecheck: "framework-check" }, dependencies: { react: "framework-version", framework: "required-version" } }),
);
assert.equal(manifestContract.changed, true, "A partially overwritten generated manifest must be repaired deterministically.");
const reconciledManifest = JSON.parse(manifestContract.content);
assert.equal(reconciledManifest.scripts.start, "custom-start", "Existing project-specific scripts must remain authoritative.");
assert.equal(reconciledManifest.dependencies.react, "custom-version", "Existing project-specific dependency versions must remain authoritative.");
assert.equal(reconciledManifest.scripts.build, "framework-build");
assert.equal(reconciledManifest.scripts.typecheck, "framework-check");
assert.equal(reconciledManifest.dependencies.framework, "required-version");
assert.equal(reconciledManifest.main, "framework-entry");
assert.equal(reconciledManifest.private, true);
const authoritativeManifest = scaffoldContractLoaded.exports.reconcilePackageManifestContract(
  JSON.stringify({ type: "module", scripts: { build: "tsc", start: "node dist/index.js" }, dependencies: { express: "^5" } }),
  JSON.stringify({ private: true, main: "expo-router/entry", scripts: { build: "expo export --platform web", start: "expo start" }, dependencies: { expo: "^54", "react-native": "0.81.5" } }),
  { authoritativeFoundation: true },
);
assert.deepEqual(JSON.parse(authoritativeManifest.content), {
  private: true,
  main: "expo-router/entry",
  scripts: { build: "expo export --platform web", start: "expo start" },
  dependencies: { expo: "^54", "react-native": "0.81.5" },
}, "A detected-stack mismatch must restore the saved brief's foundation instead of producing a hybrid project.");

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
assert.deepEqual(JSON.parse(JSON.stringify(autonomyLoaded.exports.assessAutonomousBlocker("Build output is locked by another running process; it was not safely identified as Foundry-owned."))), {
  disposition: "external-dependency",
  terminal: true,
  nextAction: "Close the specifically identified external process, then verify again; Foundry will not spend model calls trying to repair source for an operating-system file lock.",
});
assert.equal(autonomyLoaded.exports.assessAutonomousBlocker("Approval is required before deleting this folder").disposition, "authority-required");
assert.match(autonomyLoaded.exports.terminalBlockerWithNextAction("Missing API key for deployment"), /Next action:/);

const executor = source("lib/ai/mission/executor.ts");
const runtime = source("lib/factory/runtime.ts");
const adapters = source("lib/verification/adapters.ts");
assert.doesNotMatch(executor, /normalizeSvelteTemplateAssertions|svelte-normalization/, "Framework-specific source rewriting must not sit in the generic executor.");
assert.match(runtime, /compilerFailureAttempts/);
assert.match(runtime, /compilerFailureMutations/);
assert.match(runtime, /maxTurns:\s*1/);
assert.match(runtime, /compilerDiagnosticOutput\(deterministicBuildFailure\)/);
assert.match(runtime, /Cannot find module\\s\+\['"\]/, "TypeScript missing-package diagnostics must use deterministic dependency recovery.");
assert.match(runtime, /Failed to resolve import\\s\+\['"\]/, "Vite missing-package diagnostics must use deterministic dependency recovery.");
assert.match(runtime, /installing only that exact evidence before any repair model is called/);
assert.match(runtime, /browser preflight compiler identified/);
assert.match(executor, /tools: pendingEvidenceRepairReadPath/);
assert.match(runtime, /Compiler-authorized repair files/);
assert.match(runtime, /strategyReset:\s*true/, "Repeated repair evidence must change strategy without presenting a terminal blocker.");
assert.match(runtime, /applicationCompilerSourcePaths\(output, projectPath\)/, "Compiler working sets must route through the application-owned source filter and framework-contract mapper.");
assert.match(runtime, /generatedVerificationProfile/);
assert.match(runtime, /\$\{generatedVerificationProfile\.ecosystem\} verification passed after evidence-driven recovery/);
assert.match(runtime, /ecosystemFailureAttempts/);
assert.match(runtime, /runRequiredVerificationProfile/);
assert.match(runtime, /applyDeterministicCompilerRepairs/);
assert.match(runtime, /paidModelCalls: 0/);
assert.equal((runtime.match(/detached: process\.platform !== "win32"/g) || []).length, 2, "Windows framework previews must keep the piped npm wrapper attached so readiness and logs remain authoritative.");
assert.equal((runtime.match(/if \(process\.platform !== "win32"\) child\.unref\(\);/g) || []).length, 2, "Only detached POSIX preview groups should be unreferenced.");
assert.match(runtime, /projectRuntimeEnvironment\(projectPath, startScript === "start" \? "production" : "development",\s*projectId\)/, "A Next preview must load scoped project credentials and the selected project's env files without inheriting Foundry's development runtime mode.");
assert.match(runtime, /projectRuntimeEnvironment\(projectPath, script === "start" \? "production" : "development",\s*projectId\)/, "A generic Node preview must load scoped project credentials, env files, and runtime mode.");
assert.match(runtime, /platform === "mobile" && await isExpoProject\(projectPath\)/, "Expo must use its mobile-aware preview route rather than generic Node startup.");
assert.match(runtime, /startStaticPreview\(projectId, exportedWebRoot, "index\.html", events, execution, true\)/, "A verified Expo web export must be served at the SPA root.");
assert.match(runtime, /const previewUrl = useRootUrl \? `http:\/\/127\.0\.0\.1:\$\{port\}\/`/, "SPA preview URLs must not expose index.html as an application route.");
assert.match(runtime, /return startGenericNodePreview\(projectId, projectPath, webScript, events, execution, "web"\)/, "An in-progress Expo project must use its declared web script.");
assert.match(runtime, /Removed missing optional Expo asset references before model routing/, "Expo config failures must receive deterministic recovery before another paid repair.");
assert.match(runtime, /web: \{ bundler: "metro", output: "single" \}/, "New Expo scaffolds must default to the reliable SPA export instead of requiring every route to support SSR.");
assert.match(runtime, /\["\.env", `\.env\.\$\{mode\}`, "\.env\.local", `\.env\.\$\{mode\}\.local`\]/, "Managed previews must honor the project env-file precedence chain.");
assert.match(runtime, /return \{ \.\.\.fromProjectFiles, \.\.\.process\.env, \.\.\.stored\.environment, NODE_ENV: mode \}/, "Verified project-scoped credentials must win over host and project env files while the child runtime mode stays authoritative.");
assert.match(runtime, /function automatedTestEvidencePassed/, "Successful test commands must be reconciled with non-empty test evidence.");
assert.match(runtime, /discovered zero executable tests/, "A zero-test Node command must never be reported as passing verification.");
assert.match(runtime, /declaredTestsAreApplicable = hasNodeTestSource\(projectPath\) \|\| missionRequiresAutomatedTests\(task\)/, "An empty optional Node test script can still block an unrelated mission.");
assert.match(runtime, /nodeTestSourceExists \|\| requireAutomatedTests/, "Required profile gating does not distinguish real or explicitly requested tests from an inapplicable empty suite.");
assert.match(runtime, /latestMatchingCommand[\s\S]{0,500}latestResultIsAuthoritativePass/, "Verification command reuse is not based on the latest authoritative invocation.");
assert.match(runtime, /verificationFiles\[entry\] = read\.content/);
assert.match(executor, /mainwindow\\\.xaml/);
assert.match(executor, /fix\\\.txt/);
assert.match(executor, /build\[-_ \]\?lock/);
assert.match(executor, /Internal orchestration artifacts are never customer application source/);
assert.match(executor, /existingProjectManifestPaths/);
assert.match(executor, /removedFoundation/);
assert.match(executor, /removedScaffoldScript/);
assert.match(executor, /cannot delete canonical build, typecheck, test, start, or preview commands/);
assert.match(executor, /isLongRunningServerCommand/);
assert.match(executor, /Model-owned preview command rejected/);
assert.match(executor, /a dev or start server cannot count as successful production verification/);
assert.match(executor, /competingProjectManifestPath/);
assert.match(executor, /Repair the existing project in place/);
assert.match(executor, /Recoverable engineering failure returned to execution/);
assert.match(executor, /assessAutonomousBlocker\(reason\)/);
assert.match(runtime, /FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES/);
assert.match(runtime, /autonomousRepairStageLimit\(process\.env\.FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES, 20\)/, "Distinct compiler failures must be allowed to continue beyond the old four-pass ceiling.");
assert.ok(runtime.indexOf("compilerRepairPass += 1;") > runtime.indexOf("const failureFingerprint = compilerFailureFingerprint"), "Paid compiler-repair capacity must be consumed only after deterministic dependency and source repair routes are exhausted.");
assert.match(runtime, /fingerprintMutations >= 2 \|\| signatureMutations >= 2/, "Repeated semantic compiler failures must trigger strategy escalation only after real mutations, not repeated inspections.");
assert.match(runtime, /strategyReset: true, terminal: false/, "Repeated engineering failures must change strategy instead of becoming terminal project failures.");
assert.doesNotMatch(runtime, /Compiler repair reached a genuine repeated-error blocker/, "A repeated compiler diagnostic must never be presented as proof that a project cannot be completed.");
assert.match(runtime, /The project is unfinished, not failed\. Confirm continued recovery/, "A spending boundary must preserve a resumable project instead of returning a failed terminal state.");
assert.match(runtime, /options: \["Continue recovery", "Pause here"\]/, "A preserved recovery boundary must offer an actual resumable user decision instead of a dead approval state.");
assert.match(runtime, /failureAttempt > 1 \|\| signatureAttempt > 1/, "A second zero-change compiler observation must enforce a mutation instead of purchasing another inspection-only pass.");
assert.match(runtime, /transientBuildArtifactDirectory\(deterministicBuildFailure, projectPath\)/, "Missing generated build-cache artifacts must receive deterministic recovery before a repair model is charged.");
assert.match(runtime, /prisma", "generate"/, "Prisma projects must generate their client before build and preview.");
assert.match(runtime, /prisma", "db", "push", "--skip-generate"/, "Local SQLite Prisma projects must provision their schema before browser smoke testing.");
assert.doesNotMatch(runtime, /if \(!alreadyBuilt && existsSync\(path\.join\(projectPath, "package\.json"\)\)\)/, "Runtime dependency preparation must not be skipped merely because an earlier build command passed.");
assert.match(runtime, /await validateRequestedAuthFlow\(page, previewUrl\)/, "Requested authentication projects must execute a real live form smoke test instead of asserting one occurred.");
assert.match(runtime, /Created \$\{testEmail\} through the live signup form, then logged in with the same credentials/, "Auth completion requires a real signup-to-login browser round trip.");
assert.match(runtime, /integrationRequirementsForBrief\(credentialBrief\)/, "Every credential-backed requirement must be resolved before generation.");
assert.match(runtime, /No generation model was called/, "Missing project integrations must stop before paid generation.");
assert.match(runtime, /enforceProductionIntegrationReadiness/, "Browser completion must include the universal production integration source gate.");
assert.match(runtime, /authentication state is stored only in memory and disappears on restart/, "In-memory auth substitutes must be rejected explicitly.");
assert.match(runtime, /transactional email is logged to the console instead of being provider-delivered/, "Console-logged reset mail must never pass as working delivery.");
assert.match(runtime, /missingImport && compilerRepairPass < maxCompilerRepairPasses/, "A missing generated import must automatically change repair strategy instead of asking the customer to approve ordinary compiler work.");
assert.match(runtime, /Compiler repair paused before another paid attempt/, "A zero-mutation compiler repair without actionable missing-generation evidence must still stop before unbounded paid attempts.");
assert.match(runtime, /result\.commands\.filter\(\(command\) => isProductionBuildCommand\(command\.command\)\)\.at\(-1\)\?\.exitCode === 0/, "Only the latest production build may authorize preview and completion.");
assert.match(runtime, /Preview process reachable; running browser smoke verification/, "A listening HTTP process must not be presented as a verified live application.");
assert.match(runtime, /Preview port was occupied; relaunching on a clean port/, "App previews must recover when a probed port is claimed before the child process binds it.");
assert.match(runtime, /startNextPreview\(projectId, projectPath, events, execution, platform, bindAttempt \+ 1, excludedPorts\)/, "Next previews must retry on a newly allocated port after a bind collision.");
assert.match(runtime, /startGenericNodePreview\(projectId, projectPath, script, events, execution, platform, bindAttempt \+ 1, excludedPorts\)/, "Generic Node previews must retry on a newly allocated port after a bind collision.");
assert.doesNotMatch(runtime, /const maxCompilerRepairPasses = 4;/, "The fixed four-pass compiler repair boundary caused progressing builds to fail.");
assert.match(runtime, /maximumFinalGateRepairs = autonomousRepairStageLimit\(process\.env\.FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES, 20\)/, "A compiler failure exposed by the final verification gate must enter autonomous repair.");
assert.match(runtime, /finalProfileGate = await runRequiredVerificationProfile[\s\S]+final verification repair[\s\S]+finalProfileGate = await runRequiredVerificationProfile/, "Final-gate repair must rerun the complete verification profile after each mutation.");
assert.match(executor, /fix\[-_ \]\?\(\?:note\|placeholder\|stub\|temp\)/, "Generated-project progress guards must reject fake fix-placeholder files.");
assert.match(runtime, /sourceAfter !== sourceBefore \|\| recoveryFingerprintAfter !== recoveryFingerprintBefore/, "Recovery must recognize either source mutation or a changed verification failure as forward progress.");
assert.match(runtime, /consecutiveStagnantContinuationBatches >= 2/, "Recovery may pause paid calls only after both source and verification evidence remain unchanged across consecutive batches.");
assert.match(runtime, /preflightIncompleteGeneratedBuild\(executorAccess, verificationProfile, workspaceProjectPath, execution\)/);
assert.match(runtime, /Applied a compiler-proven recovery repair before model routing/);
assert.match(runtime, /discoverNestedManifestPaths\(access\)/);
assert.match(runtime, /deterministicRecoveryPass < 8/);
assert.match(runtime, /reconcilePackageManifest/);
assert.match(runtime, /reconcilePackageManifestContract/);
assert.match(runtime, /resumingIncompleteProject \? generatedRecoveryBudgetForTier\(routingBudgetForTier\(implementationModel\.tier\)\) : undefined/, "Generated recovery must use the selected model tier's bounded budget instead of a stale fixed constant.");
assert.doesNotMatch(runtime, /resumingIncompleteProject \? \{ maximumModelCalls: 40/);
assert.match(runtime, /maxContinuationBatches = autonomousRepairStageLimit\(process\.env\.FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES, 20\)/, "Progressing generated-project recovery must not stop at the old two-batch ceiling.");
assert.match(runtime, /consecutiveStagnantContinuationBatches = evidenceProgressed \? 0/, "Changing source or verification evidence must reset the recovery stagnation counter.");
assert.doesNotMatch(runtime, /Required \$\{verificationProfile\.ecosystem\} verification failed/, "Intermediate verification failures must remain internal repair evidence rather than user-facing terminal summaries.");
assert.match(runtime, /Verification stopped before model routing/);
assert.match(runtime, /authoritativeGeneratedStack/);
assert.match(runtime, /detectedStackMismatch/);
assert.match(runtime, /Restored the authoritative \$\{stackProfile\.label\} scaffold from the saved brief before model routing/);
assert.match(runtime, /stopOrphanedStaticPreviewsForProjectPath/);
assert.match(runtime, /foundry-static-preview\.cjs/);
assert.match(runtime, /pathIsInside\(canonicalProjectPath, previewPath\) \|\| pathIsInside\(previewPath, canonicalProjectPath\)/);
assert.match(adapters, /id:\s*"python"/);
assert.match(adapters, /id:\s*"dotnet"/);
assert.match(adapters, /id:\s*"rust"/);
assert.match(adapters, /id:\s*"go"/);
assert.match(adapters, /id:\s*"maven"/);

console.log("Cross-ecosystem compiler recovery regression checks passed.");
