import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../../lib/ai-access';
import { deleteFlagRule, listFlagRules, reorderFlagRules, saveFlagRule } from '../../../../../lib/ai-workspace-db';
import { canonicalFlagMetric } from '../../../../../lib/dashboard-metric-catalog';

export async function GET(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json({ rules: await listFlagRules(access.organizationId) });
}

export async function POST(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const domain = body.domain === 'hitting' ? 'hitting' : 'pitching';
  const direction = ['increase', 'decrease', 'either'].includes(String(body.direction))
    ? body.direction as 'increase' | 'decrease' | 'either'
    : 'either';
  const threshold = Math.max(0, Number(body.threshold ?? 0));
  if (!String(body.name ?? '').trim() || !String(body.metric ?? '').trim() || threshold <= 0) {
    return NextResponse.json({ error: 'Name, metric, and a positive threshold are required.' }, { status: 400 });
  }
  const requestedPitchTypes = Array.isArray(body.pitchTypes) ? body.pitchTypes : [body.pitchType ?? 'All'];
  const cleanPitchTypes = Array.from(new Set(requestedPitchTypes.map((value) => String(value ?? '').trim()).filter(Boolean)));
  const pitchTypes = cleanPitchTypes.length && !cleanPitchTypes.some((value) => value.toLowerCase() === 'all') ? cleanPitchTypes : ['All'];
  const id = await saveFlagRule({
    id: Number(body.id ?? 0) || undefined,
    organizationId: access.organizationId,
    userId: access.userId,
    name: String(body.name).trim(),
    domain,
    metric: canonicalFlagMetric(String(body.metric)),
    pitchTypes,
    direction,
    threshold,
    thresholdType: body.thresholdType === 'percent' ? 'percent' : 'absolute',
    baselineDays: Math.min(365, Math.max(7, Number(body.baselineDays ?? 30))),
    minimumSample: Math.min(500, Math.max(1, Number(body.minimumSample ?? 5))),
    targetPlayer: String(body.targetPlayer ?? 'All').trim() || 'All',
    sessionType: String(body.sessionType ?? 'All').trim() || 'All',
    notificationsEnabled: Boolean(body.notificationsEnabled),
    cooldownHours: Math.min(720, Math.max(1, Number(body.cooldownHours ?? 24))),
    enabled: body.enabled !== false,
  });
  return NextResponse.json({ id });
}

export async function PATCH(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => ({})) as { ruleIds?: unknown };
  if (!Array.isArray(body.ruleIds)) return NextResponse.json({ error: 'A complete rule order is required.' }, { status: 400 });
  const saved = await reorderFlagRules(access.organizationId, body.ruleIds.map(Number));
  if (!saved) return NextResponse.json({ error: 'Rule order did not match this organization.' }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  await deleteFlagRule(Number(new URL(request.url).searchParams.get('id') ?? 0), access.organizationId);
  return NextResponse.json({ ok: true });
}
