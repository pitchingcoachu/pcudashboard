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
function normalizeLevel(value: string): string {
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

type AggRow = {
  split_value: string;
  pitch_type: string;
  pitch_n: number;
  swing_n: number;
  whiff_n: number;
  in_play_n: number;
  gb_n: number;
  cs_n: number;
  take_n: number;
  pa_n: number;
  inzone_n: number;
  fps_den: number;
  fps_num: number;
  fps_fb_den: number;
  fps_fb_num: number;
  fps_os_den: number;
  fps_os_num: number;
  chase_n: number;
  h_n: number;
  xbh_n: number;
  hr_n: number;
  hbp_n: number;
  k_n: number;
  bb_n: number;
  barrel_n: number;
  xiso_sum: number;
  xiso_n: number;
  rv_sum: number;
  pv_sum: number;
  xwoba_sum: number;
  xwoba_n: number;
  ev_sum: number;
  ev_n: number;
};

const PITCH_TYPE_ORDER = [
  'Fastball',
  'Sinker',
  'Cutter',
  'Slider',
  'Sweeper',
  'Curveball',
  'ChangeUp',
  'Splitter',
  'Undefined',
  'Unknown',
] as const;

function canonicalPitchType(value: string): string {
  const token = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (!token) return 'Unknown';
  if (['fastball', 'fourseam', 'fourseamfastball', '4seam', '4seamfastball', 'ff', 'fa'].includes(token)) return 'Fastball';
  if (['sinker', 'twoseam', 'twoseamfastball', 'oneseamfastball', 'si', 'ft'].includes(token)) return 'Sinker';
  if (['cutter', 'fc'].includes(token)) return 'Cutter';
  if (['slider', 'sl'].includes(token)) return 'Slider';
  if (['sweeper', 'st'].includes(token)) return 'Sweeper';
  if (['curveball', 'curve', 'cu', 'kc', 'slurve', 'sv'].includes(token)) return 'Curveball';
  if (['changeup', 'change', 'ch', 'circlechange'].includes(token)) return 'ChangeUp';
  if (['splitter', 'split', 'splitfinger', 'sp', 'fs'].includes(token)) return 'Splitter';
  if (token === 'undefined') return 'Undefined';
  if (token === 'unknown') return 'Unknown';
  return String(value ?? '').trim() || 'Unknown';
}

function pitchTypeSortRank(value: string): number {
  const canonical = canonicalPitchType(value);
  const idx = PITCH_TYPE_ORDER.indexOf(canonical as (typeof PITCH_TYPE_ORDER)[number]);
  return idx >= 0 ? idx : PITCH_TYPE_ORDER.length;
}

function toRate(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return (n / d) * 100;
}

function toCell(metric: string, row: AggRow): number | string {
  const p = Number(row.pitch_n || 0);
  const swing = Number(row.swing_n || 0);
  const whiff = Number(row.whiff_n || 0);
  const inPlay = Number(row.in_play_n || 0);
  const gb = Number(row.gb_n || 0);
  const cs = Number(row.cs_n || 0);
  const take = Number(row.take_n || 0);
  const pa = Number(row.pa_n || 0);
  const inzone = Number(row.inzone_n || 0);
  const fpsDen = Number(row.fps_den || 0);
  const fpsNum = Number(row.fps_num || 0);
  const fpsFbDen = Number(row.fps_fb_den || 0);
  const fpsFbNum = Number(row.fps_fb_num || 0);
  const fpsOsDen = Number(row.fps_os_den || 0);
  const fpsOsNum = Number(row.fps_os_num || 0);
  const chase = Number(row.chase_n || 0);
  const h = Number(row.h_n || 0);
  const xbh = Number(row.xbh_n || 0);
  const hr = Number(row.hr_n || 0);
  const hbp = Number(row.hbp_n || 0);
  const k = Number(row.k_n || 0);
  const bb = Number(row.bb_n || 0);
  const barrel = Number(row.barrel_n || 0);
  const xisoSum = Number(row.xiso_sum || 0);
  const xisoN = Number(row.xiso_n || 0);
  const rv = Number(row.rv_sum || 0);
  const pv = Number(row.pv_sum || 0);
  const xwobaSum = Number(row.xwoba_sum || 0);
  const xwobaN = Number(row.xwoba_n || 0);
  const evSum = Number(row.ev_sum || 0);
  const evN = Number(row.ev_n || 0);

  if (metric === 'P') return p;
  if (metric === 'PA') return pa;
  if (metric === 'Usage' || metric === 'Overall') return '-';
  if (metric === '#') return '-';
  if (metric === 'BF') return pa;
  if (metric === 'InZone%') return toRate(inzone, p) ?? '-';
  if (metric === 'Strike%') return toRate(cs + swing, p) ?? '-';
  if (metric === 'FPS%') return toRate(fpsNum, fpsDen) ?? '-';
  if (metric === 'FPS(FB)%') return toRate(fpsFbNum, fpsFbDen) ?? '-';
  if (metric === 'FPS(OS)%') return toRate(fpsOsNum, fpsOsDen) ?? '-';
  if (metric === 'Swing%' || metric === 'Swing Rate') return toRate(swing, p) ?? '-';
  if (metric === 'Whiff%' || metric === 'Whiff Rate') return toRate(whiff, swing) ?? '-';
  if (metric === 'SwStrk%') return toRate(whiff, p) ?? '-';
  if (metric === 'GB%' || metric === 'GB Rate') return toRate(gb, inPlay) ?? '-';
  if (metric === 'Barrel%') return toRate(barrel, inPlay) ?? '-';
  if (metric === 'K%') return toRate(k, pa) ?? '-';
  if (metric === 'BB%') return toRate(bb, pa) ?? '-';
  if (metric === 'K-BB%') {
    const kr = toRate(k, pa);
    const bbr = toRate(bb, pa);
    if (kr === null || bbr === null) return '-';
    return Number((kr - bbr).toFixed(1));
  }
  if (metric === 'CSW%') return toRate(cs + whiff, p) ?? '-';
  if (metric === 'Called-S%') return toRate(cs, take) ?? '-';
  if (metric === 'Take%') return toRate(take, p) ?? '-';
  if (metric === 'Chase%') {
    const outOfZone = Math.max(0, p - inzone);
    return toRate(chase, outOfZone) ?? '-';
  }
  if (metric === 'EV' || metric === 'Exit Velocity') return evN > 0 ? Number((evSum / evN).toFixed(1)) : '-';
  if (metric === 'H') return h;
  if (metric === 'XBH') return xbh;
  if (metric === 'HR') return hr;
  if (metric === 'HBP') return hbp;
  if (metric === 'BB') return bb;
  if (metric === 'K') return k;
  if (metric === 'Whiffs') return whiff;
  if (metric === 'AB') return Math.max(0, pa - bb - hbp);
  if (metric === 'AVG') {
    const ab = Math.max(0, pa - bb - hbp);
    return ab > 0 ? Number((h / ab).toFixed(3)) : '-';
  }
  if (metric === 'OBP') return pa > 0 ? Number(((h + bb + hbp) / pa).toFixed(3)) : '-';
  if (metric === 'SLG') {
    const ab = Math.max(0, pa - bb - hbp);
    if (ab <= 0) return '-';
    const singles = Math.max(0, h - xbh);
    const doublesTriplesHr = xbh;
    const tbApprox = singles + (2 * doublesTriplesHr);
    return Number((tbApprox / ab).toFixed(3));
  }
  if (metric === 'OPS') {
    const ab = Math.max(0, pa - bb - hbp);
    if (ab <= 0 || pa <= 0) return '-';
    const singles = Math.max(0, h - xbh);
    const doublesTriplesHr = xbh;
    const tbApprox = singles + (2 * doublesTriplesHr);
    const slg = tbApprox / ab;
    const obp = (h + bb + hbp) / pa;
    return Number((slg + obp).toFixed(3));
  }
  if (metric === 'xWOBA') return xwobaN > 0 ? Number((xwobaSum / xwobaN).toFixed(3)) : '-';
  if (metric === 'xISO') return xisoN > 0 ? Number((xisoSum / xisoN).toFixed(3)) : '-';
  if (metric === 'RV/100' || metric === 'Run Values') return p > 0 ? Number(((rv / p) * 100).toFixed(1)) : '-';
  if (metric === 'PV/100') return p > 0 ? Number(((pv / p) * 100).toFixed(1)) : '-';
  return '-';
}

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 500 });
  await ensureAuthDbReady();
  const pool = getDbPool();
  const url = new URL(request.url);

  const splitBy = String(url.searchParams.get('split_by') ?? '').trim();
  const splitByNorm = splitBy || 'Pitch Types';
  if (!['Pitch Types', 'Pitcher Hand', 'Batter Team', 'Count', 'After Count', 'Inning'].includes(splitByNorm)) {
    return NextResponse.json({ table_rows: [], table_columns: [] });
  }

  const schoolCode = String(url.searchParams.get('school_code') ?? '').trim().toUpperCase();
  if (!schoolCode) return NextResponse.json({ table_rows: [], table_columns: [] });
  const startDate = String(url.searchParams.get('start_date') ?? '').trim();
  const endDate = String(url.searchParams.get('end_date') ?? '').trim();
  const level = normalizeLevel(String(url.searchParams.get('level') ?? ''));
  const sessionType = normalizeSessionType(String(url.searchParams.get('session_type') ?? ''));
  const hand = normalizeHand(String(url.searchParams.get('hand') ?? ''));
  const hitterList = parseCsv(url.searchParams.get('hitter'));
  const hitterNorms = Array.from(new Set(hitterList.map(normalizeName).filter(Boolean)));
  const teamCode = maybeTeamCode(String(url.searchParams.get('team_type') ?? ''));
  const pitchTypes = parseCsv(url.searchParams.get('pitch_types'));
  const pitchTypeSet = new Set(pitchTypes.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const columns = parseCsv(url.searchParams.get('custom_columns'));
  const supportedColumns = new Set([
    '#', 'P', 'PA', 'BF', 'AB', 'AVG', 'OBP', 'SLG', 'OPS', 'H', 'XBH', 'HR', 'HBP', 'BB', 'K', 'Whiffs',
    'Usage', 'Overall', 'InZone%', 'Strike%', 'FPS%', 'FPS(FB)%', 'FPS(OS)%',
    'Swing%', 'Swing Rate', 'Whiff%', 'Whiff Rate', 'SwStrk%', 'GB%', 'GB Rate', 'Barrel%', 'K%', 'BB%', 'K-BB%', 'CSW%', 'Called-S%', 'Take%', 'Chase%',
    'EV', 'Exit Velocity', 'xWOBA', 'xISO', 'RV/100', 'PV/100',
  ]);
  if (columns.length && columns.some((col) => !supportedColumns.has(col))) {
    return NextResponse.json({ table_rows: [], table_columns: [] });
  }

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
  const isPro = schoolCode === 'PRO';
  if (!isPro) add('school_code = ?', schoolCode);
  if (startDate) add('session_date >= ?::date', startDate);
  if (endDate) add('session_date <= ?::date', endDate);
  if (isPro && level) add('level_bucket = ?', level);
  if (!isPro && sessionType) add('session_type_bucket = ?', sessionType);
  if (hand) add('pitcherthrows_norm = ?', hand);
  if (teamCode) add('batter_team_code = ?', teamCode);
  if (hitterNorms.length) add('batter_norm = ANY(?::text[])', hitterNorms);
  const tableRef = isPro ? 'public.pro_hitting_heatmap_daily_bins' : 'public.hitting_heatmap_daily_bins';

  const result = await pool.query<AggRow>(
    `
      SELECT
        ${
          splitByNorm === 'Pitcher Hand'
            ? "CASE WHEN pitcherthrows_norm <> '' THEN pitcherthrows_norm ELSE 'Unknown' END"
            : splitByNorm === 'Batter Team'
              ? "COALESCE(NULLIF(TRIM(batter_team_code), ''), 'Unknown')"
              : splitByNorm === 'Count'
                ? "COALESCE(NULLIF(TRIM(count_bucket), ''), 'Unknown')"
                : splitByNorm === 'After Count'
                  ? "COALESCE(NULLIF(TRIM(after_count_bucket), ''), 'Unknown')"
                : splitByNorm === 'Inning'
                  ? "COALESCE(NULLIF(TRIM(inning_bucket), ''), 'Unknown')"
            : "COALESCE(NULLIF(pitch_type,''), 'Unknown')"
        } AS split_value,
        pitch_type,
        SUM(pitch_n)::int AS pitch_n,
        SUM(swing_n)::int AS swing_n,
        SUM(whiff_n)::int AS whiff_n,
        SUM(in_play_n)::int AS in_play_n,
        SUM(gb_n)::int AS gb_n,
        SUM(cs_n)::int AS cs_n,
        SUM(take_n)::int AS take_n,
        SUM(pa_n)::int AS pa_n,
        SUM(inzone_n)::int AS inzone_n,
        SUM(fps_den)::int AS fps_den,
        SUM(fps_num)::int AS fps_num,
        SUM(fps_fb_den)::int AS fps_fb_den,
        SUM(fps_fb_num)::int AS fps_fb_num,
        SUM(fps_os_den)::int AS fps_os_den,
        SUM(fps_os_num)::int AS fps_os_num,
        SUM(chase_n)::int AS chase_n,
        SUM(h_n)::int AS h_n,
        SUM(xbh_n)::int AS xbh_n,
        SUM(hr_n)::int AS hr_n,
        SUM(hbp_n)::int AS hbp_n,
        SUM(k_n)::int AS k_n,
        SUM(bb_n)::int AS bb_n,
        SUM(barrel_n)::int AS barrel_n,
        SUM(xiso_sum)::double precision AS xiso_sum,
        SUM(xiso_n)::int AS xiso_n,
        SUM(rv_sum)::double precision AS rv_sum,
        SUM(pv_sum)::double precision AS pv_sum,
        SUM(xwoba_sum)::double precision AS xwoba_sum,
        SUM(xwoba_n)::int AS xwoba_n,
        SUM(ev_sum)::double precision AS ev_sum,
        SUM(ev_n)::int AS ev_n
      FROM ${tableRef}
      WHERE ${where.join(' AND ')}
      GROUP BY split_value, pitch_type
    `,
    values
  );

  const filtered = result.rows.filter((row) => {
    if (splitByNorm === 'Pitcher Hand' || splitByNorm === 'Batter Team' || splitByNorm === 'Count' || splitByNorm === 'After Count' || splitByNorm === 'Inning') return true;
    if (!pitchTypeSet.size) return true;
    return pitchTypeSet.has(String(row.pitch_type ?? '').trim().toLowerCase());
  });
  if (!filtered.length) return NextResponse.json({ table_rows: [], table_columns: [] });
  if (splitByNorm === 'Pitch Types') {
    filtered.sort((a, b) => {
      const rankDiff = pitchTypeSortRank(String(a.pitch_type ?? a.split_value ?? '')) - pitchTypeSortRank(String(b.pitch_type ?? b.split_value ?? ''));
      if (rankDiff !== 0) return rankDiff;
      return String(a.split_value ?? a.pitch_type ?? '').localeCompare(String(b.split_value ?? b.pitch_type ?? ''));
    });
  }

  const splitColumn =
    splitByNorm === 'Pitcher Hand'
      ? 'Pitcher Hand'
      : splitByNorm === 'Batter Team'
        ? 'Batter Team'
        : splitByNorm === 'Count'
          ? 'Count'
          : splitByNorm === 'After Count'
            ? 'After Count'
          : splitByNorm === 'Inning'
            ? 'Inning'
            : 'Pitch';
  const tableColumns = [splitColumn, ...(columns.length ? columns : ['PA', 'Usage', 'FPS%', 'SwStrk%', 'Whiff%', 'K%', 'BB%', 'xWOBA', 'PV/100'])];
  const totalPitches = filtered.reduce((sum, row) => sum + Number(row.pitch_n || 0), 0);
  const rows = filtered.map((row) => {
    const out: Record<string, string | number | null> = { [splitColumn]: row.split_value || (row.pitch_type || 'Unknown') };
    for (const metric of tableColumns.slice(1)) {
      if (metric === 'Usage' || metric === 'Overall') {
        out[metric] = totalPitches > 0 ? Number((((Number(row.pitch_n || 0) / totalPitches) * 100)).toFixed(1)) : '-';
      } else {
        out[metric] = toCell(metric, row);
      }
    }
    return out;
  });

  const allAgg = filtered.reduce<AggRow>(
    (acc, row) => ({
      split_value: 'All',
      pitch_type: 'All',
      pitch_n: acc.pitch_n + Number(row.pitch_n || 0),
      swing_n: acc.swing_n + Number(row.swing_n || 0),
      whiff_n: acc.whiff_n + Number(row.whiff_n || 0),
      in_play_n: acc.in_play_n + Number(row.in_play_n || 0),
      gb_n: acc.gb_n + Number(row.gb_n || 0),
      cs_n: acc.cs_n + Number(row.cs_n || 0),
      take_n: acc.take_n + Number(row.take_n || 0),
      pa_n: acc.pa_n + Number(row.pa_n || 0),
      inzone_n: acc.inzone_n + Number(row.inzone_n || 0),
      fps_den: acc.fps_den + Number(row.fps_den || 0),
      fps_num: acc.fps_num + Number(row.fps_num || 0),
      fps_fb_den: acc.fps_fb_den + Number(row.fps_fb_den || 0),
      fps_fb_num: acc.fps_fb_num + Number(row.fps_fb_num || 0),
      fps_os_den: acc.fps_os_den + Number(row.fps_os_den || 0),
      fps_os_num: acc.fps_os_num + Number(row.fps_os_num || 0),
      chase_n: acc.chase_n + Number(row.chase_n || 0),
      h_n: acc.h_n + Number(row.h_n || 0),
      xbh_n: acc.xbh_n + Number(row.xbh_n || 0),
      hr_n: acc.hr_n + Number(row.hr_n || 0),
      hbp_n: acc.hbp_n + Number(row.hbp_n || 0),
      k_n: acc.k_n + Number(row.k_n || 0),
      bb_n: acc.bb_n + Number(row.bb_n || 0),
      barrel_n: acc.barrel_n + Number(row.barrel_n || 0),
      xiso_sum: acc.xiso_sum + Number(row.xiso_sum || 0),
      xiso_n: acc.xiso_n + Number(row.xiso_n || 0),
      rv_sum: acc.rv_sum + Number(row.rv_sum || 0),
      pv_sum: acc.pv_sum + Number(row.pv_sum || 0),
      xwoba_sum: acc.xwoba_sum + Number(row.xwoba_sum || 0),
      xwoba_n: acc.xwoba_n + Number(row.xwoba_n || 0),
      ev_sum: acc.ev_sum + Number(row.ev_sum || 0),
      ev_n: acc.ev_n + Number(row.ev_n || 0),
    }),
    {
      split_value: 'All',
      pitch_type: 'All',
      pitch_n: 0, swing_n: 0, whiff_n: 0, in_play_n: 0, gb_n: 0, cs_n: 0, take_n: 0,
      pa_n: 0, inzone_n: 0, fps_den: 0, fps_num: 0, fps_fb_den: 0, fps_fb_num: 0, fps_os_den: 0, fps_os_num: 0, chase_n: 0,
      h_n: 0, xbh_n: 0, hr_n: 0, hbp_n: 0, k_n: 0, bb_n: 0, barrel_n: 0,
      xiso_sum: 0, xiso_n: 0,
      rv_sum: 0, pv_sum: 0, xwoba_sum: 0, xwoba_n: 0, ev_sum: 0, ev_n: 0,
    }
  );
  const allRow: Record<string, string | number | null> = { [splitColumn]: 'All' };
  for (const metric of tableColumns.slice(1)) {
    if (metric === 'Usage' || metric === 'Overall') {
      allRow[metric] = 100;
    } else {
      allRow[metric] = toCell(metric, allAgg);
    }
  }
  rows.push(allRow);

  return NextResponse.json({ table_rows: rows, table_columns: tableColumns, chart_points: [], heatmap_points: [] });
}
