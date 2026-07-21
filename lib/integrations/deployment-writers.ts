import "server-only";

export type HostingTarget={provider:"vercel";projectId:string;teamId?:string}|{provider:"netlify";accountId:string;siteId?:string};
export async function writeHostingSecret(target:HostingTarget,credential:Record<string,string>,name:string,value:string){
 if(target.provider==="vercel"){
  const token=credential.token;if(!token)throw new Error("Verified Vercel deployment credentials are required.");
  const query=target.teamId?`?teamId=${encodeURIComponent(target.teamId)}`:"";
  const response=await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(target.projectId)}/env${query}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({key:name,value,type:"encrypted",target:["production","preview","development"]})});
  if(!response.ok)throw new Error(`Vercel rejected secret injection (HTTP ${response.status}).`);return;
 }
 const token=credential.token;if(!token)throw new Error("Verified Netlify deployment credentials are required.");
 const response=await fetch(`https://api.netlify.com/api/v1/accounts/${encodeURIComponent(target.accountId)}/env/${encodeURIComponent(name)}`,{method:"PUT",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({scopes:["builds","functions","runtime"],values:[{context:"all",value}],...(target.siteId?{site_id:target.siteId}:{})})});
 if(!response.ok)throw new Error(`Netlify rejected secret injection (HTTP ${response.status}).`);
}
