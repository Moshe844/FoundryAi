import "server-only";
import { integrationById } from "@/lib/integrations/catalog";
import { verifiedCredentialsForProject } from "@/lib/integrations/secret-store";

/** Builds a server-only child-process environment from verified credentials in one exact scope. */
export async function projectIntegrationEnvironment(input:{projectId:string;environment:"development"|"production";userId?:string;workspaceId?:string;location?:"local"|"cloud"}) {
  const records=await verifiedCredentialsForProject({userId:input.userId||"local-user",workspaceId:input.workspaceId,projectId:input.projectId,environment:input.environment,location:input.location||"local"});
  const environment:Record<string,string>={};
  const providers:string[]=[];
  for(const record of records){const definition=integrationById(record.scope.provider);if(!definition)continue;for(const field of definition.fields){const value=record.values[field.key];const variable=definition.deploymentMappings[field.env[0]]||field.env[0];if(value&&variable)environment[variable]=value;}providers.push(definition.id);}
  return {environment,providers};
}
