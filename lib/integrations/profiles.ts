import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IntegrationDefinition } from "@/lib/integrations/types";
const root=path.join(process.cwd(),".foundry-data","integration-profiles");
const safe=(value:string)=>value.replace(/[^a-zA-Z0-9-]/g,"_");
export type ProjectIntegrationProfile={projectId:string;definition:IntegrationDefinition;variableMappings:Record<string,string>;testCommand?:string;createdAt:string;updatedAt:string};
export async function readProfiles(projectId:string):Promise<ProjectIntegrationProfile[]>{try{return JSON.parse(await readFile(path.join(root,`${safe(projectId)}.json`),"utf8")) as ProjectIntegrationProfile[];}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return[];throw error;}}
export async function saveProfile(profile:ProjectIntegrationProfile){const profiles=await readProfiles(profile.projectId);const next=[...profiles.filter(item=>item.definition.id!==profile.definition.id),profile];await mkdir(root,{recursive:true});await writeFile(path.join(root,`${safe(profile.projectId)}.json`),JSON.stringify(next,null,2),"utf8");return profile;}
