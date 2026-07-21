import { NextResponse } from "next/server";
import { integrationRegistry } from "@/lib/integrations/registry";
export async function GET(){return NextResponse.json({packs:integrationRegistry.listPacks(),integrations:integrationRegistry.definitions().length});}
