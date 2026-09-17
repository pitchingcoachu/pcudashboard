import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../../lib/player-content-scope';
import {
  listPlayerAssessmentSeries,
  listPlayerChoicesByOrganization,
  listQuestionnaireQuestionSeries,
} from '../../../../../lib/training-db';

function normalizeName(value: string): string {
  const raw = String(value ?? '').trim();
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...rest] = raw.split(',').map((part) => part.trim());
        return `${rest.join(' ')} ${last}`.trim();
      })()
    : raw;
  return firstLast.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Not available.' }, { status: 403 });
  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Not available for this school.' }, { status: 403 });

  const roster = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  const allowedRoster = roster.map((player) => ({ id: player.playerId, name: String(player.fullName ?? '').trim() })).filter((entry) => entry.name);

  const url = new URL(request.url);
  const requestedPlayer = String(url.searchParams.get('player') ?? '').trim();
  const requestedNorm = normalizeName(requestedPlayer);
  const match = allowedRoster.find((entry) => normalizeName(entry.name) === requestedNorm);
  if (!requestedPlayer || requestedPlayer === 'All' || !match) {
    return NextResponse.json({ chart_points: [], table_columns: ['Date', 'Value'], table_rows: [] });
  }

  const source = url.searchParams.get('source') === 'questionnaire' ? 'questionnaire' : 'assessment';

  if (source === 'assessment') {
    const fieldId = String(url.searchParams.get('fieldId') ?? '').trim();
    if (!fieldId) return NextResponse.json({ error: 'fieldId is required.' }, { status: 400 });
    const series = await listPlayerAssessmentSeries({ organizationId, playerId: match.id, fieldId });
    return NextResponse.json({
      chart_points: series.map((point) => ({ session_date: point.date, value: point.value })),
      table_columns: ['Date', 'Value'],
      table_rows: series.map((point) => ({ Date: point.date, Value: point.value })),
    }, { headers: { 'cache-control': 'private, max-age=15, stale-while-revalidate=60' } });
  }

  const questionnaireId = Number(url.searchParams.get('questionnaireId') ?? '0');
  const questionId = String(url.searchParams.get('questionId') ?? '').trim();
  if (!Number.isFinite(questionnaireId) || questionnaireId <= 0 || !questionId) {
    return NextResponse.json({ error: 'questionnaireId and questionId are required.' }, { status: 400 });
  }
  const series = await listQuestionnaireQuestionSeries({ organizationId, playerId: match.id, questionnaireId, questionId });
  return NextResponse.json({
    chart_points: series.map((point) => ({ session_date: point.date, value: point.value })),
    table_columns: ['Date', 'Value'],
    table_rows: series.map((point) => ({ Date: point.date, Value: point.value })),
  }, { headers: { 'cache-control': 'private, max-age=15, stale-while-revalidate=60' } });
}
