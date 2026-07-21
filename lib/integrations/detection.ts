import { integrationCatalog } from "@/lib/integrations/catalog";
import type { DetectedIntegration, DetectionEvidence } from "@/lib/integrations/types";
import type { IntegrationDefinition } from "@/lib/integrations/types";
import { slug } from "@/lib/integrations/ecosystem";

export type ProjectEvidenceFile = { path: string; content?: string };
const ignored = /(?:^|\/)(?:node_modules|\.git|\.next|dist|build|coverage)(?:\/|$)/;

function parseEnv(content: string) {
  const names = new Set<string>();
  const malformed: string[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
    if (match) names.add(match[1]); else malformed.push(`line ${index + 1}`);
  });
  return { names, malformed };
}

function manifestDependencies(files:ProjectEvidenceFile[]){const dependencies=new Map<string,string>();const add=(name:string,path:string)=>{const clean=name.trim().replace(/["'`,;()[\]{}]/g,"");if(clean&&clean.length<160)dependencies.set(clean,path);};for(const file of files){const p=file.path.replace(/\\/g,"/");const c=file.content||"";if(/(?:^|\/)package\.json$/i.test(p)){try{const parsed=JSON.parse(c) as {dependencies?:Record<string,string>;devDependencies?:Record<string,string>;peerDependencies?:Record<string,string>};Object.keys({...parsed.dependencies,...parsed.devDependencies,...parsed.peerDependencies}).forEach(name=>add(name,p));}catch{/* malformed config remains non-fatal */}}else if(/(?:^|\/)package-lock\.json$/i.test(p)){try{const parsed=JSON.parse(c) as {packages?:Record<string,unknown>;dependencies?:Record<string,unknown>};Object.keys(parsed.dependencies||{}).forEach(name=>add(name,p));Object.keys(parsed.packages||{}).filter(name=>name.includes("node_modules/")).forEach(name=>add(name.split("node_modules/").at(-1)!,p));}catch{/* ignore malformed lock */}}else if(/(?:^|\/)(?:yarn\.lock|pnpm-lock\.yaml)$/i.test(p))Array.from(c.matchAll(/^(?:\s{2})?["']?(@?[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)?)(?:@|:)/gim)).forEach(m=>add(m[1],p));else if(/(?:^|\/)(?:requirements[^/]*\.txt|Pipfile|poetry\.lock)$/i.test(p))c.split(/\r?\n/).map(line=>line.match(/^\s*(?:name\s*=\s*["'])?([A-Za-z0-9_.-]+)/)?.[1]).filter(Boolean).forEach(name=>add(name!,p));else if(/(?:^|\/)pyproject\.toml$/i.test(p))Array.from(c.matchAll(/^[\s"']*([A-Za-z0-9_.-]+)\s*(?:[=<>~!]|["'])/gm)).forEach(m=>add(m[1],p));else if(/(?:^|\/)go\.mod$/i.test(p))Array.from(c.matchAll(/^\s*([a-z0-9.-]+\/[a-z0-9_./-]+)/gim)).forEach(m=>add(m[1],p));else if(/(?:^|\/)Cargo\.toml$/i.test(p))Array.from(c.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)).forEach(m=>add(m[1],p));else if(/\.csproj$/i.test(p))Array.from(c.matchAll(/PackageReference\s+Include=["']([^"']+)/gi)).forEach(m=>add(m[1],p));else if(/(?:^|\/)pom\.xml$/i.test(p))Array.from(c.matchAll(/<artifactId>([^<]+)<\/artifactId>/gi)).forEach(m=>add(m[1],p));}return dependencies;}
function evidenceKind(path:string):DetectionEvidence["kind"]{if(/(?:dockerfile|compose\.ya?ml)$/i.test(path))return"docker";if(/(?:^|\/)(?:\.github\/workflows|\.gitlab-ci|azure-pipelines|Jenkinsfile|\.circleci)/i.test(path))return"ci";if(/(?:vercel|netlify|render|fly)\.(?:json|toml|ya?ml)$/i.test(path))return"deployment";if(/\.(?:tf|tfvars)$/i.test(path)||/(?:^|\/)(?:Chart\.yaml|kustomization\.yaml|pulumi\.)/i.test(path))return"infrastructure";if(/\.(?:log|out)$/i.test(path))return"runtime";return"config";}
function genericDefinition(packageName:string,env:string[]):IntegrationDefinition{const id=`project-${slug(packageName)}`;return{id,name:packageName,category:"unknown",pack:"project",auth:env.length?"api-key":"none",authenticationMethods:env.length?["api-key"]:["none"],preferredAuthenticationMethod:env.length?"api-key":"none",fields:env.map(name=>({key:slug(name),label:name.replace(/_/g," "),env:[name],required:true,secret:/(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/.test(name)})),packages:[packageName],imports:[packageName],sourcePatterns:env,configFiles:[],conventions:[],help:"Foundry detected a service that does not yet have a built-in setup guide.",deploymentMappings:Object.fromEntries(env.map(name=>[name,name])),troubleshooting:["Inspect the SDK initialization and project documentation.","Provide an optional safe test command that does not mutate provider data."],maturity:"metadata"};}

export function detectProjectIntegrations(files: ProjectEvidenceFile[], environment: Record<string, string | undefined> = {}) {
  const usable = files.filter((file) => !ignored.test(file.path.replace(/\\/g, "/"))).slice(0, 5000);
  const dependencySources=manifestDependencies(usable);const dependencies=new Set(dependencySources.keys());
  const envNames = new Set(Object.keys(environment));
  const malformedEnvironmentFiles: Array<{ path: string; lines: string[] }> = [];
  for (const file of usable.filter((item) => /(?:^|\/)\.env(?:\.[^/]+)?$/i.test(item.path))) {
    const parsed = parseEnv(file.content || ""); parsed.names.forEach((name) => envNames.add(name));
    if (parsed.malformed.length) malformedEnvironmentFiles.push({ path: file.path, lines: parsed.malformed });
  }
  const envReferences = new Set<string>();
  usable.forEach((file) => Array.from((file.content || "").matchAll(/(?:(?:process\.env\.|import\.meta\.env\.|env\[['"])([A-Z][A-Z0-9_]*)|(?:getenv|GetEnvironmentVariable)\s*\(\s*["']([A-Z][A-Z0-9_]*)["'])/g)).forEach((match) => envReferences.add(match[1]||match[2])));
  const detected: DetectedIntegration[] = [];
  for (const definition of integrationCatalog) {
    const evidence: DetectionEvidence[] = [];
    definition.packages.filter((value) => dependencies.has(value)).forEach((value) => {const source=dependencySources.get(value);evidence.push({ kind:source&&/(?:lock|pnpm|yarn)/i.test(source)?"lockfile":"dependency", value, path:source });});
    for (const file of usable) {
      const content = file.content || ""; const normalized = file.path.replace(/\\/g, "/");
      definition.imports.filter((value) => content.includes(value)).forEach((value) => evidence.push({ kind:"import", value, path:normalized }));
      definition.sourcePatterns.filter((value) => content.toLowerCase().includes(value.toLowerCase()) || normalized.toLowerCase().includes(value.toLowerCase())).forEach((value) => evidence.push({ kind:evidenceKind(normalized)==="runtime"?"runtime":"source", value, path:normalized }));
      definition.configFiles.filter((value) => normalized === value || normalized.endsWith(`/${value}`) || (value.startsWith(".")&&normalized.endsWith(value)) || normalized.startsWith(`${value}/`)).forEach((value) => evidence.push({ kind:evidenceKind(normalized), value, path:normalized }));
      definition.conventions.filter((value) => content.includes(value)).forEach((value) => evidence.push({ kind:"convention", value, path:normalized }));
    }
    const knownEnv = definition.fields.flatMap((field) => field.env);
    knownEnv.filter((name) => envReferences.has(name)).forEach((name) => evidence.push({ kind:"environment", value:name }));
    if (!evidence.length) continue;
    const missingEnvironment = definition.fields.filter((field) => field.required && !field.env.some((name) => envNames.has(name) && Boolean(environment[name]))).map((field) => field.env[0]);
    const used=evidence.some(item=>["import","source","environment","convention","runtime"].includes(item.kind));const confidence=Math.min(100,evidence.reduce((score,item)=>score+({dependency:15,lockfile:5,import:30,source:25,environment:20,convention:25,runtime:25,docker:15,ci:15,deployment:15,infrastructure:20,config:15,"unknown-package":10}[item.kind]||0),0));
    detected.push({ definition, evidence: evidence.slice(0, 12), required: used, missingEnvironment,used,confidence,state:!used?"not-used":missingEnvironment.length?"credentials-required":"detected" });
  }
  const knownPackages=new Set(integrationCatalog.flatMap(item=>item.packages));const ignoredPackage=/^(?:react|react-dom|next|vite|typescript|eslint|prettier|tailwindcss|lucide-react|vitest|jest|mocha|webpack|rollup|babel|postcss|autoprefixer|sass|less|dotenv|zod|lodash|date-fns|clsx|class-variance-authority)$/i;
  for(const packageName of dependencies){if(knownPackages.has(packageName)||ignoredPackage.test(packageName))continue;const locations=usable.filter(file=>(file.content||"").includes(packageName)&&!/(?:package\.json|lock|requirements|pyproject|Cargo\.toml|go\.mod|pom\.xml|csproj)$/i.test(file.path));if(!locations.length)continue;const nearbyEnv=new Set<string>();locations.forEach(file=>Array.from((file.content||"").matchAll(/(?:process\.env\.|import\.meta\.env\.|env\[['"])([A-Z][A-Z0-9_]*)/g)).forEach(match=>nearbyEnv.add(match[1])));const definition=genericDefinition(packageName,[...nearbyEnv]);detected.push({definition,evidence:[{kind:"unknown-package",value:packageName,path:dependencySources.get(packageName)},...locations.slice(0,5).map(file=>({kind:"import" as const,value:packageName,path:file.path}))],required:true,missingEnvironment:[...nearbyEnv].filter(name=>!envNames.has(name)),used:true,confidence:Math.min(85,40+locations.length*10),state:nearbyEnv.size?"credentials-required":"unknown-integration"});}
  return { detected, environmentReferences:[...envReferences].sort(), malformedEnvironmentFiles,stats:{catalogSize:integrationCatalog.length,known:detected.filter(item=>item.definition.category!=="unknown").length,unknown:detected.filter(item=>item.definition.category==="unknown").length} };
}
