import { NextResponse } from "next/server";
import { integrationById } from "@/lib/integrations/catalog";
import { certificationProgress } from "@/lib/integrations/registry";
import { integrationLabel } from "@/lib/integrations/certification";
export async function GET(request:Request){const id=new URL(request.url).searchParams.get("id")||"";const definition=integrationById(id);if(!definition)return NextResponse.json({error:"Integration was not found."},{status:404});return NextResponse.json({id,label:integrationLabel(definition),maturity:definition.maturity,...certificationProgress(definition)});}
