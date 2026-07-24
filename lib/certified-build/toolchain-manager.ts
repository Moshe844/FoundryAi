import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runtimeAdapterFor } from "./platform-adapters";
import type { ExecutionReadinessState, StackEnvironmentStatus, StackOperations } from "./types";

type MachineMemory={version:1;toolchains:Record<string,{path?:string;version?:string;validatedAt:string}>};
const memoryPath=path.join(process.cwd(),".foundry-data","toolchains-v1.json");
const executableNames:Record<string,string[]>={node:["node"],npm:["npm.cmd","npm"],python:["python","python3"],dotnet:["dotnet"],java:["java"],android:["adb"],flutter:["flutter"],rust:["cargo","rustc"],godot:["godot"],unity:["Unity.exe","Unity"],xcode:["xcodebuild"],swift:["swift"]};
const installable=new Set(["node","python","dotnet","java","android","flutter","rust","godot"]);

function findExecutable(names:string[]){for(const name of names){const result=spawnSync(process.platform==="win32"?"where.exe":"which",[name],{encoding:"utf8",windowsHide:true});if(result.status===0){const first=result.stdout.split(/\r?\n/).find(Boolean)?.trim();if(first)return first;}}}
function readMemory():MachineMemory{try{return JSON.parse(readFileSync(memoryPath,"utf8")) as MachineMemory;}catch{return{version:1,toolchains:{}};}}
function remember(found:Record<string,string>){const memory=readMemory();const validatedAt=new Date().toISOString();for(const [id,executable] of Object.entries(found))memory.toolchains[id]={path:executable,validatedAt};mkdirSync(path.dirname(memoryPath),{recursive:true});writeFileSync(memoryPath,JSON.stringify(memory,null,2),"utf8");}
function remoteMac(){return Boolean(process.env.FOUNDRY_REMOTE_MAC_URL&&process.env.FOUNDRY_REMOTE_MAC_TOKEN);}
const allOperations:Array<keyof StackOperations>=["create","inspect","edit","install","run","build","test","lint","debug","preview","package","export","deploy"];

export function inspectCertifiedStackEnvironment(stackId:string):StackEnvironmentStatus{
  const adapter=runtimeAdapterFor(stackId);
  if(!adapter)return{stackId,state:"unavailable",readyOperations:[],deferredOperations:allOperations,missingToolchains:[],plainLanguage:"Foundry does not have a certified runtime adapter for this stack.",actions:["show_remaining_steps"]};
  const found:Record<string,string>={};const missing:string[]=[];
  for(const id of adapter.toolchains){const executable=findExecutable(executableNames[id]??[id]);if(executable)found[id]=executable;else missing.push(id);}
  remember(found);
  const macRequired=adapter.commands.some((command)=>command.remotePlatform==="macos")&&process.platform!=="darwin";
  const licensed=missing.includes("unity");
  let state:ExecutionReadinessState="ready_local";
  if(licensed)state="requires_user_license";else if(macRequired&&!remoteMac())state="requires_remote_builder";else if(missing.length&&missing.every((item)=>installable.has(item)))state="installable_by_foundry";else if(missing.length)state="export_ready";
  const deferred=new Set<keyof StackOperations>();
  if(state!=="ready_local")for(const command of adapter.commands){if((macRequired&&command.remotePlatform==="macos")||missing.length)deferred.add(command.operation as keyof StackOperations);}
  const actions:StackEnvironmentStatus["actions"]=[];
  if(state==="installable_by_foundry")actions.push("install_for_me");
  if(state==="requires_remote_builder")actions.push("connect_mac","use_cloud_build");
  if(state==="requires_user_license")actions.push("open_license_setup");
  if(state!=="ready_local")actions.push("export_project","show_remaining_steps");
  const plainLanguage=state==="ready_local"?"Everything needed for this stack is ready on this computer.":state==="installable_by_foundry"?"Foundry can install and configure the missing tools for you.":state==="requires_remote_builder"?"The project can be created here. Final Apple build and device checks need a connected Mac or Foundry cloud build.":state==="requires_user_license"?"Foundry can prepare the project, but this tool requires you to complete its license sign-in before builds can run.":state==="export_ready"?"Foundry can create and validate the project here, then export it with exact completion steps.":"This stack is unavailable in the current configuration.";
  return{stackId,state,readyOperations:allOperations.filter((operation)=>!deferred.has(operation)),deferredOperations:[...deferred],missingToolchains:missing,plainLanguage,actions,remoteBuilder:macRequired?{platform:"macos",connected:remoteMac(),label:remoteMac()?"Connected Mac builder":"Mac builder not connected"}:undefined};
}

export function toolchainManagerMemory(){return readMemory();}
