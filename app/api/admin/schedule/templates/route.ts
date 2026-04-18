import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { deleteScheduleTemplate, listScheduleTemplatesByOrganization, saveScheduleTemplate } from '../../../../../lib/training-db';
import { logApiTiming } from '../../../../../lib/request-timing';

type TemplateItemInput = {
  workoutId?: number;
  prescribedSets?: string;
  prescribedReps?: string;
  prescribedLoad?: string;
  prescribedNotes?: string;
};

type TemplateDayInput = {
  dayOffset?: number;
  items?: TemplateItemInput[];
};

export async function GET() {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.templates.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return finish(400, { error: 'Session context missing. Please log out and log in again.' });
  }

  const templates = await listScheduleTemplatesByOrganization(organizationId);
  return finish(200, { templates }, { organizationId, count: Array.isArray(templates) ? templates.length : 0 });
}

export async function POST(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.templates.POST', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const body = (await request.json().catch(() => null)) as
    | { templateId?: number; name?: string; days?: TemplateDayInput[] }
    | null;
  if (!body) return finish(400, { error: 'Invalid JSON body.' });

  const organizationId = resolveProgrammingOrganizationId(session);
  const userId = Number(session.userId ?? 0);
  if (organizationId <= 0 || userId <= 0) {
    return finish(400, { error: 'Session context missing. Please log out and log in again.' });
  }

  const result = await saveScheduleTemplate({
    organizationId,
    userId,
    templateId: Number(body.templateId ?? 0) || undefined,
    name: String(body.name ?? ''),
    days: (body.days ?? []).map((day) => ({
      dayOffset: Number(day.dayOffset ?? 0),
      items: (day.items ?? []).map((item) => ({
        workoutId: Number(item.workoutId ?? 0),
        prescribedSets: String(item.prescribedSets ?? ''),
        prescribedReps: String(item.prescribedReps ?? ''),
        prescribedLoad: String(item.prescribedLoad ?? ''),
        prescribedNotes: String(item.prescribedNotes ?? ''),
      })),
    })),
  });

  if (!result.ok) return finish(400, { error: result.error });
  return finish(200, { ok: true, templateId: result.templateId }, { organizationId, templateId: result.templateId });
}

export async function DELETE(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.templates.DELETE', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const url = new URL(request.url);
  const templateId = Number(url.searchParams.get('templateId') ?? '0');
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return finish(400, { error: 'templateId is required.' });
  }

  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return finish(400, { error: 'Session context missing. Please log out and log in again.' });
  }

  const result = await deleteScheduleTemplate({ organizationId, templateId });
  if (!result.ok) return finish(400, { error: result.error });
  return finish(200, { ok: true }, { organizationId, templateId });
}
