import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { getDbPool, isDatabaseConfigured } from '../../../../../lib/auth-db';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import {
  resolveDashboardPlayerIdentity,
  scopedPlayerQueryName,
  shouldScopeDashboardPlayer,
} from '../../../../../lib/dashboard-player-scope';

export const maxDuration = 60;

const ROLLOUT_DATE = '2026-08-21';
const NUMBER_PATTERN = '[-+]?[0-9]*\\.?[0-9]+';
const BROAD_DETAIL_ROWS_PER_PITCH_TYPE = 250;

type QueryValue = string | number | string[] | null;

type FlightRow = {
  pitch_type: string;
  pitch_count: number | string;
  first_date: string | Date | null;
  last_date: string | Date | null;
  velo: number | string | null;
  spin: number | string | null;
  ivb: number | string | null;
  hb: number | string | null;
  release_height: number | string | null;
  release_side: number | string | null;
  extension: number | string | null;
  plate_height: number | string | null;
  plate_side: number | string | null;
  zone_time: number | string | null;
  x0: number | string | null;
  y0: number | string | null;
  z0: number | string | null;
  vx0: number | string | null;
  vy0: number | string | null;
  vz0: number | string | null;
  ax0: number | string | null;
  ay0: number | string | null;
  az0: number | string | null;
};

type AvailabilityRow = { first_date: string | Date | null; last_date: string | Date | null };

type SpinSampleRow = {
  pitch_type: string;
  pitch_uid: string | null;
  sample_date: string | Date | null;
  pitcher: string | null;
  pitcher_throws: string | null;
  spin_rate: number | string | null;
  active_spin_rate: number | string | null;
  spin_efficiency: number | string | null;
  velocity: number | string | null;
  extension: number | string | null;
  ivb: number | string | null;
  hb: number | string | null;
  measured_tilt: string | null;
  break_tilt: string | null;
  transverse_angle: number | string | null;
  longitudinal_angle: number | string | null;
  axis_x: number | string | null;
  axis_y: number | string | null;
  axis_z: number | string | null;
  rotation_x: number | string | null;
  rotation_y: number | string | null;
  rotation_z: number | string | null;
  source?: string | null;
  confidence?: number | string | null;
  source_url?: string | null;
  coordinate_frame?: string | null;
};

function csvValues(value: string): string[] {
  return value.split(/[;,]/).map((item) => item.trim()).filter((item) => item && item.toLowerCase() !== 'all');
}

function personValues(value: string): string[] {
  // Dashboard multi-selects use semicolons. Commas must remain intact because
  // TrackMan commonly stores names as "Last, First".
  return value.split(';').map((item) => item.trim()).filter((item) => item && item.toLowerCase() !== 'all');
}

function normalizedPerson(value: string): string {
  const trimmed = value.trim();
  const comma = trimmed.indexOf(',');
  const reordered = comma >= 0
    ? `${trimmed.slice(comma + 1).trim()} ${trimmed.slice(0, comma).trim()}`
    : trimmed;
  return reordered.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normalizedPersonSql(column: string): string {
  const trimmed = `TRIM(COALESCE(${column}, ''))`;
  const reordered = `CASE WHEN POSITION(',' IN ${trimmed}) > 0
    THEN CONCAT(TRIM(SPLIT_PART(${trimmed}, ',', 2)), ' ', TRIM(SPLIT_PART(${trimmed}, ',', 1)))
    ELSE ${trimmed} END`;
  return `TRIM(regexp_replace(lower(${reordered}), '[^a-z0-9]+', ' ', 'g'))`;
}

function personParams(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizedPerson).filter(Boolean)));
}

function hasFocusedPitcher(search: URLSearchParams, scopedPitcher: string | null): boolean {
  return Boolean(scopedPitcher) || personValues(search.get('pitcher') ?? '').length === 1;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteLateral(value: unknown, multiplier: number): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : parsed * multiplier;
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function addParam(params: QueryValue[], value: QueryValue): string {
  params.push(value);
  return `$${params.length}`;
}

function textNumber(column: string): string {
  return `(regexp_match(COALESCE(${column}::text, ''), '${NUMBER_PATTERN}'))[1]::double precision`;
}

function countPredicate(balls: string, strikes: string, tokens: string[], params: QueryValue[]): string | null {
  if (!tokens.length) return null;
  const predicates: string[] = [];
  for (const token of tokens) {
    if (/^[0-3]-[0-2]$/.test(token)) {
      const [b, s] = token.split('-').map(Number);
      predicates.push(`(${balls} = ${addParam(params, b)} AND ${strikes} = ${addParam(params, s)})`);
    } else if (token === 'Even') {
      predicates.push(`(${balls}, ${strikes}) IN ((0,0),(1,1),(2,2),(3,2))`);
    } else if (token === 'Behind') {
      predicates.push(`(${balls}, ${strikes}) IN ((1,0),(2,0),(3,0),(3,1),(2,1))`);
    } else if (token === 'Ahead') {
      predicates.push(`(${balls}, ${strikes}) IN ((0,1),(0,2),(1,2))`);
    } else if (token === '2KNF') {
      predicates.push(`(${balls}, ${strikes}) IN ((0,2),(1,2),(2,2))`);
    }
  }
  return predicates.length ? `(${predicates.join(' OR ')})` : null;
}

function zoneLocationPredicates(side: string, height: string, isLefty: string, tokens: string[]): string[] {
  return tokens.map((token) => {
    if (token === 'Upper Half') return `${height} >= 2.55`;
    if (token === 'Bottom Half') return `${height} <= 2.55`;
    if (token === 'Glove Side Half') return `(CASE WHEN ${isLefty} THEN ${side} >= 0 ELSE ${side} <= 0 END)`;
    if (token === 'Arm Side Half') return `(CASE WHEN ${isLefty} THEN ${side} <= 0 ELSE ${side} >= 0 END)`;
    if (token === 'Upper 3rd') return `${height} >= 2.9`;
    if (token === 'Bottom 3rd') return `${height} <= 2.2`;
    if (token === 'Glove Side 3rd') return `(CASE WHEN ${isLefty} THEN ${side} >= 0.2933 ELSE ${side} <= -0.2933 END)`;
    if (token === 'Arm Side 3rd') return `(CASE WHEN ${isLefty} THEN ${side} <= -0.2933 ELSE ${side} >= 0.2933 END)`;
    return 'TRUE';
  });
}

function pitchResultPredicate(column: string, tokens: string[], params: QueryValue[]): string | null {
  if (!tokens.length) return null;
  const normalized = `regexp_replace(lower(COALESCE(${column}, '')), '[^a-z0-9]', '', 'g')`;
  const rawTokens: string[] = [];
  for (const token of tokens) {
    if (token === 'Called Strike') rawTokens.push('calledstrike', 'strikecalled');
    else if (token === 'Ball') rawTokens.push('ball', 'ballcalled', 'ballindirt', 'hitbypitch');
    else if (token === 'Foul') rawTokens.push('foul', 'foulball', 'foultip', 'foulballfieldable', 'foulballnotfieldable');
    else if (token === 'Whiff') rawTokens.push('whiff', 'strikeswinging', 'swingingstrike', 'swingingstrikeblocked');
    else if (token.startsWith('In Play')) rawTokens.push('inplay', 'inplayouts', 'inplaynoout', 'inplayruns');
    else rawTokens.push(token.toLowerCase().replace(/[^a-z0-9]/g, ''));
  }
  return `${normalized} = ANY(${addParam(params, Array.from(new Set(rawTokens)))}::text[])`;
}

function rawPitchTypeSql(): string {
  const token = `regexp_replace(lower(COALESCE(NULLIF(TRIM(pd."TaggedPitchType"), ''), NULLIF(TRIM(pd."AutoPitchType"), ''), '')), '[^a-z0-9]', '', 'g')`;
  return `CASE
    WHEN ${token} IN ('fastball','fourseam','fourseamfastball','fourseamfourseamfastball','4seamfastball','ff','fa') THEN 'Fastball'
    WHEN ${token} IN ('sinker','oneseamfastball','twoseam','twoseamfastball','si','ft') THEN 'Sinker'
    WHEN ${token} IN ('cutter','fc') THEN 'Cutter'
    WHEN ${token} IN ('slider','sl') THEN 'Slider'
    WHEN ${token} IN ('sweeper','st') THEN 'Sweeper'
    WHEN ${token} IN ('curveball','knucklecurve','cu','kc') THEN 'Curveball'
    WHEN ${token} IN ('changeup','ch') THEN 'ChangeUp'
    WHEN ${token} IN ('splitter','splitfinger','splitfingerfastball','sp','fs') THEN 'Splitter'
    WHEN ${token} IN ('knuckleball','kn') THEN 'Knuckleball'
    ELSE COALESCE(NULLIF(TRIM(pd."TaggedPitchType"), ''), NULLIF(TRIM(pd."AutoPitchType"), ''), 'Undefined')
  END`;
}

function proPitchTypeSql(): string {
  const token = `regexp_replace(lower(COALESCE(TRIM(pe.taggedpitchtype), '')), '[^a-z0-9]', '', 'g')`;
  return `CASE
    WHEN ${token} IN ('fastball','fourseam','fourseamfastball','4seamfastball','ff','fa') THEN 'Fastball'
    WHEN ${token} IN ('sinker','oneseamfastball','twoseam','twoseamfastball','si','ft') THEN 'Sinker'
    WHEN ${token} IN ('cutter','fc') THEN 'Cutter'
    WHEN ${token} IN ('slider','sl') THEN 'Slider'
    WHEN ${token} IN ('sweeper','st') THEN 'Sweeper'
    WHEN ${token} IN ('curveball','knucklecurve','cu','kc') THEN 'Curveball'
    WHEN ${token} IN ('changeup','ch') THEN 'ChangeUp'
    WHEN ${token} IN ('splitter','splitfinger','splitfingerfastball','sp','fs') THEN 'Splitter'
    WHEN ${token} IN ('knuckleball','kn') THEN 'Knuckleball'
    ELSE COALESCE(NULLIF(TRIM(pe.taggedpitchtype), ''), 'Undefined')
  END`;
}

function pitchEventPitchTypeSql(): string {
  const token = `regexp_replace(lower(COALESCE(TRIM(pe.taggedpitchtype), '')), '[^a-z0-9]', '', 'g')`;
  return `CASE
    WHEN ${token} IN ('fastball','fourseam','fourseamfastball','4seamfastball','ff','fa') THEN 'Fastball'
    WHEN ${token} IN ('sinker','oneseamfastball','twoseam','twoseamfastball','si','ft') THEN 'Sinker'
    WHEN ${token} IN ('cutter','fc') THEN 'Cutter'
    WHEN ${token} IN ('slider','sl') THEN 'Slider'
    WHEN ${token} IN ('sweeper','st') THEN 'Sweeper'
    WHEN ${token} IN ('curveball','knucklecurve','cu','kc') THEN 'Curveball'
    WHEN ${token} IN ('changeup','ch') THEN 'ChangeUp'
    WHEN ${token} IN ('splitter','splitfinger','splitfingerfastball','sp','fs') THEN 'Splitter'
    WHEN ${token} IN ('knuckleball','kn') THEN 'Knuckleball'
    ELSE COALESCE(NULLIF(TRIM(pe.taggedpitchtype), ''), 'Undefined')
  END`;
}

function serializeRows(rows: FlightRow[], lateralMultiplier = 1) {
  return rows.map((row) => ({
    pitchType: String(row.pitch_type || 'Undefined'),
    pitchCount: Math.max(0, Math.round(finiteNumber(row.pitch_count) ?? 0)),
    firstDate: isoDate(row.first_date),
    lastDate: isoDate(row.last_date),
    velocity: finiteNumber(row.velo),
    spinRate: finiteNumber(row.spin),
    inducedVerticalBreak: finiteNumber(row.ivb),
    horizontalBreak: finiteNumber(row.hb),
    releaseHeight: finiteNumber(row.release_height),
    releaseSide: finiteLateral(row.release_side, lateralMultiplier),
    extension: finiteNumber(row.extension),
    plateHeight: finiteNumber(row.plate_height),
    plateSide: finiteLateral(row.plate_side, lateralMultiplier),
    flightTime: finiteNumber(row.zone_time),
    x0: finiteLateral(row.x0, lateralMultiplier),
    y0: finiteNumber(row.y0),
    z0: finiteNumber(row.z0),
    vx0: finiteNumber(row.vx0),
    vy0: finiteNumber(row.vy0),
    vz0: finiteNumber(row.vz0),
    ax0: finiteNumber(row.ax0),
    ay0: finiteNumber(row.ay0),
    az0: finiteNumber(row.az0),
  }));
}

function serializeIndividualPitches(rows: IndividualPitchRow[], lateralMultiplier = 1) {
  return rows
    .map((row) => ({
      pitchType: String(row.pitch_type || 'Undefined'),
      pitchUid: row.pitch_uid ? String(row.pitch_uid) : null,
      sessionDate: isoDate(row.session_date),
      pitcher: row.pitcher ? String(row.pitcher) : null,
      velocity: finiteNumber(row.velo),
      inducedVerticalBreak: finiteNumber(row.ivb),
      horizontalBreak: finiteNumber(row.hb),
      releaseHeight: finiteNumber(row.release_height),
      releaseSide: finiteLateral(row.release_side, lateralMultiplier),
      extension: finiteNumber(row.extension),
      plateHeight: finiteNumber(row.plate_height),
      plateSide: finiteLateral(row.plate_side, lateralMultiplier),
      flightTime: finiteNumber(row.zone_time),
      x0: finiteLateral(row.x0, lateralMultiplier),
      y0: finiteNumber(row.y0),
      z0: finiteNumber(row.z0),
      vx0: finiteNumber(row.vx0),
      vy0: finiteNumber(row.vy0),
      vz0: finiteNumber(row.vz0),
      ax0: finiteNumber(row.ax0),
      ay0: finiteNumber(row.ay0),
      az0: finiteNumber(row.az0),
    }))
    .filter((row) => row.pitchUid !== null && row.pitchType.toLowerCase() !== 'undefined');
}

function labeledRows(rows: FlightRow[]): FlightRow[] {
  return rows.filter((row) => {
    const pitchType = String(row.pitch_type ?? '').trim();
    return pitchType.length > 0 && pitchType.toLowerCase() !== 'undefined';
  });
}

function serializeSpinSamples(rows: SpinSampleRow[]) {
  return rows.map((row) => ({
    pitchType: String(row.pitch_type || 'Undefined'),
    pitchUid: row.pitch_uid ? String(row.pitch_uid) : null,
    sampleDate: isoDate(row.sample_date),
    pitcher: row.pitcher ? String(row.pitcher) : null,
    pitcherThrows: row.pitcher_throws ? String(row.pitcher_throws) : null,
    spinRate: finiteNumber(row.spin_rate),
    activeSpinRate: finiteNumber(row.active_spin_rate),
    spinEfficiency: finiteNumber(row.spin_efficiency),
    velocity: finiteNumber(row.velocity),
    extension: finiteNumber(row.extension),
    inducedVerticalBreak: finiteNumber(row.ivb),
    horizontalBreak: finiteNumber(row.hb),
    measuredTilt: row.measured_tilt ? String(row.measured_tilt).trim() : null,
    breakTilt: row.break_tilt ? String(row.break_tilt).trim() : null,
    transverseAngle: finiteNumber(row.transverse_angle),
    longitudinalAngle: finiteNumber(row.longitudinal_angle),
    spinAxis: {
      x: finiteNumber(row.axis_x),
      y: finiteNumber(row.axis_y),
      z: finiteNumber(row.axis_z),
    },
    seamRotation: {
      x: finiteNumber(row.rotation_x),
      y: finiteNumber(row.rotation_y),
      z: finiteNumber(row.rotation_z),
    },
    source: row.source === 'edger_video' ? 'edger_video' : 'trackman_measured',
    confidence: finiteNumber(row.confidence),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    coordinateFrame: row.coordinate_frame ? String(row.coordinate_frame) : 'trackman',
  })).filter((row) => (
    row.spinRate !== null
    && row.spinAxis.x !== null && row.spinAxis.y !== null && row.spinAxis.z !== null
    && row.seamRotation.x !== null && row.seamRotation.y !== null && row.seamRotation.z !== null
  ));
}

function mergeFlightRows(groups: FlightRow[][]): FlightRow[] {
  const byType = new Map<string, FlightRow[]>();
  for (const row of groups.flat()) {
    const key = String(row.pitch_type || 'Undefined');
    const current = byType.get(key) ?? [];
    current.push(row);
    byType.set(key, current);
  }
  const numericKeys: Array<keyof FlightRow> = [
    'velo', 'spin', 'ivb', 'hb', 'release_height', 'release_side', 'extension', 'plate_height', 'plate_side',
    'zone_time', 'x0', 'y0', 'z0', 'vx0', 'vy0', 'vz0', 'ax0', 'ay0', 'az0',
  ];
  return Array.from(byType.entries()).map(([pitchType, rows]) => {
    const total = rows.reduce((sum, row) => sum + (finiteNumber(row.pitch_count) ?? 0), 0);
    const merged: FlightRow = {
      pitch_type: pitchType,
      pitch_count: total,
      first_date: rows.map((row) => isoDate(row.first_date)).filter(Boolean).sort()[0] ?? null,
      last_date: rows.map((row) => isoDate(row.last_date)).filter(Boolean).sort().at(-1) ?? null,
      velo: null, spin: null, ivb: null, hb: null, release_height: null, release_side: null, extension: null,
      plate_height: null, plate_side: null, zone_time: null, x0: null, y0: null, z0: null,
      vx0: null, vy0: null, vz0: null, ax0: null, ay0: null, az0: null,
    };
    for (const key of numericKeys) {
      let weighted = 0;
      let weight = 0;
      for (const row of rows) {
        const value = finiteNumber(row[key]);
        const count = finiteNumber(row.pitch_count) ?? 0;
        if (value === null || count <= 0) continue;
        weighted += value * count;
        weight += count;
      }
      merged[key] = (weight > 0 ? weighted / weight : null) as never;
    }
    return merged;
  }).sort((a, b) => {
    const order = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter', 'Knuckleball'];
    return (order.indexOf(a.pitch_type) < 0 ? 99 : order.indexOf(a.pitch_type)) - (order.indexOf(b.pitch_type) < 0 ? 99 : order.indexOf(b.pitch_type));
  });
}

function collegeArsenalWhere(args: {
  schoolCode: string;
  search: URLSearchParams;
  scopedPitcher: string | null;
  params: QueryValue[];
}): string[] {
  const { schoolCode, search, scopedPitcher, params } = args;
  const schoolParam = addParam(params, schoolCode);
  const where = [
    `pd.school_code = ${schoolParam}`,
    `pd."Date" IS NOT NULL`,
    `${textNumber('pd."ZoneTime"')} BETWEEN 0.2 AND 0.9`,
    ...['x0', 'y0', 'z0', 'vx0', 'vy0', 'vz0', 'ax0', 'ay0', 'az0'].map(
      (column) => `${textNumber(`pd."${column}"`)} IS NOT NULL`
    ),
    `pd."Date" >= DATE '${ROLLOUT_DATE}'`,
  ];

  const startDate = search.get('start_date')?.trim();
  const endDate = search.get('end_date')?.trim();
  if (startDate) where.push(`pd."Date" >= ${addParam(params, startDate)}::date`);
  if (endDate) where.push(`pd."Date" <= ${addParam(params, endDate)}::date`);

  const pitchers = scopedPitcher ? [scopedPitcher] : personValues(search.get('pitcher') ?? '');
  if (pitchers.length) where.push(`${normalizedPersonSql('pd."Pitcher"')} = ANY(${addParam(params, personParams(pitchers))}::text[])`);
  const hitters = personValues(search.get('opp_hitter') ?? '');
  if (hitters.length) where.push(`${normalizedPersonSql('pd."Batter"')} = ANY(${addParam(params, personParams(hitters))}::text[])`);
  const pitchTypes = csvValues(search.get('pitch_types') ?? '');
  if (pitchTypes.length) where.push(`${rawPitchTypeSql()} = ANY(${addParam(params, pitchTypes)}::text[])`);
  const ballTypes = csvValues(search.get('ball_types') ?? '');
  if (ballTypes.length && !ballTypes.includes('Baseball')) where.push('FALSE');

  const hand = search.get('hand')?.trim();
  if (hand === 'Left') where.push(`UPPER(LEFT(COALESCE(pd."PitcherThrows", ''), 1)) = 'L'`);
  if (hand === 'Right') where.push(`UPPER(LEFT(COALESCE(pd."PitcherThrows", ''), 1)) = 'R'`);
  const batterSide = search.get('batter_side')?.trim();
  if (batterSide === 'Left') where.push(`UPPER(LEFT(COALESCE(pd."BatterSide", ''), 1)) = 'L'`);
  if (batterSide === 'Right') where.push(`UPPER(LEFT(COALESCE(pd."BatterSide", ''), 1)) = 'R'`);

  const teamType = search.get('team_type')?.trim();
  if (teamType && !['All', 'Opponents', schoolCode].includes(teamType)) {
    where.push(`UPPER(TRIM(COALESCE(pd."PitcherTeam", ''))) = ${addParam(params, teamType.toUpperCase())}`);
  }
  const sessionType = search.get('session_type')?.trim();
  if (sessionType && sessionType !== 'All') {
    where.push(`NULLIF(TRIM(pd."SessionType"), '') = ${addParam(params, sessionType)}`);
  }

  const numericFilters: Array<[string, string]> = [
    ['velo_min', `COALESCE(${textNumber('pd."RelSpeed"')}, -9999)`],
    ['velo_max', `COALESCE(${textNumber('pd."RelSpeed"')}, 9999)`],
    ['ivb_min', `COALESCE(${textNumber('pd."InducedVertBreak"')}, -9999)`],
    ['ivb_max', `COALESCE(${textNumber('pd."InducedVertBreak"')}, 9999)`],
    ['hb_min', `COALESCE(${textNumber('pd."HorzBreak"')}, -9999)`],
    ['hb_max', `COALESCE(${textNumber('pd."HorzBreak"')}, 9999)`],
  ];
  for (const [key, expression] of numericFilters) {
    const value = finiteNumber(search.get(key));
    if (value !== null) where.push(`${expression} ${key.endsWith('_min') ? '>=' : '<='} ${addParam(params, value)}`);
  }
  for (const [key, operator] of [['pc_min', '>='], ['pc_max', '<=']] as const) {
    const value = finiteNumber(search.get(key));
    if (value !== null) where.push(`${textNumber('pd."PitchNo"')} ${operator} ${addParam(params, value)}`);
  }

  const countSql = countPredicate(textNumber('pd."Balls"'), textNumber('pd."Strikes"'), csvValues(search.get('count_filter') ?? ''), params);
  if (countSql) where.push(countSql);
  if (csvValues(search.get('after_count_filter') ?? '').length) where.push('FALSE');

  const plateSide = textNumber('pd."PlateLocSide"');
  const plateHeight = textNumber('pd."PlateLocHeight"');
  const inZone = csvValues(search.get('in_zone') ?? '');
  if (inZone.length) {
    const predicates = inZone.map((token) => {
      if (token === 'Yes') return `(${plateSide} BETWEEN -0.88 AND 0.88 AND ${plateHeight} BETWEEN 1.5 AND 3.6)`;
      if (token === 'No') return `NOT (${plateSide} BETWEEN -0.88 AND 0.88 AND ${plateHeight} BETWEEN 1.5 AND 3.6)`;
      return `(${plateSide} BETWEEN -1.5 AND 1.5 AND ${plateHeight} BETWEEN 1.05 AND 4.05)`;
    });
    where.push(`(${predicates.join(' OR ')})`);
  }
  const zoneLocations = csvValues(search.get('zone_locations') ?? '');
  where.push(...zoneLocationPredicates(plateSide, plateHeight, `UPPER(LEFT(COALESCE(pd."PitcherThrows", ''), 1)) = 'L'`, zoneLocations));
  const qpLocations = search.get('qp_locations')?.trim();
  if (qpLocations === 'Yes') where.push(`${plateSide} BETWEEN -1.5 AND 1.5 AND ${plateHeight} BETWEEN 1.05 AND 4.05`);
  if (qpLocations === 'No') where.push(`NOT (${plateSide} BETWEEN -1.5 AND 1.5 AND ${plateHeight} BETWEEN 1.05 AND 4.05)`);
  const pitchResultSql = pitchResultPredicate('pd."PitchCall"', csvValues(search.get('pitch_results') ?? ''), params);
  if (pitchResultSql) where.push(pitchResultSql);
  return where;
}

async function collegeArsenal(args: {
  schoolCode: string;
  search: URLSearchParams;
  scopedPitcher: string | null;
}): Promise<FlightRow[]> {
  const params: QueryValue[] = [];
  const where = collegeArsenalWhere({ ...args, params });

  const query = `
    WITH filtered AS (
      SELECT pd.*, ${rawPitchTypeSql()} AS pitch_type
      FROM public.pitch_data pd
      WHERE ${where.join('\n        AND ')}
    )
    SELECT
      pitch_type,
      COUNT(*)::int AS pitch_count,
      MIN("Date") AS first_date,
      MAX("Date") AS last_date,
      AVG(${textNumber('"RelSpeed"')}) AS velo,
      AVG(${textNumber('"SpinRate"')}) AS spin,
      AVG(${textNumber('"InducedVertBreak"')}) AS ivb,
      AVG(${textNumber('"HorzBreak"')}) AS hb,
      AVG(${textNumber('"RelHeight"')}) AS release_height,
      AVG(${textNumber('"RelSide"')}) AS release_side,
      AVG(${textNumber('"Extension"')}) AS extension,
      AVG(${textNumber('"PlateLocHeight"')}) AS plate_height,
      AVG(${textNumber('"PlateLocSide"')}) AS plate_side,
      AVG(${textNumber('"ZoneTime"')}) AS zone_time,
      AVG(${textNumber('"x0"')}) AS x0,
      AVG(${textNumber('"y0"')}) AS y0,
      AVG(${textNumber('"z0"')}) AS z0,
      AVG(${textNumber('"vx0"')}) AS vx0,
      AVG(${textNumber('"vy0"')}) AS vy0,
      AVG(${textNumber('"vz0"')}) AS vz0,
      AVG(${textNumber('"ax0"')}) AS ax0,
      AVG(${textNumber('"ay0"')}) AS ay0,
      AVG(${textNumber('"az0"')}) AS az0
    FROM filtered
    GROUP BY pitch_type
    HAVING COUNT(*) > 0
    ORDER BY MIN(CASE pitch_type
      WHEN 'Fastball' THEN 1 WHEN 'Sinker' THEN 2 WHEN 'Cutter' THEN 3 WHEN 'Slider' THEN 4
      WHEN 'Sweeper' THEN 5 WHEN 'Curveball' THEN 6 WHEN 'ChangeUp' THEN 7 WHEN 'Splitter' THEN 8 ELSE 99 END)
  `;
  const result = await getDbPool().query<FlightRow>(query, params);
  return result.rows;
}

type IndividualPitchRow = {
  pitch_type: string;
  pitch_uid: string | null;
  session_date: string | Date | null;
  pitcher: string | null;
  velo: number | string | null;
  ivb: number | string | null;
  hb: number | string | null;
  release_height: number | string | null;
  release_side: number | string | null;
  extension: number | string | null;
  plate_height: number | string | null;
  plate_side: number | string | null;
  zone_time: number | string | null;
  x0: number | string | null;
  y0: number | string | null;
  z0: number | string | null;
  vx0: number | string | null;
  vy0: number | string | null;
  vz0: number | string | null;
  ax0: number | string | null;
  ay0: number | string | null;
  az0: number | string | null;
};

async function collegeArsenalPitches(args: {
  schoolCode: string;
  search: URLSearchParams;
  scopedPitcher: string | null;
}): Promise<IndividualPitchRow[]> {
  const params: QueryValue[] = [];
  const where = collegeArsenalWhere({ ...args, params });
  const focusedPitcher = hasFocusedPitcher(args.search, args.scopedPitcher);
  const detailLimit = focusedPitcher ? null : addParam(params, BROAD_DETAIL_ROWS_PER_PITCH_TYPE);

  const query = `
    WITH ranked AS (
      SELECT
        pd.*,
        ${rawPitchTypeSql()} AS normalized_pitch_type,
        ROW_NUMBER() OVER (
          PARTITION BY ${rawPitchTypeSql()}
          ORDER BY pd."Date" DESC, pd."PitchUID" DESC NULLS LAST
        ) AS detail_rank
      FROM public.pitch_data pd
      WHERE ${where.join('\n        AND ')}
    )
    SELECT
      pd.normalized_pitch_type AS pitch_type,
      NULLIF(TRIM(pd."PitchUID"), '') AS pitch_uid,
      pd."Date" AS session_date,
      NULLIF(TRIM(pd."Pitcher"), '') AS pitcher,
      ${textNumber('pd."RelSpeed"')} AS velo,
      ${textNumber('pd."InducedVertBreak"')} AS ivb,
      ${textNumber('pd."HorzBreak"')} AS hb,
      ${textNumber('pd."RelHeight"')} AS release_height,
      ${textNumber('pd."RelSide"')} AS release_side,
      ${textNumber('pd."Extension"')} AS extension,
      ${textNumber('pd."PlateLocHeight"')} AS plate_height,
      ${textNumber('pd."PlateLocSide"')} AS plate_side,
      ${textNumber('pd."ZoneTime"')} AS zone_time,
      ${textNumber('pd."x0"')} AS x0,
      ${textNumber('pd."y0"')} AS y0,
      ${textNumber('pd."z0"')} AS z0,
      ${textNumber('pd."vx0"')} AS vx0,
      ${textNumber('pd."vy0"')} AS vy0,
      ${textNumber('pd."vz0"')} AS vz0,
      ${textNumber('pd."ax0"')} AS ax0,
      ${textNumber('pd."ay0"')} AS ay0,
      ${textNumber('pd."az0"')} AS az0
    FROM ranked pd
    WHERE (${focusedPitcher ? 'TRUE' : `pd.detail_rank <= ${detailLimit!}`})
    ORDER BY pd."Date" DESC, pd."PitchUID" DESC NULLS LAST
  `;
  const result = await getDbPool().query<IndividualPitchRow>(query, params);
  return result.rows;
}

async function collegeSpinSamples(args: {
  schoolCode: string;
  search: URLSearchParams;
  scopedPitcher: string | null;
}): Promise<SpinSampleRow[]> {
  const { schoolCode, search, scopedPitcher } = args;
  const focusedPitcher = hasFocusedPitcher(search, scopedPitcher);
  const params: QueryValue[] = [];
  const where = [
    `pd.school_code = ${addParam(params, schoolCode)}`,
    `pd."Date" IS NOT NULL`,
    `${textNumber('pd."SpinRate"')} IS NOT NULL`,
    ...['SpinAxis3dVectorX', 'SpinAxis3dVectorY', 'SpinAxis3dVectorZ',
      'SpinAxis3dSeamOrientationRotationX', 'SpinAxis3dSeamOrientationRotationY', 'SpinAxis3dSeamOrientationRotationZ']
      .map((column) => `${textNumber(`pd."${column}"`)} IS NOT NULL`),
  ];

  const startDate = search.get('start_date')?.trim();
  const endDate = search.get('end_date')?.trim();
  if (startDate) where.push(`pd."Date" >= ${addParam(params, startDate)}::date`);
  if (endDate) where.push(`pd."Date" <= ${addParam(params, endDate)}::date`);

  const pitchers = scopedPitcher ? [scopedPitcher] : personValues(search.get('pitcher') ?? '');
  if (pitchers.length) where.push(`${normalizedPersonSql('pd."Pitcher"')} = ANY(${addParam(params, personParams(pitchers))}::text[])`);
  const hitters = personValues(search.get('opp_hitter') ?? '');
  if (hitters.length) where.push(`${normalizedPersonSql('pd."Batter"')} = ANY(${addParam(params, personParams(hitters))}::text[])`);
  const pitchTypes = csvValues(search.get('pitch_types') ?? '');
  if (pitchTypes.length) where.push(`${rawPitchTypeSql()} = ANY(${addParam(params, pitchTypes)}::text[])`);
  const ballTypes = csvValues(search.get('ball_types') ?? '');
  if (ballTypes.length && !ballTypes.includes('Baseball')) where.push('FALSE');
  const hand = search.get('hand')?.trim();
  if (hand === 'Left') where.push(`UPPER(LEFT(COALESCE(pd."PitcherThrows", ''), 1)) = 'L'`);
  if (hand === 'Right') where.push(`UPPER(LEFT(COALESCE(pd."PitcherThrows", ''), 1)) = 'R'`);
  const batterSide = search.get('batter_side')?.trim();
  if (batterSide === 'Left') where.push(`UPPER(LEFT(COALESCE(pd."BatterSide", ''), 1)) = 'L'`);
  if (batterSide === 'Right') where.push(`UPPER(LEFT(COALESCE(pd."BatterSide", ''), 1)) = 'R'`);
  const teamType = search.get('team_type')?.trim();
  if (teamType && !['All', 'Opponents', schoolCode].includes(teamType)) {
    where.push(`UPPER(TRIM(COALESCE(pd."PitcherTeam", ''))) = ${addParam(params, teamType.toUpperCase())}`);
  }
  const sessionType = search.get('session_type')?.trim();
  if (sessionType && sessionType !== 'All') where.push(`NULLIF(TRIM(pd."SessionType"), '') = ${addParam(params, sessionType)}`);

  const numericFilters: Array<[string, string]> = [
    ['velo_min', `COALESCE(${textNumber('pd."RelSpeed"')}, -9999)`],
    ['velo_max', `COALESCE(${textNumber('pd."RelSpeed"')}, 9999)`],
    ['ivb_min', `COALESCE(${textNumber('pd."InducedVertBreak"')}, -9999)`],
    ['ivb_max', `COALESCE(${textNumber('pd."InducedVertBreak"')}, 9999)`],
    ['hb_min', `COALESCE(${textNumber('pd."HorzBreak"')}, -9999)`],
    ['hb_max', `COALESCE(${textNumber('pd."HorzBreak"')}, 9999)`],
  ];
  for (const [key, expression] of numericFilters) {
    const value = finiteNumber(search.get(key));
    if (value !== null) where.push(`${expression} ${key.endsWith('_min') ? '>=' : '<='} ${addParam(params, value)}`);
  }

  const countSql = countPredicate(textNumber('pd."Balls"'), textNumber('pd."Strikes"'), csvValues(search.get('count_filter') ?? ''), params);
  if (countSql) where.push(countSql);
  if (csvValues(search.get('after_count_filter') ?? '').length) where.push('FALSE');

  const plateSide = textNumber('pd."PlateLocSide"');
  const plateHeight = textNumber('pd."PlateLocHeight"');
  const inZone = csvValues(search.get('in_zone') ?? '');
  if (inZone.length) {
    const predicates = inZone.map((token) => {
      if (token === 'Yes') return `(${plateSide} BETWEEN -0.88 AND 0.88 AND ${plateHeight} BETWEEN 1.5 AND 3.6)`;
      if (token === 'No') return `NOT (${plateSide} BETWEEN -0.88 AND 0.88 AND ${plateHeight} BETWEEN 1.5 AND 3.6)`;
      return `(${plateSide} BETWEEN -1.5 AND 1.5 AND ${plateHeight} BETWEEN 1.05 AND 4.05)`;
    });
    where.push(`(${predicates.join(' OR ')})`);
  }
  where.push(...zoneLocationPredicates(plateSide, plateHeight, `UPPER(LEFT(COALESCE(pd."PitcherThrows", ''), 1)) = 'L'`, csvValues(search.get('zone_locations') ?? '')));
  const qpLocations = search.get('qp_locations')?.trim();
  if (qpLocations === 'Yes') where.push(`${plateSide} BETWEEN -1.5 AND 1.5 AND ${plateHeight} BETWEEN 1.05 AND 4.05`);
  if (qpLocations === 'No') where.push(`NOT (${plateSide} BETWEEN -1.5 AND 1.5 AND ${plateHeight} BETWEEN 1.05 AND 4.05)`);
  const pitchResultSql = pitchResultPredicate('pd."PitchCall"', csvValues(search.get('pitch_results') ?? ''), params);
  if (pitchResultSql) where.push(pitchResultSql);

  const withVideo = search.get('with_video')?.trim();
  if (withVideo === 'Yes' || withVideo === 'No') {
    const hasVideo = `COALESCE(
      NULLIF(TRIM(to_jsonb(pd)->>'VideoClip'), ''),
      NULLIF(TRIM(to_jsonb(pd)->>'VideoClip2'), ''),
      NULLIF(TRIM(to_jsonb(pd)->>'VideoClip3'), ''),
      NULLIF(TRIM(to_jsonb(pd)->>'videoclip'), ''),
      NULLIF(TRIM(to_jsonb(pd)->>'videoclip2'), ''),
      NULLIF(TRIM(to_jsonb(pd)->>'videoclip3'), '')
    ) IS NOT NULL`;
    where.push(withVideo === 'Yes' ? hasVideo : `NOT (${hasVideo})`);
  }

  const venue = search.get('venue')?.trim();
  if (venue === 'Home' || venue === 'Away') {
    const half = `LOWER(COALESCE(to_jsonb(pd)->>'InningTopBot', to_jsonb(pd)->>'inningtopbot', ''))`;
    const pitcherTeam = `UPPER(TRIM(COALESCE(pd."PitcherTeam", '')))`;
    const comparisonTeam = venue === 'Home'
      ? `UPPER(TRIM(COALESCE(to_jsonb(pd)->>'HomeTeam', to_jsonb(pd)->>'hometeam', '')))`
      : `UPPER(TRIM(COALESCE(to_jsonb(pd)->>'AwayTeam', to_jsonb(pd)->>'awayteam', '')))`;
    const halfMatch = venue === 'Home' ? `${half} LIKE 'top%'` : `${half} LIKE 'bottom%'`;
    where.push(`(${halfMatch} OR (${pitcherTeam} <> '' AND ${pitcherTeam} = ${comparisonTeam}))`);
  }

  const detailLimit = focusedPitcher ? null : addParam(params, BROAD_DETAIL_ROWS_PER_PITCH_TYPE);
  const query = `
    WITH filtered AS (
      SELECT pd.*, ${rawPitchTypeSql()} AS pitch_type
      FROM public.pitch_data pd
      WHERE ${where.join('\n        AND ')}
    ), ranked AS (
      SELECT filtered.*, ROW_NUMBER() OVER (
        PARTITION BY pitch_type ORDER BY "Date" DESC, "PitchUID" DESC NULLS LAST
      ) AS detail_rank
      FROM filtered
    )
    SELECT
      pitch_type,
      NULLIF(TRIM("PitchUID"), '') AS pitch_uid,
      "Date" AS sample_date,
      NULLIF(TRIM("Pitcher"), '') AS pitcher,
      NULLIF(TRIM("PitcherThrows"), '') AS pitcher_throws,
      ${textNumber('"SpinRate"')} AS spin_rate,
      ${textNumber('"SpinAxis3dActiveSpinRate"')} AS active_spin_rate,
      ${textNumber('"SpinAxis3dSpinEfficiency"')} AS spin_efficiency,
      ${textNumber('"RelSpeed"')} AS velocity,
      ${textNumber('"Extension"')} AS extension,
      ${textNumber('"InducedVertBreak"')} AS ivb,
      ${textNumber('"HorzBreak"')} AS hb,
      NULLIF(TRIM(COALESCE("SpinAxis3dTilt"::text, '')), '') AS measured_tilt,
      NULLIF(TRIM(COALESCE("Tilt"::text, '')), '') AS break_tilt,
      ${textNumber('"SpinAxis3dTransverseAngle"')} AS transverse_angle,
      ${textNumber('"SpinAxis3dLongitudinalAngle"')} AS longitudinal_angle,
      ${textNumber('"SpinAxis3dVectorX"')} AS axis_x,
      ${textNumber('"SpinAxis3dVectorY"')} AS axis_y,
      ${textNumber('"SpinAxis3dVectorZ"')} AS axis_z,
      ${textNumber('"SpinAxis3dSeamOrientationRotationX"')} AS rotation_x,
      ${textNumber('"SpinAxis3dSeamOrientationRotationY"')} AS rotation_y,
      ${textNumber('"SpinAxis3dSeamOrientationRotationZ"')} AS rotation_z
    FROM ranked
    WHERE lower(COALESCE(pitch_type, '')) <> 'undefined'
      AND (${focusedPitcher ? 'TRUE' : `detail_rank <= ${detailLimit!}`})
    ORDER BY pitch_type, "Date" DESC, "PitchUID" DESC NULLS LAST
  `;
  const result = await getDbPool().query<SpinSampleRow>(query, params);
  return result.rows;
}

async function collegeVideoSpinSamples(args: {
  schoolCode: string;
  search: URLSearchParams;
  scopedPitcher: string | null;
}): Promise<SpinSampleRow[]> {
  const { schoolCode, search, scopedPitcher } = args;
  const focusedPitcher = hasFocusedPitcher(search, scopedPitcher);
  const params: QueryValue[] = [];
  const where = [
    `vse.school_code = ${addParam(params, schoolCode)}`,
    `vse.status = 'accepted'`,
    `pe.session_date IS NOT NULL`,
    `${textNumber('pe.spinrate')} IS NOT NULL`,
  ];
  const startDate = search.get('start_date')?.trim();
  const endDate = search.get('end_date')?.trim();
  if (startDate) where.push(`pe.session_date >= ${addParam(params, startDate)}::date`);
  if (endDate) where.push(`pe.session_date <= ${addParam(params, endDate)}::date`);
  const pitchers = scopedPitcher ? [scopedPitcher] : personValues(search.get('pitcher') ?? '');
  if (pitchers.length) where.push(`${normalizedPersonSql('pe.pitcher')} = ANY(${addParam(params, personParams(pitchers))}::text[])`);
  const hitters = personValues(search.get('opp_hitter') ?? '');
  if (hitters.length) where.push(`${normalizedPersonSql('pe.batter')} = ANY(${addParam(params, personParams(hitters))}::text[])`);
  const pitchTypes = csvValues(search.get('pitch_types') ?? '');
  if (pitchTypes.length) where.push(`${pitchEventPitchTypeSql()} = ANY(${addParam(params, pitchTypes)}::text[])`);
  const hand = search.get('hand')?.trim();
  if (hand === 'Left') where.push(`UPPER(LEFT(COALESCE(pe.pitcherthrows, ''), 1)) = 'L'`);
  if (hand === 'Right') where.push(`UPPER(LEFT(COALESCE(pe.pitcherthrows, ''), 1)) = 'R'`);
  const batterSide = search.get('batter_side')?.trim();
  if (batterSide === 'Left') where.push(`UPPER(LEFT(COALESCE(pe.batterside, ''), 1)) = 'L'`);
  if (batterSide === 'Right') where.push(`UPPER(LEFT(COALESCE(pe.batterside, ''), 1)) = 'R'`);
  const sessionType = search.get('session_type')?.trim();
  if (sessionType && sessionType !== 'All') {
    where.push(`NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'sessiontype', to_jsonb(pe)->>'SessionType', '')), '') = ${addParam(params, sessionType)}`);
  }
  const ballTypes = csvValues(search.get('ball_types') ?? '');
  if (ballTypes.length && !ballTypes.includes('Baseball')) where.push('FALSE');
  for (const [key, column] of [
    ['velo_min', 'pe.relspeed'], ['velo_max', 'pe.relspeed'],
    ['ivb_min', 'pe.inducedvertbreak'], ['ivb_max', 'pe.inducedvertbreak'],
    ['hb_min', 'pe.horzbreak'], ['hb_max', 'pe.horzbreak'],
  ] as const) {
    const value = finiteNumber(search.get(key));
    if (value !== null) where.push(`COALESCE(${textNumber(column)}, ${key.endsWith('_min') ? '-9999' : '9999'}) ${key.endsWith('_min') ? '>=' : '<='} ${addParam(params, value)}`);
  }
  const countSql = countPredicate(textNumber('pe.balls'), textNumber('pe.strikes'), csvValues(search.get('count_filter') ?? ''), params);
  if (countSql) where.push(countSql);
  if (csvValues(search.get('after_count_filter') ?? '').length) where.push('FALSE');
  const inZone = csvValues(search.get('in_zone') ?? '');
  if (inZone.length) {
    const predicates = inZone.map((token) => {
      if (token === 'Yes') return `(${textNumber('pe.platelocside')} BETWEEN -0.88 AND 0.88 AND ${textNumber('pe.platelocheight')} BETWEEN 1.5 AND 3.6)`;
      if (token === 'No') return `NOT (${textNumber('pe.platelocside')} BETWEEN -0.88 AND 0.88 AND ${textNumber('pe.platelocheight')} BETWEEN 1.5 AND 3.6)`;
      return `(${textNumber('pe.platelocside')} BETWEEN -1.5 AND 1.5 AND ${textNumber('pe.platelocheight')} BETWEEN 1.05 AND 4.05)`;
    });
    where.push(`(${predicates.join(' OR ')})`);
  }
  where.push(...zoneLocationPredicates(textNumber('pe.platelocside'), textNumber('pe.platelocheight'), `UPPER(LEFT(COALESCE(pe.pitcherthrows, ''), 1)) = 'L'`, csvValues(search.get('zone_locations') ?? '')));
  const qpLocations = search.get('qp_locations')?.trim();
  if (qpLocations === 'Yes') where.push(`${textNumber('pe.platelocside')} BETWEEN -1.5 AND 1.5 AND ${textNumber('pe.platelocheight')} BETWEEN 1.05 AND 4.05`);
  if (qpLocations === 'No') where.push(`NOT (${textNumber('pe.platelocside')} BETWEEN -1.5 AND 1.5 AND ${textNumber('pe.platelocheight')} BETWEEN 1.05 AND 4.05)`);
  const pitchResultSql = pitchResultPredicate('pe.pitchcall', csvValues(search.get('pitch_results') ?? ''), params);
  if (pitchResultSql) where.push(pitchResultSql);
  const withVideo = search.get('with_video')?.trim();
  if (withVideo === 'No') where.push('FALSE');

  const detailLimit = focusedPitcher ? null : addParam(params, BROAD_DETAIL_ROWS_PER_PITCH_TYPE);
  const query = `
    WITH filtered AS (
      SELECT
        vse.*, pe.*, ${pitchEventPitchTypeSql()} AS normalized_pitch_type,
        ROW_NUMBER() OVER (
          PARTITION BY ${pitchEventPitchTypeSql()}
          ORDER BY pe.session_date DESC, pe.id DESC
        ) AS detail_rank
      FROM public.video_spin_estimates vse
      JOIN public.pitch_events pe ON pe.id = vse.pitch_event_id
      WHERE ${where.join('\n        AND ')}
    )
    SELECT
      normalized_pitch_type AS pitch_type,
      COALESCE(NULLIF(TRIM(vse.pitch_uid), ''), NULLIF(TRIM(pitchuid), '')) AS pitch_uid,
      session_date AS sample_date,
      NULLIF(TRIM(pitcher), '') AS pitcher,
      NULLIF(TRIM(pitcherthrows), '') AS pitcher_throws,
      ${textNumber('spinrate')} AS spin_rate,
      CASE WHEN ${textNumber('spinefficiency')} IS NULL THEN NULL ELSE ${textNumber('spinrate')} * ${textNumber('spinefficiency')} END AS active_spin_rate,
      ${textNumber('spinefficiency')} AS spin_efficiency,
      ${textNumber('relspeed')} AS velocity,
      ${textNumber('extension')} AS extension,
      ${textNumber('inducedvertbreak')} AS ivb,
      ${textNumber('horzbreak')} AS hb,
      NULLIF(TRIM(COALESCE(releasetilt, '')), '') AS measured_tilt,
      NULLIF(TRIM(COALESCE(breaktilt, '')), '') AS break_tilt,
      NULL::double precision AS transverse_angle,
      NULL::double precision AS longitudinal_angle,
      axis_x, axis_y, axis_z,
      rotation_x, rotation_y, rotation_z,
      'edger_video'::text AS source,
      confidence,
      source_url,
      coordinate_frame
    FROM filtered vse
    WHERE lower(COALESCE(normalized_pitch_type, '')) <> 'undefined'
      AND (${focusedPitcher ? 'TRUE' : `detail_rank <= ${detailLimit!}`})
    ORDER BY normalized_pitch_type, sample_date DESC, pitch_event_id DESC
  `;
  const result = await getDbPool().query<SpinSampleRow>(query, params);
  return result.rows;
}

function backfillArsenalWhere(args: {
  schoolCode: string;
  search: URLSearchParams;
  scopedPitcher: string | null;
  params: QueryValue[];
}): string[] {
  const { schoolCode, search, scopedPitcher, params } = args;
  const schoolParam = addParam(params, schoolCode);
  const where = [
    `bf.school_code = ${schoolParam}`,
    // zone_time has no source column on pitch_events (see syncPitchEvents in
    // lib/pitch-flight-sync.ts, which always inserts it NULL), so rows synced
    // from there would otherwise be silently excluded by a hard
    // "BETWEEN 0.2 AND 0.9" check -- accept a NULL zone_time too, matching
    // the frontend's own fallback (durationForPitch solves flight time from
    // vy0/ay0 when flightTime is null instead of using this column).
    `(bf.zone_time BETWEEN 0.2 AND 0.9 OR bf.zone_time IS NULL)`,
    `bf.x0 IS NOT NULL AND bf.y0 IS NOT NULL AND bf.z0 IS NOT NULL`,
    `bf.vx0 IS NOT NULL AND bf.vy0 IS NOT NULL AND bf.vz0 IS NOT NULL`,
    `bf.ax0 IS NOT NULL AND bf.ay0 IS NOT NULL AND bf.az0 IS NOT NULL`,
    // New pitch_data rows are queried directly above. Keep their mirrored sync
    // copy from counting a pitch twice while retaining VMI and local-file rows.
    `NOT (bf.source_file = 'pitch_data' AND bf.session_date >= DATE '${ROLLOUT_DATE}')`,
  ];
  const startDate = search.get('start_date')?.trim();
  const endDate = search.get('end_date')?.trim();
  if (startDate) where.push(`bf.session_date >= ${addParam(params, startDate)}::date`);
  if (endDate) where.push(`bf.session_date <= ${addParam(params, endDate)}::date`);
  const pitchers = scopedPitcher ? [scopedPitcher] : personValues(search.get('pitcher') ?? '');
  if (pitchers.length) where.push(`${normalizedPersonSql('bf.pitcher')} = ANY(${addParam(params, personParams(pitchers))}::text[])`);
  const hitters = personValues(search.get('opp_hitter') ?? '');
  if (hitters.length) where.push(`${normalizedPersonSql('bf.batter')} = ANY(${addParam(params, personParams(hitters))}::text[])`);
  const pitchTypes = csvValues(search.get('pitch_types') ?? '');
  if (pitchTypes.length) where.push(`bf.pitch_type = ANY(${addParam(params, pitchTypes)}::text[])`);
  const ballTypes = csvValues(search.get('ball_types') ?? '');
  if (ballTypes.length) where.push(`COALESCE(bf.ball_type, 'Baseball') = ANY(${addParam(params, ballTypes)}::text[])`);
  const hand = search.get('hand')?.trim();
  if (hand === 'Left') where.push(`UPPER(LEFT(COALESCE(bf.pitcher_throws, ''), 1)) = 'L'`);
  if (hand === 'Right') where.push(`UPPER(LEFT(COALESCE(bf.pitcher_throws, ''), 1)) = 'R'`);
  const batterSide = search.get('batter_side')?.trim();
  if (batterSide === 'Left') where.push(`UPPER(LEFT(COALESCE(bf.batter_side, ''), 1)) = 'L'`);
  if (batterSide === 'Right') where.push(`UPPER(LEFT(COALESCE(bf.batter_side, ''), 1)) = 'R'`);
  const teamType = search.get('team_type')?.trim();
  if (teamType && !['All', 'Opponents', schoolCode].includes(teamType)) where.push(`UPPER(COALESCE(bf.pitcher_team, '')) = ${addParam(params, teamType.toUpperCase())}`);
  const sessionType = search.get('session_type')?.trim();
  if (sessionType && sessionType !== 'All') where.push(`bf.session_type = ${addParam(params, sessionType)}`);
  for (const [key, column] of [['velo_min', 'bf.velocity'], ['velo_max', 'bf.velocity'], ['ivb_min', 'bf.ivb'], ['ivb_max', 'bf.ivb'], ['hb_min', 'bf.hb'], ['hb_max', 'bf.hb']] as const) {
    const value = finiteNumber(search.get(key));
    if (value !== null) where.push(`${column} ${key.endsWith('_min') ? '>=' : '<='} ${addParam(params, value)}`);
  }
  const backfillCountSql = countPredicate('bf.balls', 'bf.strikes', csvValues(search.get('count_filter') ?? ''), params);
  if (backfillCountSql) where.push(backfillCountSql);
  if (csvValues(search.get('after_count_filter') ?? '').length) where.push('FALSE');
  const inZone = csvValues(search.get('in_zone') ?? '');
  if (inZone.length) {
    const predicates = inZone.map((token) => {
      if (token === 'Yes') return `(bf.plate_side BETWEEN -0.88 AND 0.88 AND bf.plate_height BETWEEN 1.5 AND 3.6)`;
      if (token === 'No') return `NOT (bf.plate_side BETWEEN -0.88 AND 0.88 AND bf.plate_height BETWEEN 1.5 AND 3.6)`;
      return `(bf.plate_side BETWEEN -1.5 AND 1.5 AND bf.plate_height BETWEEN 1.05 AND 4.05)`;
    });
    where.push(`(${predicates.join(' OR ')})`);
  }
  where.push(...zoneLocationPredicates('bf.plate_side', 'bf.plate_height', `UPPER(LEFT(COALESCE(bf.pitcher_throws, ''), 1)) = 'L'`, csvValues(search.get('zone_locations') ?? '')));
  const qpLocations = search.get('qp_locations')?.trim();
  if (qpLocations === 'Yes') where.push(`bf.plate_side BETWEEN -1.5 AND 1.5 AND bf.plate_height BETWEEN 1.05 AND 4.05`);
  if (qpLocations === 'No') where.push(`NOT (bf.plate_side BETWEEN -1.5 AND 1.5 AND bf.plate_height BETWEEN 1.05 AND 4.05)`);
  const pitchResultSql = pitchResultPredicate('bf.pitch_call', csvValues(search.get('pitch_results') ?? ''), params);
  if (pitchResultSql) where.push(pitchResultSql);
  return where;
}

async function backfillArsenal(args: { schoolCode: string; search: URLSearchParams; scopedPitcher: string | null }): Promise<FlightRow[]> {
  const params: QueryValue[] = [];
  const where = backfillArsenalWhere({ ...args, params });
  const query = `
    SELECT pitch_type, COUNT(*)::int AS pitch_count, MIN(session_date) AS first_date, MAX(session_date) AS last_date,
      AVG(velocity) AS velo, AVG(spin_rate) AS spin, AVG(ivb) AS ivb, AVG(hb) AS hb,
      AVG(release_height) AS release_height, AVG(release_side) AS release_side, AVG(extension) AS extension,
      AVG(plate_height) AS plate_height, AVG(plate_side) AS plate_side, AVG(zone_time) AS zone_time,
      AVG(x0) AS x0, AVG(y0) AS y0, AVG(z0) AS z0, AVG(vx0) AS vx0, AVG(vy0) AS vy0,
      AVG(vz0) AS vz0, AVG(ax0) AS ax0, AVG(ay0) AS ay0, AVG(az0) AS az0
    FROM public.pitch_flight_backfill bf
    WHERE ${where.join('\n      AND ')}
    GROUP BY pitch_type
  `;
  const result = await getDbPool().query<FlightRow>(query, params);
  return result.rows;
}

async function backfillArsenalPitches(args: {
  schoolCode: string;
  search: URLSearchParams;
  scopedPitcher: string | null;
}): Promise<IndividualPitchRow[]> {
  const params: QueryValue[] = [];
  const where = backfillArsenalWhere({ ...args, params });
  const focusedPitcher = hasFocusedPitcher(args.search, args.scopedPitcher);
  const detailLimit = focusedPitcher ? null : addParam(params, BROAD_DETAIL_ROWS_PER_PITCH_TYPE);
  const query = `
    WITH ranked AS (
      SELECT bf.*, ROW_NUMBER() OVER (
        PARTITION BY pitch_type ORDER BY session_date DESC, pitch_uid DESC NULLS LAST
      ) AS detail_rank
      FROM public.pitch_flight_backfill bf
      WHERE ${where.join('\n        AND ')}
    )
    SELECT
      pitch_type, pitch_uid, session_date, pitcher,
      velocity AS velo, ivb, hb, release_height, release_side, extension,
      plate_height, plate_side, zone_time, x0, y0, z0, vx0, vy0, vz0, ax0, ay0, az0
    FROM ranked bf
    WHERE (${focusedPitcher ? 'TRUE' : `bf.detail_rank <= ${detailLimit!}`})
    ORDER BY session_date DESC, pitch_uid DESC NULLS LAST
  `;
  const result = await getDbPool().query<IndividualPitchRow>(query, params);
  return result.rows;
}

async function proArsenal(search: URLSearchParams): Promise<FlightRow[]> {
  const params: QueryValue[] = [];
  const where = [
    `pe.school_code = 'PRO'`,
    `pe.session_date IS NOT NULL`,
    `pe.vx0 IS NOT NULL`, `pe.vy0 IS NOT NULL`, `pe.vz0 IS NOT NULL`,
    `pe.ax IS NOT NULL`, `pe.ay IS NOT NULL`, `pe.az IS NOT NULL`,
  ];
  const startDate = search.get('start_date')?.trim();
  const endDate = search.get('end_date')?.trim();
  if (startDate) where.push(`pe.session_date >= ${addParam(params, startDate)}::date`);
  if (endDate) where.push(`pe.session_date <= ${addParam(params, endDate)}::date`);
  const pitchers = personValues(search.get('pitcher') ?? '');
  if (pitchers.length) where.push(`${normalizedPersonSql('pe.pitcher')} = ANY(${addParam(params, personParams(pitchers))}::text[])`);
  const pitchTypes = csvValues(search.get('pitch_types') ?? '');
  if (pitchTypes.length) where.push(`${proPitchTypeSql()} = ANY(${addParam(params, pitchTypes)}::text[])`);
  const hand = search.get('hand')?.trim();
  if (hand === 'Left') where.push(`UPPER(LEFT(COALESCE(pe.pitcherthrows, ''), 1)) = 'L'`);
  if (hand === 'Right') where.push(`UPPER(LEFT(COALESCE(pe.pitcherthrows, ''), 1)) = 'R'`);
  const batterSide = search.get('batter_side')?.trim();
  if (batterSide === 'Left') where.push(`UPPER(LEFT(COALESCE(pe.batterside, ''), 1)) = 'L'`);
  if (batterSide === 'Right') where.push(`UPPER(LEFT(COALESCE(pe.batterside, ''), 1)) = 'R'`);
  for (const [key, column] of [['velo_min', 'pe.relspeed'], ['velo_max', 'pe.relspeed'], ['ivb_min', 'pe.inducedvertbreak'], ['ivb_max', 'pe.inducedvertbreak'], ['hb_min', 'pe.horzbreak'], ['hb_max', 'pe.horzbreak']] as const) {
    const value = finiteNumber(search.get(key));
    if (value !== null) where.push(`${column} ${key.endsWith('_min') ? '>=' : '<='} ${addParam(params, value)}`);
  }
  const proCountSql = countPredicate('pe.balls', 'pe.strikes', csvValues(search.get('count_filter') ?? ''), params);
  if (proCountSql) where.push(proCountSql);
  if (csvValues(search.get('after_count_filter') ?? '').length) where.push('FALSE');
  const proInZone = csvValues(search.get('in_zone') ?? '');
  if (proInZone.length) {
    const predicates = proInZone.map((token) => {
      if (token === 'Yes') return `(pe.platelocside BETWEEN -0.88 AND 0.88 AND pe.platelocheight BETWEEN 1.5 AND 3.6)`;
      if (token === 'No') return `NOT (pe.platelocside BETWEEN -0.88 AND 0.88 AND pe.platelocheight BETWEEN 1.5 AND 3.6)`;
      return `(pe.platelocside BETWEEN -1.5 AND 1.5 AND pe.platelocheight BETWEEN 1.05 AND 4.05)`;
    });
    where.push(`(${predicates.join(' OR ')})`);
  }
  where.push(...zoneLocationPredicates('pe.platelocside', 'pe.platelocheight', `UPPER(LEFT(COALESCE(pe.pitcherthrows, ''), 1)) = 'L'`, csvValues(search.get('zone_locations') ?? '')));
  const proQpLocations = search.get('qp_locations')?.trim();
  if (proQpLocations === 'Yes') where.push(`pe.platelocside BETWEEN -1.5 AND 1.5 AND pe.platelocheight BETWEEN 1.05 AND 4.05`);
  if (proQpLocations === 'No') where.push(`NOT (pe.platelocside BETWEEN -1.5 AND 1.5 AND pe.platelocheight BETWEEN 1.05 AND 4.05)`);
  const proResultSql = pitchResultPredicate('pe.pitchcall', csvValues(search.get('pitch_results') ?? ''), params);
  if (proResultSql) where.push(proResultSql);

  const query = `
    WITH filtered AS (
      SELECT pe.*, ${proPitchTypeSql()} AS pitch_type
      FROM public.pro_pitch_events pe
      WHERE ${where.join('\n        AND ')}
    )
    SELECT pitch_type, COUNT(*)::int AS pitch_count, MIN(session_date) AS first_date, MAX(session_date) AS last_date,
      AVG(relspeed) AS velo, AVG(spinrate) AS spin, AVG(inducedvertbreak) AS ivb, AVG(horzbreak) AS hb,
      AVG(relheight) AS release_height, AVG(relside) AS release_side, AVG(extension) AS extension,
      AVG(platelocheight) AS plate_height, AVG(platelocside) AS plate_side,
      NULL::double precision AS zone_time,
      AVG(relside) AS x0, 50.0::double precision AS y0, AVG(relheight) AS z0,
      AVG(vx0) AS vx0, AVG(vy0) AS vy0, AVG(vz0) AS vz0,
      AVG(ax) AS ax0, AVG(ay) AS ay0, AVG(az) AS az0
    FROM filtered GROUP BY pitch_type HAVING COUNT(*) > 0
    ORDER BY MIN(CASE pitch_type
      WHEN 'Fastball' THEN 1 WHEN 'Sinker' THEN 2 WHEN 'Cutter' THEN 3 WHEN 'Slider' THEN 4
      WHEN 'Sweeper' THEN 5 WHEN 'Curveball' THEN 6 WHEN 'ChangeUp' THEN 7 WHEN 'Splitter' THEN 8 ELSE 99 END)
  `;
  const result = await getDbPool().query<FlightRow>(query, params);
  return result.rows;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 });

  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  }).toUpperCase();
  const url = new URL(request.url);
  const detailMode = url.searchParams.get('detail')?.trim().toLowerCase() ?? '';
  let scopedPitcher: string | null = null;
  if (shouldScopeDashboardPlayer(session.role, schoolCode)) {
    const identity = await resolveDashboardPlayerIdentity(session);
    if (!identity) return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
    scopedPitcher = scopedPlayerQueryName(identity, 'Pitching');
  }

  try {
    let sourcePitchCounts: Record<string, number>;
    let rows: FlightRow[];
    let spinSamples: SpinSampleRow[] = [];
    let individualPitchRows: IndividualPitchRow[] = [];
    if (schoolCode === 'PRO') {
      rows = labeledRows(await proArsenal(url.searchParams));
      sourcePitchCounts = { measured: rows.reduce((sum, row) => sum + (finiteNumber(row.pitch_count) ?? 0), 0) };
    } else {
      const [rawForwardRows, rawBackfillRows] = await Promise.all([
        collegeArsenal({ schoolCode, search: url.searchParams, scopedPitcher }),
        backfillArsenal({ schoolCode, search: url.searchParams, scopedPitcher }),
      ]);
      const forwardRows = labeledRows(rawForwardRows);
      const backfillRows = labeledRows(rawBackfillRows);
      sourcePitchCounts = {
        forward: forwardRows.reduce((sum, row) => sum + (finiteNumber(row.pitch_count) ?? 0), 0),
        backfill: backfillRows.reduce((sum, row) => sum + (finiteNumber(row.pitch_count) ?? 0), 0),
      };
      rows = mergeFlightRows([forwardRows, backfillRows]);
      if (detailMode === 'spin') {
        const [measuredSamples, videoSamples] = await Promise.all([
          collegeSpinSamples({ schoolCode, search: url.searchParams, scopedPitcher }),
          collegeVideoSpinSamples({ schoolCode, search: url.searchParams, scopedPitcher }),
        ]);
        const byPitch = new Map<string, SpinSampleRow>();
        for (const row of videoSamples) byPitch.set(row.pitch_uid ?? `video:${row.pitch_type}:${row.sample_date}`, row);
        // Measured TrackMan seam coordinates always take precedence when the
        // same pitch also has a video-derived estimate.
        for (const row of measuredSamples) byPitch.set(row.pitch_uid ?? `measured:${row.pitch_type}:${row.sample_date}`, row);
        spinSamples = Array.from(byPitch.values());
      }
      if (detailMode === 'pitches') {
        const [rawForwardPitches, rawBackfillPitches] = await Promise.all([
          collegeArsenalPitches({ schoolCode, search: url.searchParams, scopedPitcher }),
          backfillArsenalPitches({ schoolCode, search: url.searchParams, scopedPitcher }),
        ]);
        // Prefer the direct pitch_data row over its mirrored backfill copy when
        // the same pitch_uid appears in both.
        const byUid = new Map<string, IndividualPitchRow>();
        for (const row of rawBackfillPitches) if (row.pitch_uid) byUid.set(row.pitch_uid, row);
        for (const row of rawForwardPitches) if (row.pitch_uid) byUid.set(row.pitch_uid, row);
        individualPitchRows = Array.from(byUid.values());
      }
    }
    let availableDateRange: { firstDate: string | null; lastDate: string | null } | null = null;
    if (!rows.length && schoolCode !== 'PRO') {
      const availability = await getDbPool().query<AvailabilityRow>(`
        SELECT MIN(session_date) AS first_date, MAX(session_date) AS last_date
        FROM public.pitch_flight_backfill
        WHERE school_code = $1
      `, [schoolCode]);
      const firstDate = isoDate(availability.rows[0]?.first_date);
      const lastDate = isoDate(availability.rows[0]?.last_date);
      if (firstDate || lastDate) availableDateRange = { firstDate, lastDate };
    }
    return NextResponse.json({
      schoolCode,
      mode: 'average-arsenal',
      dataPolicy: 'measured-only',
      rolloutDate: ROLLOUT_DATE,
      backfillWindowDays: 0,
      sourcePitchCounts,
      availableDateRange,
      // Statcast/pro horizontal coordinates use the opposite sign from the
      // dashboard's TrackMan-facing convention: raw pro RelSide averages are
      // positive for LHP and negative for RHP. Normalize only pro lateral
      // release/plate positions here so every camera view places the pitcher
      // on the correct side without changing college data.
      pitches: serializeRows(rows, schoolCode === 'PRO' ? -1 : 1),
      spinSamples: serializeSpinSamples(spinSamples),
      individualPitches: serializeIndividualPitches(individualPitchRows, schoolCode === 'PRO' ? -1 : 1),
    }, { headers: { 'cache-control': 'private, max-age=30, stale-while-revalidate=120' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load ball-flight data.' }, { status: 500 });
  }
}
