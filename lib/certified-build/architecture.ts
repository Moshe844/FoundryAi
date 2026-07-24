import type { ProductProfile, StackRecommendation } from "./types";

export type ProjectArchitecture = { applications: Array<{ id:string; role:string; stackId:string; capabilities:string[] }>; sharedServices:string[]; artifacts:string[] };
export function composeProjectArchitecture(profile: ProductProfile, recommendation: StackRecommendation): ProjectArchitecture | null {
  if (!recommendation.selectedStack) return null;
  const apps=[{id:"primary",role:profile.platforms.web?"web management application":profile.platforms.api?"service":profile.platforms.android?"Android application":profile.platforms.ios?"iOS application":"application",stackId:recommendation.selectedStack.stackId,capabilities:recommendation.requirementsMatched}];
  if(profile.platforms.web&&profile.platforms.android) apps.push({id:"android-companion",role:"native Android companion",stackId:"android-kotlin-compose",capabilities:["offlineMode","barcodeScanning","bluetooth"].filter((x)=>profile.capabilities[x as keyof typeof profile.capabilities])});
  return {applications:apps,sharedServices:[profile.capabilities.relationalData?"relational data service":"",profile.capabilities.authentication?"authentication and authorization":"",profile.capabilities.auditHistory?"audit history":""].filter(Boolean),artifacts:[...new Set(apps.flatMap((app)=>app.stackId===recommendation.selectedStack?.stackId?recommendation.selectedStack.artifacts:app.stackId==="android-kotlin-compose"?["android-artifact"]:[]))]};
}
