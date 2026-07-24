import { STACK_MANIFESTS } from "./manifests";
import type { StackManifest } from "./types";
import { runtimeAdapterFor } from "./platform-adapters";

export const CERTIFICATION_SCENARIOS = ["create","install","run","build","test","lint","debug","edit","follow-up","stop","approval","missing-dependency","preview","recovery","package","functionality","reconnect","undo","model-routing","context-compaction"] as const;
export type CertificationScenario = (typeof CERTIFICATION_SCENARIOS)[number];
export type CertificationEvidence = { stackId:string; manifestVersion:number; suiteVersion:string; environment:string[]; results:Record<CertificationScenario,boolean>; passedAt:string };

export function certificationStatus(manifest: StackManifest, evidence?: CertificationEvidence) {
  const complete=Boolean(evidence&&evidence.stackId===manifest.stackId&&evidence.manifestVersion===manifest.version&&CERTIFICATION_SCENARIOS.every((scenario)=>evidence.results[scenario]));
  return { certified:manifest.supportLevel===4&&complete, stale:Boolean(evidence&&evidence.manifestVersion!==manifest.version), missing:CERTIFICATION_SCENARIOS.filter((scenario)=>!evidence?.results[scenario]) };
}
export function certifiedStackCatalog(){return STACK_MANIFESTS.filter((manifest)=>manifest.supportLevel===4);}

export function implementationContractStatus(manifest:StackManifest){
  const adapter=runtimeAdapterFor(manifest.stackId);if(!adapter)return{complete:false,missing:["runtime adapter"]};
  const operations=new Set(adapter.commands.map((command)=>command.operation));
  const required=["create","run","build","test","preview","package","export"] as const;
  // Creation and preview may be implemented by the scaffold/artifact contract rather than a shell command.
  const missing=required.filter((operation)=>operation==="create"?!adapter.scaffoldKind:operation==="preview"?!adapter.artifacts.some((artifact)=>/preview|playground|emulator|simulator/.test(artifact)):operation==="export"?!operations.has("export"):operation==="test"?!operations.has("test"):operation==="package"?!operations.has("package"):operation==="run"?!operations.has("run"):!operations.has("build"));
  return{complete:missing.length===0,missing};
}
