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
import { CERTIFIED_STARTER_KINDS, CERTIFIED_STARTER_SUBTYPES, certifiedStarterSeed, type CertifiedStarterId } from "./starter-contracts";
import { discoverProject } from "../ai/project-discovery";

const webEnv:EnvironmentCapabilities={os:"windows",availableToolchains:["node","npm"],unavailableToolchains:[],remoteMacBuilder:false};
const recommend=(brief:string)=>recommendStack(extractProductProfile(brief),webEnv);

describe("Foundry certified build policy",()=>{
  it("ships a broad data-driven taxonomy",()=>{expect(PROJECT_TAXONOMY.length).toBeGreaterThan(150);expect(new Set(PROJECT_TAXONOMY.map(x=>x.family)).size).toBeGreaterThanOrEqual(11);});
  it("returns only fully certified implementations for registered project subtypes and identifies honest gaps",()=>{
    const unsupported:string[]=[];
    for(const entry of PROJECT_TAXONOMY){
      const result=recommend(entry.subtype);
      if(!result.selectedStackId){
        unsupported.push(entry.subtype);
        expect(result.question,entry.subtype).toMatch(/cannot honestly substitute|not a fully certified/i);
        continue;
      }
      expect(result.selectedStack?.supportLevel,entry.subtype).toBe(4);
      expect(implementationContractStatus(result.selectedStack!).missing,entry.subtype).toEqual([]);
    }
    expect(unsupported).toEqual(["winforms application"]);
  });
  it("uses only Level 4 stacks for automatic selection",()=>{for(const brief of ["marketing website","multi-user SaaS dashboard","API-only webhook service","warehouse inventory with Android scanners"]){const r=recommend(brief);expect(r.selectedStack?.supportLevel??4).toBe(4);}});
  it("keeps a marketing website serverless",()=>{expect(recommend("simple marketing website with contact details; no login or database").selectedStackId).toBe("static-web-vite");});
  it("keeps an ordinary one-page business website free of invented application infrastructure",()=>{
    const brief="Build a polished responsive one-page website for a neighborhood bakery with a hero, featured pastries, about, opening hours, address, and contact call-to-action.";
    const discovery=discoverProject(brief,"custom");
    const profile=extractProductProfile(brief,discovery);
    expect(recommendStack(profile,webEnv).selectedStackId).toBe("static-web-vite");
    expect(profile.capabilities.bluetooth).toBe(false);
    expect(profile.capabilities.fileUploads).toBe(false);
    expect(discovery.recommendedStack).toBe("Static HTML + CSS + JavaScript");
    expect(discovery.mainFeatures.join(" ")).not.toMatch(/blog|detail page|database|author|category|mdx/i);
    expect(discovery.dataModel).toEqual([]);
  });
  it("treats a comma-separated rejection list as negative constraints, not backend evidence",()=>{
    const brief="Build and publish a polished responsive one-page website for a neighborhood florist. Do not add a database, backend, blog, authentication, CMS, or extra pages.";
    const discovery=discoverProject(brief,"custom");
    expect(discovery.decisions.find(item=>item.dimension==="platform")?.hypothesis).toBe("Web");
    expect(discovery.decisions.find(item=>item.dimension==="auth-database-api")?.hypothesis).toMatch(/^No database/);
    expect(discovery.decisions.find(item=>item.dimension==="navigation")?.hypothesis).toMatch(/^One-page section navigation/);
    expect(recommendStack(extractProductProfile(brief,discovery),webEnv).selectedStackId).toBe("static-web-vite");
    expect(discovery.recommendedStack).toBe("Static HTML + CSS + JavaScript");
    expect(discovery.dataModel).toEqual([]);
  });
  it("keeps the exact marketing-site starter on static HTML without model-added architecture",()=>{const profile=extractProductProfile("Marketing site",{prompt:"Marketing site",projectType:"Responsive Website. Subtype: Marketing Site",recommendedStack:"Next.js + PostgreSQL",architecture:"dashboard with a database",mainFeatures:["Admin dashboard","User accounts"],styleDirection:"",dataModel:["User","Record"],assumptions:[],questions:[],decisions:[],keyFacts:[],futureCapabilities:[]});const result=recommendStack(profile,webEnv);expect(result.selectedStackId).toBe("static-web-vite");expect(result.selectedStack?.displayName).toBe("Static HTML + CSS + JavaScript");});
  it("chooses relational full stack for SaaS",()=>{expect(recommend("multi-user SaaS dashboard with login, roles and reports").selectedStackId).toBe("nextjs-typescript-postgres");});
  it("describes the business stack without falsely requiring an unconfigured production database",()=>{
    expect(recommend("customer ordering app with login and checkout").selectedStack?.displayName).toBe("Next.js + TypeScript + Relational Database");
    expect(recommend("customer ordering app with login and checkout").selectedStack?.supportedDatabases).toEqual(expect.arrayContaining(["SQLite","PostgreSQL"]));
  });
  it("treats login as a commerce capability rather than replacing the requested product",()=>{
    const brief="Build a complete customer ordering web app with polished login and sign-up pages. After login, show a storefront where customers add items to a cart, place orders and checkout.";
    const discovery=discoverProject(brief,"custom");
    expect(discovery.projectType).toBe("E-commerce store");
    expect(discovery.dataModel).toEqual(expect.arrayContaining(["User","Auth session","Product","Cart","Cart item","Order","Payment"]));
    expect(discovery.mainFeatures).toEqual(expect.arrayContaining(["Login","Account registration","Product browsing","Add to cart","Order placement and checkout"]));
    expect(discovery.decisions.find(item=>item.dimension==="navigation")?.hypothesis).toMatch(/Storefront.*checkout.*order history/i);
    expect(discovery.mainFeatures.join(" ")).not.toMatch(/Google OAuth|GitHub OAuth|Magic-link|MFA/i);
  });
  it("never recommends static HTML for payments",()=>{expect(recommend("payment-sensitive merchant portal with checkout and transaction audit history").selectedStackId).not.toBe("static-web-vite");});
  it("uses an API artifact for API-only work",()=>{const r=recommend("REST API webhook service with background jobs");expect(r.selectedStack?.artifacts).toContain("api-playground");expect(r.selectedStack?.artifacts).not.toContain("browser-preview");});
  it("selects the complete iOS implementation while requiring real macOS execution",()=>{const r=recommend("deep Apple platform iPhone app using Bluetooth");expect(r.selectedStackId).toBe("ios-swiftui");expect(r.environmentRequirements.concat(r.limitations).join(" ")).toMatch(/macOS|Xcode/i);});
  it("selects native Android while separating missing local tools from implementation support",()=>{const r=recommend("Android-only deep Bluetooth barcode scanner app that works offline");expect(r.selectedStackId).toBe("android-kotlin-compose");expect(r.environmentRequirements).toEqual(expect.arrayContaining(["java","android"]));expect(r.limitations.join(" ")).toMatch(/hardware|device/i);});
  it("blocks invalid overrides",()=>{const p=extractProductProfile("advanced 3D game");expect(validateStackOverride(p,webEnv,"static-web-vite").allowed).toBe(false);});
  it("does not use project name mappings",()=>{const a=recommend("Acme is a multi-user relational portal with roles");const b=recommend("Acme is a simple static brochure");expect(a.selectedStackId).not.toBe(b.selectedStackId);});
  it.each([
    ["retail inventory management with suppliers and purchase orders", "nextjs-typescript-postgres"],
    ["e-commerce store with catalogue, checkout and order management", "nextjs-typescript-postgres"],
    ["retail POS with receipts, payments and offline register workflows", "nextjs-typescript-postgres"],
    ["operations dashboard with filters, alerts and exportable reports", "nextjs-typescript-postgres"],
    ["portfolio website with responsive pages and SEO; no login or database", "static-web-vite"],
    ["cross-platform consumer mobile app for iPhone and Android", "flutter-mobile"],
    ["2D browser game with levels, score and keyboard controls", "phaser-typescript"],
    ["REST API with webhooks, validation and background jobs", "node-typescript-api"],
    ["document analysis AI service with RAG and file processing", "python-fastapi"],
    ["cross-platform desktop productivity app for Windows, macOS and Linux", "electron-typescript"],
  ])("selects a product-appropriate certified stack for %s", (brief, expected) => {
    expect(recommend(brief).selectedStackId).toBe(expected);
  });
  it("honors an explicit certified technology choice",()=>{expect(recommend("REST API in Python with FastAPI").selectedStackId).toBe("python-fastapi");});
  it.each([
    ["AI application. Subtype: Chat assistant","nextjs-ai-postgres"],
    ["AI application. Subtype: Document Q&A / RAG","nextjs-ai-postgres"],
    ["AI application. Subtype: Agentic workflow","nextjs-ai-postgres"],
    ["AI application. Subtype: Content generation tool","nextjs-ai-postgres"],
    ["AI application. Subtype: AI-powered internal tool","nextjs-ai-postgres"],
    ["AI application. Subtype: Voice/multimodal app","nextjs-ai-postgres"],
    ["AI-only FastAPI service for document classification","python-fastapi"],
  ])("uses a complete AI architecture for %s",(brief,expected)=>{
    const result=recommend(brief);
    expect(result.selectedStackId).toBe(expected);
    if(expected==="nextjs-ai-postgres") expect(result.selectedStack?.traits).toEqual(expect.arrayContaining(["ai-runtime","model-provider","evaluation"]));
  });
  it.each([
    ["3D game in Unreal Engine","Unreal Engine"],
    ["desktop application in Qt and C++","Qt/C++"],
    ["mobile app with React Native and Expo","React Native / Expo"],
    ["web app in Vue and TypeScript","Vue / Nuxt"],
    ["API using Ruby on Rails","Ruby on Rails"],
    ["API using Laravel","Laravel"],
  ])("refuses to silently replace an explicitly requested unsupported technology: %s",(brief,technology)=>{
    const result=recommend(brief);
    expect(result.selectedStackId).toBeNull();
    expect(result.question).toContain(technology);
    expect(result.alternatives).toEqual([]);
  });
  it.each([
    ["iOS app built with WPF","wpf-dotnet"],
    ["Android app built with SwiftUI","ios-swiftui"],
    ["API-only service built with Electron","electron-typescript"],
  ])("rejects a certified technology when it cannot deliver the requested surface: %s",(brief,stackId)=>{
    const result=recommend(brief);
    expect(result.selectedStackId).toBeNull();
    expect(result.candidates.find(candidate=>candidate.manifest.stackId===stackId)?.eligible).toBe(false);
  });
  it("does not invent a website taxonomy for an ambiguous custom prompt",()=>{const profile=extractProductProfile("build something useful for Acme");expect(profile.projectFamily).toBe("unclassified");expect(recommendStack(profile,webEnv).selectedStackId).toBeNull();});
  it.each([
    ["a local Windows expense tracker in .NET with SQLite","wpf-dotnet"],
    ["a macOS and Windows markdown editor that stores files locally","electron-typescript"],
    ["an Android warehouse scanner using Bluetooth and offline sync","android-kotlin-compose"],
    ["an iPhone field inspection app using the camera","ios-swiftui"],
    ["a cross-platform habit tracking mobile app","flutter-mobile"],
    ["a public webhook API for shipping integrations","node-typescript-api"],
    ["an ETL data pipeline that cleans nightly CSV imports","python-fastapi"],
    ["a customer support RAG assistant over uploaded manuals","nextjs-ai-postgres"],
    ["an internal AI agent that summarizes tickets and drafts replies","nextjs-ai-postgres"],
    ["a small 3D museum exploration game","godot"],
    ["a realistic open-world survival game in 3D","unity"],
    ["a browser-based 2D rhythm game","phaser-typescript"],
    ["a portfolio for a photographer with no accounts or database","static-web-vite"],
    ["a multi-tenant booking portal with accounts, roles and payments","nextjs-typescript-postgres"],
  ])("routes arbitrary free-form projects through the same certified contract: %s",(brief,expected)=>{
    expect(recommend(brief).selectedStackId).toBe(expected);
  });
  it("keeps the desktop starter authoritative over an ambiguous business-tool subtype",()=>{
    const result=recommend("Desktop application. Subtype: Internal business tool");
    expect(result.selectedStackId).toBe("electron-typescript");
    expect(result.selectedStack?.supportedPlatforms).toEqual(expect.arrayContaining(["windows","macos","linux"]));
  });
  it.each([
    [".NET Framework register desktop app","wpf-dotnet"],
    [".NET desktop application for Windows","wpf-dotnet"],
    ["ASP.NET Core Web API","dotnet-web-api"],
    ["Electron React desktop app","electron-typescript"],
    ["Tauri React Rust desktop app","tauri-rust"],
    ["Python FastAPI backend service","python-fastapi"],
    ["Kotlin Jetpack Compose Android app","android-kotlin-compose"],
    ["SwiftUI iPhone app","ios-swiftui"],
  ])("honors the named technology in custom flow: %s",(brief,expected)=>{
    expect(recommend(brief).selectedStackId).toBe(expected);
  });
  it("describes an explicit .NET desktop request as Windows-only",()=>{
    const result=recommend(".NET Framework register desktop app");
    expect(result.reasons.join(" ")).toMatch(/Windows desktop application/i);
    expect(result.reasons.join(" ")).not.toMatch(/cross-platform desktop/i);
  });
  it("tests the exact seed used by every visible starter and subtype",()=>{
    const allowed: Record<Exclude<CertifiedStarterId,"custom">,string[]> = {
      inventory:["nextjs-typescript-postgres"], commerce:["nextjs-typescript-postgres"], pos:["nextjs-typescript-postgres"],
      dashboard:["nextjs-typescript-postgres"], website:["static-web-vite","nextjs-typescript-postgres"],
      mobile:["flutter-mobile","android-kotlin-compose","ios-swiftui"], game:["phaser-typescript","godot","unity"],
      api:["node-typescript-api","python-fastapi","dotnet-web-api"], ai:["nextjs-ai-postgres","python-fastapi"],
      desktop:["electron-typescript","tauri-rust","wpf-dotnet"],
    };
    for(const id of Object.keys(CERTIFIED_STARTER_KINDS) as CertifiedStarterId[]){
      if(id==="custom") continue;
      for(const subtype of CERTIFIED_STARTER_SUBTYPES[id]){
        const result=recommend(certifiedStarterSeed(id,subtype));
        expect(allowed[id],`${id}: ${subtype}`).toContain(result.selectedStackId);
        expect(result.selectedStack?.supportLevel,`${id}: ${subtype}`).toBe(4);
      }
    }
  });
  it.each([
    ["financial dashboard mobile app", "flutter-mobile"],
    ["Android scanner app", "android-kotlin-compose"],
    ["iPhone camera app", "ios-swiftui"],
    ["WPF application", "wpf-dotnet"],
    ["cross-platform desktop app", "electron-typescript"],
    ["advanced 3D training simulation", "unity"],
    ["Survival Exploration 3d Games", "unity"],
    ["small indie 3D puzzle game", "godot"],
    ["2D educational game", "phaser-typescript"],
    ["service-status dashboard", "nextjs-typescript-postgres"],
  ])("keeps subtype-specific platform requirements for %s", (brief, expected) => {
    expect(recommend(brief).selectedStackId).toBe(expected);
  });
  it("publishes honest manifests",()=>{expect(STACK_MANIFESTS.filter(x=>x.supportLevel===4).every(x=>x.status==="certified"&&x.certification.passRate===1)).toBe(true);expect(STACK_MANIFESTS.filter(x=>x.supportLevel<4).every(x=>x.status!=="certified")).toBe(true);});
  it("gives every curated Level 4 stack a complete runtime contract",()=>{expect(assertManifestAdapterCoverage(STACK_MANIFESTS).filter(x=>!x.covered)).toEqual([]);expect(STACK_MANIFESTS.filter(x=>x.supportLevel===4).flatMap(x=>implementationContractStatus(x).missing.map(operation=>`${x.stackId}:${operation}`))).toEqual([]);});
  it("composes and plans a web plus native Android warehouse system",()=>{const profile=extractProductProfile("warehouse inventory web management system with an offline Android barcode scanner app and Bluetooth");const recommendation=recommendStack(profile,webEnv);const architecture=composeProjectArchitecture(profile,recommendation);expect(architecture?.applications.map(app=>app.stackId)).toEqual(expect.arrayContaining(["nextjs-typescript-postgres","android-kotlin-compose"]));expect(buildWorkspaceExecutionPlan(architecture!).applications).toHaveLength(2);});
});
