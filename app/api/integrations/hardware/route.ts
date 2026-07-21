import { NextResponse } from "next/server";
import { diagnoseHardware } from "@/lib/integrations/hardware-adapters";
export async function POST(request:Request){try{const body=await request.json() as {provider?:string;agent?:{url:string;token?:string}};if(!body.provider||!body.agent)throw new Error("Provider and Local Agent configuration are required.");return NextResponse.json(await diagnoseHardware(body.provider,body.agent));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Hardware diagnostics failed."},{status:400});}}
