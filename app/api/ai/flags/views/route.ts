import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../../lib/ai-access';
import { deleteFlagView, listFlagViews, saveFlagView } from '../../../../../lib/ai-workspace-db';

export async function GET(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const viewer = { userId: access.userId, email: access.session.email ?? '' };
  return NextResponse.json({ views: await listFlagViews(access.organizationId, viewer) });
}

export async function POST(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'View name is required.' }, { status: 400 });
  const ruleIds = Array.isArray(body.ruleIds) ? body.ruleIds.map((value) => Number(value)).filter((value) => Number.isFinite(value)) : [];
  const id = await saveFlagView({
    id: Number(body.id ?? 0) || undefined,
    organizationId: access.organizationId,
    userId: access.userId,
    userEmail: access.session.email ?? '',
    name,
    ruleIds,
    visibility: body.visibility === 'private' ? 'private' : 'organization',
  });
  if (!id) return NextResponse.json({ error: 'View not found, or you do not have permission to edit it.' }, { status: 404 });
  return NextResponse.json({ id });
}

export async function DELETE(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const viewer = { userId: access.userId, email: access.session.email ?? '' };
  await deleteFlagView(Number(new URL(request.url).searchParams.get('id') ?? 0), access.organizationId, viewer);
  return NextResponse.json({ ok: true });
}
