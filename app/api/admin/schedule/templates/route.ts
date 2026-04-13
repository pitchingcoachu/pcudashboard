import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { deleteScheduleTemplate, listScheduleTemplatesByOrganization, saveScheduleTemplate } from '../../../../../lib/training-db';

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
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }

  const templates = await listScheduleTemplatesByOrganization(organizationId);
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { templateId?: number; name?: string; days?: TemplateDayInput[] }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const organizationId = resolveProgrammingOrganizationId(session);
  const userId = Number(session.userId ?? 0);
  if (organizationId <= 0 || userId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
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

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, templateId: result.templateId });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const templateId = Number(url.searchParams.get('templateId') ?? '0');
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return NextResponse.json({ error: 'templateId is required.' }, { status: 400 });
  }

  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Session context missing. Please log out and log in again.' }, { status: 400 });
  }

  const result = await deleteScheduleTemplate({ organizationId, templateId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
