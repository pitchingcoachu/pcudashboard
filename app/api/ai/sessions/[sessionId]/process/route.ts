import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../../../lib/ai-access';
import { processAiSession } from '../../../../../../lib/ai-session-processing';
export const maxDuration=300;
export async function POST(request:Request,context:{params:Promise<{sessionId:string}>}){const access=await requireAiAccess(request,true);if(!access.ok)return NextResponse.json({error:access.error},{status:access.status});const id=Number((await context.params).sessionId);try{await processAiSession(id,access.organizationId);return NextResponse.json({ok:true});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Processing failed.'},{status:500});}}
