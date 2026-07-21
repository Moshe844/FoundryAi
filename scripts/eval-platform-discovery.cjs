const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadPolicy() {
  const source = fs.readFileSync(path.join(root, "lib/discovery/platform-stack-policy.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const sandboxRequire = (id) => id === "@/lib/ai/project-discovery"
    ? { explicitPlatformFromPrompt: () => undefined, explicitStackFromPrompt: () => undefined }
    : require(id);
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require: sandboxRequire }, { filename: "platform-stack-policy.js" });
  return loadedModule.exports;
}

const policy = loadPolicy();
const baseDiscovery = {
  prompt: "",
  projectType: "Project",
  recommendedStack: "Next.js",
  architecture: "Application",
  mainFeatures: [],
  dataModel: [],
  decisions: [],
};
const webOnly = [
  { name: "Next.js", why: "Web", recommended: true },
  { name: "Node/Express", why: "Backend", recommended: false },
  { name: "Static HTML", why: "Page", recommended: false },
];

const desktop = policy.reconcilePlatformStackOptions("desktop", { ...baseDiscovery, projectType: "Desktop Application" }, webOnly);
assert(desktop.family === "desktop" && desktop.repaired, "A desktop starter did not reject web-only stack cards.");
assert(desktop.recommendedStack.includes("Tauri") && desktop.stackOptions.every((item) => !/Next\.js|Static HTML/.test(item.name)), "Desktop fallback still contains unrelated web stacks.");

const mobile = policy.reconcilePlatformStackOptions("mobile", { ...baseDiscovery, projectType: "Mobile App" }, webOnly);
assert(mobile.family === "mobile" && /React Native/.test(mobile.recommendedStack), "Mobile fallback is not platform-compatible.");

const backend = policy.reconcilePlatformStackOptions("api", { ...baseDiscovery, projectType: "API Service" }, webOnly);
assert(backend.family === "backend" && backend.stackOptions.every((item) => !/Next\.js|Static HTML/.test(item.name)), "Backend fallback still contains page frameworks.");

const game = policy.reconcilePlatformStackOptions("game", { ...baseDiscovery, projectType: "Game" }, webOnly);
assert(game.family === "game" && /Godot/.test(game.recommendedStack), "Game fallback is not engine-compatible.");

const web = policy.reconcilePlatformStackOptions("website", { ...baseDiscovery, projectType: "Business Website" }, [
  { name: ".NET WPF", why: "Desktop", recommended: true },
  { name: "Electron", why: "Desktop", recommended: false },
]);
assert(web.family === "web" && /HTML \+ CSS/.test(web.recommendedStack) && web.stackOptions.every(item=>!/WPF|Electron/.test(item.name)), "Web starters are not protected from incompatible desktop recommendations.");

const authWeb=policy.reconcilePlatformStackOptions("custom",{...baseDiscovery,prompt:"Build a full login signup page with password reset, email verification, remember me and protected pages",projectType:"Authentication web application",architecture:"Server-rendered web application",mainFeatures:["Signup","Password reset","Email verification"],dataModel:["User","Session","Password reset token"],decisions:[{dimension:"platform",hypothesis:"Responsive web application"}]},webOnly);
assert(/Auth\.js/.test(authWeb.recommendedStack)&&/Prisma/.test(authWeb.recommendedStack)&&/PostgreSQL/.test(authWeb.recommendedStack),"Authentication recommendation omitted its auth, persistence, or migration stack.");
assert(/secure cookie sessions/.test(authWeb.stackOptions[0].why)&&/reset tokens/.test(authWeb.stackOptions[0].why),"Authentication recommendation does not explain lifecycle/security coverage.");

const staticWeb=policy.reconcilePlatformStackOptions("website",{...baseDiscovery,prompt:"A simple static portfolio with projects and contact links",projectType:"Portfolio website",architecture:"Static site"},webOnly);
assert(/^HTML \+ CSS/.test(staticWeb.recommendedStack)&&!staticWeb.stackOptions.some(item=>/PostgreSQL|Prisma/.test(item.name)),"Static websites are still being over-engineered.");

const aiBackend=policy.reconcilePlatformStackOptions("api",{...baseDiscovery,prompt:"AI document extraction API using embeddings and an LLM",projectType:"AI API",architecture:"Backend API",mainFeatures:["Document inference","Vector embeddings"]},webOnly);
assert(/FastAPI/.test(aiBackend.recommendedStack),"AI backend did not prefer the Python data/AI toolchain.");

const windowsDesktop=policy.reconcilePlatformStackOptions("desktop",{...baseDiscovery,prompt:"Windows-only accounting desktop app",projectType:"Windows desktop",architecture:"Native Windows application"},webOnly);
assert(/WPF/.test(windowsDesktop.recommendedStack)&&/SQLite/.test(windowsDesktop.recommendedStack),"Windows-native desktop requirements did not select a complete .NET stack.");

const iosMobile=policy.reconcilePlatformStackOptions("mobile",{...baseDiscovery,prompt:"iPhone-only personal health tracker",projectType:"iOS mobile app",architecture:"Native iOS application"},webOnly);
assert(/SwiftUI/.test(iosMobile.recommendedStack)&&/SwiftData/.test(iosMobile.recommendedStack),"Apple-only requirements did not select the native iOS stack.");

const browserGame=policy.reconcilePlatformStackOptions("game",{...baseDiscovery,prompt:"A 2D browser game",projectType:"Browser game",architecture:"HTML5 browser game"},webOnly);
assert(/Phaser/.test(browserGame.recommendedStack),"Browser-game requirements did not select a browser-native game stack.");

const cli=policy.reconcilePlatformStackOptions("custom",{...baseDiscovery,prompt:"A command-line tool for organizing project files",projectType:"CLI tool",architecture:"Terminal command-line application"},webOnly);
assert(cli.family==="cli"&&/Commander/.test(cli.recommendedStack),"CLI requirements did not receive a distributable command-line stack.");
const data=policy.reconcilePlatformStackOptions("custom",{...baseDiscovery,prompt:"An ETL data pipeline for CSV analytics",projectType:"Data pipeline",architecture:"Batch data processing"},webOnly);
assert(data.family==="data"&&/Polars/.test(data.recommendedStack)&&/DuckDB/.test(data.recommendedStack),"Data-pipeline requirements did not receive a reproducible local analytics stack.");
const library=policy.reconcilePlatformStackOptions("custom",{...baseDiscovery,prompt:"A reusable SDK library package for API clients",projectType:"Library",architecture:"Reusable package"},webOnly);
assert(library.family==="library"&&/Vitest/.test(library.recommendedStack),`Library requirements did not receive build, type, test, and publishing tooling: ${JSON.stringify(library)}`);
const embedded=policy.reconcilePlatformStackOptions("custom",{...baseDiscovery,prompt:"ESP32 embedded firmware for a temperature sensor",projectType:"Firmware",architecture:"Microcontroller embedded application"},webOnly);
assert(embedded.family==="embedded"&&/embedded-hal/.test(embedded.recommendedStack),"Embedded requirements did not receive firmware build and diagnostics tooling.");
const paxAndroid=policy.reconcilePlatformStackOptions("custom",{...baseDiscovery,prompt:"Build a production PAX Android app using the licensed PAX SDK; do not simulate hardware or payments",projectType:"Mobile app (Android)",architecture:"Android payment terminal application",mainFeatures:["Barcode scanning","PAX terminal checkout","Offline cart"]},webOnly);
assert(paxAndroid.family==="mobile"&&/^Kotlin/.test(paxAndroid.recommendedStack)&&/native vendor SDK/.test(paxAndroid.recommendedStack),`PAX Android hardware requirements did not prefer the native vendor SDK stack: ${JSON.stringify(paxAndroid)}`);

const customDesktop = policy.reconcilePlatformStackOptions("custom", {
  ...baseDiscovery,
  projectType: "AI File Organizer",
  architecture: "Installable desktop application with filesystem access",
  decisions: [{ dimension: "platform", hypothesis: "Windows and macOS desktop app" }],
}, webOnly);
assert(customDesktop.family === "desktop" && customDesktop.repaired, "A custom brief with an explicit desktop platform was not protected.");

const dashboard = fs.readFileSync(path.join(root, "components/BuildDashboard.tsx"), "utf8");
const discoverRoute = fs.readFileSync(path.join(root, "app/api/factory/discover/route.ts"), "utf8");
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const connector = fs.readFileSync(path.join(root, "scripts/foundry-local-connector.cjs"), "utf8");
assert(dashboard.includes("platformStackOptionsForProject(template.id)") && dashboard.includes("Pick a complete delivery stack"), "The new-project UI can still seed generic framework-only choices for a known platform.");
assert(discoverRoute.includes("reconcilePlatformStackOptions(context.starter.id"), "Server discovery does not enforce the selected platform after model parsing.");
assert(runtime.includes("windowsHide: true") && connector.includes("windowsHide: true"), "Managed background servers are not configured to stay inside Foundry on Windows.");

console.log("Platform discovery and managed-preview regression checks passed.");
