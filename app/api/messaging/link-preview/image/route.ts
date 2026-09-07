import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { fetchPreviewResource } from '../../../../../lib/message-link-preview';

export async function GET(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const url = new URL(request.url).searchParams.get('url') ?? '';
    const image = await fetchPreviewResource(url, 5 * 1024 * 1024, true);
    return new Response(new Uint8Array(image.body), { headers: {
      'Content-Type': image.contentType, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
