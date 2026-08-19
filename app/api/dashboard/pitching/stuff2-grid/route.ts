import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveDashboardApiBaseUrl } from '../../../../../lib/dashboard-access';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/stuff2/grid`);
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(
        { error: String(data.detail ?? data.error ?? 'Failed to compute Stuff+ grid.') },
        { status: response.status }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reach dashboard API.' },
      { status: 502 }
    );
  }
}
