import { runtimeAdapterFor } from "./platform-adapters";
import type { ProjectArchitecture } from "./architecture";

export type WorkspaceExecutionPlan={version:1;applications:Array<{id:string;role:string;stackId:string;workingDirectory:string;operations:Array<{operation:string;command:string;remotePlatform?:string}>;artifacts:string[]}>;sharedServices:string[];verificationOrder:string[]};
export function buildWorkspaceExecutionPlan(architecture:ProjectArchitecture):WorkspaceExecutionPlan{
  const applications=architecture.applications.map((application)=>{const adapter=runtimeAdapterFor(application.stackId);if(!adapter)throw new Error(`No certified runtime adapter exists for ${application.stackId}.`);return{id:application.id,role:application.role,stackId:application.stackId,workingDirectory:architecture.applications.length===1?".":`apps/${application.id}`,operations:adapter.commands.map(({operation,command,remotePlatform})=>({operation,command,...(remotePlatform?{remotePlatform}:{})})),artifacts:adapter.artifacts};});
  return{version:1,applications,sharedServices:architecture.sharedServices,verificationOrder:[...applications.map((app)=>`${app.id}:build`),...applications.map((app)=>`${app.id}:test`),...applications.map((app)=>`${app.id}:preview`)]};
}
