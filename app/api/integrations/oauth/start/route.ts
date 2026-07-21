import { NextResponse } from "next/server";
import { integrationById } from "@/lib/integrations/catalog";
import { normalizeScope } from "@/lib/integrations/manager";
import { oauthStart } from "@/lib/integrations/oauth";
export async function POST(request:Request){try{const body=await request.json() as {scope?:Record<string,unknown>};const scope=normalizeScope(body.scope||{});const def=integrationById(scope.provider)!;const redirectUri=new URL("/api/integrations/oauth/callback",request.url).toString();return NextResponse.json(oauthStart(def,JSON.stringify(scope),redirectUri));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"OAuth could not start."},{status:400});}}
