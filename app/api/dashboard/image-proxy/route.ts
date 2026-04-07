import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTS = new Set(['www.mlbstatic.com', 'mlbstatic.com']);

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url') || '';
  if (!raw) {
    return NextResponse.json({ error: 'Missing url query parameter.' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid url.' }, { status: 400 });
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    return NextResponse.json({ error: 'Unsupported protocol.' }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    return NextResponse.json({ error: 'Host not allowed.' }, { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      cache: 'force-cache',
      next: { revalidate: 86400 },
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Upstream image request failed.' }, { status: upstream.status });
    }
    const buffer = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('content-type') || 'image/svg+xml';
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400, stale-while-revalidate=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch image.' }, { status: 502 });
  }
}
