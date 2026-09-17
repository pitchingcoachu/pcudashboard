import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../../lib/player-content-scope';
import { listChartableAssessmentFields, listOrgQuestionnaireCatalog } from '../../../../../lib/training-db';

export async function GET() {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Not available.' }, { status: 403 });
  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Not available for this school.' }, { status: 403 });

  const assessmentFields = listChartableAssessmentFields().map((field) => ({ value: field.id, label: field.label }));
  const questionnaires = await listOrgQuestionnaireCatalog({ organizationId });

  return NextResponse.json(
    { assessment_fields: assessmentFields, questionnaires },
    { headers: { 'cache-control': 'private, max-age=30, stale-while-revalidate=120' } }
  );
}
