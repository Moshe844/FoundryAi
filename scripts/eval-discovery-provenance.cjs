#!/usr/bin/env node
/**
 * Guards discovery honesty: a value Foundry invented must never be presented as the user's own choice.
 *
 * Live 2026-07-22, a "Northstar For Creative Agency" site showed main features "Primary workspace / Core
 * create/edit workflow / List/detail view / Settings or configuration area" and entities "Item, User,
 * Record" at 100% confidence, captioned "The leading capabilities preserve the user's selected product
 * concepts" — while the SAME screen still asked "What kind of tool or product is this, and who is it
 * for?". The heuristic marks those "inferred"/"defaulted" correctly; reconcileDiscoveryWithUserProductSignal
 * then overwrote them as user-confirmed regardless of whether any user words survived.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.join(__dirname, "..");
Module._extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: f }).outputText, f);
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { const t = r.startsWith("@/") ? path.join(root, r.slice(2)) : r; try { return orig.call(this, t, ...a); } catch (e) { for (const x of [".ts", ".tsx"]) if (fs.existsSync(`${t}${x}`)) return `${t}${x}`; throw e; } };

const { reconcileDiscoveryWithUserProductSignal, GENERIC_FEATURE_PLACEHOLDERS, GENERIC_ENTITY_PLACEHOLDERS, isGenericPlaceholderValue } = require(path.join(root, "lib/ai/project-discovery.ts"));

let failures = 0;
const ok = (label, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  — ${detail ?? ""}`}`); };
const decisionOf = (result, dimension) => result.decisions.find((d) => d.dimension === dimension);

const baseDiscovery = (over = {}) => ({
  prompt: "Northstar for creative agency", projectType: "Custom project", recommendedStack: "Next.js",
  architecture: "Application with an editable first version.", styleDirection: "Clean",
  mainFeatures: [...GENERIC_FEATURE_PLACEHOLDERS], dataModel: [...GENERIC_ENTITY_PLACEHOLDERS],
  keyFacts: [], assumptions: [], questions: [], futureCapabilities: [], deploymentNote: "",
  decisions: [
    { dimension: "features", hypothesis: "", confidence: 84, stakes: "high", source: "inferred", rationale: "Initial features are chosen from common workflows for this category.", action: "silent-infer" },
    { dimension: "data-shape", hypothesis: "", confidence: 82, stakes: "high", source: "defaulted", rationale: "Entities are inferred from the product category.", action: "silent-infer" },
  ],
  ...over,
});

console.log("=== placeholders must NOT be laundered into user-confirmed facts ===");
const generic = reconcileDiscoveryWithUserProductSignal(baseDiscovery(), { productSignal: "", starterTitle: "Website" });
const genericFeatures = decisionOf(generic, "features");
const genericEntities = decisionOf(generic, "data-shape");
ok("generic features are not marked user-confirmed", genericFeatures.source !== "user-confirmed", genericFeatures.source);
ok("generic features are not asserted at 100% confidence", genericFeatures.confidence < 100, String(genericFeatures.confidence));
// The invariant is honesty of provenance, not one exact sentence: either Foundry's own default wording,
// or the heuristic's original "inferred from this category" rationale. What must never appear is a claim
// that the user chose it.
const honest = (rationale) => /Foundry's default/i.test(rationale) || /inferred|chosen from common workflows|category/i.test(rationale);
ok("the feature rationale states an inferred origin", honest(genericFeatures.rationale), genericFeatures.rationale);
ok("it does not claim the user selected them", !/user's selected|user selected/i.test(genericFeatures.rationale), genericFeatures.rationale);
ok("generic entities are not marked user-confirmed", genericEntities.source !== "user-confirmed", genericEntities.source);
ok("the entity rationale states an inferred origin", honest(genericEntities.rationale), genericEntities.rationale);
ok("the entity rationale does not claim user selection", !/user's selected|user selected/i.test(genericEntities.rationale), genericEntities.rationale);

console.log("\n=== concepts present, but everything resolves to placeholders ===");
const placeholderOnly = reconcileDiscoveryWithUserProductSignal(baseDiscovery(), { productSignal: "Record", starterTitle: "Website" });
const placeholderFeatures = decisionOf(placeholderOnly, "features");
ok("a placeholder-only result is never user-confirmed", placeholderFeatures.source !== "user-confirmed", `${placeholderFeatures.source} :: ${placeholderFeatures.hypothesis}`);

console.log("\n=== real user concepts ARE still honoured as user-confirmed ===");
const real = reconcileDiscoveryWithUserProductSignal(baseDiscovery(), { productSignal: "Case study gallery, service list, contact enquiry", starterTitle: "Website" });
const realFeatures = decisionOf(real, "features");
ok("user-derived features are marked user-confirmed", realFeatures.source === "user-confirmed", realFeatures.source);
ok("user-derived features are asserted confidently", realFeatures.confidence === 100, String(realFeatures.confidence));
ok("the user's own words appear in the hypothesis", /case study gallery/i.test(realFeatures.hypothesis), realFeatures.hypothesis);
ok("Foundry's placeholders no longer ride along", !GENERIC_FEATURE_PLACEHOLDERS.some((p) => realFeatures.hypothesis.includes(p)), realFeatures.hypothesis);

console.log("\n=== the placeholder detector itself ===");
ok("'Primary workspace' is a placeholder", isGenericPlaceholderValue("Primary workspace"));
ok("'Record' is a placeholder", isGenericPlaceholderValue("record"));
ok("a real feature is not a placeholder", !isGenericPlaceholderValue("Case study gallery"));

console.log("\n=== a brand/title is not silently converted into a brochure website ===");
// A customer's industry is not the product type. Explicit website language may select the content
// profile, while a management workflow for that same customer must remain an application.
const { discoverProject } = require(path.join(root, "lib/ai/project-discovery.ts"));
const agency = discoverProject("Northstar for creative agency", "website");
ok("an explicitly selected Website starter may use the content profile", /content website/i.test(agency.projectType), agency.projectType);

console.log("\n=== explicit product evidence controls the domain ===");
const agencyNoStarter = discoverProject("Northstar for creative agency");
ok("'agency' alone does not imply a content website", !/content website/i.test(agencyNoStarter.projectType), agencyNoStarter.projectType);
const agencyWebsite = discoverProject("Build an agency website for Northstar with case studies and our work");
ok("explicit agency website language reaches the content profile", /content website/i.test(agencyWebsite.projectType), agencyWebsite.projectType);
const agencyProjectApp = discoverProject("Build a project management web app called Northstar for a creative agency with a kanban board and team workload view");
ok("agency project-management workflows stay an application", /project management application/i.test(agencyProjectApp.projectType), agencyProjectApp.projectType);

console.log("\n=== the discovery memo cannot promote unresolved defaults into build facts ===");
const dashboardSource = fs.readFileSync(path.join(root, "components/BuildDashboard.tsx"), "utf8");
ok("unanswered core decisions block summary continuation", /step === "summary" && blockedByUnansweredDiscovery/.test(dashboardSource));
ok("generic feature and entity placeholders are filtered from the memo", /meaningfulFeatures[\s\S]+!isGenericPlaceholderValue/.test(dashboardSource) && /meaningfulEntities[\s\S]+!isGenericPlaceholderValue/.test(dashboardSource));
ok("generic placeholders are filtered from the executable project brief", /establishedFeatures[\s\S]+!isGenericPlaceholderValue/.test(dashboardSource) && /establishedEntities[\s\S]+!isGenericPlaceholderValue/.test(dashboardSource));
ok("answered discovery questions recalculate the domain and stack", /discoveryUpdateFromConfirmedAnswers\(start\)/.test(dashboardSource));
ok("unresolved stacks are labeled provisional", /Provisional stack/.test(dashboardSource));

console.log("\n=== a genuinely vague prompt still gets defaults (and stays honest) ===");
const vague = discoverProject("Some internal thing");
ok("vague prompts still fall back to placeholders", vague.mainFeatures.some(isGenericPlaceholderValue), vague.mainFeatures.join(" | "));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
