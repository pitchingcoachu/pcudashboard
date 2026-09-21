import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../../lib/player-content-scope';
import { createCoachDashboardMedia, deleteCoachDashboardMedia, saveCoachDashboardMediaAnnotations } from '../../../../../lib/coach-dashboard-db';
import { deleteObjectFromR2, getObjectMetadataFromR2, getR2Bucket, getR2Client, isR2Configured, uploadCoachDashboardMediaToR2 } from '../../../../../lib/biomechanics-storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const maxDuration = 300;
const MAX_BYTES = 350 * 1024 * 1024;

async function staffContext(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session || session.role === 'player' || !session.userId) return null;
  const organizationId = await resolvePlayerContentOrganizationId(session);
  return organizationId > 0 ? { organizationId, ownerUserId: session.userId } : null;
}

function mediaType(contentType: string): 'photo' | 'video' | 'pdf' | null {
  if (contentType.startsWith('image/')) return 'photo';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType === 'application/pdf') return 'pdf';
  return null;
}

function inferContentType(fileName: string, suppliedType = ''): string {
  if (suppliedType.trim()) return suppliedType.trim().toLowerCase();
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const types: Record<string, string> = {
    jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', heic:'image/heic', heif:'image/heif', avif:'image/avif',
    mp4:'video/mp4', m4v:'video/mp4', mov:'video/quicktime', qt:'video/quicktime', webm:'video/webm', avi:'video/x-msvideo', mkv:'video/x-matroska',
    pdf:'application/pdf',
  };
  return types[extension] ?? 'application/octet-stream';
}

function sanitizeBreakdownAnnotations(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const tools = new Set(['line','arrow','circle','pen','text','angle']);
  return value.slice(0,500)
    .filter((entry):entry is Record<string,unknown>=>Boolean(entry)&&typeof entry==='object'&&!Array.isArray(entry))
    .map((entry)=>({
      id:String(entry.id??`media-${Date.now()}`).slice(0,160),
      tool:String(entry.tool??''),
      color:String(entry.color??'#facc15').slice(0,40),
      width:Math.max(1,Math.min(30,Number(entry.width??4)||4)),
      points:Array.isArray(entry.points)?entry.points.slice(0,2000).filter((point):point is Record<string,unknown>=>Boolean(point)&&typeof point==='object'&&!Array.isArray(point)).map((point)=>({x:Math.max(0,Math.min(1,Number(point.x??0)||0)),y:Math.max(0,Math.min(1,Number(point.y??0)||0))})):[],
      ...(typeof entry.text==='string'?{text:entry.text.slice(0,300)}:{}),
      ...(typeof entry.fontSize==='number'?{fontSize:Math.max(12,Math.min(120,entry.fontSize))}:{}),
      ...(entry.angleMode==='acute'||entry.angleMode==='obtuse'?{angleMode:entry.angleMode}:{}),
    }))
    .filter((entry)=>tools.has(entry.tool)&&entry.points.length>0);
}

export async function POST(request: Request) {
  const context = await staffContext(request);
  if (!context) return NextResponse.json({ error: 'Staff access required.' }, { status: 403 });
  if (request.headers.get('content-type')?.includes('application/json')) {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const fileName = String(body.fileName ?? '').trim();
    const contentType = inferContentType(fileName, String(body.contentType ?? ''));
    const sizeBytes = Math.round(Number(body.sizeBytes) || 0);
    const kind = mediaType(contentType);
    if (!fileName || !kind || sizeBytes <= 0 || sizeBytes > MAX_BYTES) return NextResponse.json({ error:'Choose a supported file smaller than 350 MB.' }, { status:400 });
    if (body.action === 'presign') {
      if (!isR2Configured()) return NextResponse.json({ fallback:true });
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
      const r2Key = `coach-dashboard/org-${context.organizationId}/user-${context.ownerUserId}/${kind}-${Date.now()}-${safeName}`;
      const client = getR2Client();
      if (!client) return NextResponse.json({ fallback:true });
      const uploadUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket:getR2Bucket(), Key:r2Key, ContentType:contentType, Metadata:{ organization_id:String(context.organizationId), owner_user_id:String(context.ownerUserId) } }), { expiresIn:900 });
      return NextResponse.json({ uploadUrl, r2Key });
    }
    if (body.action === 'finalize') {
      const r2Key = String(body.r2Key ?? '');
      const prefix = `coach-dashboard/org-${context.organizationId}/user-${context.ownerUserId}/`;
      if (!r2Key.startsWith(prefix)) return NextResponse.json({ error:'Invalid upload key.' }, { status:400 });
      const stored = await getObjectMetadataFromR2(r2Key);
      if (!stored || stored.contentLength !== sizeBytes) return NextResponse.json({ error:'The uploaded file could not be verified.' }, { status:400 });
      const media = await createCoachDashboardMedia({ ...context, title:String(body.title??'').trim()||fileName, category:String(body.category??'').trim()||'General', mediaType:kind, fileName, contentType, sizeBytes, r2Key });
      return NextResponse.json({ ok:true, media });
    }
    return NextResponse.json({ error:'Unsupported action.' }, { status:400 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a photo, video, or PDF.' }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'Files must be smaller than 350 MB.' }, { status: 400 });
  const contentType = inferContentType(file.name, file.type);
  const kind = mediaType(contentType);
  if (!kind) return NextResponse.json({ error: 'Only photos, videos, and PDFs are supported.' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const r2Key = await uploadCoachDashboardMediaToR2({ ...context, fileName:file.name, contentType, body:buffer });
  if (!r2Key) return NextResponse.json({ error: 'Upload failed.' }, { status: 500 });
  try {
    const media = await createCoachDashboardMedia({
      ...context, title:String(form?.get('title') ?? '').trim() || file.name, category:String(form?.get('category') ?? '').trim() || 'General',
      mediaType:kind, fileName:file.name, contentType, sizeBytes:file.size, r2Key,
    });
    return NextResponse.json({ ok:true, media });
  } catch (error) {
    await deleteObjectFromR2(r2Key).catch(() => {});
    return NextResponse.json({ error:error instanceof Error ? error.message : 'Upload failed.' }, { status:500 });
  }
}

export async function DELETE(request: Request) {
  const context = await staffContext(request);
  if (!context) return NextResponse.json({ error: 'Staff access required.' }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get('id') ?? 0);
  if (id <= 0) return NextResponse.json({ error: 'id is required.' }, { status:400 });
  const key = await deleteCoachDashboardMedia({ ...context, id });
  if (key) await deleteObjectFromR2(key).catch(() => {});
  return NextResponse.json({ ok:Boolean(key) });
}

export async function PATCH(request:Request) {
  const context=await staffContext(request);
  if(!context)return NextResponse.json({error:'Staff access required.'},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const id=Number(body.id??0);
  const annotations=sanitizeBreakdownAnnotations(body.breakdownAnnotations);
  if(id<=0)return NextResponse.json({error:'A valid media id is required.'},{status:400});
  if(annotations===null)return NextResponse.json({error:'Invalid breakdown annotations.'},{status:400});
  const media=await saveCoachDashboardMediaAnnotations({...context,id,annotations});
  if(!media)return NextResponse.json({error:'Media not found.'},{status:404});
  return NextResponse.json({ok:true,media});
}
