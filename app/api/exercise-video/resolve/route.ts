import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { shouldResolveExerciseVideoUrl } from '../../../../lib/exercise-video';

const FINAL_VIDEO_HOSTS = ['tiktok.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com'];
const SHORT_VIDEO_HOSTS = ['fb.watch', 't.co'];

function isAllowedFinalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^www\./, '');
  return FINAL_VIDEO_HOSTS.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function isAllowedFetchHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^www\./, '');
  return isAllowedFinalHost(normalized) || SHORT_VIDEO_HOSTS.includes(normalized);
}

async function followShareUrl(url: string, method: 'HEAD' | 'GET', signal: AbortSignal): Promise<string> {
  let current = url;
  for (let redirectCount = 0; redirectCount < 6; redirectCount += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== 'https:' || !isAllowedFetchHost(parsed.hostname)) {
      throw new Error('Unsupported redirect target.');
    }
    const response = await fetch(current, {
      method,
      redirect: 'manual',
      cache: 'no-store',
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PCUExerciseVideo/1.0)',
      },
    });
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (response.status < 300 || response.status >= 400 || !location) return current;
    current = new URL(location, current).toString();
  }
  throw new Error('Too many redirects.');
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const raw = new URL(request.url).searchParams.get('url')?.trim() ?? '';
  if (!shouldResolveExerciseVideoUrl(raw)) {
    return NextResponse.json({ error: 'This share URL is not supported.' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    let resolved = await followShareUrl(raw, 'HEAD', controller.signal);
    if (resolved === raw) resolved = await followShareUrl(raw, 'GET', controller.signal);
    const parsed = new URL(resolved);
    if (parsed.protocol !== 'https:' || !isAllowedFinalHost(parsed.hostname) || shouldResolveExerciseVideoUrl(resolved)) {
      return NextResponse.json({ error: 'The shared link redirected to an unsupported site.' }, { status: 400 });
    }
    return NextResponse.json({ url: resolved }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'The shared link took too long to resolve.'
      : 'Could not resolve the shared link.';
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
