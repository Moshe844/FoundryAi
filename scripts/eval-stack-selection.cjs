#!/usr/bin/env node
/**
 * Guards workload-signal classification in lib/discovery/platform-stack-policy.ts.
 *
 * The alternations there were written as /\bfoo|bar|ai|baz\b/ — in JS the \b binds only to the FIRST
 * and LAST alternative, so short tokens were unanchored: `ai` matched inside "pl(ai)n", "em(ai)l",
 * "m(ai)n", "det(ai)l"; `ar`/`vr` matched inside "m(ar)keting", "c(ar)d", "st(ar)t". A request for a
 * "plain HTML page" was therefore classified dynamic, skipped the static-stack branch, and was forced
 * into Next.js + TypeScript + a database. Reproduced live in the real UI on 2026-07-21.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { const t = r.startsWith("@/") ? path.join(root, r.slice(2)) : r; try { return orig.call(this, t, ...a); } catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${t}${x}`)) return `${t}${x}`; throw e; } };

const { platformStackOptionsForProject, reconcilePlatformStackOptions, architectureForSelectedStack, discoveryWithSelectedStack } = require(path.join(root, "lib/discovery/platform-stack-policy.ts"));

let failures = 0;
const ok = (label, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  — ${detail ?? ""}`}`); };
const recommendedFor = (prompt, projectType = "Website", mainFeatures = []) => {
  const options = platformStackOptionsForProject("website", { prompt, projectType, mainFeatures, dataModel: [], keyFacts: [], decisions: [] });
  return (options.find((option) => option.recommended) ?? options[0] ?? {}).name ?? "";
};

console.log("=== the exact live request that was forced into Next.js ===");
const plainPrompt = 'A one-page personal profile site in plain HTML and CSS. No framework and no build step — a single index.html. Centered card with the name "Sam Carter", a one-line bio, and three skill tags with a hover effect.';
const plainRec = recommendedFor(plainPrompt);
ok('"plain HTML" no longer recommends a full-stack framework', !/next\.js|postgres|prisma|fastapi/i.test(plainRec), plainRec);
ok("it recommends a static HTML/CSS stack", /html/i.test(plainRec), plainRec);

console.log("\n=== other innocent words that used to trip the `ai` token ===");
for (const word of ["email", "main navigation", "product details", "available hours", "training page"]) {
  const rec = recommendedFor(`A simple one-page site showing ${word}. Static content only.`);
  ok(`"${word}" does not force a full-stack framework`, /html/i.test(rec), rec);
}

console.log("\n=== negated mentions must not summon what the user explicitly refused ===");
const negated = recommendedFor('A single static HTML page — a profile card. Plain HTML and CSS only. Nothing else — no dashboard, no records, no forms.');
ok('"no dashboard, no records" does not pull in a database stack', !/postgres|prisma|sqlite|mysql/i.test(negated), negated);
ok("it still lands on a static stack", /html/i.test(negated), negated);
const noDb = recommendedFor("A simple one-page site with no database and no backend.");
ok('"no database and no backend" is honoured', !/postgres|prisma|fastapi/i.test(noDb), noDb);

console.log("\n=== genuinely dynamic requests STILL get a real stack ===");
ok("an app with login/accounts gets an auth-capable stack", /auth|next\.js|django|identity|devise/i.test(recommendedFor("Build an admin portal with user login, signup and password reset.")), recommendedFor("Build an admin portal with user login, signup and password reset."));
ok("an inventory app with a database gets a data stack", /postgres|prisma|database|next\.js/i.test(recommendedFor("An inventory app that stores records in a database for multiple users.")), recommendedFor("An inventory app that stores records in a database for multiple users."));
ok("a real AI project still reads as AI", /next\.js|fastapi|ai/i.test(recommendedFor("An AI assistant that calls an LLM for chat responses.")), recommendedFor("An AI assistant that calls an LLM for chat responses."));

console.log("\n=== the discovery model must not upsell a framework onto a simple static project ===");
// Reproduces the live portfolio screen: the model proposed Next.js ★ and the deterministic policy's own
// "no server, account, or shared-data requirement" card was pushed to the bottom.
const portfolio = {
  prompt: "A portfolio site showing my projects, with a page per project and an about section.",
  projectType: "Portfolio", mainFeatures: ["Project grid", "Project detail pages", "About section"],
  dataModel: [], keyFacts: [], decisions: [], recommendedStack: "Next.js (React + Static Generation)",
};
const modelProposed = [
  { name: "Next.js (React + Static Generation)", why: "Static rendering plus MDX authoring.", recommended: true },
  { name: "Astro (Island architecture with React/Vue/Svelte)", why: "Static content sites with MDX.", recommended: false },
  { name: "Hugo (Go-based static site generator)", why: "SEO-friendly responsive portfolios.", recommended: false },
];
const reconciled = reconcilePlatformStackOptions("website", portfolio, modelProposed);
const names = reconciled.stackOptions.map((o) => o.name);
ok("a portfolio is no longer recommended a React framework", !/next\.js/i.test(reconciled.recommendedStack), reconciled.recommendedStack);
ok("the lightest viable stack owns the recommendation", /html/i.test(reconciled.recommendedStack), reconciled.recommendedStack);
ok("exactly one option is flagged recommended", reconciled.stackOptions.filter((o) => o.recommended).length === 1);
ok("the model's proposals are still offered as alternatives", names.some((n) => /next\.js|astro|hugo/i.test(n)), JSON.stringify(names));

console.log("\n=== package/library toolchains must never be offered for a website ===");
// Live 2026-07-22: a portfolio was offered "TypeScript + tsup + Vitest — npm publishing" ★, plus
// Python+Hatch and Rust+Cargo. Cause: familyForExplicitStack tested /…|vite|…/ unbounded, so "Vi(test)"
// matched "vite" and the package toolchain was classified WEB; unnamed toolchains fell through to
// "unconstrained", which the fit filter always accepted.
const libraryProposals = reconcilePlatformStackOptions("custom", portfolio, [
  { name: "TypeScript + tsup + Vitest", why: "A typed package stack with npm publishing.", recommended: true },
  { name: "Python + Hatch + pytest + mypy", why: "A Python package alternative with PyPI publishing.", recommended: false },
  { name: "Rust + Cargo", why: "Native/WASM library.", recommended: false },
]);
const libNames = libraryProposals.stackOptions.map((o) => o.name).join(" | ");
ok("no npm-publishing package stack is offered", !/tsup|vitest/i.test(libNames), libNames);
ok("no PyPI/Cargo library stack is offered", !/hatch|cargo/i.test(libNames), libNames);
ok("every offered option is a web stack", libraryProposals.stackOptions.every((o) => /html|astro|svelte|next|vite|react/i.test(o.name)), libNames);

console.log("\n=== the architecture prose must follow the stack that was actually selected ===");
// Verbatim from the live discovery screen: sidebar said "STACK: HTML + CSS + TypeScript (Vite)" while
// the memo still read "Portfolio built with Next.js …". That memo is carried into the build brief.
const modelProse = "Portfolio built with Next.js, organized around Portfolio. Next.js content site with static generation for pages and posts, MDX-based content authoring, and a component library of reusable sections (hero, feature grid, testimonials, CTA).";
const reconciledProse = architectureForSelectedStack(modelProse, "Next.js (React + Static Generation)", "HTML + CSS + TypeScript (Vite)");
ok("the rejected framework no longer appears in the memo", !/next\.js/i.test(reconciledProse), reconciledProse.slice(0, 120));
ok("the selected stack is named in the memo", /HTML \+ CSS \+ TypeScript \(Vite\)/.test(reconciledProse));
ok("the memo states the selected stack decisively", /Implementation stack: HTML \+ CSS \+ TypeScript \(Vite\)/.test(reconciledProse));
ok("unrelated prose is preserved", /hero, feature grid, testimonials/.test(reconciledProse));
ok("an unchanged recommendation leaves the memo untouched", architectureForSelectedStack(modelProse, "Next.js", "Next.js") === modelProse);
ok("empty architecture stays empty", architectureForSelectedStack("", "Next.js", "HTML + CSS") === "");

console.log("\n=== 'simple' alone must not force static onto a genuinely interactive site ===");
// A museum site with a 3D artifact viewer has no auth or database either — but a framework is right
// there. Forcing static on everything "simple" would replace a valid model recommendation.
const museum = reconcilePlatformStackOptions("website", {
  prompt: "An interactive museum exhibition website with 3D artifact stories",
  projectType: "Museum website", mainFeatures: ["Interactive exhibits", "3D artifact viewer"],
  dataModel: [], keyFacts: [], decisions: [], recommendedStack: "Nuxt 4 + Vue 3 + TypeScript",
}, [
  { name: "Nuxt 4 + Vue 3 + TypeScript", why: "Matches the requested interactive editorial experience.", recommended: true },
  { name: "Astro + TypeScript", why: "Content-forward alternative.", recommended: false },
]);
ok("an interactive 3D site keeps its framework recommendation", /^Nuxt 4/.test(museum.recommendedStack), museum.recommendedStack);

console.log("\n=== the rejected stack must not survive in ANY memo field ===");
// Verbatim shape from the live "Product page" run: preserveUserProductSignal had already copied the
// architecture sentence into decisions[architecture].hypothesis and keyFacts BEFORE reconciliation, so
// fixing only `architecture` left "Next.js" on screen and in the build brief. Scan every field.
const liveMemo = {
  prompt: "Product page", projectType: "Product page", recommendedStack: "Next.js (React + Static Generation)",
  architecture: "Product page built with Next.js, organized around Product page. Next.js content site with static generation for pages and posts, MDX-based content authoring, and a component library of reusable sections (hero, feature grid, testimonials, CTA).",
  mainFeatures: ["Multi-page website"], dataModel: ["Page", "Post/project", "Author"],
  keyFacts: ["Multi-page website", "Next.js content site with static generation for pages and posts", "Web application"],
  decisions: [
    { dimension: "platform", hypothesis: "Web" },
    { dimension: "architecture", hypothesis: "Product page built with Next.js, organized around Product page. Next.js content site with static generation for pages and posts, MDX-based content authoring." },
  ],
};
const corrected = discoveryWithSelectedStack({ ...liveMemo, recommendedStack: "HTML + CSS + TypeScript (Vite)" }, liveMemo.recommendedStack, "HTML + CSS + TypeScript (Vite)");
const everyField = [corrected.architecture, ...corrected.keyFacts, ...corrected.decisions.map((d) => d.hypothesis)].join(" || ");
ok("no field still names the rejected framework", !/next\.js/i.test(everyField), everyField.slice(0, 200));
ok("the architecture decision hypothesis was rewritten", !/next\.js/i.test(corrected.decisions.find((d) => d.dimension === "architecture").hypothesis));
ok("the key facts were rewritten", !corrected.keyFacts.some((fact) => /next\.js/i.test(fact)));
ok("the selected stack now appears in the memo", /HTML \+ CSS \+ TypeScript \(Vite\)/.test(everyField));
ok("unrelated decisions are untouched", corrected.decisions.find((d) => d.dimension === "platform").hypothesis === "Web");
ok("an unchanged recommendation leaves the memo alone", discoveryWithSelectedStack(liveMemo, "Next.js", "Next.js").architecture === liveMemo.architecture);

console.log("\n=== a genuinely dynamic project still follows the model's recommendation ===");
const adminApp = {
  prompt: "An admin portal where staff log in with a password and manage customer records in a database.",
  projectType: "Business app", mainFeatures: ["Login", "Manage customers", "Roles"],
  dataModel: ["Customer"], keyFacts: [], decisions: [], recommendedStack: "Next.js App Router + TypeScript + Auth.js + Prisma",
};
const adminReconciled = reconcilePlatformStackOptions("website", adminApp, [
  { name: "Next.js App Router + TypeScript + Auth.js + Prisma", why: "Full account lifecycle.", recommended: true },
]);
ok("an auth + database app is not downgraded to static HTML", !/^html/i.test(adminReconciled.recommendedStack), adminReconciled.recommendedStack);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
