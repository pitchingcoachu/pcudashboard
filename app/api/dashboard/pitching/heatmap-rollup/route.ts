import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from '../../../../../lib/auth-db';

function parseCsv(value: string | null): string[] {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
function normalizeName(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}
function normalizeHand(value: string): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'right' || raw === 'r') return 'Right';
  if (raw === 'left' || raw === 'l') return 'Left';
  return '';
}
function normalizeSessionType(value: string): string {
  const raw = String(value ?? '').trim().toUpperCase();
  return raw && raw !== 'ALL' ? raw : '';
}
function maybeTeamCode(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase() === 'all') return '';
  const direct = raw.toUpperCase();
  if (/^[A-Z0-9]{2,8}$/.test(direct)) return direct;
  const paren = raw.match(/\(([A-Z0-9]{2,8})\)\s*$/i)?.[1];
  if (paren) return String(paren).toUpperCase();
  return '';
}

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 500 });
  await ensureAuthDbReady();
  const pool = getDbPool();
  const url = new URL(request.url);

  const schoolCode = String(url.searchParams.get('school_code') ?? '').trim().toUpperCase();
  if (!schoolCode) return NextResponse.json({ chart_points: [], heatmap_points: [] });

  const startDate = String(url.searchParams.get('start_date') ?? '').trim();
  const endDate = String(url.searchParams.get('end_date') ?? '').trim();
  const sessionType = normalizeSessionType(String(url.searchParams.get('session_type') ?? ''));
  const hand = normalizeHand(String(url.searchParams.get('hand') ?? ''));
  const batterSide = normalizeHand(String(url.searchParams.get('batter_side') ?? ''));
  const pitcherList = parseCsv(url.searchParams.get('pitcher'));
  const pitcherNorms = Array.from(new Set(pitcherList.map(normalizeName).filter(Boolean)));
  const teamCode = maybeTeamCode(String(url.searchParams.get('team_type') ?? ''));
  const pitchTypes = parseCsv(url.searchParams.get('pitch_types'));
  const pitchTypeSet = new Set(pitchTypes.map((value) => value.trim().toLowerCase()).filter(Boolean));

  const where: string[] = ['1=1'];
  const values: unknown[] = [];
  const add = (clause: string, value?: unknown) => {
    if (value === undefined) {
      where.push(clause);
      return;
    }
    values.push(value);
    where.push(clause.replace('?', `$${values.length}`));
  };

  add('school_code = ?', schoolCode);
  if (startDate) add('session_date >= ?::date', startDate);
  if (endDate) add('session_date <= ?::date', endDate);
  if (sessionType) add('session_type_bucket = ?', sessionType);
  if (hand) add('pitcherhand_norm = ?', hand);
  if (batterSide) add('batterside_norm = ?', batterSide);
  if (teamCode) add('pitcher_team_code = ?', teamCode);
  if (pitcherNorms.length) add('pitcher_norm = ANY(?::text[])', pitcherNorms);

  const result = await pool.query<{
    plate_x_bin: number;
    plate_z_bin: number;
    pitch_type: string;
    pitch_n: number;
    swing_n: number;
    whiff_n: number;
    in_play_n: number;
    gb_n: number;
    cs_n: number;
    take_n: number;
    rv_sum: number;
    pv_sum: number;
    xwoba_sum: number;
    xwoba_n: number;
    ev_sum: number;
    ev_n: number;
  }>(
    `
      SELECT
        plate_x_bin,
        plate_z_bin,
        pitch_type,
        SUM(pitch_n)::int AS pitch_n,
        SUM(swing_n)::int AS swing_n,
        SUM(whiff_n)::int AS whiff_n,
        SUM(in_play_n)::int AS in_play_n,
        SUM(gb_n)::int AS gb_n,
        SUM(cs_n)::int AS cs_n,
        SUM(take_n)::int AS take_n,
        SUM(rv_sum)::double precision AS rv_sum,
        SUM(pv_sum)::double precision AS pv_sum,
        SUM(xwoba_sum)::double precision AS xwoba_sum,
        SUM(xwoba_n)::int AS xwoba_n,
        SUM(ev_sum)::double precision AS ev_sum,
        SUM(ev_n)::int AS ev_n
      FROM public.pitching_heatmap_daily_bins
      WHERE ${where.join(' AND ')}
      GROUP BY plate_x_bin, plate_z_bin, pitch_type
    `,
    values
  );

  const chartPoints = result.rows
    .filter((row) => row.pitch_n > 0)
    .filter((row) => {
      if (!pitchTypeSet.size) return true;
      return pitchTypeSet.has(String(row.pitch_type ?? '').trim().toLowerCase());
    })
    .map((row) => {
      const x = -2.5 + ((Number(row.plate_x_bin) + 0.5) / 24) * 5.0;
      const z = 0 + ((Number(row.plate_z_bin) + 0.5) / 30) * 5.0;
      return {
        plate_side: x,
        plate_height: z,
        pitch_type: row.pitch_type,
        pitch_n: Number(row.pitch_n),
        swing_n: Number(row.swing_n),
        whiff_n: Number(row.whiff_n),
        in_play_n: Number(row.in_play_n),
        gb_n: Number(row.gb_n),
        cs_n: Number(row.cs_n),
        take_n: Number(row.take_n),
        run_value_sum: Number(row.rv_sum),
        pv_sum: Number(row.pv_sum),
        xwoba_sum: Number(row.xwoba_sum),
        xwoba_n: Number(row.xwoba_n),
        ev_sum: Number(row.ev_sum),
        ev_n: Number(row.ev_n),
      };
    });

  return NextResponse.json({
    chart_points: chartPoints,
    heatmap_points: chartPoints,
    table_rows: [],
    table_columns: [],
    total_pitches: chartPoints.reduce((sum, row) => sum + Number(row.pitch_n || 0), 0),
  });
}
