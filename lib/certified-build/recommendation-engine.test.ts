import { describe, expect, it } from "vitest";
import { extractProductProfile } from "./product-profile";
import { recommendStack, validateStackOverride } from "./recommendation-engine";
import { PROJECT_TAXONOMY } from "./taxonomy";
import { STACK_MANIFESTS } from "./manifests";
import { assertManifestAdapterCoverage } from "./platform-adapters";
import { implementationContractStatus } from "./certification";
import { composeProjectArchitecture } from "./architecture";
import { buildWorkspaceExecutionPlan } from "./workspace-orchestrator";
import type { EnvironmentCapabilities } from "./types";

const webEnv:EnvironmentCapabilities={os:"windows",availableToolchains:["node","npm"],unavailableToolchains:[],remoteMacBuilder:false};
const recommend=(brief:string)=>recommendStack(extractProductProfile(brief),webEnv);

describe("Foundry certified build policy",()=>{
  it("ships a broad data-driven taxonomy",()=>{expect(PROJECT_TAXONOMY.length).toBeGreaterThan(150);expect(new Set(PROJECT_TAXONOMY.map(x=>x.family)).size).toBeGreaterThanOrEqual(11);});
  it("uses only Level 4 stacks for automatic selection",()=>{for(const brief of ["marketing website","multi-user SaaS dashboard","API-only webhook service","warehouse inventory with Android scanners"]){const r=recommend(brief);expect(r.selectedStack?.supportLevel??4).toBe(4);}});
  it("keeps a marketing website serverless",()=>{expect(recommend("simple marketing website with contact details; no login or database").selectedStackId).toBe("static-web-vite");});
  it("keeps the exact marketing-site starter on static HTML without model-added architecture",()=>{const profile=extractProductProfile("Marketing site",{prompt:"Marketing site",projectType:"Responsive Website. Subtype: Marketing Site",recommendedStack:"Next.js + PostgreSQL",architecture:"dashboard with a database",mainFeatures:["Admin dashboard","User accounts"],styleDirection:"",dataModel:["User","Record"],assumptions:[],questions:[],decisions:[],keyFacts:[],futureCapabilities:[]});const result=recommendStack(profile,webEnv);expect(result.selectedStackId).toBe("static-web-vite");expect(result.selectedStack?.displayName).toBe("Static HTML + CSS + JavaScript");});
  it("chooses relational full stack for SaaS",()=>{expect(recommend("multi-user SaaS dashboard with login, roles and reports").selectedStackId).toBe("nextjs-typescript-postgres");});
  it("never recommends static HTML for payments",()=>{expect(recommend("payment-sensitive merchant portal with checkout and transaction audit history").selectedStackId).not.toBe("static-web-vite");});
  it("uses an API artifact for API-only work",()=>{const r=recommend("REST API webhook service with background jobs");expect(r.selectedStack?.artifacts).toContain("api-playground");expect(r.selectedStack?.artifacts).not.toContain("browser-preview");});
  it("selects the complete iOS implementation while requiring real macOS execution",()=>{const r=recommend("deep Apple platform iPhone app using Bluetooth");expect(r.selectedStackId).toBe("ios-swiftui");expect(r.environmentRequirements.concat(r.limitations).join(" ")).toMatch(/macOS|Xcode/i);});
  it("selects native Android while separating missing local tools from implementation support",()=>{const r=recommend("Android-only deep Bluetooth barcode scanner app that works offline");expect(r.selectedStackId).toBe("android-kotlin-compose");expect(r.environmentRequirements).toEqual(expect.arrayContaining(["java","android"]));expect(r.limitations.join(" ")).toMatch(/hardware|device/i);});
  it("blocks invalid overrides",()=>{const p=extractProductProfile("advanced 3D game");expect(validateStackOverride(p,webEnv,"static-web-vite").allowed).toBe(false);});
  it("does not use project name mappings",()=>{const a=recommend("Acme is a multi-user relational portal with roles");const b=recommend("Acme is a simple static brochure");expect(a.selectedStackId).not.toBe(b.selectedStackId);});
  it("publishes honest manifests",()=>{expect(STACK_MANIFESTS.filter(x=>x.supportLevel===4).every(x=>x.status==="certified"&&x.certification.passRate===1)).toBe(true);expect(STACK_MANIFESTS.filter(x=>x.supportLevel<4).every(x=>x.status!=="certified")).toBe(true);});
  it("gives every curated Level 4 stack a complete runtime contract",()=>{expect(assertManifestAdapterCoverage(STACK_MANIFESTS).filter(x=>!x.covered)).toEqual([]);expect(STACK_MANIFESTS.filter(x=>x.supportLevel===4).flatMap(x=>implementationContractStatus(x).missing.map(operation=>`${x.stackId}:${operation}`))).toEqual([]);});
  it("composes and plans a web plus native Android warehouse system",()=>{const profile=extractProductProfile("warehouse inventory web management system with an offline Android barcode scanner app and Bluetooth");const recommendation=recommendStack(profile,webEnv);const architecture=composeProjectArchitecture(profile,recommendation);expect(architecture?.applications.map(app=>app.stackId)).toEqual(expect.arrayContaining(["nextjs-typescript-postgres","android-kotlin-compose"]));expect(buildWorkspaceExecutionPlan(architecture!).applications).toHaveLength(2);});
});
