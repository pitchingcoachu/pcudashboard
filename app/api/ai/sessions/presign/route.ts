import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../../lib/ai-access';
import { getR2Bucket, getR2Client, isR2Configured } from '../../../../../lib/biomechanics-storage';

const ALLOWED = new Set(['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/webm','video/mp4','video/quicktime','video/webm']);
export async function POST(request:Request){
  const access=await requireAiAccess(request,true);if(!access.ok)return NextResponse.json({error:access.error},{status:access.status});
  const body=await request.json().catch(()=>({})) as {fileName?:string;contentType?:string;sizeBytes?:number};
  const fileName=String(body.fileName??'recording').trim();const contentType=String(body.contentType??'').split(';')[0].trim().toLowerCase();const sizeBytes=Number(body.sizeBytes??0);
  if(!ALLOWED.has(contentType))return NextResponse.json({error:'Choose an MP3, M4A, WAV, WebM, MP4, or MOV recording.'},{status:400});
  if(!Number.isFinite(sizeBytes)||sizeBytes<=0||sizeBytes>200*1024*1024)return NextResponse.json({error:'Recording must be under 200 MB.'},{status:400});
  if(!isR2Configured())return NextResponse.json({error:'Recording storage is not configured.'},{status:503});
  const safe=fileName.replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-120)||'recording';
  const r2Key=`ai-sessions/org-${access.organizationId}/uploads/${Date.now()}-${crypto.randomUUID()}-${safe}`;
  const uploadUrl=await getSignedUrl(getR2Client()!,new PutObjectCommand({Bucket:getR2Bucket(),Key:r2Key,ContentType:contentType}),{expiresIn:3600});
  return NextResponse.json({uploadUrl,r2Key,contentType});
}
