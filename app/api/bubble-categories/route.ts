import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../lib/programming-scope';
import { createBubbleCategory, getBubbleCategories } from '../../../lib/training-db';
import { normalizeBubbleCategoryLabel, normalizeBubbleCategoryOptions } from '../../../lib/bubble-categories';
import { logApiTiming } from '../../../lib/request-timing';

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>) => {
    logApiTiming({ route: 'bubble-categories.GET', startedAtMs, status });
    return NextResponse.json(payload, { status });
  };

  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return finish(400, { error: 'Session context missing. Please log out and log in again.' });

  const categories = await getBubbleCategories({ organizationId });
  return finish(200, { categories });
}

export async function POST(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>) => {
    logApiTiming({ route: 'bubble-categories.POST', startedAtMs, status });
    return NextResponse.json(payload, { status });
  };

  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return finish(400, { error: 'Session context missing. Please log out and log in again.' });

  const body = (await request.json().catch(() => null)) as { label?: unknown; options?: unknown } | null;
  if (!body) return finish(400, { error: 'Invalid JSON body.' });

  const label = normalizeBubbleCategoryLabel(body.label);
  const options = normalizeBubbleCategoryOptions(body.options);
  if (!label) return finish(400, { error: 'Category name is required.' });
  if (options.length < 2) return finish(400, { error: 'At least two options are required.' });

  const result = await createBubbleCategory({
    organizationId,
    userId: session.userId ?? null,
    label,
    options,
  });
  if (!result.ok) return finish(400, { error: result.error });
  return finish(200, { ok: true, id: result.id });
}
