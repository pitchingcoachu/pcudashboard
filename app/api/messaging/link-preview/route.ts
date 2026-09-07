import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { getMessageLinkPreview } from '../../../../lib/message-link-preview';

export async function GET(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const url = new URL(request.url).searchParams.get('url') ?? '';
    return NextResponse.json({ preview: await getMessageLinkPreview(url) }, { headers: { 'Cache-Control': 'private, max-age=600' } });
  } catch {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
  }
}
