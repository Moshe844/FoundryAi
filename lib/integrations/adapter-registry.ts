import "server-only";
import { integrationById } from "@/lib/integrations/catalog";
import { verifyCredential, type VerificationResult } from "@/lib/integrations/adapters";
import type { AuthenticationMethod, IntegrationDefinition } from "@/lib/integrations/types";
import { executableProviderIds, verifyProviderAdapter } from "@/lib/integrations/provider-adapters";
export type IntegrationAdapter={id:string;authenticationStrategies:AuthenticationMethod[];test(values:Record<string,string>):Promise<VerificationResult>;healthCheck(values:Record<string,string>):Promise<VerificationResult>;};
export class AdapterRegistry{private adapters=new Map<string,IntegrationAdapter>();register(adapter:IntegrationAdapter){if(this.adapters.has(adapter.id))throw new Error(`Adapter ${adapter.id} is already registered.`);this.adapters.set(adapter.id,adapter);}get(id:string){return this.adapters.get(id);}has(id:string){return this.adapters.has(id);}list(){return[...this.adapters.keys()];}}
const builtinAdapterIds=["gmail","outlook","smtp","postgresql","mysql","mongodb","redis","supabase","firebase","stripe","twilio","sendgrid","resend","openai","anthropic","gemini","github","slack"];
export const adapterRegistry=new AdapterRegistry();
for(const id of builtinAdapterIds){const definition=integrationById(id) as IntegrationDefinition;adapterRegistry.register({id,authenticationStrategies:definition.authenticationMethods,test:values=>verifyCredential(definition,values),healthCheck:values=>verifyCredential(definition,values)});}
for(const id of executableProviderIds){const definition=integrationById(id) as IntegrationDefinition;adapterRegistry.register({id,authenticationStrategies:definition.authenticationMethods,test:values=>verifyProviderAdapter(id,values),healthCheck:values=>verifyProviderAdapter(id,values)});}
