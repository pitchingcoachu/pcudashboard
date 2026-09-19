import { GetObjectCommand } from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { getR2Bucket, getR2Client } from '../../../../lib/biomechanics-storage';

function contentTypeFromKey(key: string): string {
  if (key.toLowerCase().endsWith('.mov')) return 'video/quicktime';
  if (key.toLowerCase().endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

function streamFrom(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of iterable) controller.enqueue(chunk);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export async function GET(request: Request) {
  const key = String(new URL(request.url).searchParams.get('key') ?? '');
  if (!/^exercise-media\/org-\d+\/[a-f0-9-]+\.(mp4|m4v|mov|webm)$/i.test(key)) {
    return NextResponse.json({ error: 'Video not found.' }, { status: 404 });
  }

  const range = request.headers.get('range');
  const headers = new Headers({
    'Content-Type': contentTypeFromKey(key),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400, immutable',
  });

  const client = getR2Client();
  if (!client) return NextResponse.json({ error: 'Storage is unavailable.' }, { status: 503 });
  try {
    const object = await client.send(new GetObjectCommand({ Bucket: getR2Bucket(), Key: key, ...(range ? { Range: range } : {}) }));
    if (!object.Body) return NextResponse.json({ error: 'Video not found.' }, { status: 404 });
    if (object.ContentType) headers.set('Content-Type', object.ContentType);
    if (object.ContentLength != null) headers.set('Content-Length', String(object.ContentLength));
    if (object.ContentRange) headers.set('Content-Range', object.ContentRange);
    return new Response(streamFrom(object.Body as AsyncIterable<Uint8Array>), { status: range ? 206 : 200, headers });
  } catch {
    return NextResponse.json({ error: 'Video not found.' }, { status: 404 });
  }
}
