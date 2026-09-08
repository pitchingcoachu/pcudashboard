import { GetObjectCommand } from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../../../lib/ai-access';
import { getAiSessionForOrganization } from '../../../../../../lib/ai-workspace-db';
import { getR2Bucket,getR2Client } from '../../../../../../lib/biomechanics-storage';
export async function GET(request:Request,context:{params:Promise<{sessionId:string}>}){const access=await requireAiAccess(request);if(!access.ok)return NextResponse.json({error:access.error},{status:access.status});const item=await getAiSessionForOrganization(Number((await context.params).sessionId),access.organizationId);const playerAllowed=access.role!=='player'||(item?.playerVisible&&access.playerId!=null&&item.playerIds.includes(access.playerId));if(!item||!item.audioR2Key||!playerAllowed)return new Response(null,{status:404});const object=await getR2Client()!.send(new GetObjectCommand({Bucket:getR2Bucket(),Key:item.audioR2Key}));return new Response(object.Body?.transformToWebStream() as ReadableStream,{headers:{'Content-Type':item.audioContentType,'Cache-Control':'private, max-age=300'}});}
