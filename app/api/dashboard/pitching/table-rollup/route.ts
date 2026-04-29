import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from '../../../../../lib/auth-db';
import { resolveDashboardApiBaseUrl } from '../../../../../lib/dashboard-access';

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
  return raw || 'ALL';
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
  comp_n: number;
  fps_den: number;
  fps_num: number;
  early_den: number;
  early_num: number;
  ahead_den: number;
  ahead_num: number;
  ea_den: number;
  ea_num: number;
  oneone_den: number;
  oneone_num: number;
  chase_n: number;
  h_n: number;
  xbh_n: number;
  hr_n: number;
  hbp_n: number;
  fps_fb_den: number;
  fps_fb_num: number;
  fps_os_den: number;
  fps_os_num: number;
  barrel_n: number;
  xiso_sum: number;
  xiso_n: number;
  relspeed_sum: number;
  relspeed_n: number;
  relspeed_max: number;
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
  extension_sum: number;
  extension_n: number;
  releasetilt_sum: number;
  releasetilt_n: number;
  stuff_plus_sum: number;
  stuff_plus_n: number;
  qp_plus_sum: number;
  qp_plus_n: number;
  ctrl_plus_sum: number;
  ctrl_plus_n: number;
  pitching_plus_sum: number;
  pitching_plus_n: number;
  k_n: number;
  bb_n: number;
  rv_sum: number;
  pv_sum: number;
  xwoba_sum: number;
  xwoba_n: number;
  ev_sum: number;
  ev_n: number;
};
type PlusMetricKey = 'Stuff+' | 'QP+' | 'Ctrl+' | 'Pitching+';

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
  const comp = Number(row.comp_n || 0);
  const fpsDen = Number(row.fps_den || 0);
  const fpsNum = Number(row.fps_num || 0);
  const earlyDen = Number(row.early_den || 0);
  const earlyNum = Number(row.early_num || 0);
  const aheadDen = Number(row.ahead_den || 0);
  const aheadNum = Number(row.ahead_num || 0);
  const eaDen = Number(row.ea_den || 0);
  const eaNum = Number(row.ea_num || 0);
  const oneOneDen = Number(row.oneone_den || 0);
  const oneOneNum = Number(row.oneone_num || 0);
  const chase = Number(row.chase_n || 0);
  const h = Number(row.h_n || 0);
  const xbh = Number(row.xbh_n || 0);
  const hr = Number(row.hr_n || 0);
  const hbp = Number(row.hbp_n || 0);
  const fpsFbDen = Number(row.fps_fb_den || 0);
  const fpsFbNum = Number(row.fps_fb_num || 0);
  const fpsOsDen = Number(row.fps_os_den || 0);
  const fpsOsNum = Number(row.fps_os_num || 0);
  const barrel = Number(row.barrel_n || 0);
  const xisoSum = Number(row.xiso_sum || 0);
  const xisoN = Number(row.xiso_n || 0);
  const relspeedSum = Number(row.relspeed_sum || 0);
  const relspeedN = Number(row.relspeed_n || 0);
  const relspeedMax = Number(row.relspeed_max || 0);
  const ivbSum = Number(row.ivb_sum || 0);
  const ivbN = Number(row.ivb_n || 0);
  const hbSum = Number(row.hb_sum || 0);
  const hbN = Number(row.hb_n || 0);
  const spinSum = Number(row.spin_sum || 0);
  const spinN = Number(row.spin_n || 0);
  const relheightSum = Number(row.relheight_sum || 0);
  const relheightN = Number(row.relheight_n || 0);
  const relsideSum = Number(row.relside_sum || 0);
  const relsideN = Number(row.relside_n || 0);
  const extensionSum = Number(row.extension_sum || 0);
  const extensionN = Number(row.extension_n || 0);
  const releasetiltSum = Number(row.releasetilt_sum || 0);
  const releasetiltN = Number(row.releasetilt_n || 0);
  const stuffPlusSum = Number(row.stuff_plus_sum || 0);
  const stuffPlusN = Number(row.stuff_plus_n || 0);
  const qpPlusSum = Number(row.qp_plus_sum || 0);
  const qpPlusN = Number(row.qp_plus_n || 0);
  const ctrlPlusSum = Number(row.ctrl_plus_sum || 0);
  const ctrlPlusN = Number(row.ctrl_plus_n || 0);
  const pitchingPlusSum = Number(row.pitching_plus_sum || 0);
  const pitchingPlusN = Number(row.pitching_plus_n || 0);
  const k = Number(row.k_n || 0);
  const bb = Number(row.bb_n || 0);
  const rv = Number(row.rv_sum || 0);
  const pv = Number(row.pv_sum || 0);
  const xwobaSum = Number(row.xwoba_sum || 0);
  const xwobaN = Number(row.xwoba_n || 0);
  const evSum = Number(row.ev_sum || 0);
  const evN = Number(row.ev_n || 0);

  if (metric === 'PA') return pa;
  if (metric === 'P') return p;
  if (metric === 'Usage' || metric === 'Overall') return '-';
  if (metric === '#') return '-';
  if (metric === 'BF') return pa;
  if (metric === 'Velo') return relspeedN > 0 ? Number((relspeedSum / relspeedN).toFixed(1)) : '-';
  if (metric === 'Max') return relspeedN > 0 ? Number(relspeedMax.toFixed(1)) : '-';
  if (metric === 'IVB') return ivbN > 0 ? Number((ivbSum / ivbN).toFixed(1)) : '-';
  if (metric === 'HB') return hbN > 0 ? Number((hbSum / hbN).toFixed(1)) : '-';
  if (metric === 'Spin') return spinN > 0 ? Number((spinSum / spinN).toFixed(0)) : '-';
  if (metric === 'Height') return relheightN > 0 ? Number((relheightSum / relheightN).toFixed(2)) : '-';
  if (metric === 'Side') return relsideN > 0 ? Number((relsideSum / relsideN).toFixed(2)) : '-';
  if (metric === 'Ext') return extensionN > 0 ? Number((extensionSum / extensionN).toFixed(2)) : '-';
  if (metric === 'rTilt') return releasetiltN > 0 ? Number((releasetiltSum / releasetiltN).toFixed(0)) : '-';
  if (metric === 'InZone%') return toRate(inzone, p) ?? '-';
  if (metric === 'Comp%') return toRate(comp, p) ?? '-';
  if (metric === 'Strike%') return toRate(cs + swing, p) ?? '-';
  if (metric === 'FPS%') return toRate(fpsNum, fpsDen) ?? '-';
  if (metric === 'FPS(FB)%') return toRate(fpsFbNum, fpsFbDen) ?? '-';
  if (metric === 'FPS(OS)%') return toRate(fpsOsNum, fpsOsDen) ?? '-';
  if (metric === 'Early%') return toRate(earlyNum, earlyDen) ?? '-';
  if (metric === 'Ahead%') return toRate(aheadNum, aheadDen) ?? '-';
  if (metric === 'E+A%') return toRate(eaNum, eaDen) ?? '-';
  if (metric === '1-1W%') return toRate(oneOneNum, oneOneDen) ?? '-';
  if (metric === 'Swing%') return toRate(swing, p) ?? '-';
  if (metric === 'Whiff%') return toRate(whiff, swing) ?? '-';
  if (metric === 'SwStrk%') return toRate(whiff, p) ?? '-';
  if (metric === 'GB%') return toRate(gb, inPlay) ?? '-';
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
  if (metric === 'EV') return evN > 0 ? Number((evSum / evN).toFixed(1)) : '-';
  if (metric === 'Stuff+') return stuffPlusN > 0 ? Number((stuffPlusSum / stuffPlusN).toFixed(1)) : '-';
  if (metric === 'QP+') return qpPlusN > 0 ? Number((qpPlusSum / qpPlusN).toFixed(1)) : '-';
  if (metric === 'Ctrl+') return ctrlPlusN > 0 ? Number((ctrlPlusSum / ctrlPlusN).toFixed(1)) : '-';
  if (metric === 'Pitching+') return pitchingPlusN > 0 ? Number((pitchingPlusSum / pitchingPlusN).toFixed(1)) : '-';
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
  if (metric === 'WHIP' || metric === 'ERA' || metric === 'FIP' || metric === 'xFIP' || metric === 'SIERA') {
    const outs = Math.max(0, pa - h - bb - hbp);
    const ip = outs / 3;
    if (ip <= 0) return '-';
    if (metric === 'WHIP') return Number((((bb + h) / ip)).toFixed(2));
    const runsEst = Math.max(0, rv);
    if (metric === 'ERA') return Number((((runsEst * 9) / ip)).toFixed(2));
    const fipConst = 3.2;
    const fip = ((13 * hr) + (3 * (bb + hbp)) - (2 * k)) / ip + fipConst;
    if (metric === 'FIP') return Number(fip.toFixed(2));
    const flyBallsApprox = Math.max(0, inPlay - gb);
    const expHr = flyBallsApprox * 0.13;
    const xFip = ((13 * expHr) + (3 * (bb + hbp)) - (2 * k)) / ip + fipConst;
    if (metric === 'xFIP') return Number(xFip.toFixed(2));
    const kPa = pa > 0 ? k / pa : 0;
    const bbPa = pa > 0 ? bb / pa : 0;
    const gbBip = inPlay > 0 ? gb / inPlay : 0;
    const siera =
      6.145
      - (16.986 * kPa)
      + (11.434 * bbPa)
      - (1.858 * gbBip)
      + (7.653 * kPa * kPa)
      + (6.664 * gbBip * gbBip)
      + (10.130 * kPa * gbBip)
      - (5.195 * bbPa * gbBip);
    return Number(siera.toFixed(2));
  }
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
  if (!['Pitch Types', 'Pitcher Hand', 'Batter Hand', 'Count', 'After Count', 'Inning'].includes(splitByNorm)) {
    return NextResponse.json({ table_rows: [], table_columns: [] });
  }

  const schoolCode = String(url.searchParams.get('school_code') ?? '').trim().toUpperCase();
  if (!schoolCode) return NextResponse.json({ table_rows: [], table_columns: [] });
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
  const pitchTypeSet = new Set(pitchTypes.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const columns = parseCsv(url.searchParams.get('custom_columns'));
  const plusMetrics: PlusMetricKey[] = ['Stuff+', 'QP+', 'Ctrl+', 'Pitching+'].filter((metric) => columns.includes(metric)) as PlusMetricKey[];
  const supportedColumns = new Set([
    '#', 'P', 'PA', 'BF', 'AB', 'AVG', 'OBP', 'SLG', 'OPS', 'H', 'XBH', 'HR', 'HBP', 'BB', 'K', 'Whiffs',
    'Velo', 'Max', 'IVB', 'HB', 'Spin', 'Height', 'Side', 'Ext', 'rTilt',
    'PA', 'Usage', 'Overall', 'InZone%', 'Comp%', 'Strike%', 'FPS%', 'Early%', 'Ahead%', 'E+A%', '1-1W%',
    'FPS(FB)%', 'FPS(OS)%',
    'Swing%', 'Whiff%', 'SwStrk%', 'GB%', 'K%', 'BB%', 'K-BB%', 'CSW%', 'Called-S%', 'Take%', 'Chase%',
    'EV', 'Barrel%', 'xWOBA', 'xISO', 'RV/100', 'PV/100',
    'Stuff+', 'QP+', 'Ctrl+', 'Pitching+',
    'ERA', 'FIP', 'xFIP', 'SIERA', 'WHIP',
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
  add('school_code = ?', schoolCode);
  if (schoolCode === 'PRO' && level !== 'ALL') add('level_bucket = ?', level);
  if (startDate) add('session_date >= ?::date', startDate);
  if (endDate) add('session_date <= ?::date', endDate);
  if (sessionType) add('session_type_bucket = ?', sessionType);
  if (hand) add('pitcherhand_norm = ?', hand);
  if (batterSide) add('batterside_norm = ?', batterSide);
  if (teamCode) add('pitcher_team_code = ?', teamCode);
  if (pitcherNorms.length) add('pitcher_norm = ANY(?::text[])', pitcherNorms);

  const tableRef = schoolCode === 'PRO'
    ? 'public.pro_pitching_heatmap_daily_bins'
    : 'public.pitching_heatmap_daily_bins';

  let result: { rows: AggRow[] };
  try {
    result = await pool.query<AggRow>(
      `
      SELECT
        ${
          splitByNorm === 'Pitcher Hand'
              ? "CASE WHEN pitcherhand_norm <> '' THEN pitcherhand_norm ELSE 'Unknown' END"
              : splitByNorm === 'Batter Hand'
              ? "CASE WHEN batterside_norm <> '' THEN batterside_norm ELSE 'Unknown' END"
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
        SUM(comp_n)::int AS comp_n,
        SUM(fps_den)::int AS fps_den,
        SUM(fps_num)::int AS fps_num,
        SUM(early_den)::int AS early_den,
        SUM(early_num)::int AS early_num,
        SUM(ahead_den)::int AS ahead_den,
        SUM(ahead_num)::int AS ahead_num,
        SUM(ea_den)::int AS ea_den,
        SUM(ea_num)::int AS ea_num,
        SUM(oneone_den)::int AS oneone_den,
        SUM(oneone_num)::int AS oneone_num,
        SUM(chase_n)::int AS chase_n,
        SUM(h_n)::int AS h_n,
        SUM(xbh_n)::int AS xbh_n,
        SUM(hr_n)::int AS hr_n,
        SUM(hbp_n)::int AS hbp_n,
        SUM(fps_fb_den)::int AS fps_fb_den,
        SUM(fps_fb_num)::int AS fps_fb_num,
        SUM(fps_os_den)::int AS fps_os_den,
        SUM(fps_os_num)::int AS fps_os_num,
        SUM(barrel_n)::int AS barrel_n,
        SUM(xiso_sum)::double precision AS xiso_sum,
        SUM(xiso_n)::int AS xiso_n,
        SUM(relspeed_sum)::double precision AS relspeed_sum,
        SUM(relspeed_n)::int AS relspeed_n,
        MAX(relspeed_max)::double precision AS relspeed_max,
        SUM(ivb_sum)::double precision AS ivb_sum,
        SUM(ivb_n)::int AS ivb_n,
        SUM(hb_sum)::double precision AS hb_sum,
        SUM(hb_n)::int AS hb_n,
        SUM(spin_sum)::double precision AS spin_sum,
        SUM(spin_n)::int AS spin_n,
        SUM(relheight_sum)::double precision AS relheight_sum,
        SUM(relheight_n)::int AS relheight_n,
        SUM(relside_sum)::double precision AS relside_sum,
        SUM(relside_n)::int AS relside_n,
        SUM(extension_sum)::double precision AS extension_sum,
        SUM(extension_n)::int AS extension_n,
        SUM(releasetilt_sum)::double precision AS releasetilt_sum,
        SUM(releasetilt_n)::int AS releasetilt_n,
        SUM(stuff_plus_sum)::double precision AS stuff_plus_sum,
        SUM(stuff_plus_n)::int AS stuff_plus_n,
        SUM(qp_plus_sum)::double precision AS qp_plus_sum,
        SUM(qp_plus_n)::int AS qp_plus_n,
        SUM(ctrl_plus_sum)::double precision AS ctrl_plus_sum,
        SUM(ctrl_plus_n)::int AS ctrl_plus_n,
        SUM(pitching_plus_sum)::double precision AS pitching_plus_sum,
        SUM(pitching_plus_n)::int AS pitching_plus_n,
        SUM(k_n)::int AS k_n,
        SUM(bb_n)::int AS bb_n,
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
  } catch (error) {
    const code = String((error as { code?: string } | null)?.code ?? '');
    if (!(schoolCode === 'PRO' && code === '42P01')) throw error;
    result = await pool.query<AggRow>(
      `
      SELECT
        ${
          splitByNorm === 'Pitcher Hand'
              ? "CASE WHEN pitcherhand_norm <> '' THEN pitcherhand_norm ELSE 'Unknown' END"
              : splitByNorm === 'Batter Hand'
              ? "CASE WHEN batterside_norm <> '' THEN batterside_norm ELSE 'Unknown' END"
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
        SUM(comp_n)::int AS comp_n,
        SUM(fps_den)::int AS fps_den,
        SUM(fps_num)::int AS fps_num,
        SUM(early_den)::int AS early_den,
        SUM(early_num)::int AS early_num,
        SUM(ahead_den)::int AS ahead_den,
        SUM(ahead_num)::int AS ahead_num,
        SUM(ea_den)::int AS ea_den,
        SUM(ea_num)::int AS ea_num,
        SUM(oneone_den)::int AS oneone_den,
        SUM(oneone_num)::int AS oneone_num,
        SUM(chase_n)::int AS chase_n,
        SUM(h_n)::int AS h_n,
        SUM(xbh_n)::int AS xbh_n,
        SUM(hr_n)::int AS hr_n,
        SUM(hbp_n)::int AS hbp_n,
        SUM(fps_fb_den)::int AS fps_fb_den,
        SUM(fps_fb_num)::int AS fps_fb_num,
        SUM(fps_os_den)::int AS fps_os_den,
        SUM(fps_os_num)::int AS fps_os_num,
        SUM(barrel_n)::int AS barrel_n,
        SUM(xiso_sum)::double precision AS xiso_sum,
        SUM(xiso_n)::int AS xiso_n,
        SUM(relspeed_sum)::double precision AS relspeed_sum,
        SUM(relspeed_n)::int AS relspeed_n,
        MAX(relspeed_max)::double precision AS relspeed_max,
        SUM(ivb_sum)::double precision AS ivb_sum,
        SUM(ivb_n)::int AS ivb_n,
        SUM(hb_sum)::double precision AS hb_sum,
        SUM(hb_n)::int AS hb_n,
        SUM(spin_sum)::double precision AS spin_sum,
        SUM(spin_n)::int AS spin_n,
        SUM(relheight_sum)::double precision AS relheight_sum,
        SUM(relheight_n)::int AS relheight_n,
        SUM(relside_sum)::double precision AS relside_sum,
        SUM(relside_n)::int AS relside_n,
        SUM(extension_sum)::double precision AS extension_sum,
        SUM(extension_n)::int AS extension_n,
        SUM(releasetilt_sum)::double precision AS releasetilt_sum,
        SUM(releasetilt_n)::int AS releasetilt_n,
        SUM(stuff_plus_sum)::double precision AS stuff_plus_sum,
        SUM(stuff_plus_n)::int AS stuff_plus_n,
        SUM(qp_plus_sum)::double precision AS qp_plus_sum,
        SUM(qp_plus_n)::int AS qp_plus_n,
        SUM(ctrl_plus_sum)::double precision AS ctrl_plus_sum,
        SUM(ctrl_plus_n)::int AS ctrl_plus_n,
        SUM(pitching_plus_sum)::double precision AS pitching_plus_sum,
        SUM(pitching_plus_n)::int AS pitching_plus_n,
        SUM(k_n)::int AS k_n,
        SUM(bb_n)::int AS bb_n,
        SUM(rv_sum)::double precision AS rv_sum,
        SUM(pv_sum)::double precision AS pv_sum,
        SUM(xwoba_sum)::double precision AS xwoba_sum,
        SUM(xwoba_n)::int AS xwoba_n,
        SUM(ev_sum)::double precision AS ev_sum,
        SUM(ev_n)::int AS ev_n
      FROM public.pitching_heatmap_daily_bins
      WHERE ${where.join(' AND ')}
      GROUP BY split_value, pitch_type
    `,
      values
    );
  }

  const filtered = result.rows.filter((row) => {
    if (splitByNorm === 'Pitcher Hand' || splitByNorm === 'Batter Hand' || splitByNorm === 'Count' || splitByNorm === 'After Count' || splitByNorm === 'Inning') return true;
    if (!pitchTypeSet.size) return true;
    return pitchTypeSet.has(String(row.pitch_type ?? '').trim().toLowerCase());
  });
  if (!filtered.length) return NextResponse.json({ table_rows: [], table_columns: [] });

  const splitColumn =
    splitByNorm === 'Pitcher Hand'
      ? 'Pitcher Hand'
      : splitByNorm === 'Batter Hand'
      ? 'Batter Hand'
      : splitByNorm === 'Count'
        ? 'Count'
        : splitByNorm === 'After Count'
          ? 'After Count'
        : splitByNorm === 'Inning'
          ? 'Inning'
          : 'Pitch';
  const tableColumns = [splitColumn, ...(columns.length ? columns : ['PA', 'Usage', 'InZone%', 'Strike%', 'FPS%', 'E+A%', 'SwStrk%', 'Whiff%', 'GB%', 'K%', 'BB%', 'CSW%', 'EV', 'PV/100', 'RV/100'])];
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
      comp_n: acc.comp_n + Number(row.comp_n || 0),
      fps_den: acc.fps_den + Number(row.fps_den || 0),
      fps_num: acc.fps_num + Number(row.fps_num || 0),
      early_den: acc.early_den + Number(row.early_den || 0),
      early_num: acc.early_num + Number(row.early_num || 0),
      ahead_den: acc.ahead_den + Number(row.ahead_den || 0),
      ahead_num: acc.ahead_num + Number(row.ahead_num || 0),
      ea_den: acc.ea_den + Number(row.ea_den || 0),
      ea_num: acc.ea_num + Number(row.ea_num || 0),
      oneone_den: acc.oneone_den + Number(row.oneone_den || 0),
      oneone_num: acc.oneone_num + Number(row.oneone_num || 0),
      chase_n: acc.chase_n + Number(row.chase_n || 0),
      h_n: acc.h_n + Number(row.h_n || 0),
      xbh_n: acc.xbh_n + Number(row.xbh_n || 0),
      hr_n: acc.hr_n + Number(row.hr_n || 0),
      hbp_n: acc.hbp_n + Number(row.hbp_n || 0),
      fps_fb_den: acc.fps_fb_den + Number(row.fps_fb_den || 0),
      fps_fb_num: acc.fps_fb_num + Number(row.fps_fb_num || 0),
      fps_os_den: acc.fps_os_den + Number(row.fps_os_den || 0),
      fps_os_num: acc.fps_os_num + Number(row.fps_os_num || 0),
      barrel_n: acc.barrel_n + Number(row.barrel_n || 0),
      xiso_sum: acc.xiso_sum + Number(row.xiso_sum || 0),
      xiso_n: acc.xiso_n + Number(row.xiso_n || 0),
      relspeed_sum: acc.relspeed_sum + Number(row.relspeed_sum || 0),
      relspeed_n: acc.relspeed_n + Number(row.relspeed_n || 0),
      relspeed_max: Math.max(Number(acc.relspeed_max || 0), Number(row.relspeed_max || 0)),
      ivb_sum: acc.ivb_sum + Number(row.ivb_sum || 0),
      ivb_n: acc.ivb_n + Number(row.ivb_n || 0),
      hb_sum: acc.hb_sum + Number(row.hb_sum || 0),
      hb_n: acc.hb_n + Number(row.hb_n || 0),
      spin_sum: acc.spin_sum + Number(row.spin_sum || 0),
      spin_n: acc.spin_n + Number(row.spin_n || 0),
      relheight_sum: acc.relheight_sum + Number(row.relheight_sum || 0),
      relheight_n: acc.relheight_n + Number(row.relheight_n || 0),
      relside_sum: acc.relside_sum + Number(row.relside_sum || 0),
      relside_n: acc.relside_n + Number(row.relside_n || 0),
      extension_sum: acc.extension_sum + Number(row.extension_sum || 0),
      extension_n: acc.extension_n + Number(row.extension_n || 0),
      releasetilt_sum: acc.releasetilt_sum + Number(row.releasetilt_sum || 0),
      releasetilt_n: acc.releasetilt_n + Number(row.releasetilt_n || 0),
      stuff_plus_sum: acc.stuff_plus_sum + Number(row.stuff_plus_sum || 0),
      stuff_plus_n: acc.stuff_plus_n + Number(row.stuff_plus_n || 0),
      qp_plus_sum: acc.qp_plus_sum + Number(row.qp_plus_sum || 0),
      qp_plus_n: acc.qp_plus_n + Number(row.qp_plus_n || 0),
      ctrl_plus_sum: acc.ctrl_plus_sum + Number(row.ctrl_plus_sum || 0),
      ctrl_plus_n: acc.ctrl_plus_n + Number(row.ctrl_plus_n || 0),
      pitching_plus_sum: acc.pitching_plus_sum + Number(row.pitching_plus_sum || 0),
      pitching_plus_n: acc.pitching_plus_n + Number(row.pitching_plus_n || 0),
      k_n: acc.k_n + Number(row.k_n || 0),
      bb_n: acc.bb_n + Number(row.bb_n || 0),
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
      pitch_n: 0, swing_n: 0, whiff_n: 0, in_play_n: 0, gb_n: 0, cs_n: 0, take_n: 0, pa_n: 0,
      inzone_n: 0, comp_n: 0, fps_den: 0, fps_num: 0, early_den: 0, early_num: 0, ahead_den: 0, ahead_num: 0, ea_den: 0, ea_num: 0, oneone_den: 0, oneone_num: 0,
      chase_n: 0,
      h_n: 0, xbh_n: 0, hr_n: 0, hbp_n: 0,
      fps_fb_den: 0, fps_fb_num: 0, fps_os_den: 0, fps_os_num: 0,
      barrel_n: 0, xiso_sum: 0, xiso_n: 0, relspeed_sum: 0, relspeed_n: 0, relspeed_max: 0, ivb_sum: 0, ivb_n: 0, hb_sum: 0, hb_n: 0, spin_sum: 0, spin_n: 0, relheight_sum: 0, relheight_n: 0, relside_sum: 0, relside_n: 0, extension_sum: 0, extension_n: 0, releasetilt_sum: 0, releasetilt_n: 0, stuff_plus_sum: 0, stuff_plus_n: 0, qp_plus_sum: 0, qp_plus_n: 0, ctrl_plus_sum: 0, ctrl_plus_n: 0, pitching_plus_sum: 0, pitching_plus_n: 0,
      k_n: 0, bb_n: 0,
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

  if (schoolCode === 'PRO' && plusMetrics.length) {
    try {
      const apiBase = resolveDashboardApiBaseUrl();
      const plusUrl = new URL(`${apiBase}/v1/pitching/overview`);
      plusUrl.searchParams.set('school_code', schoolCode);
      plusUrl.searchParams.set('table_mode', 'Custom');
      plusUrl.searchParams.set('custom_columns', plusMetrics.join(','));
      plusUrl.searchParams.set('split_by', splitByNorm);
      plusUrl.searchParams.set('include_chart_points', '0');
      if (startDate) plusUrl.searchParams.set('start_date', startDate);
      if (endDate) plusUrl.searchParams.set('end_date', endDate);
      if (sessionType) plusUrl.searchParams.set('session_type', sessionType);
      if (hand) plusUrl.searchParams.set('hand', hand);
      if (teamCode) plusUrl.searchParams.set('team_type', teamCode);
      if (pitcherList.length) plusUrl.searchParams.set('pitcher', pitcherList.join(','));
      if (pitchTypes.length) plusUrl.searchParams.set('pitch_types', pitchTypes.join(','));
      const plusResp = await fetch(plusUrl.toString(), { cache: 'no-store' });
      const plusPayload = (await plusResp.json().catch(() => ({}))) as { table_rows?: Record<string, unknown>[] };
      const plusRows = Array.isArray(plusPayload.table_rows) ? plusPayload.table_rows : [];
      if (plusRows.length) {
        const bySplit = new Map<string, Record<string, unknown>>();
        for (const pr of plusRows) {
          const splitValue = String(pr[splitColumn] ?? '').trim();
          if (splitValue) bySplit.set(splitValue, pr);
        }
        for (const row of rows) {
          const splitValue = String(row[splitColumn] ?? '').trim();
          if (!splitValue) continue;
          const plusRow = bySplit.get(splitValue);
          if (!plusRow) continue;
          for (const metric of plusMetrics) {
            const val = plusRow[metric];
            row[metric] = typeof val === 'number' || typeof val === 'string' ? val : '-';
          }
        }
      }
    } catch {
      // Keep native rollup values/fallback when hybrid source is unavailable.
    }
  }

  return NextResponse.json({ table_rows: rows, table_columns: tableColumns, chart_points: [], heatmap_points: [] });
}
