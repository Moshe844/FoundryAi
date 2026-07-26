import { environmentReadiness } from "./environment";
import { STACK_MANIFESTS } from "./manifests";
import type { EnvironmentCapabilities, ProductProfile, ScoreBreakdown, StackCandidate, StackManifest, StackRecommendation } from "./types";

const cap = (n: number) => Math.max(0, Math.min(1, n));

const FAMILY_STACK_AFFINITY: Record<string, Record<string, number>> = {
  "websites-content": { "static-web-vite": 1, "react-vite-typescript": .55, "nextjs-typescript-postgres": .35 },
  "web-applications-saas": { "nextjs-typescript-postgres": 1, "react-vite-typescript": .65 },
  "commerce-payments": { "nextjs-typescript-postgres": 1 },
  "inventory-logistics": { "nextjs-typescript-postgres": 1, "android-kotlin-compose": .8, "flutter-mobile": .65 },
  "mobile-applications": { "flutter-mobile": 1, "android-kotlin-compose": .9, "ios-swiftui": .9 },
  "desktop-applications": { "electron-typescript": 1, "tauri-rust": .92, "wpf-dotnet": .88 },
  "backend-services": { "node-typescript-api": 1, "python-fastapi": .82, "dotnet-web-api": .8 },
  "data-ai": { "python-fastapi": 1, "nextjs-typescript-postgres": .82, "react-vite-typescript": .45 },
  "games-interactive": { "phaser-typescript": 1, godot: .88, unity: .72 },
  "developer-tools": { "node-typescript-api": .8, "tauri-rust": .65 },
  "infrastructure-operations": { "python-fastapi": .78, "node-typescript-api": .75, "dotnet-web-api": .7 },
};

function familyAffinity(profile: ProductProfile, stack: StackManifest) {
  if (profile.projectFamily === "mobile-applications") {
    if (profile.platforms.ios && !profile.platforms.android) return stack.stackId === "ios-swiftui" ? 1 : stack.supportedPlatforms.includes("ios") ? .65 : .2;
    if (profile.platforms.android && !profile.platforms.ios) return stack.stackId === "android-kotlin-compose" ? 1 : stack.supportedPlatforms.includes("android") ? .65 : .2;
  }
  return FAMILY_STACK_AFFINITY[profile.projectFamily]?.[stack.stackId] ?? .2;
}

function explicitStackMatches(profile: ProductProfile, stack: StackManifest) {
  if (profile.technologyConstraint?.kind === "unsupported") return false;
  if (profile.technologyConstraint?.kind === "certified") return stack.stackId === profile.technologyConstraint.stackId;
  if (!profile.userPreferences.length) return true;
  const target = profile.userPreferences.join(" ").toLowerCase();
  const corpus = [stack.stackId, stack.displayName, ...stack.traits].join(" ").toLowerCase();
  const aliases: Record<string, RegExp> = {
    "static-web-vite": /\b(?:html|vanilla javascript|static)\b/,
    "react-vite-typescript": /\b(?:react|vite)\b/,
    "nextjs-typescript-postgres": /\b(?:next(?:\.js)?|postgres|prisma)\b/,
    "node-typescript-api": /\b(?:node(?:\.js)?|express)\b/,
    "python-fastapi": /\b(?:python|fastapi)\b/,
    "dotnet-web-api": /\b(?:\.net|asp\.net|c#)\b/,
    "android-kotlin-compose": /\b(?:android|kotlin|compose)\b/,
    "ios-swiftui": /\b(?:ios|swift|swiftui)\b/,
    "flutter-mobile": /\bflutter\b/,
    "wpf-dotnet": /\b(?:wpf|\.net)\b/,
    "electron-typescript": /\belectron\b/,
    "tauri-rust": /\b(?:tauri|rust)\b/,
    "phaser-typescript": /\bphaser\b/,
    godot: /\bgodot\b/,
    unity: /\bunity\b/,
  };
  return corpus.includes(target) || Boolean(aliases[stack.stackId]?.test(target));
}

function disqualifiers(profile: ProductProfile, stack: StackManifest): string[] {
  const out: string[] = [];
  const p = profile.platforms, c = profile.capabilities, traits = new Set(stack.traits);
  const requested = Object.entries(p).filter(([,enabled])=>enabled).map(([name])=>name);
  const missingPrimarySurfaces = requested.filter((platform) => {
    // Web + native products are composed as multiple certified applications. The web stack is the
    // primary system and native companions are added by the architecture composer.
    if ((platform === "android" || platform === "ios") && p.web) return false;
    return !stack.supportedPlatforms.includes(platform as never);
  });
  if (missingPrimarySurfaces.length) out.push(`The stack does not deliver the required ${missingPrimarySurfaces.join(", ")} surface${missingPrimarySurfaces.length === 1 ? "" : "s"}.`);
  if (p.ios && !p.android && !stack.supportedPlatforms.includes("ios")) out.push("The product requires iOS delivery.");
  if (p.android && !p.ios && !stack.supportedPlatforms.includes("android") && !p.web) out.push("The product requires Android delivery.");
  if (p.windows && !p.web && !stack.supportedPlatforms.includes("windows")) out.push("The product requires a Windows application.");
  if (p.game && !stack.supportedPlatforms.includes("game")) out.push("A game requires a real game runtime.");
  if (p.cli && !stack.supportedPlatforms.includes("cli")) out.push("A CLI cannot be delivered as a browser application.");
  if (p.web && (p.android || p.ios) && !stack.supportedPlatforms.includes("web")) out.push("A multi-application product uses the certified web platform as its primary system and adds native companion applications separately.");
  if (p.api && !p.web && stack.supportedPlatforms.includes("web")) out.push("An API-only project must not receive a browser application as its primary artifact.");
  const explicitlyAdvanced3d = profile.sourceEvidence.some((evidence) =>
    /\badvanced\s+3d\b|\bvirtual showroom\b|\badvanced simulation\b|\b(?:3d\b[^.\n]{0,80}\b(?:survival|open[- ]world|large[- ]world|photorealistic|realistic exploration|multiplayer)|(?:survival|open[- ]world|large[- ]world|photorealistic|realistic exploration|multiplayer)\b[^.\n]{0,80}\b3d)\b/i.test(evidence)
  );
  if (explicitlyAdvanced3d && !traits.has("advanced-3d")) out.push("Advanced 3D requirements need the certified advanced-3D runtime.");
  else if (c.threeDimensional && !traits.has("advanced-3d") && !traits.has("3d")) out.push("3D requirements are unsupported by this stack.");
  if ((c.bluetooth || c.nfc || c.barcodeScanning) && p.android && !p.web && !stack.supportedPlatforms.includes("android")) out.push("Deep Android hardware access requires a native-capable Android stack.");
  if ((c.authentication || c.multiUser || c.relationalData || c.payments) && traits.has("no-server")) out.push("Server-backed multi-user or sensitive workflows cannot use a static-only stack.");
  const simpleContentSite = profile.projectFamily === "websites-content"
    && !c.authentication && !c.multiUser && !c.relationalData && !c.payments && !c.realTime && !c.fileUploads && !c.backgroundJobs;
  if (simpleContentSite && !traits.has("no-server") && !traits.has("content-first")) out.push("A content-only website must use the smallest certified static delivery stack; an application server and database would be unnecessary architecture.");
  if (!requested.length) out.push("No target platform is established.");
  if (!explicitStackMatches(profile, stack)) out.push("The stack conflicts with the technology explicitly requested by the user.");
  if (stack.supportLevel < 4) out.push("This stack has not reached Full Foundry Support.");
  return out;
}

function score(profile: ProductProfile, stack: StackManifest, env: EnvironmentCapabilities): ScoreBreakdown {
  const p=profile.platforms,c=profile.capabilities,t=new Set(stack.traits), requested=Object.entries(p).filter(([,v])=>v).map(([k])=>k);
  const platformFit=cap(requested.filter((p)=>stack.supportedPlatforms.includes(p as never)).length/Math.max(1,requested.length));
  const hardwareFit=cap((c.bluetooth||c.nfc||c.barcodeScanning)?(t.has("hardware")||t.has("native-android")?1:0.15):0.85);
  const dataFit=cap(c.relationalData?(t.has("relational")?1:stack.supportedDatabases.length?0.7:0.2):0.85);
  const featureFit=cap(([c.authentication&&"auth",c.payments&&"payments",c.reporting&&"reporting",c.realTime&&"realtime"].filter(Boolean) as string[]).reduce((s,x)=>s+(t.has(x)?1:0.45),0)/Math.max(1,[c.authentication,c.payments,c.reporting,c.realTime].filter(Boolean).length));
  const environmentReadinessScore=environmentReadiness(stack,env).score;
  const simpleWeb=profile.platforms.web&&!profile.platforms.api&&!c.authentication&&!c.multiUser&&!c.relationalData&&!c.payments&&!c.fileUploads;
  const familyFit = familyAffinity(profile, stack);
  const architecturalFit=simpleWeb?(t.has("no-server")?1:t.has("content-first")?0.9:0.35):cap((platformFit+dataFit+hardwareFit+familyFit*2)/5);
  const scores={architecturalFit,platformFit,featureFit:cap((featureFit+familyFit)/2),hardwareFit,offlineFit:c.offlineMode?(t.has("offline")||t.has("local-first")?1:0.35):0.85,dataFit,securityFit:profile.securityRisk==="high"?(t.has("payments")||t.has("enterprise")?1:0.5):0.85,deploymentFit:0.8,foundrySupport:stack.supportLevel/4,environmentReadiness:environmentReadinessScore,maintainability:0.85,futureGrowth:simpleWeb?(t.has("no-server")?0.95:0.55):(t.has("full-stack")||t.has("enterprise")?0.95:0.75),userPreferenceFit:explicitStackMatches(profile,stack)?1:0,totalScore:0};
  scores.totalScore=Object.entries(scores).filter(([k])=>k!=="totalScore").reduce((s,[,v])=>s+v,0)/13;
  // Local tool availability must not make a cross-platform abstraction outrank the native stack for
  // a product explicitly targeting just one mobile OS. Readiness is reported separately and can be
  // resolved by Foundry's toolchain/remote-builder workflow; it is not an architecture requirement.
  if (p.ios && !p.android) scores.totalScore += stack.stackId === "ios-swiftui" ? .12 : stack.supportedPlatforms.includes("android") ? -.04 : 0;
  if (p.android && !p.ios) scores.totalScore += stack.stackId === "android-kotlin-compose" ? .12 : stack.supportedPlatforms.includes("ios") ? -.04 : 0;
  return scores;
}

export function recommendStack(profile: ProductProfile, environment: EnvironmentCapabilities): StackRecommendation {
  const candidates: StackCandidate[]=STACK_MANIFESTS.map((manifest)=>{const ds=disqualifiers(profile,manifest);return{manifest,eligible:ds.length===0,disqualifiers:ds,scores:score(profile,manifest,environment)}}).sort((a,b)=>b.scores.totalScore-a.scores.totalScore);
  const selected=candidates.find((item)=>item.eligible)??null;
  if (!selected) {
    const requiredPlatforms=Object.entries(profile.platforms).filter(([,enabled])=>enabled).map(([name])=>name);
    const ideal=candidates.find((item)=>requiredPlatforms.every((platform)=>item.manifest.supportedPlatforms.includes(platform as never)))??candidates[0];
    const unsupported = profile.technologyConstraint?.kind === "unsupported" ? profile.technologyConstraint.technology : null;
    return {selectedStackId:null,selectedStack:null,alternatives:candidates.filter((item)=>item.eligible).slice(0,3).map(toAlternative),reasons:[],requirementsMatched:[],tradeoffs:ideal?[`The closest architecture is ${ideal.manifest.displayName}, but it is not eligible for automatic delivery.`]:[],limitations:unsupported?[`${unsupported} was explicitly requested, but Foundry does not yet have a fully certified end-to-end implementation contract for it.`]:ideal?.disqualifiers??[],environmentRequirements:ideal?environmentReadiness(ideal.manifest,environment).missing:[],confidence:profile.confidence*.5,candidates,question:unsupported?`Foundry cannot honestly substitute another stack for ${unsupported}. Choose a certified technology or continue only after that implementation contract is added.`:profile.ambiguities.length?"What kind of product is this, and where must people use it?":"The requested product and technology combination is not a fully certified Foundry stack. Review the limitation instead of accepting a substitute."};
  }
  const readiness=environmentReadiness(selected.manifest,environment);
  return {selectedStackId:selected.manifest.stackId,selectedStack:selected.manifest,alternatives:candidates.filter((x)=>x.eligible&&x.manifest.stackId!==selected.manifest.stackId).slice(0,2).map(toAlternative),reasons:[`${selected.manifest.displayName} is the strongest certified fit for this ${profile.projectSubtype}.`,`${selected.manifest.displayName} matches the required ${Object.entries(profile.platforms).filter(([,v])=>v).map(([k])=>k).join(", ")} delivery surfaces and the product's ${profile.projectFamily} architecture.`,`It is a Level 4 certified stack with manifest-defined creation, build, test, packaging, and recovery behavior.`],requirementsMatched:Object.entries(profile.capabilities).filter(([,v])=>v).map(([k])=>k),tradeoffs:selected.manifest.knownLimitations,limitations:selected.manifest.knownLimitations,environmentRequirements:readiness.missing,confidence:cap((profile.confidence+selected.scores.totalScore)/2),candidates};
}
function toAlternative(item: StackCandidate){return{stackId:item.manifest.stackId,displayName:item.manifest.displayName,score:item.scores.totalScore,limitations:[...item.disqualifiers,...item.manifest.knownLimitations]};}

export function validateStackOverride(profile: ProductProfile, environment: EnvironmentCapabilities, stackId: string) {
  const recommendation=recommendStack(profile,environment); const candidate=recommendation.candidates.find((item)=>item.manifest.stackId===stackId);
  return candidate?{allowed:candidate.disqualifiers.filter((x)=>!x.includes("Full Foundry Support")).length===0,informedOverrideRequired:!candidate.eligible,reasons:candidate.disqualifiers,manifest:candidate.manifest}:{allowed:false,informedOverrideRequired:true,reasons:["Unknown stack: no capability manifest exists."],manifest:null};
}
