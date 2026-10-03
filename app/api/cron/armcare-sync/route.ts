import { NextResponse } from 'next/server';
import { syncArmCareExams } from '../../../../lib/armcare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const cronSecret = String(process.env.CRON_SECRET ?? '').trim();
  const armCareKey = String(process.env.ARMCARE_CRON_KEY ?? '').trim();
  if (!cronSecret && !armCareKey) return false;
  const headerKey = String(request.headers.get('x-cron-key') ?? '').trim();
  if (armCareKey && headerKey === armCareKey) return true;
  const authorization = String(request.headers.get('authorization') ?? '').trim();
  if (!authorization.toLowerCase().startsWith('bearer ')) return false;
  const token = authorization.slice(7).trim();
  return Boolean(token && (token === cronSecret || token === armCareKey));
}

function pcuOrganizationId(): number {
  const explicit = Number(process.env.ARMCARE_ORGANIZATION_ID ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  try {
    const mapping = JSON.parse(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}') as Record<string, unknown>;
    const match = Object.entries(mapping).find(([, school]) => String(school ?? '').trim().toUpperCase() === 'PCU');
    return Number(match?.[0] ?? 0);
  } catch {
    return 0;
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const organizationId = pcuOrganizationId();
    if (!organizationId) throw new Error('The PCU organization could not be resolved.');
    const result = await syncArmCareExams({ organizationId, schoolCode: 'PCU' });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'ArmCare sync failed.' }, { status: 500 });
  }
}
