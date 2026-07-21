import { NextResponse } from "next/server";
import { publicCatalog } from "@/lib/integrations/catalog";
export async function GET(){return NextResponse.json({integrations:publicCatalog()});}
