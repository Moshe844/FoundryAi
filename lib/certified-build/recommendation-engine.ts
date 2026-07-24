import { environmentReadiness } from "./environment";
import { STACK_MANIFESTS } from "./manifests";
import type { EnvironmentCapabilities, ProductProfile, ScoreBreakdown, StackCandidate, StackManifest, StackRecommendation } from "./types";

const cap = (n: number) => Math.max(0, Math.min(1, n));
function disqualifiers(profile: ProductProfile, stack: StackManifest): string[] {
  const out: string[] = [];
  const p = profile.platforms, c = profile.capabilities, traits = new Set(stack.traits);
  const requested = Object.entries(p).filter(([,enabled])=>enabled).map(([name])=>name);
  if (p.ios && !p.android && !stack.supportedPlatforms.includes("ios")) out.push("The product requires iOS delivery.");
  if (p.android && !p.ios && !stack.supportedPlatforms.includes("android") && !p.web) out.push("The product requires Android delivery.");
  if (p.windows && !p.web && !stack.supportedPlatforms.includes("windows")) out.push("The product requires a Windows application.");
  if (p.game && !stack.supportedPlatforms.includes("game")) out.push("A game requires a real game runtime.");
  if (p.cli && !stack.supportedPlatforms.includes("cli")) out.push("A CLI cannot be delivered as a browser application.");
  if (p.web && (p.android || p.ios) && !stack.supportedPlatforms.includes("web")) out.push("A multi-application product uses the certified web platform as its primary system and adds native companion applications separately.");
  if (p.api && !p.web && stack.supportedPlatforms.includes("web")) out.push("An API-only project must not receive a browser application as its primary artifact.");
  if (c.threeDimensional && !traits.has("advanced-3d") && !traits.has("3d")) out.push("Advanced 3D requirements are unsupported by this stack.");
  if ((c.bluetooth || c.nfc || c.barcodeScanning) && p.android && !p.web && !stack.supportedPlatforms.includes("android")) out.push("Deep Android hardware access requires a native-capable Android stack.");
  if ((c.authentication || c.multiUser || c.relationalData || c.payments) && traits.has("no-server")) out.push("Server-backed multi-user or sensitive workflows cannot use a static-only stack.");
  const simpleContentSite = profile.projectFamily === "websites-content"
    && !c.authentication && !c.multiUser && !c.relationalData && !c.payments && !c.realTime && !c.fileUploads && !c.backgroundJobs;
  if (simpleContentSite && !traits.has("no-server") && !traits.has("content-first")) out.push("A content-only website must use the smallest certified static delivery stack; an application server and database would be unnecessary architecture.");
  if (!requested.length) out.push("No target platform is established.");
  if (stack.supportLevel < 4) out.push("This stack has not reached Full Foundry Support.");
  return out;
}

function score(profile: ProductProfile, stack: StackManifest, env: EnvironmentCapabilities): ScoreBreakdown {
  const c=profile.capabilities,t=new Set(stack.traits), requested=Object.entries(profile.platforms).filter(([,v])=>v).map(([k])=>k);
  const platformFit=cap(requested.filter((p)=>stack.supportedPlatforms.includes(p as never)).length/Math.max(1,requested.length));
  const hardwareFit=cap((c.bluetooth||c.nfc||c.barcodeScanning)?(t.has("hardware")||t.has("native-android")?1:0.15):0.85);
  const dataFit=cap(c.relationalData?(t.has("relational")?1:stack.supportedDatabases.length?0.7:0.2):0.85);
  const featureFit=cap(([c.authentication&&"auth",c.payments&&"payments",c.reporting&&"reporting",c.realTime&&"realtime"].filter(Boolean) as string[]).reduce((s,x)=>s+(t.has(x)?1:0.45),0)/Math.max(1,[c.authentication,c.payments,c.reporting,c.realTime].filter(Boolean).length));
  const environmentReadinessScore=environmentReadiness(stack,env).score;
  const simpleWeb=profile.platforms.web&&!profile.platforms.api&&!c.authentication&&!c.multiUser&&!c.relationalData&&!c.payments&&!c.fileUploads;
  const architecturalFit=simpleWeb?(t.has("no-server")?1:t.has("content-first")?0.9:0.45):cap((platformFit+dataFit+hardwareFit)/3);
  const scores={architecturalFit,platformFit,featureFit,hardwareFit,offlineFit:c.offlineMode?(t.has("offline")||t.has("local-first")?1:0.35):0.85,dataFit,securityFit:profile.securityRisk==="high"?(t.has("payments")||t.has("enterprise")?1:0.5):0.85,deploymentFit:0.8,foundrySupport:stack.supportLevel/4,environmentReadiness:environmentReadinessScore,maintainability:0.85,futureGrowth:simpleWeb?(t.has("no-server")?0.95:0.55):(t.has("full-stack")||t.has("enterprise")?0.95:0.75),userPreferenceFit:profile.userPreferences.some((x)=>stack.displayName.toLowerCase().includes(x.toLowerCase()))?1:0.65,totalScore:0};
  scores.totalScore=Object.entries(scores).filter(([k])=>k!=="totalScore").reduce((s,[,v])=>s+v,0)/13;
  return scores;
}

export function recommendStack(profile: ProductProfile, environment: EnvironmentCapabilities): StackRecommendation {
  const candidates: StackCandidate[]=STACK_MANIFESTS.map((manifest)=>{const ds=disqualifiers(profile,manifest);return{manifest,eligible:ds.length===0,disqualifiers:ds,scores:score(profile,manifest,environment)}}).sort((a,b)=>b.scores.totalScore-a.scores.totalScore);
  const selected=candidates.find((item)=>item.eligible)??null;
  if (!selected) {
    const requiredPlatforms=Object.entries(profile.platforms).filter(([,enabled])=>enabled).map(([name])=>name);
    const ideal=candidates.find((item)=>requiredPlatforms.every((platform)=>item.manifest.supportedPlatforms.includes(platform as never)))??candidates[0];
    return {selectedStackId:null,selectedStack:null,alternatives:candidates.slice(0,3).map(toAlternative),reasons:[],requirementsMatched:[],tradeoffs:ideal?[`The closest architecture is ${ideal.manifest.displayName}, but it is not eligible for automatic delivery.`]:[],limitations:ideal?.disqualifiers??[],environmentRequirements:ideal?environmentReadiness(ideal.manifest,environment).missing:[],confidence:profile.confidence*.5,candidates,question:profile.ambiguities.length?"What kind of product is this, and where must people use it?":"The ideal architecture is not yet a fully certified, environment-ready Foundry stack. Review the limitations or choose a managed build environment."};
  }
  const readiness=environmentReadiness(selected.manifest,environment);
  return {selectedStackId:selected.manifest.stackId,selectedStack:selected.manifest,alternatives:candidates.filter((x)=>x.manifest.stackId!==selected.manifest.stackId).slice(0,2).map(toAlternative),reasons:[`${selected.manifest.displayName} matches the required ${Object.entries(profile.platforms).filter(([,v])=>v).map(([k])=>k).join(", ")} delivery surfaces.`,`It is a Level 4 certified stack with manifest-defined build and verification behavior.`],requirementsMatched:Object.entries(profile.capabilities).filter(([,v])=>v).map(([k])=>k),tradeoffs:selected.manifest.knownLimitations,limitations:selected.manifest.knownLimitations,environmentRequirements:readiness.missing,confidence:cap((profile.confidence+selected.scores.totalScore)/2),candidates};
}
function toAlternative(item: StackCandidate){return{stackId:item.manifest.stackId,displayName:item.manifest.displayName,score:item.scores.totalScore,limitations:[...item.disqualifiers,...item.manifest.knownLimitations]};}

export function validateStackOverride(profile: ProductProfile, environment: EnvironmentCapabilities, stackId: string) {
  const recommendation=recommendStack(profile,environment); const candidate=recommendation.candidates.find((item)=>item.manifest.stackId===stackId);
  return candidate?{allowed:candidate.disqualifiers.filter((x)=>!x.includes("Full Foundry Support")).length===0,informedOverrideRequired:!candidate.eligible,reasons:candidate.disqualifiers,manifest:candidate.manifest}:{allowed:false,informedOverrideRequired:true,reasons:["Unknown stack: no capability manifest exists."],manifest:null};
}
