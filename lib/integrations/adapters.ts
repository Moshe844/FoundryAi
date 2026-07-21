import "server-only";
import type { IntegrationDefinition } from "@/lib/integrations/types";

export type VerificationResult={ok:boolean;status:"configured"|"expired"|"revoked"|"failed";message:string};
async function http(url:string,init:RequestInit={},expected=[200]) { const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000); try { const response=await fetch(url,{...init,signal:controller.signal,cache:"no-store"}); const body=await response.text(); return {response,body,ok:expected.includes(response.status)}; } finally { clearTimeout(timer); } }
const bearer=(token:string)=>({authorization:`Bearer ${token}`});
async function verifyDatabase(id:string,url:string){
  if(id==="postgresql"){
    const {Client}=await import("pg");const client=new Client({connectionString:url,connectionTimeoutMillis:8000});
    try{await client.connect();await client.query("SELECT 1");}finally{await client.end().catch(()=>undefined);}return;
  }
  if(id==="mysql"){
    const {createConnection}=await import("mysql2/promise");const client=await createConnection({uri:url,connectTimeout:8000});
    try{await client.query("SELECT 1");}finally{await client.end();}return;
  }
  if(id==="mongodb"){
    const {MongoClient}=await import("mongodb");const client=new MongoClient(url,{connectTimeoutMS:8000,serverSelectionTimeoutMS:8000});
    try{await client.connect();await client.db().command({ping:1});}finally{await client.close();}return;
  }
  const {createClient}=await import("redis");const client=createClient({url,socket:{connectTimeout:8000}});
  try{await client.connect();await client.ping();}finally{if(client.isOpen)await client.quit();}
}
async function verifySmtp(v:Record<string,string>){const {default:nodemailer}=await import("nodemailer");const transport=nodemailer.createTransport({host:v.host,port:Number(v.port),secure:Number(v.port)===465,auth:{user:v.username,pass:v.password},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:8000});try{await transport.verify();}finally{transport.close();}}
function failure(status:number,body:string):VerificationResult { const expired=status===401&&/expired/i.test(body); const revoked=status===401&&/(revoked|invalid_token|bad credentials)/i.test(body); return {ok:false,status:expired?"expired":revoked?"revoked":"failed",message:expired?"Credential expired. Reconnect the service.":revoked?"Credential was revoked or is invalid. Reconnect the service.":`Authentication failed (HTTP ${status}). Check scope, environment, and permissions.`}; }
export async function verifyCredential(def:IntegrationDefinition,v:Record<string,string>):Promise<VerificationResult>{
  try {
    if (["postgresql","mysql","mongodb","redis"].includes(def.id)){await verifyDatabase(def.id,v.url);return {ok:true,status:"configured",message:"Authentication succeeded and an application-level health query completed."};}
    if(def.id==="smtp"){await verifySmtp(v);return {ok:true,status:"configured",message:"SMTP authentication and server verification succeeded."};}
    let result:{response:Response;body:string;ok:boolean};
    switch(def.id){
      case "gmail": result=await http("https://gmail.googleapis.com/gmail/v1/users/me/profile",{headers:bearer(v.accessToken)}); break;
      case "outlook": result=await http("https://graph.microsoft.com/v1.0/me",{headers:bearer(v.accessToken)}); break;
      case "github": result=await http("https://api.github.com/user",{headers:{...bearer(v.accessToken),accept:"application/vnd.github+json","user-agent":"Foundry"}}); break;
      case "slack": result=await http("https://slack.com/api/auth.test",{method:"POST",headers:{...bearer(v.accessToken),"content-type":"application/x-www-form-urlencoded"}}); if(result.response.ok&&!JSON.parse(result.body||"{}").ok)return failure(401,result.body); break;
      case "openai": result=await http("https://api.openai.com/v1/models",{headers:bearer(v.apiKey)}); break;
      case "anthropic": result=await http("https://api.anthropic.com/v1/models",{headers:{"x-api-key":v.apiKey,"anthropic-version":"2023-06-01"}}); break;
      case "gemini": result=await http(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(v.apiKey)}`); break;
      case "stripe": result=await http("https://api.stripe.com/v1/account",{headers:bearer(v.secretKey)}); break;
      case "twilio": result=await http(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(v.accountSid)}.json`,{headers:{authorization:`Basic ${Buffer.from(`${v.accountSid}:${v.authToken}`).toString("base64")}`}}); break;
      case "sendgrid": result=await http("https://api.sendgrid.com/v3/scopes",{headers:bearer(v.apiKey)}); break;
      case "resend": result=await http("https://api.resend.com/domains",{headers:bearer(v.apiKey)}); break;
      case "supabase": result=await http(`${v.url.replace(/\/$/,"")}/rest/v1/`,{headers:{apikey:v.key,authorization:`Bearer ${v.key}`}}); break;
      case "firebase": {
        if(v.serviceAccount){const {GoogleAuth}=await import("google-auth-library");const credentials=JSON.parse(v.serviceAccount);const auth=new GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/cloud-platform"]});const token=await auth.getAccessToken();result=await http(`https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(v.projectId)}`,{headers:bearer(String(token))});}
        else result=await http(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(v.apiKey)}`);
        break;
      }
      default:return {ok:false,status:"failed",message:"This credential requires verification through its application adapter."};
    }
    return result.ok?{ok:true,status:"configured",message:"Authentication succeeded and the service is reachable."}:failure(result.response.status,result.body);
  } catch{return {ok:false,status:"failed",message:"Connection or authentication failed. Check the credential, network access, TLS settings, and environment."};}
}
