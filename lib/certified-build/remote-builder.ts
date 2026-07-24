import { runtimeAdapterFor } from "./platform-adapters";

export type RemoteBuildTarget="connected-mac"|"foundry-cloud-macos";
export type RemoteBuildRequest={stackId:string;projectArchiveBase64:string;operation:"build"|"test"|"run-simulator"|"archive"|"export";target:RemoteBuildTarget};
export type RemoteBuilderStatus={target:RemoteBuildTarget;connected:boolean;label:string;capabilities:string[];setupAction?:"connect_mac"|"use_cloud_build"};

function config(target:RemoteBuildTarget){
  if(target==="connected-mac")return{url:process.env.FOUNDRY_REMOTE_MAC_URL,token:process.env.FOUNDRY_REMOTE_MAC_TOKEN,label:"Connected Mac"};
  return{url:process.env.FOUNDRY_CLOUD_MACOS_URL,token:process.env.FOUNDRY_CLOUD_MACOS_TOKEN,label:"Foundry cloud build"};
}
export function remoteBuilderStatus(target:RemoteBuildTarget):RemoteBuilderStatus{const value=config(target);return{target,connected:Boolean(value.url&&value.token),label:value.label,capabilities:["xcode-build","simulator-test","signing-guidance","archive","ipa-export"],setupAction:target==="connected-mac"?"connect_mac":"use_cloud_build"};}
export async function runRemoteBuild(request:RemoteBuildRequest){
  const adapter=runtimeAdapterFor(request.stackId);if(!adapter)throw new Error("This stack has no certified runtime adapter.");
  const command=adapter.commands.find((item)=>item.remotePlatform==="macos"&&item.operation===(request.operation==="run-simulator"?"run":request.operation==="archive"?"package":request.operation));
  if(!command)throw new Error(`The certified adapter does not define remote ${request.operation}.`);
  const value=config(request.target);if(!value.url||!value.token)return{ok:false,state:"requires_remote_builder" as const,status:remoteBuilderStatus(request.target),plainLanguage:request.target==="connected-mac"?"Connect a Mac to continue the final Apple build.":"Turn on Foundry cloud build to continue the final Apple build.",actions:[request.target==="connected-mac"?"connect_mac":"use_cloud_build","export_project","show_remaining_steps"]};
  const response=await fetch(`${value.url.replace(/\/$/,"")}/v1/builds`,{method:"POST",headers:{authorization:`Bearer ${value.token}`,"content-type":"application/json"},body:JSON.stringify({...request,command:command.command})});
  const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(typeof payload?.error==="string"?payload.error:`Remote builder returned ${response.status}.`);
  return{ok:true,state:"ready_local" as const,remote:true,result:payload};
}
