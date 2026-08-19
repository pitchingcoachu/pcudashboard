import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from '../../../../../lib/auth-db';
import { resolveDashboardApiBaseUrl } from '../../../../../lib/dashboard-access';
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
  if (!token || ['unknown', 'undefined', 'other', 'untagged', 'na', 'none', 'null'].includes(token)) return 'Undefined';
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
const PITCH_TYPE_ORDER = new Map([
  ['Fastball', 1],
  ['Sinker', 2],
  ['Cutter', 3],
  ['Slider', 4],
  ['Sweeper', 5],
  ['Curveball', 6],
  ['ChangeUp', 7],
  ['Splitter', 8],
  ['Knuckleball', 9],
  ['Undefined', 10],
]);
function pitchTypeSortRank(value: string): number {
  return PITCH_TYPE_ORDER.get(normalizePitchType(value)) ?? 99;
}
const PITCH_TYPE_SQL = `
CASE
  WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') IN ('', 'unknown', 'undefined', 'other', 'untagged', 'na', 'none', 'null') THEN 'Undefined'
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
const VALID_PITCH_TYPE_SQL = "regexp_replace(lower(COALESCE(NULLIF(TRIM(pitch_type), ''), 'undefined')), '[^a-z0-9]', '', 'g') NOT IN ('', 'unknown', 'undefined', 'other', 'untagged', 'na', 'none', 'null')";
const LEAGUE_SCHOOL_EXCLUSION_SQL = "school_code NOT IN ('PRO', 'LEAGUE', 'TRIAL')";
const LEAGUE_ROLLUP_SCOPE_SQL = "school_code = 'LEAGUE'";
const LEAGUE_TEAM_EXCLUSION_SQL = "UPPER(regexp_replace(COALESCE(NULLIF(TRIM(pitcher_team_norm), ''), ''), '[^A-Za-z0-9]', '', 'g')) NOT IN ('TRIAL', 'DASHBOARDTRIAL') AND UPPER(regexp_replace(COALESCE(NULLIF(TRIM(batter_team_norm_eff), ''), ''), '[^A-Za-z0-9]', '', 'g')) NOT IN ('TRIAL', 'DASHBOARDTRIAL')";

// Movement-separation stats (fbCHivbSEP, siSLhbSEP, fbCBtotSEP, etc.) each
// need this pitcher's own average IVB/HB for one specific off-speed pitch
// type relative to their own Fastball or Sinker -- not the row's pooled
// ivb_sum/hb_sum (which mixes every pitch type together). abbr is the short
// code used in the stat key; sqlValues lists every raw pitch_type string
// this abbreviation should match (rollup tables are already normalized to
// these exact names, per a direct DB check, with one legacy league typo
// ('FourSeamFourSeamFastBall') folded into Fastball defensively).
const SEP_PITCH_TYPES: Array<{ abbr: string; sqlValues: string[] }> = [
  { abbr: 'CH', sqlValues: ['ChangeUp'] },
  { abbr: 'SP', sqlValues: ['Splitter'] },
  { abbr: 'CT', sqlValues: ['Cutter'] },
  { abbr: 'SL', sqlValues: ['Slider'] },
  { abbr: 'CB', sqlValues: ['Curveball'] },
  { abbr: 'SW', sqlValues: ['Sweeper'] },
];
const SEP_BASE_TYPES: Array<{ prefix: string; sqlValues: string[] }> = [
  { prefix: 'fb', sqlValues: ['Fastball', 'FourSeamFourSeamFastBall'] },
  { prefix: 'si', sqlValues: ['Sinker'] },
];
// Every AggRow field the SEP stats need, for the allAgg reducer -- kept in
// sync with sepSelectExprsSql()'s column names since both are generated
// from the same SEP_BASE_TYPES/SEP_PITCH_TYPES lists.
const SEP_AGG_FIELD_NAMES: string[] = SEP_BASE_TYPES.flatMap((base) => [
  `sep_${base.prefix}_base_ivb_sum`, `sep_${base.prefix}_base_ivb_n`,
  `sep_${base.prefix}_base_hb_sum`, `sep_${base.prefix}_base_hb_n`,
  sepLeftCountCol(base.prefix, ''), sepRightCountCol(base.prefix, ''),
  ...SEP_PITCH_TYPES.flatMap((off) => [
    `sep_${base.prefix}_${off.abbr.toLowerCase()}_ivb_sum`, `sep_${base.prefix}_${off.abbr.toLowerCase()}_ivb_n`,
    `sep_${base.prefix}_${off.abbr.toLowerCase()}_hb_sum`, `sep_${base.prefix}_${off.abbr.toLowerCase()}_hb_n`,
    sepLeftCountCol(base.prefix, off.abbr), sepRightCountCol(base.prefix, off.abbr),
  ]),
]);
function sepIvbSumCol(prefix: string, abbr: string): string { return `sep_${prefix}_${abbr.toLowerCase()}_ivb_sum`; }
function sepIvbCountCol(prefix: string, abbr: string): string { return `sep_${prefix}_${abbr.toLowerCase()}_ivb_n`; }
function sepHbSumCol(prefix: string, abbr: string): string { return `sep_${prefix}_${abbr.toLowerCase()}_hb_sum`; }
function sepHbCountCol(prefix: string, abbr: string): string { return `sep_${prefix}_${abbr.toLowerCase()}_hb_n`; }
function sepLeftCountCol(prefix: string, abbr: string): string { return `sep_${prefix}_${abbr ? abbr.toLowerCase() : 'base'}_left_n`; }
function sepRightCountCol(prefix: string, abbr: string): string { return `sep_${prefix}_${abbr ? abbr.toLowerCase() : 'base'}_right_n`; }
// One conditional-sum SELECT expression per (base, off-speed) pair, e.g.
// `SUM(ivb_sum) FILTER (WHERE pitch_type = ANY(ARRAY['ChangeUp'])) AS sep_fb_ch_ivb_sum`.
// Shared by every SQL block below so the column set/order can't drift.
//
// handColumn/pitchCountColumn: HB is mirrored (negated for Right, passed
// through for Left) BEFORE the FILTER/SUM -- matching the sign convention
// already established in dashboard_api/app/main.py's hb_adj_sum ("SUM(CASE
// WHEN pitcherthrows_norm = 'Left' THEN hb_sum ELSE -hb_sum END)"). Without
// this, a row that pools pitches from both lefties and righties (Team
// split, or any split coarser than one row per pitcher) would sum HB values
// with opposite real-world sign for a same-shaped pitch, producing
// meaningless separation numbers.
//
// left_n/right_n (per bucket) let the caller detect a single-hand bucket
// and un-mirror back to that pitcher's own natural-hand HB for display --
// mirroring is correct for POOLING across hands, but a lefty's own
// single-pitcher row should still show HB-SEP in their own true release
// direction, not flipped into "righty space".
function sepSelectExprsSql(handColumn: string, pitchCountColumn: string): string {
  const mirroredHb = `(CASE WHEN ${handColumn} = 'Left' THEN hb_sum ELSE -hb_sum END)`;
  const lines: string[] = [];
  for (const base of SEP_BASE_TYPES) {
    const baseList = base.sqlValues.map((v) => `'${v}'`).join(', ');
    lines.push(`SUM(ivb_sum) FILTER (WHERE pitch_type = ANY(ARRAY[${baseList}]))::double precision AS sep_${base.prefix}_base_ivb_sum`);
    lines.push(`SUM(ivb_n) FILTER (WHERE pitch_type = ANY(ARRAY[${baseList}]))::int AS sep_${base.prefix}_base_ivb_n`);
    lines.push(`SUM(${mirroredHb}) FILTER (WHERE pitch_type = ANY(ARRAY[${baseList}]))::double precision AS sep_${base.prefix}_base_hb_sum`);
    lines.push(`SUM(hb_n) FILTER (WHERE pitch_type = ANY(ARRAY[${baseList}]))::int AS sep_${base.prefix}_base_hb_n`);
    lines.push(`SUM(${pitchCountColumn}) FILTER (WHERE pitch_type = ANY(ARRAY[${baseList}]) AND ${handColumn} = 'Left')::int AS ${sepLeftCountCol(base.prefix, '')}`);
    lines.push(`SUM(${pitchCountColumn}) FILTER (WHERE pitch_type = ANY(ARRAY[${baseList}]) AND ${handColumn} = 'Right')::int AS ${sepRightCountCol(base.prefix, '')}`);
    for (const off of SEP_PITCH_TYPES) {
      const offList = off.sqlValues.map((v) => `'${v}'`).join(', ');
      lines.push(`SUM(ivb_sum) FILTER (WHERE pitch_type = ANY(ARRAY[${offList}]))::double precision AS ${sepIvbSumCol(base.prefix, off.abbr)}`);
      lines.push(`SUM(ivb_n) FILTER (WHERE pitch_type = ANY(ARRAY[${offList}]))::int AS ${sepIvbCountCol(base.prefix, off.abbr)}`);
      lines.push(`SUM(${mirroredHb}) FILTER (WHERE pitch_type = ANY(ARRAY[${offList}]))::double precision AS ${sepHbSumCol(base.prefix, off.abbr)}`);
      lines.push(`SUM(hb_n) FILTER (WHERE pitch_type = ANY(ARRAY[${offList}]))::int AS ${sepHbCountCol(base.prefix, off.abbr)}`);
      lines.push(`SUM(${pitchCountColumn}) FILTER (WHERE pitch_type = ANY(ARRAY[${offList}]) AND ${handColumn} = 'Left')::int AS ${sepLeftCountCol(base.prefix, off.abbr)}`);
      lines.push(`SUM(${pitchCountColumn}) FILTER (WHERE pitch_type = ANY(ARRAY[${offList}]) AND ${handColumn} = 'Right')::int AS ${sepRightCountCol(base.prefix, off.abbr)}`);
    }
  }
  return lines.join(',\n        ');
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
// Precomputed rollup bucket columns (session_bucket / session_type_bucket)
// only ever distinguish 'BULLPEN' from everything else -- neither one has a
// real 'LIVE BP' concept, and most schools' raw data never carries a literal
// 'SEASON' tag (only 'Live'/'Bullpen'). So "Season" here has to mean "not
// Bullpen" (matches Live, Season, or anything else non-bullpen) to line up
// with what "Season" means everywhere else in this app; an exact-string
// match against 'SEASON' would silently return zero rows for every real
// school. 'LIVE BP' has no signal in these tables (no opponent/team info
// retained at this aggregation level) so it intentionally matches nothing.
function sessionBucketWhereSql(column: string, sessionType: string, paramIndex: number): string | null {
  if (!sessionType) return null;
  if (sessionType === 'BULLPEN') return `UPPER(${column}) = $${paramIndex}`;
  if (sessionType === 'SEASON') return `UPPER(${column}) <> $${paramIndex}`;
  return '1=0';
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
  xivb_sum: number;
  xhb_sum: number;
  expected_move_n: number;
  divb_sum: number;
  dhb_sum: number;
  tilt_dev_minutes_sum: number;
  tilt_dev_n: number;
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
  k_n: number;
  bb_n: number;
  rv_sum: number;
  pv_sum: number;
  xwoba_sum: number;
  xwoba_n: number;
  ev_sum: number;
  ev_n: number;
  // Movement-separation base points (fastball/sinker's own avg IVB/HB for
  // this same row) plus one ivb/hb sum+count pair per off-speed pitch type,
  // for fbCHivbSEP/siSLhbSEP/fbCBtotSEP-style stats. Keys generated by
  // sepIvbSumCol/sepIvbCountCol/sepHbSumCol/sepHbCountCol above.
  sep_fb_base_ivb_sum: number;
  sep_fb_base_ivb_n: number;
  sep_fb_base_hb_sum: number;
  sep_fb_base_hb_n: number;
  sep_si_base_ivb_sum: number;
  sep_si_base_ivb_n: number;
  sep_si_base_hb_sum: number;
  sep_si_base_hb_n: number;
  sep_fb_ch_ivb_sum: number; sep_fb_ch_ivb_n: number; sep_fb_ch_hb_sum: number; sep_fb_ch_hb_n: number;
  sep_fb_sp_ivb_sum: number; sep_fb_sp_ivb_n: number; sep_fb_sp_hb_sum: number; sep_fb_sp_hb_n: number;
  sep_fb_ct_ivb_sum: number; sep_fb_ct_ivb_n: number; sep_fb_ct_hb_sum: number; sep_fb_ct_hb_n: number;
  sep_fb_sl_ivb_sum: number; sep_fb_sl_ivb_n: number; sep_fb_sl_hb_sum: number; sep_fb_sl_hb_n: number;
  sep_fb_cb_ivb_sum: number; sep_fb_cb_ivb_n: number; sep_fb_cb_hb_sum: number; sep_fb_cb_hb_n: number;
  sep_fb_sw_ivb_sum: number; sep_fb_sw_ivb_n: number; sep_fb_sw_hb_sum: number; sep_fb_sw_hb_n: number;
  sep_si_ch_ivb_sum: number; sep_si_ch_ivb_n: number; sep_si_ch_hb_sum: number; sep_si_ch_hb_n: number;
  sep_si_sp_ivb_sum: number; sep_si_sp_ivb_n: number; sep_si_sp_hb_sum: number; sep_si_sp_hb_n: number;
  sep_si_ct_ivb_sum: number; sep_si_ct_ivb_n: number; sep_si_ct_hb_sum: number; sep_si_ct_hb_n: number;
  sep_si_sl_ivb_sum: number; sep_si_sl_ivb_n: number; sep_si_sl_hb_sum: number; sep_si_sl_hb_n: number;
  sep_si_cb_ivb_sum: number; sep_si_cb_ivb_n: number; sep_si_cb_hb_sum: number; sep_si_cb_hb_n: number;
  sep_si_sw_ivb_sum: number; sep_si_sw_ivb_n: number; sep_si_sw_hb_sum: number; sep_si_sw_hb_n: number;
  // sep_{prefix}_{base|abbr}_left_n / _right_n: per-bucket pitch counts by
  // hand, used to detect a single-hand row and un-mirror HB-SEP back to
  // that pitcher's own natural release direction for display (see
  // sepSelectExprsSql's handColumn/pitchCountColumn params). Accessed
  // dynamically like the sum/count fields above, not hand-typed here.
  [sepHandCountKey: `sep_${string}_left_n` | `sep_${string}_right_n`]: number;
};
type PlusMetricKey = 'Stuff+' | 'Command+' | 'QP+' | 'Ctrl+';

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
  const expectedMoveN = Number(row.expected_move_n || 0);
  const tiltDevN = Number(row.tilt_dev_n || 0);
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
  if (metric === 'xIVB') return expectedMoveN > 0 ? Number((Number(row.xivb_sum || 0) / expectedMoveN).toFixed(1)) : '-';
  if (metric === 'dIVB') return expectedMoveN > 0 ? Number((Number(row.divb_sum || 0) / expectedMoveN).toFixed(1)) : '-';
  if (metric === 'HB') return hbN > 0 ? Number((hbSum / hbN).toFixed(1)) : '-';
  if (metric === 'xHB') return expectedMoveN > 0 ? Number((Number(row.xhb_sum || 0) / expectedMoveN).toFixed(1)) : '-';
  if (metric === 'dHB') return expectedMoveN > 0 ? Number((Number(row.dhb_sum || 0) / expectedMoveN).toFixed(1)) : '-';
  if (metric === 'TiltDev' && tiltDevN > 0) {
    const rounded = Math.round(Number(row.tilt_dev_minutes_sum || 0) / tiltDevN);
    const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
    const absolute = Math.abs(rounded);
    return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}`;
  }
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
  for (const base of SEP_BASE_TYPES) {
    for (const off of SEP_PITCH_TYPES) {
      if (metric !== `${base.prefix}${off.abbr}ivbSEP` && metric !== `${base.prefix}${off.abbr}hbSEP` && metric !== `${base.prefix}${off.abbr}totSEP`) continue;
      const baseIvbSum = Number((row as unknown as Record<string, number>)[`sep_${base.prefix}_base_ivb_sum`] || 0);
      const baseIvbN = Number((row as unknown as Record<string, number>)[`sep_${base.prefix}_base_ivb_n`] || 0);
      const baseHbSum = Number((row as unknown as Record<string, number>)[`sep_${base.prefix}_base_hb_sum`] || 0);
      const baseHbN = Number((row as unknown as Record<string, number>)[`sep_${base.prefix}_base_hb_n`] || 0);
      const offIvbSum = Number((row as unknown as Record<string, number>)[sepIvbSumCol(base.prefix, off.abbr)] || 0);
      const offIvbN = Number((row as unknown as Record<string, number>)[sepIvbCountCol(base.prefix, off.abbr)] || 0);
      const offHbSum = Number((row as unknown as Record<string, number>)[sepHbSumCol(base.prefix, off.abbr)] || 0);
      const offHbN = Number((row as unknown as Record<string, number>)[sepHbCountCol(base.prefix, off.abbr)] || 0);
      if (baseIvbN <= 0 || baseHbN <= 0 || offIvbN <= 0 || offHbN <= 0) return '-';
      const ivbDiff = (baseIvbSum / baseIvbN) - (offIvbSum / offIvbN);
      let hbDiff = (baseHbSum / baseHbN) - (offHbSum / offHbN);
      // hbDiff above is in mirrored space (see sepSelectExprsSql: Left
      // passes through unchanged, Right is negated), correct for pooling
      // across both hands. But if every pitch in both buckets came from the
      // same hand, un-mirror back to that pitcher's own natural release
      // direction for display -- mirroring should only affect POOLED
      // (mixed-hand) rows, not a single pitcher's/single-hand row's own
      // HB-SEP sign. Left is already the natural reference space in this
      // convention, so only an all-RIGHT bucket needs un-flipping.
      const baseLeftN = Number((row as unknown as Record<string, number>)[sepLeftCountCol(base.prefix, '')] || 0);
      const baseRightN = Number((row as unknown as Record<string, number>)[sepRightCountCol(base.prefix, '')] || 0);
      const offLeftN = Number((row as unknown as Record<string, number>)[sepLeftCountCol(base.prefix, off.abbr)] || 0);
      const offRightN = Number((row as unknown as Record<string, number>)[sepRightCountCol(base.prefix, off.abbr)] || 0);
      const allRight = baseLeftN === 0 && offLeftN === 0 && baseRightN > 0 && offRightN > 0;
      if (allRight) hbDiff = -hbDiff;
      if (metric === `${base.prefix}${off.abbr}ivbSEP`) return Number(ivbDiff.toFixed(1));
      if (metric === `${base.prefix}${off.abbr}hbSEP`) return Number(hbDiff.toFixed(1));
      return Number(Math.sqrt((ivbDiff * ivbDiff) + (hbDiff * hbDiff)).toFixed(1));
    }
  }
  if (metric === 'Stuff+') return stuffPlusN > 0 ? Number((stuffPlusSum / stuffPlusN).toFixed(1)) : '-';
  // Command+ has no native rollup SQL computation at all (unlike Stuff+,
  // which has always-zero sum/n placeholders above) -- it's only ever
  // populated by the hybrid /v1/pitching/overview merge below. This
  // placeholder just ensures the column renders something before that
  // merge runs (or if it fails/is unavailable).
  if (metric === 'Command+') return '-';
  if (metric === 'QP+') return qpPlusN > 0 ? Number((qpPlusSum / qpPlusN).toFixed(1)) : '-';
  if (metric === 'Ctrl+') return ctrlPlusN > 0 ? Number((ctrlPlusSum / ctrlPlusN).toFixed(1)) : '-';
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
  const isPitcherArsenalSplit = splitByNorm === 'Pitcher Arsenal';
  const isTeamSplit = splitByNorm === 'Team' || splitByNorm === 'Pitcher Team';
  if (!['Pitch Types', 'Pitcher', 'Pitcher Arsenal', 'Team', 'Pitcher Team', 'Pitcher Hand', 'Batter Hand', 'Count', 'After Count', 'Inning'].includes(splitByNorm)) {
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
  const pitchTypeSet = new Set(pitchTypes.map((value) => normalizePitchType(value).toLowerCase()).filter(Boolean));
  const columns = parseCsv(url.searchParams.get('custom_columns'));
  const defaultColumns = ['#', 'Velo', 'Max', 'IVB', 'HB', 'FPS%', 'E+A%', 'InZone%', 'Strike%', 'Whiff%', 'K%', 'BB%', 'HR%', 'QP+'];
  const plusMetrics: PlusMetricKey[] = ['Stuff+', 'Command+', 'QP+', 'Ctrl+'].filter((metric) => columns.includes(metric)) as PlusMetricKey[];
  const supportedColumns = new Set([
    '#', 'P', 'PA', 'BF', 'AB', 'AVG', 'OBP', 'SLG', 'OPS', 'H', 'XBH', 'HR', 'HBP', 'BB', 'K', 'Whiffs',
    'Velo', 'Max', 'IVB', 'xIVB', 'dIVB', 'HB', 'xHB', 'dHB', 'Spin', 'Height', 'Side', 'Ext', 'rTilt', 'TiltDev',
    'PA', 'Usage', 'Overall', 'InZone%', 'Comp%', 'Strike%', 'FPS%', 'Early%', 'Ahead%', 'E+A%', '1-1W%',
    'FPS(FB)%', 'FPS(OS)%',
    'Swing%', 'Whiff%', 'SwStrk%', 'GB%', 'K%', 'BB%', 'K-BB%', 'CSW%', 'Called-S%', 'Take%', 'Chase%',
    'EV', 'Barrel%', 'xWOBA', 'xISO', 'RV/100', 'PV/100',
    'Stuff+', 'Command+', 'QP+', 'Ctrl+',
    'ERA', 'FIP', 'xFIP', 'SIERA', 'WHIP',
    ...SEP_BASE_TYPES.flatMap((base) => SEP_PITCH_TYPES.flatMap((off) => [
      `${base.prefix}${off.abbr}ivbSEP`,
      `${base.prefix}${off.abbr}hbSEP`,
      `${base.prefix}${off.abbr}totSEP`,
    ])),
  ]);
  if (columns.length && columns.some((col) => !supportedColumns.has(col))) {
    return NextResponse.json({ table_rows: [], table_columns: [] });
  }

  if (schoolCode === 'LEAGUE' && splitByNorm === 'Pitch Types' && columns.length === 0) {
    try {
      const where: string[] = [LEAGUE_ROLLUP_SCOPE_SQL, LEAGUE_TEAM_EXCLUSION_SQL];
      const values: unknown[] = [];
      if (startDate) {
        values.push(startDate);
        where.push(`session_date >= $${values.length}::date`);
      }
      if (endDate) {
        values.push(endDate);
        where.push(`session_date <= $${values.length}::date`);
      }
      if (level !== 'ALL') {
        values.push(level);
        where.push(
          `(UPPER(COALESCE(NULLIF(TRIM(level_bucket), ''), 'UNKNOWN')) = $${values.length} OR NOT EXISTS (
            SELECT 1
            FROM public.pitch_events_daily_rollup_league lvl
            WHERE ${LEAGUE_ROLLUP_SCOPE_SQL}
              AND ${LEAGUE_TEAM_EXCLUSION_SQL}
              AND UPPER(COALESCE(NULLIF(TRIM(level_bucket), ''), 'UNKNOWN')) NOT IN ('ALL', 'UNKNOWN')
          ))`
        );
      }
      if (sessionType) {
        values.push(sessionType);
        const clause = sessionBucketWhereSql('session_bucket', sessionType, values.length);
        if (clause) where.push(clause);
      }
      if (hand) {
        values.push(hand);
        where.push(`pitcherthrows_norm = $${values.length}`);
      }
      if (batterSide) {
        values.push(batterSide);
        where.push(`batterside_norm = $${values.length}`);
      }
      if (teamCode) {
        values.push(teamCode);
        where.push(`pitcher_team_norm = $${values.length}`);
      }
      if (pitcherNorms.length) {
        values.push(pitcherNorms);
        where.push(`pitcher_norm = ANY($${values.length}::text[])`);
      }
      if (pitchTypeSet.size) {
        values.push(Array.from(pitchTypeSet));
        where.push(`LOWER(${PITCH_TYPE_SQL}) = ANY($${values.length}::text[])`);
      }
      const q = `
        SELECT
          ${PITCH_TYPE_SQL} AS pitch,
          SUM(pitches)::int AS pitches,
          SUM(velo_sum)::double precision AS velo_sum,
          SUM(velo_n)::int AS velo_n,
          MAX(velo_max)::double precision AS velo_max,
          SUM(ivb_sum)::double precision AS ivb_sum,
          SUM(ivb_n)::int AS ivb_n,
          SUM(hb_sum)::double precision AS hb_sum,
          SUM(hb_n)::int AS hb_n,
          SUM(bf_n)::int AS pa_n,
          SUM(in_zone_n)::int AS in_zone_n,
          SUM(pitches)::int AS loc_n,
          SUM(comp_n)::int AS comp_n,
          GREATEST(SUM(csw_n)::int - SUM(whiff_n)::int, 0) + SUM(swing_n)::int AS strike_n,
          SUM(fps_num)::int AS fps_num,
          SUM(fps_den)::int AS fps_den,
          SUM(ea_num)::int AS ea_num,
          SUM(ea_den)::int AS ea_den,
          SUM(whiff_n)::int AS whiff_n,
          SUM(swing_n)::int AS swing_n,
          SUM(gb_n)::int AS gb_n,
          SUM(in_play_n)::int AS in_play_n,
          SUM(k_n)::int AS k_n,
          SUM(bb_n)::int AS bb_n,
          SUM(csw_n)::int AS csw_n,
          SUM(ev_sum)::double precision AS ev_sum,
          SUM(ev_n)::int AS ev_n,
          SUM(pv_sum)::double precision AS pv_sum,
          SUM(rv_sum)::double precision AS rv_sum
        FROM public.pitch_events_daily_rollup_league
        WHERE ${where.join(' AND ')}
        GROUP BY 1
      `;
      const agg = await pool.query(q, values);
      if (!agg.rows.length) return NextResponse.json({ table_rows: [], table_columns: [] });
      const tableColumns = ['Pitch', ...defaultColumns];
      const toPct = (n: number, d: number) => (d > 0 ? Number(((100 * n) / d).toFixed(1)) : '-');
      const buildRow = (row: Record<string, unknown>, pitchLabel: string) => {
        const pitches = Number(row.pitches || 0);
        const pa = Number(row.pa_n || 0);
        const swing = Number(row.swing_n || 0);
        const whiff = Number(row.whiff_n || 0);
        const veloN = Number(row.velo_n || 0);
        const ivbN = Number(row.ivb_n || 0);
        const hbN = Number(row.hb_n || 0);
        const qpPct = toRate(Number(row.comp_n || 0), pitches);
        return {
          Pitch: pitchLabel,
          '#': pitches,
          Velo: veloN > 0 ? Number((Number(row.velo_sum || 0) / veloN).toFixed(1)) : '-',
          Max: Number.isFinite(Number(row.velo_max)) ? Number(Number(row.velo_max).toFixed(1)) : '-',
          IVB: ivbN > 0 ? Number((Number(row.ivb_sum || 0) / ivbN).toFixed(1)) : '-',
          HB: hbN > 0 ? Number((Number(row.hb_sum || 0) / hbN).toFixed(1)) : '-',
          'FPS%': toPct(Number(row.fps_num || 0), Number(row.fps_den || 0)),
          'E+A%': toPct(Number(row.ea_num || 0), Number(row.ea_den || 0)),
          'InZone%': toPct(Number(row.in_zone_n || 0), Number(row.loc_n || 0)),
          'Strike%': toPct(Number(row.strike_n || 0), pitches),
          'Whiff%': toPct(whiff, swing),
          'K%': toPct(Number(row.k_n || 0), pa),
          'BB%': toPct(Number(row.bb_n || 0), pa),
          'HR%': toPct(Number(row.hr_n || 0), pa),
          'QP+': qpPct === null ? '-' : Number((qpPct * 1.35).toFixed(1)),
        };
      };
      const rows = agg.rows
        .map((row) => buildRow(row, String(row.pitch || 'Unknown')))
        .sort((a, b) => pitchTypeSortRank(a.Pitch) - pitchTypeSortRank(b.Pitch) || a.Pitch.localeCompare(b.Pitch));
      const allAgg = agg.rows.reduce<Record<string, number>>((acc, row) => {
        for (const key of [
          'pitches', 'velo_sum', 'velo_n', 'ivb_sum', 'ivb_n', 'hb_sum', 'hb_n', 'pa_n', 'in_zone_n', 'loc_n',
          'comp_n', 'strike_n', 'fps_num', 'fps_den', 'ea_num', 'ea_den', 'whiff_n', 'swing_n', 'k_n', 'bb_n',
          'hr_n',
        ]) {
          acc[key] = (acc[key] || 0) + Number(row[key] || 0);
        }
        const veloMax = Number(row.velo_max);
        if (Number.isFinite(veloMax)) acc.velo_max = Math.max(acc.velo_max ?? -Infinity, veloMax);
        return acc;
      }, {});
      if (Number.isFinite(allAgg.velo_max) && rows.length) {
        rows.push(buildRow(allAgg, 'All'));
      }
      return NextResponse.json({ table_rows: rows, table_columns: tableColumns, chart_points: [], heatmap_points: [] });
    } catch {
      return NextResponse.json({ table_rows: [], table_columns: ['Pitch', ...defaultColumns], chart_points: [], heatmap_points: [] });
    }
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
  if (sessionType) {
    values.push(sessionType);
    const clause = sessionBucketWhereSql('session_type_bucket', sessionType, values.length);
    if (clause) where.push(clause);
  }
  if (hand) add('pitcherhand_norm = ?', hand);
  if (batterSide) add('batterside_norm = ?', batterSide);
  if (teamCode) add('pitcher_team_code = ?', teamCode);
  if (pitcherNorms.length) add('pitcher_norm = ANY(?::text[])', pitcherNorms);
  if (pitchTypeSet.size) add('LOWER(pitch_type) = ANY(?::text[])', Array.from(pitchTypeSet));
  add(VALID_PITCH_TYPE_SQL);

  const tableRef = schoolCode === 'PRO'
    ? 'public.pro_pitching_heatmap_daily_bins'
    : 'public.pitching_heatmap_daily_bins';

  let result: { rows: AggRow[] };
  const useProPitcherEventRollup =
    schoolCode === 'PRO' &&
    (splitByNorm === 'Pitcher' || isPitcherArsenalSplit || isTeamSplit) &&
    !batterSide &&
    !teamCode &&
    !pitcherNorms.length;
  const useLeaguePitcherEventRollup =
    schoolCode !== 'PRO' &&
    (splitByNorm === 'Pitcher' || isPitcherArsenalSplit || isTeamSplit) &&
    !batterSide &&
    !teamCode &&
    !pitcherNorms.length;
  if (useProPitcherEventRollup) {
    const eventWhere: string[] = ['school_code = $1'];
    const eventValues: unknown[] = [schoolCode];
    const addEvent = (clause: string, value?: unknown) => {
      if (value === undefined) {
        eventWhere.push(clause);
        return;
      }
      eventValues.push(value);
      eventWhere.push(clause.replace('?', `$${eventValues.length}`));
    };
    if (level !== 'ALL') addEvent('level_bucket = ?', level);
    if (startDate) addEvent('session_date >= ?::date', startDate);
    if (endDate) addEvent('session_date <= ?::date', endDate);
    if (hand) addEvent('pitcherthrows_norm = ?', hand);
    if (pitchTypeSet.size) addEvent('LOWER(pitch_type) = ANY(?::text[])', Array.from(pitchTypeSet));
    addEvent(VALID_PITCH_TYPE_SQL);
    const splitExpr = isTeamSplit
      ? "CASE WHEN pitcher_team_code <> '' THEN pitcher_team_code ELSE 'Unknown' END"
      : "CASE WHEN pitcher_name <> '' THEN pitcher_name ELSE pitcher_norm END";
    const splitGroupExpr = isTeamSplit
      ? "CASE WHEN pitcher_team_code <> '' THEN pitcher_team_code ELSE 'Unknown' END"
      : "pitcher_norm";
    result = await pool.query<AggRow>(
      `
      SELECT
        MIN(${splitExpr}) AS split_value,
        MIN(pitch_type) AS pitch_type,
        SUM(pitches)::int AS pitch_n,
        SUM(swing_n)::int AS swing_n,
        SUM(whiff_n)::int AS whiff_n,
        SUM(in_play_n)::int AS in_play_n,
        SUM(gb_n)::int AS gb_n,
        GREATEST(SUM(csw_n)::int - SUM(whiff_n)::int, 0) AS cs_n,
        GREATEST(SUM(pitches)::int - SUM(swing_n)::int, 0) AS take_n,
        SUM(bf_n)::int AS pa_n,
        SUM(in_zone_n)::int AS inzone_n,
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
        SUM(chase_num)::int AS chase_n,
        (SUM(single_n) + SUM(double_n) + SUM(triple_n) + SUM(hr_n))::int AS h_n,
        (SUM(double_n) + SUM(triple_n) + SUM(hr_n))::int AS xbh_n,
        SUM(hr_n)::int AS hr_n,
        SUM(hbp_n)::int AS hbp_n,
        0::int AS fps_fb_den,
        0::int AS fps_fb_num,
        0::int AS fps_os_den,
        0::int AS fps_os_num,
        SUM(barrel_n)::int AS barrel_n,
        0::double precision AS xiso_sum,
        0::int AS xiso_n,
        SUM(velo_sum)::double precision AS relspeed_sum,
        SUM(velo_n)::int AS relspeed_n,
        MAX(velo_max)::double precision AS relspeed_max,
        SUM(ivb_sum)::double precision AS ivb_sum,
        SUM(ivb_n)::int AS ivb_n,
        SUM(hb_sum)::double precision AS hb_sum,
        SUM(hb_n)::int AS hb_n,
        SUM(xivb_sum)::double precision AS xivb_sum,
        SUM(xhb_sum)::double precision AS xhb_sum,
        SUM(expected_move_n)::int AS expected_move_n,
        SUM(divb_sum)::double precision AS divb_sum,
        SUM(dhb_sum)::double precision AS dhb_sum,
        SUM(tilt_dev_minutes_sum)::double precision AS tilt_dev_minutes_sum,
        SUM(tilt_dev_n)::int AS tilt_dev_n,
        SUM(spin_sum)::double precision AS spin_sum,
        SUM(spin_n)::int AS spin_n,
        SUM(rel_height_sum)::double precision AS relheight_sum,
        SUM(rel_height_n)::int AS relheight_n,
        SUM(rel_side_sum)::double precision AS relside_sum,
        SUM(rel_side_n)::int AS relside_n,
        SUM(ext_sum)::double precision AS extension_sum,
        SUM(ext_n)::int AS extension_n,
        0::double precision AS releasetilt_sum,
        0::int AS releasetilt_n,
        0::double precision AS stuff_plus_sum,
        0::int AS stuff_plus_n,
        SUM(comp_n)::double precision * 135.0 AS qp_plus_sum,
        SUM(pitches)::int AS qp_plus_n,
        0::double precision AS ctrl_plus_sum,
        0::int AS ctrl_plus_n,
        SUM(k_n)::int AS k_n,
        SUM(bb_n)::int AS bb_n,
        SUM(rv_sum)::double precision AS rv_sum,
        SUM(pv_sum)::double precision AS pv_sum,
        SUM(xwoba_sum)::double precision AS xwoba_sum,
        SUM(xwoba_n)::int AS xwoba_n,
        SUM(ev_sum)::double precision AS ev_sum,
        SUM(ev_n)::int AS ev_n,
        ${sepSelectExprsSql('pitcherthrows_norm', 'pitches')}
      FROM public.pro_pitch_events_daily_rollup
      WHERE ${eventWhere.join(' AND ')}
      GROUP BY ${splitGroupExpr}${isPitcherArsenalSplit ? ', pitch_type' : ''}
      `,
      eventValues
    );
  } else if (useLeaguePitcherEventRollup) {
    const eventWhere: string[] = schoolCode === 'LEAGUE'
      ? [LEAGUE_ROLLUP_SCOPE_SQL, LEAGUE_TEAM_EXCLUSION_SQL]
      : ['school_code = $1'];
    const eventValues: unknown[] = schoolCode === 'LEAGUE' ? [] : [schoolCode];
    const addEvent = (clause: string, value?: unknown) => {
      if (value === undefined) {
        eventWhere.push(clause);
        return;
      }
      eventValues.push(value);
      eventWhere.push(clause.replace('?', `$${eventValues.length}`));
    };
    if (startDate) addEvent('session_date >= ?::date', startDate);
    if (endDate) addEvent('session_date <= ?::date', endDate);
    if (schoolCode === 'LEAGUE' && level !== 'ALL') {
      addEvent(
          `(UPPER(COALESCE(NULLIF(TRIM(level_bucket), ''), 'UNKNOWN')) = ? OR NOT EXISTS (
          SELECT 1
          FROM public.pitch_events_daily_rollup_league lvl
          WHERE ${LEAGUE_ROLLUP_SCOPE_SQL}
            AND ${LEAGUE_TEAM_EXCLUSION_SQL}
            AND UPPER(COALESCE(NULLIF(TRIM(level_bucket), ''), 'UNKNOWN')) NOT IN ('ALL', 'UNKNOWN')
        ))`,
        level
      );
    }
    if (sessionType) {
      eventValues.push(sessionType);
      const clause = sessionBucketWhereSql('session_bucket', sessionType, eventValues.length);
      if (clause) eventWhere.push(clause);
    }
    if (hand) addEvent('pitcherthrows_norm = ?', hand);
    if (pitchTypeSet.size) addEvent('LOWER(pitch_type) = ANY(?::text[])', Array.from(pitchTypeSet));
    addEvent(VALID_PITCH_TYPE_SQL);
    const splitExpr = isTeamSplit
      ? "CASE WHEN pitcher_team_norm <> '' THEN pitcher_team_norm ELSE 'Unknown' END"
      : "CASE WHEN pitcher_name <> '' THEN pitcher_name ELSE pitcher_norm END";
    const splitGroupExpr = isTeamSplit
      ? "CASE WHEN pitcher_team_norm <> '' THEN pitcher_team_norm ELSE 'Unknown' END"
      : "pitcher_norm";
    result = await pool.query<AggRow>(
      `
      SELECT
        MIN(${splitExpr}) AS split_value,
        MIN(pitch_type) AS pitch_type,
        SUM(pitches)::int AS pitch_n,
        SUM(swing_n)::int AS swing_n,
        SUM(whiff_n)::int AS whiff_n,
        SUM(in_play_n)::int AS in_play_n,
        SUM(gb_n)::int AS gb_n,
        GREATEST(SUM(csw_n)::int - SUM(whiff_n)::int, 0) AS cs_n,
        GREATEST(SUM(pitches)::int - SUM(swing_n)::int, 0) AS take_n,
        SUM(bf_n)::int AS pa_n,
        SUM(in_zone_n)::int AS inzone_n,
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
        0::int AS chase_n,
        (SUM(single_n) + SUM(double_n) + SUM(triple_n) + SUM(hr_n))::int AS h_n,
        (SUM(double_n) + SUM(triple_n) + SUM(hr_n))::int AS xbh_n,
        SUM(hr_n)::int AS hr_n,
        SUM(hbp_n)::int AS hbp_n,
        0::int AS fps_fb_den,
        0::int AS fps_fb_num,
        0::int AS fps_os_den,
        0::int AS fps_os_num,
        SUM(barrel_n)::int AS barrel_n,
        0::double precision AS xiso_sum,
        0::int AS xiso_n,
        SUM(velo_sum)::double precision AS relspeed_sum,
        SUM(velo_n)::int AS relspeed_n,
        MAX(velo_max)::double precision AS relspeed_max,
        SUM(ivb_sum)::double precision AS ivb_sum,
        SUM(ivb_n)::int AS ivb_n,
        SUM(hb_sum)::double precision AS hb_sum,
        SUM(hb_n)::int AS hb_n,
        SUM(xivb_sum)::double precision AS xivb_sum,
        SUM(xhb_sum)::double precision AS xhb_sum,
        SUM(expected_move_n)::int AS expected_move_n,
        SUM(divb_sum)::double precision AS divb_sum,
        SUM(dhb_sum)::double precision AS dhb_sum,
        SUM(tilt_dev_minutes_sum)::double precision AS tilt_dev_minutes_sum,
        SUM(tilt_dev_n)::int AS tilt_dev_n,
        SUM(spin_sum)::double precision AS spin_sum,
        SUM(spin_n)::int AS spin_n,
        SUM(rel_height_sum)::double precision AS relheight_sum,
        SUM(rel_height_n)::int AS relheight_n,
        SUM(rel_side_sum)::double precision AS relside_sum,
        SUM(rel_side_n)::int AS relside_n,
        SUM(ext_sum)::double precision AS extension_sum,
        SUM(ext_n)::int AS extension_n,
        0::double precision AS releasetilt_sum,
        0::int AS releasetilt_n,
        0::double precision AS stuff_plus_sum,
        0::int AS stuff_plus_n,
        SUM(comp_n)::double precision * 135.0 AS qp_plus_sum,
        SUM(pitches)::int AS qp_plus_n,
        0::double precision AS ctrl_plus_sum,
        0::int AS ctrl_plus_n,
        SUM(k_n)::int AS k_n,
        SUM(bb_n)::int AS bb_n,
        SUM(rv_sum)::double precision AS rv_sum,
        SUM(pv_sum)::double precision AS pv_sum,
        0::double precision AS xwoba_sum,
        0::int AS xwoba_n,
        SUM(ev_sum)::double precision AS ev_sum,
        SUM(ev_n)::int AS ev_n,
        ${sepSelectExprsSql('pitcherthrows_norm', 'pitches')}
      FROM public.pitch_events_daily_rollup_league
      WHERE ${eventWhere.join(' AND ')}
      GROUP BY ${splitGroupExpr}${isPitcherArsenalSplit ? ', pitch_type' : ''}
      `,
      eventValues
    );
  } else try {
    result = await pool.query<AggRow>(
      `
      SELECT
        ${
          splitByNorm === 'Pitcher' || isPitcherArsenalSplit
              ? "CASE WHEN pitcher_norm <> '' THEN pitcher_norm ELSE 'Unknown' END"
              : isTeamSplit
              ? "CASE WHEN pitcher_team_code <> '' THEN pitcher_team_code ELSE 'Unknown' END"
              : splitByNorm === 'Pitcher Hand'
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
        SUM(k_n)::int AS k_n,
        SUM(bb_n)::int AS bb_n,
        SUM(rv_sum)::double precision AS rv_sum,
        SUM(pv_sum)::double precision AS pv_sum,
        SUM(xwoba_sum)::double precision AS xwoba_sum,
        SUM(xwoba_n)::int AS xwoba_n,
        SUM(ev_sum)::double precision AS ev_sum,
        SUM(ev_n)::int AS ev_n,
        ${sepSelectExprsSql('pitcherhand_norm', 'pitch_n')}
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
          splitByNorm === 'Pitcher' || isPitcherArsenalSplit
              ? "CASE WHEN pitcher_norm <> '' THEN pitcher_norm ELSE 'Unknown' END"
              : isTeamSplit
              ? "CASE WHEN pitcher_team_code <> '' THEN pitcher_team_code ELSE 'Unknown' END"
              : splitByNorm === 'Pitcher Hand'
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
        SUM(k_n)::int AS k_n,
        SUM(bb_n)::int AS bb_n,
        SUM(rv_sum)::double precision AS rv_sum,
        SUM(pv_sum)::double precision AS pv_sum,
        SUM(xwoba_sum)::double precision AS xwoba_sum,
        SUM(xwoba_n)::int AS xwoba_n,
        SUM(ev_sum)::double precision AS ev_sum,
        SUM(ev_n)::int AS ev_n,
        ${sepSelectExprsSql('pitcherhand_norm', 'pitch_n')}
      FROM public.pitching_heatmap_daily_bins
      WHERE ${where.join(' AND ')}
      GROUP BY split_value, pitch_type
    `,
      values
    );
  }

  const filtered = result.rows.filter((row) => {
    if (normalizePitchType(String(row.pitch_type ?? '')) === 'Undefined') return false;
    if (splitByNorm === 'Pitcher' || isPitcherArsenalSplit || isTeamSplit || splitByNorm === 'Pitcher Hand' || splitByNorm === 'Batter Hand' || splitByNorm === 'Count' || splitByNorm === 'After Count' || splitByNorm === 'Inning') return true;
    if (!pitchTypeSet.size) return true;
    return pitchTypeSet.has(normalizePitchType(String(row.pitch_type ?? '')).toLowerCase());
  });
  if (!filtered.length) return NextResponse.json({ table_rows: [], table_columns: [] });

  const splitColumn =
    splitByNorm === 'Pitcher' || isPitcherArsenalSplit
      ? 'Pitcher'
      : splitByNorm === 'Team'
      ? 'Team'
      : splitByNorm === 'Pitcher Team'
      ? 'Pitcher Team'
      : splitByNorm === 'Pitcher Hand'
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
  const metricColumns = columns.length ? columns : defaultColumns;
  const tableColumns = [splitColumn, ...(isPitcherArsenalSplit ? ['Pitch'] : []), ...metricColumns];
  const totalPitches = filtered.reduce((sum, row) => sum + Number(row.pitch_n || 0), 0);
  const rows = filtered.map((row) => {
    const out: Record<string, string | number | null> = { [splitColumn]: row.split_value || (row.pitch_type || 'Unknown') };
    if (isPitcherArsenalSplit) out.Pitch = normalizePitchType(String(row.pitch_type ?? ''));
    for (const metric of metricColumns) {
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
      xivb_sum: acc.xivb_sum + Number(row.xivb_sum || 0),
      xhb_sum: acc.xhb_sum + Number(row.xhb_sum || 0),
      expected_move_n: acc.expected_move_n + Number(row.expected_move_n || 0),
      divb_sum: acc.divb_sum + Number(row.divb_sum || 0),
      dhb_sum: acc.dhb_sum + Number(row.dhb_sum || 0),
      tilt_dev_minutes_sum: acc.tilt_dev_minutes_sum + Number(row.tilt_dev_minutes_sum || 0),
      tilt_dev_n: acc.tilt_dev_n + Number(row.tilt_dev_n || 0),
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
      k_n: acc.k_n + Number(row.k_n || 0),
      bb_n: acc.bb_n + Number(row.bb_n || 0),
      rv_sum: acc.rv_sum + Number(row.rv_sum || 0),
      pv_sum: acc.pv_sum + Number(row.pv_sum || 0),
      xwoba_sum: acc.xwoba_sum + Number(row.xwoba_sum || 0),
      xwoba_n: acc.xwoba_n + Number(row.xwoba_n || 0),
      ev_sum: acc.ev_sum + Number(row.ev_sum || 0),
      ev_n: acc.ev_n + Number(row.ev_n || 0),
      ...Object.fromEntries(
        SEP_AGG_FIELD_NAMES.map((field) => [field, Number((acc as unknown as Record<string, number>)[field] || 0) + Number((row as unknown as Record<string, number>)[field] || 0)])
      ),
    } as AggRow),
    {
      split_value: 'All',
      pitch_type: 'All',
      pitch_n: 0, swing_n: 0, whiff_n: 0, in_play_n: 0, gb_n: 0, cs_n: 0, take_n: 0, pa_n: 0,
      inzone_n: 0, comp_n: 0, fps_den: 0, fps_num: 0, early_den: 0, early_num: 0, ahead_den: 0, ahead_num: 0, ea_den: 0, ea_num: 0, oneone_den: 0, oneone_num: 0,
      chase_n: 0,
      h_n: 0, xbh_n: 0, hr_n: 0, hbp_n: 0,
      fps_fb_den: 0, fps_fb_num: 0, fps_os_den: 0, fps_os_num: 0,
      barrel_n: 0, xiso_sum: 0, xiso_n: 0, relspeed_sum: 0, relspeed_n: 0, relspeed_max: 0, ivb_sum: 0, ivb_n: 0, hb_sum: 0, hb_n: 0, xivb_sum: 0, xhb_sum: 0, expected_move_n: 0, divb_sum: 0, dhb_sum: 0, tilt_dev_minutes_sum: 0, tilt_dev_n: 0, spin_sum: 0, spin_n: 0, relheight_sum: 0, relheight_n: 0, relside_sum: 0, relside_n: 0, extension_sum: 0, extension_n: 0, releasetilt_sum: 0, releasetilt_n: 0, stuff_plus_sum: 0, stuff_plus_n: 0, qp_plus_sum: 0, qp_plus_n: 0, ctrl_plus_sum: 0, ctrl_plus_n: 0,
      k_n: 0, bb_n: 0,
      rv_sum: 0, pv_sum: 0, xwoba_sum: 0, xwoba_n: 0, ev_sum: 0, ev_n: 0,
      ...Object.fromEntries(SEP_AGG_FIELD_NAMES.map((field) => [field, 0])),
    } as AggRow
  );
  const allRow: Record<string, string | number | null> = { [splitColumn]: 'All' };
  for (const metric of tableColumns.slice(1)) {
    if (metric === 'Usage' || metric === 'Overall') {
      allRow[metric] = 100;
    } else {
      allRow[metric] = toCell(metric, allAgg);
    }
  }
  if (!isPitcherArsenalSplit) rows.push(allRow);

  // Stuff+/Ctrl+ have no native rollup SQL computation here
  // (their sum/n columns above are always hardcoded to 0) -- this hybrid
  // fetch overlays real values from the same /v1/pitching/overview backend
  // pitching-suite.tsx uses, so both surfaces show identical numbers. This
  // used to run for PRO only, leaving every non-PRO Custom Reports panel
  // showing "-" for these columns; there's nothing PRO-specific about the
  // merge itself; it now runs for any school.
  if (plusMetrics.length) {
    try {
      const apiBase = resolveDashboardApiBaseUrl();
      const plusUrl = new URL(`${apiBase}/v1/pitching/overview`);
      plusUrl.searchParams.set('school_code', schoolCode);
      plusUrl.searchParams.set('table_mode', 'Custom');
      plusUrl.searchParams.set('custom_columns', plusMetrics.join(','));
      plusUrl.searchParams.set('split_by', splitByNorm);
      plusUrl.searchParams.set('include_chart_points', '0');
      if (level && level !== 'ALL') {
        plusUrl.searchParams.set('level', level);
        plusUrl.searchParams.set('stuff2_level', level);
      }
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
