import { integrationCatalog } from "@/lib/integrations/catalog";
import type { IntegrationCertificationCheck, IntegrationDefinition, IntegrationPack } from "@/lib/integrations/types";

const requiredChecks:IntegrationCertificationCheck[]=["credential","connection","failure","recovery","security","functional"];
export function isCertified(definition:IntegrationDefinition){return Boolean(definition.certification?.certifiedAt&&requiredChecks.every(check=>definition.certification?.checks[check]?.passedAt));}
export function certificationProgress(definition:IntegrationDefinition){const passed=requiredChecks.filter(check=>definition.certification?.checks[check]?.passedAt);return {passed,total:requiredChecks.length,missing:requiredChecks.filter(check=>!passed.includes(check)),certified:isCertified(definition)};}
export class IntegrationRegistry{
 private packs=new Map<string,IntegrationPack>();
 constructor(definitions:IntegrationDefinition[]=integrationCatalog){const grouped=new Map<string,IntegrationDefinition[]>();for(const item of definitions)grouped.set(item.pack,[...(grouped.get(item.pack)||[]),item]);for(const [id,integrations]of grouped)this.registerPack({id,name:`${id.replace(/-/g," ")} pack`,version:"1.0.0",enabled:true,source:id==="core"?"core":"bundled",integrations});}
 registerPack(pack:IntegrationPack){if(!/^[a-z0-9-]+$/.test(pack.id))throw new Error("Integration pack id is invalid.");this.packs.set(pack.id,pack);}
 setPackEnabled(id:string,enabled:boolean){const pack=this.packs.get(id);if(!pack)throw new Error("Integration pack was not found.");this.packs.set(id,{...pack,enabled});}
 definitions(){return [...this.packs.values()].filter(pack=>pack.enabled).flatMap(pack=>pack.integrations);}
 definition(id:string){return this.definitions().find(item=>item.id===id);}
 listPacks(){return [...this.packs.values()].map(pack=>({...pack,integrationCount:pack.integrations.length,integrations:[]}));}
}
export const integrationRegistry=new IntegrationRegistry();
