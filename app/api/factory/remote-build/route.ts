import { NextResponse } from "next/server";
import { remoteBuilderStatus, runRemoteBuild, type RemoteBuildRequest, type RemoteBuildTarget } from "@/lib/certified-build/remote-builder";

export const maxDuration=1200;
export async function POST(request:Request){try{const body=await request.json() as ({action:"status";target:RemoteBuildTarget}|({action:"run"}&RemoteBuildRequest));if(body.action==="status")return NextResponse.json(remoteBuilderStatus(body.target));if(body.action==="run")return NextResponse.json(await runRemoteBuild(body));return NextResponse.json({error:"Unknown remote builder action."},{status:400});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Remote build failed."},{status:500});}}
