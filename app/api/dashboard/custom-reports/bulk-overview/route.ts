import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';

export const maxDuration = 300;

const ALLOWED_PREFIXES = new Set([
  '/api/dashboard/pitching/overview',
  '/api/dashboard/hitting/overview',
  '/api/dashboard/catching/overview',
]);

type BulkRequestBody = {
  keys?: unknown;
};

const BULK_OVERVIEW_TTL_MS = 90_000;

declare global {
  var __dashboardBulkOverviewCache:
    | Map<string, { at: number; payload?: unknown; error?: string }>
    | undefined;
}

function bulkOverviewCache(): Map<string, { at: number; payload?: unknown; error?: string }> {
  if (!global.__dashboardBulkOverviewCache) {
    global.__dashboardBulkOverviewCache = new Map();
  }
  return global.__dashboardBulkOverviewCache;
}

function parseKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    const key = String(raw ?? '').trim();
    if (!key) continue;
    const qIdx = key.indexOf('?');
    const path = qIdx >= 0 ? key.slice(0, qIdx) : key;
    if (!ALLOWED_PREFIXES.has(path)) continue;
    out.push(key);
    if (out.length >= 200) break;
  }
  return Array.from(new Set(out));
}

async function fetchOverviewKey(baseUrl: string, cookieHeader: string, key: string): Promise<{ payload?: unknown; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);
  try {
    const url = new URL(key, baseUrl);
    const response = await fetch(url.toString(), {
      cache: 'no-store',
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { error: String((payload as { error?: unknown })?.error ?? 'Request failed') };
    }
    return { payload };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: 'Request timeout' };
    }
    return { error: error instanceof Error ? error.message : 'Request failed' };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as BulkRequestBody;
  const keys = parseKeys(body.keys);
  if (!keys.length) {
    return NextResponse.json({ items: {}, errors: {} });
  }

  const requestUrl = new URL(request.url);
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
  const cookieHeader = request.headers.get('cookie') ?? '';
  const items: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const cache = bulkOverviewCache();
  const now = Date.now();
  const userScope = String(session.userId ?? 0);
  const unresolved: string[] = [];

  for (const key of keys) {
    const scopedKey = `${userScope}:${key}`;
    const cached = cache.get(scopedKey);
    if (cached && now - cached.at < BULK_OVERVIEW_TTL_MS) {
      if (cached.error) errors[key] = cached.error;
      else items[key] = cached.payload ?? {};
      continue;
    }
    unresolved.push(key);
  }
  if (!unresolved.length) {
    return NextResponse.json({ items, errors });
  }

  let nextIndex = 0;
  const workerCount = Math.min(3, unresolved.length);
  const workers = Array.from({ length: Math.min(workerCount, unresolved.length) }, async () => {
    while (nextIndex < unresolved.length) {
      const current = unresolved[nextIndex];
      nextIndex += 1;
      const result = await fetchOverviewKey(baseUrl, cookieHeader, current);
      const scopedKey = `${userScope}:${current}`;
      if (result.error) {
        // Do not cache transient errors; otherwise one backend hiccup poisons the panel for the full TTL.
        cache.delete(scopedKey);
        errors[current] = result.error;
      } else {
        cache.set(scopedKey, { at: Date.now(), payload: result.payload });
        items[current] = result.payload ?? {};
      }
    }
  });
  await Promise.all(workers);

  return NextResponse.json({ items, errors });
}
