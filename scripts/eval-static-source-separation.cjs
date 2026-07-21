const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "lib/factory/static-source-separation.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadedModule = { exports: {} };
vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require }, { filename: "static-source-separation.ts" });
const separation = loadedModule.exports;

assert.equal(separation.isStaticSourceSeparationRequest("Can you create separate files for HTML CSS and JS?"), true);
assert.equal(separation.isStaticSourceSeparationRequest("Extract the inline styles and scripts into external files."), true);
assert.equal(separation.isStaticSourceSeparationRequest("Create a separate About page"), false);

const result = separation.separateStaticHtmlSource({
  html: `<!doctype html>
<html><head><style>body { color: navy; }</style><script type="application/ld+json">{"name":"Kept inline"}</script></head>
<body><button id="go">Go</button><script>document.querySelector('#go').addEventListener('click', () => document.body.dataset.clicked = 'yes');</script></body></html>`,
});
assert.match(result.html, /<link rel="stylesheet" href="styles\.css">/);
assert.match(result.html, /<script src="script\.js"><\/script>/);
assert.doesNotMatch(result.html, /<style\b/i);
assert.match(result.html, /application\/ld\+json/);
assert.match(result.html, /Kept inline/);
assert.doesNotMatch(result.html, /querySelector\('#go'\)/);
assert.equal(result.css, "body { color: navy; }\n");
assert.match(result.javascript, /dataset\.clicked/);
assert.equal(result.extractedStyleBlocks, 1);
assert.equal(result.extractedScriptBlocks, 1);

const merged = separation.separateStaticHtmlSource({
  html: "<html><head><style>.new { display: block; }</style></head><body><script>newFeature();</script></body></html>",
  existingCss: ".existing { display: grid; }\n",
  existingJavascript: "bootstrap();\n",
});
assert.match(merged.css, /\.existing[\s\S]*\.new/);
assert.match(merged.javascript, /bootstrap\(\);[\s\S]*newFeature\(\);/);

const emptyConcerns = separation.separateStaticHtmlSource({ html: "<html><head></head><body><main>Ready</main></body></html>" });
assert.match(emptyConcerns.html, /styles\.css/);
assert.match(emptyConcerns.html, /script\.js/);
assert.equal(emptyConcerns.css, "");
assert.equal(emptyConcerns.javascript, "");

const namedPlan = separation.planStaticSourceSeparation({
  documents: [{
    path: "pages/landing.htm",
    content: "<html><head><style>.hero{display:grid}</style></head><body><main>Landing</main><script>bootLanding();</script></body></html>",
  }],
  assets: [],
  requestedPaths: ["pages/landing.htm", "assets/brand-theme.css", "runtime/landing-client.mjs"],
});
assert.deepEqual(Array.from(namedPlan.htmlFiles), ["pages/landing.htm"]);
assert.deepEqual(Array.from(namedPlan.assetFiles), ["assets/brand-theme.css", "runtime/landing-client.mjs"]);
assert.deepEqual(Array.from(namedPlan.writes, (write) => write.path), ["assets/brand-theme.css", "runtime/landing-client.mjs", "pages/landing.htm"]);
const namedHtml = namedPlan.writes.find((write) => write.path === "pages/landing.htm").content;
assert.match(namedHtml, /href="\.\.\/assets\/brand-theme\.css"/);
assert.match(namedHtml, /src="\.\.\/runtime\/landing-client\.mjs"/);

const multiPagePlan = separation.planStaticSourceSeparation({
  documents: [
    { path: "site/home.html", content: '<html><head><link rel="stylesheet" href="../shared/site.css"><style>.home{color:navy}</style></head><body><script src="../shared/site.js"></script><script>home();</script></body></html>' },
    { path: "site/about.html", content: '<html><head><link rel="stylesheet" href="../shared/site.css"><style>.about{color:green}</style></head><body><script src="../shared/site.js"></script><script>about();</script></body></html>' },
  ],
  assets: [
    { path: "shared/site.css", content: ".shared{box-sizing:border-box}\n" },
    { path: "shared/site.js", content: "bootstrap();\n" },
  ],
});
assert.equal(multiPagePlan.htmlFiles.length, 2);
assert.deepEqual(Array.from(multiPagePlan.assetFiles), ["shared/site.css", "shared/site.js"]);
assert.match(multiPagePlan.writes.find((write) => write.path === "shared/site.css").content, /\.shared[\s\S]*\.about[\s\S]*\.home|\.shared[\s\S]*\.home[\s\S]*\.about/);
const sharedJavascript = multiPagePlan.writes.find((write) => write.path === "shared/site.js").content;
assert.match(sharedJavascript, /bootstrap\(\);[\s\S]*about\(\);[\s\S]*home\(\);|bootstrap\(\);[\s\S]*home\(\);[\s\S]*about\(\);/);
assert.match(sharedJavascript, /\/site\/about\.html/);
assert.match(sharedJavascript, /\/site\/home\.html/);
assert.match(sharedJavascript, /foundryEntryPath/);

const derivedPlan = separation.planStaticSourceSeparation({
  documents: [{ path: "microsites/spring-campaign.html", content: "<html><head><style>body{margin:0}</style></head><body><script>launch();</script></body></html>" }],
  assets: [],
});
assert.deepEqual(Array.from(derivedPlan.assetFiles), ["microsites/spring-campaign.css", "microsites/spring-campaign.js"]);

const largeDocuments = Array.from({ length: 250 }, (_, index) => ({
  path: `areas/section-${String(index).padStart(3, "0")}.html`,
  content: `<html><head><link rel="stylesheet" href="../shared/application-theme.css"><style>.section-${index}{order:${index}}</style></head><body><script src="../shared/application-runtime.mjs" type="module"></script><script type="module">registerSection(${index});</script></body></html>`,
}));
const largePlan = separation.planStaticSourceSeparation({
  documents: largeDocuments,
  assets: [
    { path: "shared/application-theme.css", content: ":root{color-scheme:light}\n" },
    { path: "shared/application-runtime.mjs", content: "export function bootstrap(){}\n" },
  ],
});
assert.equal(largePlan.htmlFiles.length, 250);
assert.deepEqual(Array.from(largePlan.assetFiles), ["shared/application-theme.css", "shared/application-runtime.mjs"]);
assert.equal(largePlan.writes.length, 252);
assert.ok(largePlan.writes.slice(0, 2).every((write) => write.kind === "asset"), "Shared dependencies must be written before a large HTML batch.");
assert.ok(largePlan.writes.slice(2).every((write) => write.kind === "html"));

const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const deterministicLane = runtime.indexOf('isStaticSourceSeparationRequest(requestedTask)');
const modelRouting = runtime.indexOf('const initialModel = await modelForMissionStage', deterministicLane);
assert.ok(deterministicLane > -1 && modelRouting > deterministicLane, "Static separation must complete before model selection.");
assert.match(runtime.slice(deterministicLane, modelRouting), /runDeterministicStaticSourceSeparation/);
assert.match(runtime, /planStaticSourceSeparation/);
assert.match(runtime, /write\.kind/);
assert.match(runtime, /Every earlier write in this batch was rolled back and verified/);
assert.doesNotMatch(runtime.slice(deterministicLane, modelRouting), /readFile\("index\.html"|readFile\("styles\.css"|readFile\("script\.js"/);
assert.match(runtime, /No paid repair call was made/);
assert.match(runtime, /More than 5,000 static source files require a staged architecture plan/);
assert.match(runtime, /64 MB deterministic transaction limit/);
assert.match(runtime, /preferredStaticEntries/);
assert.match(runtime, /entryFiles: preferredStaticEntries/);

const previewServer = fs.readFileSync(path.join(root, "scripts/foundry-static-preview.cjs"), "utf8");
assert.match(previewServer, /"\.mjs": "text\/javascript; charset=utf-8"/);
assert.match(previewServer, /"\.htm": "text\/html; charset=utf-8"/);

const connector = fs.readFileSync(path.join(root, "scripts/foundry-local-connector.cjs"), "utf8");
assert.match(connector, /function findEntryHtmlFile\(fullPath, preferredEntries = \[\]\)/);
assert.match(connector, /entryFile\.split\("\/"\)\.map\(encodeURIComponent\)\.join\("\/"\)/);
assert.match(connector, /Array\.isArray\(body\.entryFiles\)/);

console.log("static source separation evaluation passed");
