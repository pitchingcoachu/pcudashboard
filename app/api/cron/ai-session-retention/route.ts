import { NextResponse } from 'next/server';
import { clearAiAudio,listExpiredAiAudio } from '../../../../lib/ai-workspace-db';
import { deleteObjectFromR2 } from '../../../../lib/biomechanics-storage';
export async function GET(request:Request){if(request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'Unauthorized'},{status:401});const expired=await listExpiredAiAudio();let deleted=0;for(const item of expired){try{await deleteObjectFromR2(item.r2Key);await clearAiAudio(item.id,item.organizationId);deleted++;}catch{}}return NextResponse.json({ok:true,deleted});}
