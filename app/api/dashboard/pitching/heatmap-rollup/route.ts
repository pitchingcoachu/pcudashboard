import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from '../../../../../lib/auth-db';
import { LEAGUE_TEAM_NAME_BY_CODE } from '../../../../../lib/league-team-name-map';

function parseCsv(value: string | null): string[] {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
function normalizeName(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function normalizePitchType(value: string): string {
  const token = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!token || ['unknown', 'undefined', 'other'].includes(token)) return 'Undefined';
  if (['fastball', 'fourseamfastball', 'fourseam', 'ff', 'fa'].includes(token)) return 'Fastball';
  if (['sinker', 'oneseamfastball', 'twoseamfastball', 'twoseamfasball', 'twoseam', 'si', 'ft'].includes(token)) return 'Sinker';
  if (['changeup', 'ch'].includes(token)) return 'ChangeUp';
  if (['sweeper', 'st'].includes(token)) return 'Sweeper';
  if (['splitter', 'splitfinger', 'splitfingerfastball', 'sp', 'fs'].includes(token)) return 'Splitter';
  if (['curveball', 'cu', 'knucklecurve', 'kc'].includes(token)) return 'Curveball';
  if (['cutter', 'fc'].includes(token)) return 'Cutter';
  if (['slider', 'sl'].includes(token)) return 'Slider';
  if (['knuckleball', 'kn'].includes(token)) return 'Knuckleball';
  return String(value ?? '').trim() || 'Undefined';
}
const PITCH_TYPE_SQL = `
CASE
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('', 'unknown', 'undefined', 'other') THEN 'Undefined'
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('fastball', 'fourseamfastball', 'fourseam', 'ff', 'fa') THEN 'Fastball'
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('sinker', 'oneseamfastball', 'twoseamfastball', 'twoseamfasball', 'twoseam', 'si', 'ft') THEN 'Sinker'
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('changeup', 'ch') THEN 'ChangeUp'
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('sweeper', 'st') THEN 'Sweeper'
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('splitter', 'splitfinger', 'splitfingerfastball', 'sp', 'fs') THEN 'Splitter'
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('curveball', 'cu', 'knucklecurve', 'kc') THEN 'Curveball'
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('cutter', 'fc') THEN 'Cutter'
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('slider', 'sl') THEN 'Slider'
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('knuckleball', 'kn') THEN 'Knuckleball'
  ELSE COALESCE(NULLIF(TRIM(pitch_type), ''), 'Undefined')
END`;
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
function normalizeLevel(value: string): string {
  const raw = String(value ?? '').trim().toUpperCase();
  return raw || 'ALL';
}
function maybeTeamCode(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase() === 'all') return '';
  const direct = raw.toUpperCase();
  if (/^[A-Z0-9_]{2,16}$/.test(direct)) return direct;
  const paren = raw.match(/\(([A-Z0-9_]{2,16})\)\s*$/i)?.[1];
  if (paren) return String(paren).toUpperCase();
  const token = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matched = Object.entries(LEAGUE_TEAM_NAME_BY_CODE).find(
    ([, label]) => String(label ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === token
  );
  if (matched) return matched[0].toUpperCase();
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
  const level = normalizeLevel(String(url.searchParams.get('level') ?? ''));
  const sessionType = normalizeSessionType(String(url.searchParams.get('session_type') ?? ''));
  const hand = normalizeHand(String(url.searchParams.get('hand') ?? ''));
  const batterSide = normalizeHand(String(url.searchParams.get('batter_side') ?? ''));
  const pitcherList = parseCsv(url.searchParams.get('pitcher'));
  const pitcherNorms = Array.from(new Set(pitcherList.map(normalizeName).filter(Boolean)));
  const teamCode = maybeTeamCode(String(url.searchParams.get('team_type') ?? ''));
  const pitchTypes = parseCsv(url.searchParams.get('pitch_types'));
  const pitchTypeSet = new Set(pitchTypes.map((value) => normalizePitchType(value).toLowerCase()).filter(Boolean));

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
  if (schoolCode === 'PRO' && level !== 'ALL') add('level_bucket = ?', level);
  if (startDate) add('session_date >= ?::date', startDate);
  if (endDate) add('session_date <= ?::date', endDate);
  if (sessionType) add('session_type_bucket = ?', sessionType);
  if (hand) add('pitcherhand_norm = ?', hand);
  if (batterSide) add('batterside_norm = ?', batterSide);
  if (teamCode) add('pitcher_team_code = ?', teamCode);
  if (pitcherNorms.length) add('pitcher_norm = ANY(?::text[])', pitcherNorms);
  if (pitchTypeSet.size) add(`LOWER(${PITCH_TYPE_SQL}) = ANY(?::text[])`, Array.from(pitchTypeSet));

  const tableRef = schoolCode === 'PRO'
    ? 'public.pro_pitching_heatmap_daily_bins'
    : 'public.pitching_heatmap_daily_bins';

  let result: {
    rows: Array<{
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
      xiso_sum: number;
      xiso_n: number;
      ev_sum: number;
      ev_n: number;
      relspeed_sum: number;
      relspeed_n: number;
      ivb_sum: number;
      ivb_n: number;
      hb_sum: number;
      hb_n: number;
      spin_sum: number;
      spin_n: number;
      relheight_sum: number;
      relheight_n: number;
      relside_sum: number;
      relside_n: number;
    }>;
  };
  try {
    result = await pool.query<{
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
      xiso_sum: number;
      xiso_n: number;
      ev_sum: number;
      ev_n: number;
      relspeed_sum: number;
      relspeed_n: number;
      ivb_sum: number;
      ivb_n: number;
      hb_sum: number;
      hb_n: number;
      spin_sum: number;
      spin_n: number;
      relheight_sum: number;
      relheight_n: number;
      relside_sum: number;
      relside_n: number;
    }>(
      `
      SELECT
        plate_x_bin,
        plate_z_bin,
        ${PITCH_TYPE_SQL} AS pitch_type,
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
        SUM(xiso_sum)::double precision AS xiso_sum,
        SUM(xiso_n)::int AS xiso_n,
        SUM(ev_sum)::double precision AS ev_sum,
        SUM(ev_n)::int AS ev_n,
        SUM(relspeed_sum)::double precision AS relspeed_sum,
        SUM(relspeed_n)::int AS relspeed_n,
        SUM(ivb_sum)::double precision AS ivb_sum,
        SUM(ivb_n)::int AS ivb_n,
        SUM(hb_sum)::double precision AS hb_sum,
        SUM(hb_n)::int AS hb_n,
        SUM(spin_sum)::double precision AS spin_sum,
        SUM(spin_n)::int AS spin_n,
        SUM(relheight_sum)::double precision AS relheight_sum,
        SUM(relheight_n)::int AS relheight_n,
        SUM(relside_sum)::double precision AS relside_sum,
        SUM(relside_n)::int AS relside_n
      FROM ${tableRef}
      WHERE ${where.join(' AND ')}
      GROUP BY plate_x_bin, plate_z_bin, ${PITCH_TYPE_SQL}
    `,
      values
    );
  } catch (error) {
    const code = String((error as { code?: string } | null)?.code ?? '');
    if (!(schoolCode === 'PRO' && code === '42P01')) throw error;
    result = await pool.query<{
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
      xiso_sum: number;
      xiso_n: number;
      ev_sum: number;
      ev_n: number;
      relspeed_sum: number;
      relspeed_n: number;
      ivb_sum: number;
      ivb_n: number;
      hb_sum: number;
      hb_n: number;
      spin_sum: number;
      spin_n: number;
      relheight_sum: number;
      relheight_n: number;
      relside_sum: number;
      relside_n: number;
    }>(
      `
      SELECT
        plate_x_bin,
        plate_z_bin,
        ${PITCH_TYPE_SQL} AS pitch_type,
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
        SUM(xiso_sum)::double precision AS xiso_sum,
        SUM(xiso_n)::int AS xiso_n,
        SUM(ev_sum)::double precision AS ev_sum,
        SUM(ev_n)::int AS ev_n,
        SUM(relspeed_sum)::double precision AS relspeed_sum,
        SUM(relspeed_n)::int AS relspeed_n,
        SUM(ivb_sum)::double precision AS ivb_sum,
        SUM(ivb_n)::int AS ivb_n,
        SUM(hb_sum)::double precision AS hb_sum,
        SUM(hb_n)::int AS hb_n,
        SUM(spin_sum)::double precision AS spin_sum,
        SUM(spin_n)::int AS spin_n,
        SUM(relheight_sum)::double precision AS relheight_sum,
        SUM(relheight_n)::int AS relheight_n,
        SUM(relside_sum)::double precision AS relside_sum,
        SUM(relside_n)::int AS relside_n
      FROM public.pitching_heatmap_daily_bins
      WHERE ${where.join(' AND ')}
      GROUP BY plate_x_bin, plate_z_bin, ${PITCH_TYPE_SQL}
    `,
      values
    );
  }

  const chartPoints = result.rows
    .filter((row) => row.pitch_n > 0)
    .filter((row) => {
      if (!pitchTypeSet.size) return true;
      return pitchTypeSet.has(String(row.pitch_type ?? '').trim().toLowerCase());
    })
    .map((row) => {
      const x = -2.5 + ((Number(row.plate_x_bin) + 0.5) / 24) * 5.0;
      const z = 0 + ((Number(row.plate_z_bin) + 0.5) / 30) * 5.0;
      const avg = (sum: unknown, n: unknown): number | null => {
        const count = Number(n || 0);
        if (!Number.isFinite(count) || count <= 0) return null;
        const total = Number(sum || 0);
        if (!Number.isFinite(total)) return null;
        return total / count;
      };
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
        xiso_sum: Number(row.xiso_sum),
        xiso_n: Number(row.xiso_n),
        ev_sum: Number(row.ev_sum),
        ev_n: Number(row.ev_n),
        velo: avg(row.relspeed_sum, row.relspeed_n),
        ivb: avg(row.ivb_sum, row.ivb_n),
        hb: avg(row.hb_sum, row.hb_n),
        spin: avg(row.spin_sum, row.spin_n),
        release_height: avg(row.relheight_sum, row.relheight_n),
        release_side: avg(row.relside_sum, row.relside_n),
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
