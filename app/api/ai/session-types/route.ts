import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../lib/ai-access';
import { createAiSessionType, listAiSessionTypes } from '../../../../lib/ai-workspace-db';

export async function GET(request: Request) {
  const access = await requireAiAccess(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json({ types: await listAiSessionTypes(access.organizationId) });
}

export async function POST(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Category name is required.' }, { status: 400 });
  const result = await createAiSessionType({ organizationId: access.organizationId, userId: access.userId, name });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ types: await listAiSessionTypes(access.organizationId) });
}
