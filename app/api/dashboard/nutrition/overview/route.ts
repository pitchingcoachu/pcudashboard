import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import {
  getNutritionTarget,
  listNutritionLogsForPlayer,
  listPlayerChoicesByOrganization,
} from '../../../../../lib/training-db';

function normalizedName(value: string): string {
  const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
  const comma = trimmed.match(/^([^,]+),\s*(.+)$/);
  return (comma ? `${comma[2]} ${comma[1]}` : trimmed).toLowerCase();
}

function validDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const url = new URL(request.url);
  const playerName = String(url.searchParams.get('player') ?? '').trim();
  if (!playerName || playerName.toLowerCase() === 'all') {
    return NextResponse.json({ error: 'Choose a specific athlete for nutrition charts.' }, { status: 400 });
  }
  const startDate = validDate(url.searchParams.get('start_date') ?? url.searchParams.get('startDate') ?? '');
  const endDate = validDate(url.searchParams.get('end_date') ?? url.searchParams.get('endDate') ?? '');

  const players = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  const requestedName = normalizedName(playerName);
  const player = players.find((candidate) => normalizedName(candidate.fullName) === requestedName);
  if (!player) return NextResponse.json({ error: 'Athlete not found in this organization.' }, { status: 404 });

  const [logs, target] = await Promise.all([
    listNutritionLogsForPlayer({ playerId: player.playerId, startDate: startDate || null, endDate: endDate || null }),
    getNutritionTarget({ playerId: player.playerId }),
  ]);
  const byDate = new Map<string, { calories: number; protein_g: number; carbs_g: number; fat_g: number }>();
  for (const log of logs) {
    const row = byDate.get(log.logDate) ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    row.calories += log.calories ?? 0;
    row.protein_g += log.proteinG ?? 0;
    row.carbs_g += log.carbsG ?? 0;
    row.fat_g += log.fatG ?? 0;
    byDate.set(log.logDate, row);
  }

  const chartPoints = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sessionDate, row]) => ({
      session_date: sessionDate,
      ...row,
      target_calories: target?.calories ?? null,
      target_protein_g: target?.proteinG ?? null,
      target_carbs_g: target?.carbsG ?? null,
      target_fat_g: target?.fatG ?? null,
    }));

  return NextResponse.json({
    player: player.fullName,
    table_columns: [],
    table_rows: [],
    chart_points: chartPoints,
  });
}
