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
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require }, { filename: "platform-stack-policy.js" });
  return loadedModule.exports;
}

const policy = loadPolicy();
const baseDiscovery = {
  projectType: "Project",
  recommendedStack: "Next.js",
  architecture: "Application",
  decisions: [],
};
const webOnly = [
  { name: "Next.js", why: "Web", recommended: true },
  { name: "Node/Express", why: "Backend", recommended: false },
  { name: "Static HTML", why: "Page", recommended: false },
];

const desktop = policy.reconcilePlatformStackOptions("desktop", { ...baseDiscovery, projectType: "Desktop Application" }, webOnly);
assert(desktop.family === "desktop" && desktop.repaired, "A desktop starter did not reject web-only stack cards.");
assert(desktop.recommendedStack.includes("Electron") && desktop.stackOptions.every((item) => !/Next\.js|Static HTML/.test(item.name)), "Desktop fallback still contains unrelated web stacks.");

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
assert(web.family === "web" && /Next\.js/.test(web.recommendedStack), "Web starters are not protected from incompatible desktop recommendations.");

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
assert(dashboard.includes("platformStackOptionsForProject(template.id)") && dashboard.includes("fast-discovery-v4-platform-contract"), "The new-project UI can still seed or reuse generic web fallbacks for a known platform.");
assert(discoverRoute.includes("reconcilePlatformStackOptions(context.starter.id"), "Server discovery does not enforce the selected platform after model parsing.");
assert(runtime.includes("windowsHide: true") && connector.includes("windowsHide: true"), "Managed background servers are not configured to stay inside Foundry on Windows.");

console.log("Platform discovery and managed-preview regression checks passed.");
