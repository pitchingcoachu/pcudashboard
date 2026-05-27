import { createHash } from 'node:crypto';
import { getDbPool, isDatabaseConfigured } from './auth-db';

export type BiomechanicsUploadKind = 'all_pitches' | 'single_pitch';

export type BiomechPitchOption = {
  pitchKey: string;
  label: string;
  capturedAt: string | null;
  velocityMph?: number | null;
};

export type BiomechSinglePitchPoint = {
  t: number;
  fx: number | null;
  fy: number | null;
  fz: number | null;
  mx: number | null;
  my: number | null;
  mz: number | null;
  phase_name?: string | null;
  device_id?: string | null;
  position_id?: string | null;
};

type BiomechComputedMetrics = {
  backPeakFz: number | null;
  backPeakFy: number | null;
  moundConnection: number | null;
  impulse: number | null;
  impulseTime: number | null;
  yzTransferBack: number | null;
  leadPeakFz: number | null;
  leadPeakFy: number | null;
  clawbackTime: number | null;
  yzTransferFront: number | null;
  yTransfer: number | null;
  zTransfer: number | null;
};

type BiomechTableSummaryRow = {
  Name: string;
  Tags: string;
  'Pitch Velocity (mph)': number | null;
  'Back Leg Peak Fz (lb)': number | null;
  'Back Leg Peak Fy (lb)': number | null;
  'Mound Connection (BW%)': number | null;
  'Back Leg Impulse (lb·s)': number | null;
  'Back Leg Impulse Time (s)': number | null;
  'Back Leg YZ Transfer (s)': number | null;
  'Lead Leg Peak Fz (lb)': number | null;
  'Lead Leg Peak Fy (lb)': number | null;
  'Lead Leg Clawback (s)': number | null;
  'Lead Leg YZ Transfer (s)': number | null;
  'Y Transfer (s)': number | null;
  'Z Transfer (s)': number | null;
  'Stride Length (in)': number | null;
  'Stride Direction (in)': number | null;
};

type NameMapping = {
  playerName?: string | null;
};

declare global {
  var __pcuBiomechanicsDbReady: boolean | undefined;
  var __pcuBiomechanicsDbPatched: boolean | undefined;
}

function normalizeSchoolCode(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ');
}

function toFirstLastName(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!raw.includes(',')) return raw.replace(/\s+/g, ' ').trim();
  const [last, ...rest] = raw.split(',');
  return `${rest.join(' ').trim()} ${last.trim()}`.replace(/\s+/g, ' ').trim();
}

function toFinite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFiniteLoose(value: unknown): number | null {
  const direct = toFinite(value);
  if (direct !== null) return direct;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^0-9.+-]/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickVelocityFromRow(row: Record<string, unknown>): number | null {
  const explicit = toFiniteLoose(
    pickValueCaseInsensitive(row, [
      'RelSpeed',
      'RelSpeed (mph)',
      'Rel Speed',
      'Rel Speed (mph)',
      'rel_speed',
      'release speed',
      'release_speed',
      'pitch speed',
      'pitch speed (mph)',
      'velocity_mph',
      'velocity',
      'velo',
      'pitch velocity',
      'pitch_velocity',
      'mph',
    ])
  );
  if (explicit !== null) return explicit;

  // Fallback: scan keys for speed/velo patterns while avoiding force-development metrics.
  for (const [key, raw] of Object.entries(row)) {
    const keyNorm = key.toLowerCase();
    if (keyNorm.includes('development')) continue;
    const speedLike =
      keyNorm.includes('relspeed') ||
      keyNorm.includes('rel speed') ||
      keyNorm.includes('release speed') ||
      keyNorm.includes('velocity') ||
      keyNorm.includes('velo') ||
      keyNorm.includes('pitch speed');
    if (!speedLike) continue;
    const parsed = toFiniteLoose(raw);
    if (parsed !== null) return parsed;
  }
  return null;
}

function trackmanNameNorm(value: string | null | undefined): string {
  const firstLast = toFirstLastName(String(value ?? '').replace(/\s+/g, ' ').trim());
  return firstLast.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildNameKeys(value: string | null | undefined): string[] {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const base = raw.replace(/\s+/g, ' ').trim();
  const firstLast = toFirstLastName(base);
  const asNorm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const keys = new Set<string>([asNorm(base), asNorm(firstLast)].filter(Boolean));
  const tokens = firstLast.split(/\s+/).filter(Boolean);
  if (tokens.length === 2) {
    keys.add(asNorm(`${tokens[1]} ${tokens[0]}`));
  }
  return Array.from(keys);
}

async function getTrackmanVelocityByNameDate(args: {
  schoolCode: string;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<Map<string, Array<{ tSec: number | null; velo: number }>>> {
  if (!isDatabaseConfigured()) return new Map();
  const pool = getDbPool();
  const values: Array<string> = [normalizeSchoolCode(args.schoolCode)];
  const dateParts: string[] = [];
  if (args.startDate) {
    values.push(args.startDate);
    dateParts.push(`session_date >= $${values.length}::date`);
  }
  if (args.endDate) {
    values.push(args.endDate);
    dateParts.push(`session_date <= $${values.length}::date`);
  }
  const dateSql = dateParts.length ? `AND ${dateParts.join(' AND ')}` : '';

  const attempts = [
    `
    SELECT
      COALESCE(NULLIF(TRIM(pitcher), ''), '') AS pitcher_name,
      session_date::text AS session_date,
      NULLIF(TRIM(COALESCE(time::text, '')), '') AS tm_time,
      relspeed::double precision AS velo
    FROM pitch_events
    WHERE school_code = $1
      ${dateSql}
      AND relspeed IS NOT NULL
      AND COALESCE(NULLIF(TRIM(pitcher), ''), '') <> ''
    `,
    `
    SELECT
      COALESCE(NULLIF(TRIM(pitcher), ''), '') AS pitcher_name,
      session_date::text AS session_date,
      NULLIF(TRIM(COALESCE(time::text, '')), '') AS tm_time,
      "RelSpeed"::double precision AS velo
    FROM pitch_events
    WHERE school_code = $1
      ${dateSql}
      AND "RelSpeed" IS NOT NULL
      AND COALESCE(NULLIF(TRIM(pitcher), ''), '') <> ''
    `,
  ];

  for (const sql of attempts) {
    try {
      const result = await pool.query<{ pitcher_name: string | null; session_date: string | null; tm_time: string | null; velo: number | null }>(sql, values);
      const map = new Map<string, Array<{ tSec: number | null; velo: number }>>();
      const parseTimeSec = (raw: string | null): number | null => {
        const text = String(raw ?? '').trim();
        if (!text) return null;
        const m = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?\s*(AM|PM)?/i);
        if (!m) return null;
        let h = Number(m[1] ?? 0);
        const min = Number(m[2] ?? 0);
        const sec = Number(m[3] ?? 0);
        const ap = String(m[4] ?? '').toUpperCase();
        if (ap === 'PM' && h < 12) h += 12;
        if (ap === 'AM' && h === 12) h = 0;
        if (![h, min, sec].every(Number.isFinite)) return null;
        return h * 3600 + min * 60 + sec;
      };
      for (const row of result.rows) {
        const dateKey = String(row.session_date ?? '').trim().replace(/-/g, '');
        const velo = toFinite(row.velo);
        if (!dateKey || velo === null) continue;
        const keys = buildNameKeys(row.pitcher_name);
        if (!keys.length) continue;
        for (const nameKey of keys) {
          const key = `${nameKey}|${dateKey}`;
          const arr = map.get(key) ?? [];
          arr.push({ tSec: parseTimeSec(row.tm_time), velo });
          map.set(key, arr);
        }
      }
      return map;
    } catch {
      // try next schema variant
    }
  }
  return new Map();
}

function toDateOrNull(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = raw.includes(' ') && /^\d{4}-\d{2}-\d{2}\s+\d/.test(raw)
    ? raw.replace(/\s+/, 'T')
    : raw;
  const d = new Date(normalized);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function parseUsDateTimeToIso(value: string): string | null {
  const raw = String(value ?? '').trim();
  const m = raw.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  let hour = Number(m[4] ?? 0);
  const minute = Number(m[5] ?? 0);
  const second = Number(m[6] ?? 0);
  const ampm = String(m[7] ?? '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const dt = new Date(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toISOString();
}

function canonicalKey(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pickValueCaseInsensitive(row: Record<string, unknown>, keys: string[]): unknown {
  const index = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) index.set(canonicalKey(k), v);
  for (const key of keys) {
    const v = index.get(canonicalKey(key));
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function pickStringCaseInsensitive(row: Record<string, unknown>, keys: string[]): string | null {
  const value = pickValueCaseInsensitive(row, keys);
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseCapturedAtFromRow(row: Record<string, unknown>): string | null {
  const raw = pickValueCaseInsensitive(row, [
    'date',
    'recorded_date',
    'recorded',
    'pitch_date',
    'capture date/time',
    'capture date/time (america/phoenix)',
    'capture date/time (american/phoenix)',
    'capture datetime',
    'timestamp',
    'time (unix ms)',
    'unix ms',
    'time',
    'datetime',
    'date_time',
    'utc_time',
  ]);
  if (raw === null) return null;
  const asString = String(raw).trim();
  if (!asString) return null;
  const numeric = Number(asString);
  if (Number.isFinite(numeric) && numeric > 10_000_000_000) {
    return new Date(numeric).toISOString();
  }
  return toDateOrNull(asString) ?? parseUsDateTimeToIso(asString);
}

function parsePitchLabelFromRow(row: Record<string, unknown>, fallback: string): string {
  const pitchNo = pickValueCaseInsensitive(row, ['pitch_no', 'pitch number', 'pitch_number', 'pitch#']);
  const pitchType = pickValueCaseInsensitive(row, ['pitch_type', 'pitch type', 'type']);
  const athlete = pickValueCaseInsensitive(row, ['player', 'pitcher', 'athlete', 'name']);
  const pieces = [athlete, pitchType, pitchNo]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);
  if (pieces.length) return pieces.join(' | ');
  return fallback;
}

function normalizePhase(value: string | null | undefined): 'loading' | 'delivery' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'loading') return 'loading';
  if (normalized === 'delivery') return 'delivery';
  return null;
}

function parseSingleFileNameParts(fileName: string): { dateKey: string | null; timeKey: number | null } {
  const match = String(fileName ?? '').match(/(?:^|[^\d])(\d{8})_(\d+)(?:\.csv)?(?:$|[^\d])/i);
  if (!match) return { dateKey: null, timeKey: null };
  const rawTime = String(match[2] ?? '').trim();
  let timeKey: number | null = null;
  if (/^\d{6}$/.test(rawTime)) {
    const hh = Number(rawTime.slice(0, 2));
    const mm = Number(rawTime.slice(2, 4));
    const ss = Number(rawTime.slice(4, 6));
    if (Number.isFinite(hh) && Number.isFinite(mm) && Number.isFinite(ss) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 && ss >= 0 && ss <= 59) {
      timeKey = hh * 3600 + mm * 60 + ss;
    }
  }
  if (timeKey === null) {
    const numeric = Number(rawTime);
    timeKey = Number.isFinite(numeric) ? numeric : null;
  }
  return { dateKey: String(match[1] ?? ''), timeKey };
}

function secondsOfDayFromIso(iso: string | null | undefined): number | null {
  const raw = String(iso ?? '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? Number.NaN);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? Number.NaN);
  const ss = Number(parts.find((p) => p.type === 'second')?.value ?? Number.NaN);
  if (![hh, mm, ss].every(Number.isFinite)) return null;
  return hh * 3600 + mm * 60 + ss;
}

function dateKeyPhoenixFromIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  if (!y || !m || !day) return null;
  return `${y}${m}${day}`;
}

function isoFromUnixMs(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  // Single-pitch timestamps are stored as unix milliseconds.
  if (value < 10_000_000_000) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function formatDateKeyMddyy(dateKey: string | null | undefined): string | null {
  const raw = String(dateKey ?? '').trim();
  if (!/^\d{8}$/.test(raw)) return null;
  const yyyy = Number(raw.slice(0, 4));
  const mm = Number(raw.slice(4, 6));
  const dd = Number(raw.slice(6, 8));
  const yy = String(yyyy % 100).padStart(2, '0');
  return `${mm}/${String(dd).padStart(2, '0')}/${yy}`;
}

function splitTags(value: string | null | undefined): string[] {
  const raw = String(value ?? '').trim();
  if (!raw) return ['UnTagged'];
  const parts = raw
    .split(/[;,|]/g)
    .map((v) => v.trim())
    .filter(Boolean);
  return parts.length ? Array.from(new Set(parts)) : ['UnTagged'];
}

function computePitchMetrics(points: BiomechSinglePitchPoint[]): BiomechComputedMetrics {
  const isMoundDevice = (value: string | null | undefined) => {
    const normalized = String(value ?? '').toLowerCase();
    return normalized.includes('pitching mound.drive') || normalized.includes('pitching mound.parent');
  };
  const isParentDevice = (value: string | null | undefined) => String(value ?? '').toLowerCase().includes('pitching mound.parent');
  const isDriveDevice = (value: string | null | undefined) => String(value ?? '').toLowerCase().includes('pitching mound.drive');

  const phasePoints = points.filter((point) => normalizePhase(point.phase_name));
  const moundPoints = phasePoints.filter((point) => isMoundDevice(point.device_id));
  const hasParent = moundPoints.some((point) => isParentDevice(point.device_id));
  const sourcePoints = moundPoints.filter((point) => (hasParent ? isParentDevice(point.device_id) : isDriveDevice(point.device_id)));
  const rawTimes = sourcePoints.map((point) => toFinite(point.t)).filter((v): v is number => v !== null);
  if (!rawTimes.length) {
    return {
      backPeakFz: null,
      backPeakFy: null,
      moundConnection: null,
      impulse: null,
      impulseTime: null,
      yzTransferBack: null,
      leadPeakFz: null,
      leadPeakFy: null,
      clawbackTime: null,
      yzTransferFront: null,
      yTransfer: null,
      zTransfer: null,
    };
  }
  const minRawTime = Math.min(...rawTimes);
  const maxRawTime = Math.max(...rawTimes);
  const rawRange = maxRawTime - minRawTime;
  const treatAsMs = rawRange > 1000 || minRawTime > 100000;
  const normalizedPoints = sourcePoints
    .map((point) => {
      const rawT = toFinite(point.t);
      if (rawT === null) return null;
      const t = treatAsMs ? (rawT - minRawTime) / 1000 : (rawT - minRawTime);
      return {
        t,
        fy: toFinite(point.fy),
        fz: toFinite(point.fz),
        phase: normalizePhase(point.phase_name),
      };
    })
    .filter((point): point is { t: number; fy: number | null; fz: number | null; phase: 'loading' | 'delivery' | null } => point !== null && point.phase !== null);

  const loading = normalizedPoints
    .filter((point) => point.phase === 'loading')
    .map((point) => ({ t: point.t, fy: point.fy, fz: point.fz }))
    .filter((p): p is { t: number; fy: number | null; fz: number | null } => p.t !== null)
    .sort((a, b) => a.t - b.t);
  const delivery = normalizedPoints
    .filter((point) => point.phase === 'delivery')
    .map((point) => ({ t: point.t, fy: point.fy, fz: point.fz }))
    .filter((p): p is { t: number; fy: number | null; fz: number | null } => p.t !== null)
    .sort((a, b) => a.t - b.t);

  // Below this line, calculations intentionally mirror LineChart key-metric logic.

  const maxBy = (arr: Array<{ t: number; v: number | null }>) => arr.filter((r) => r.v !== null).reduce<{ t: number; v: number } | null>((best, row) => {
    if (row.v === null) return best;
    if (!best || row.v > best.v) return { t: row.t, v: row.v };
    return best;
  }, null);
  const minBy = (arr: Array<{ t: number; v: number | null }>) => arr.filter((r) => r.v !== null).reduce<{ t: number; v: number } | null>((best, row) => {
    if (row.v === null) return best;
    if (!best || row.v < best.v) return { t: row.t, v: row.v };
    return best;
  }, null);
  const integrateTrapezoid = (arr: Array<{ t: number; v: number }>) => {
    if (arr.length < 2) return 0;
    let area = 0;
    for (let i = 0; i < arr.length - 1; i += 1) {
      const a = arr[i];
      const b = arr[i + 1];
      const dt = Math.max(0, b.t - a.t);
      area += ((a.v + b.v) / 2) * dt;
    }
    return area;
  };

  const backPeakFz = maxBy(loading.map((p) => ({ t: p.t, v: p.fz })));
  const backPeakFy = maxBy(loading.map((p) => ({ t: p.t, v: p.fy })));
  const leadPeakFz = maxBy(delivery.map((p) => ({ t: p.t, v: p.fz })));
  const leadPeakFy = minBy(delivery.map((p) => ({ t: p.t, v: p.fy })));
  const firstLeadFz = delivery.find((p) => p.fz !== null);
  const backFzBeforeLead = firstLeadFz
    ? loading
      .filter((p) => p.fz !== null && p.t <= firstLeadFz.t)
      .sort((a, b) => a.t - b.t)
      .at(-1)?.fz ?? null
    : null;

  let impulse: number | null = null;
  let impulseTime: number | null = null;
  if (loading.length > 2) {
    const peakFz = maxBy(loading.map((p) => ({ t: p.t, v: p.fz })));
    const peakZIdx = peakFz ? loading.findIndex((p) => p.t === peakFz.t && p.fz === peakFz.v) : -1;
    let startIdx = -1;
    if (peakZIdx > 1 && peakFz) {
      const peakTime = peakFz.t;
      const windowStartTime = peakTime - 0.7;
      const candidates: number[] = [];
      for (let i = 0; i < peakZIdx; i += 1) {
        const t = loading[i]?.t;
        if (t !== undefined && t >= windowStartTime) candidates.push(i);
      }
      if (candidates.length) {
        let minIdx = candidates[0] ?? 0;
        for (const idx of candidates) {
          const curr = loading[idx]?.fz;
          const best = loading[minIdx]?.fz;
          if (curr === null || curr === undefined) continue;
          if (best === null || best === undefined || curr < best) minIdx = idx;
        }
        startIdx = minIdx;
      }
    }
    if (startIdx >= 0) {
      const loadingFromStart = loading.slice(startIdx);
      const peakFyFromStart = maxBy(loadingFromStart.map((p) => ({ t: p.t, v: p.fy })));
      let endIdx = loading.length - 1;
      if (peakFyFromStart) {
        const peakIdx = loading.findIndex((p) => p.t === peakFyFromStart.t && p.fy === peakFyFromStart.v);
        if (peakIdx >= 0) {
          for (let i = peakIdx + 1; i < loading.length; i += 1) {
            const fy = loading[i]?.fy;
            if (fy !== null && fy <= 0) {
              endIdx = i;
              break;
            }
          }
        }
      }
      const impulseWindow = loading
        .slice(startIdx, endIdx + 1)
        .filter((p) => p.fy !== null)
        .map((p) => ({ t: p.t, v: Math.max(0, Number(p.fy)) }));
      impulse = integrateTrapezoid(impulseWindow);
      const startT = loading[startIdx]?.t ?? null;
      const endT = loading[endIdx]?.t ?? null;
      impulseTime = startT !== null && endT !== null ? Math.max(0, endT - startT) : null;
    }
  }

  let clawbackTime: number | null = null;
  const landingIdx = delivery.findIndex((p) => (p.fy ?? 0) < 0);
  if (landingIdx >= 0) {
    const recover = delivery.slice(landingIdx + 1).find((p) => (p.fy ?? Number.NEGATIVE_INFINITY) >= 0);
    if (recover) clawbackTime = Math.max(0, recover.t - delivery[landingIdx].t);
  }

  return {
    backPeakFz: backPeakFz?.v ?? null,
    backPeakFy: backPeakFy?.v ?? null,
    moundConnection: backFzBeforeLead,
    impulse,
    impulseTime,
    yzTransferBack: backPeakFy && backPeakFz ? Math.abs(backPeakFy.t - backPeakFz.t) : null,
    leadPeakFz: leadPeakFz?.v ?? null,
    leadPeakFy: leadPeakFy?.v ?? null,
    clawbackTime,
    yzTransferFront: leadPeakFy && leadPeakFz ? Math.abs(leadPeakFy.t - leadPeakFz.t) : null,
    yTransfer: backPeakFy && leadPeakFy ? Math.abs(leadPeakFy.t - backPeakFy.t) : null,
    zTransfer: backPeakFz && leadPeakFz ? Math.abs(leadPeakFz.t - backPeakFz.t) : null,
  };
}

async function ensureBiomechanicsTables(): Promise<void> {
  if (global.__pcuBiomechanicsDbReady) {
    if (global.__pcuBiomechanicsDbPatched) return;
    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '2s';`);
      await client.query(`SET LOCAL statement_timeout = '15s';`);
      await client.query(`ALTER TABLE biomechanics_single_pitch_points ADD COLUMN IF NOT EXISTS pitcher_name TEXT;`);
      await client.query(`ALTER TABLE biomechanics_single_pitch_points ADD COLUMN IF NOT EXISTS pitcher_name_norm TEXT;`);
      await client.query(`ALTER TABLE biomechanics_pitch_metrics ADD COLUMN IF NOT EXISTS impulse_time DOUBLE PRECISION;`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS biomechanics_pitch_metrics (
          id BIGSERIAL PRIMARY KEY,
          organization_id BIGINT NOT NULL,
          school_code TEXT NOT NULL,
          source_file_hash TEXT NOT NULL,
          back_peak_fz DOUBLE PRECISION,
          back_peak_fy DOUBLE PRECISION,
          mound_connection DOUBLE PRECISION,
          impulse DOUBLE PRECISION,
          impulse_time DOUBLE PRECISION,
          yz_transfer_back DOUBLE PRECISION,
          lead_peak_fz DOUBLE PRECISION,
          lead_peak_fy DOUBLE PRECISION,
          clawback_time DOUBLE PRECISION,
          yz_transfer_front DOUBLE PRECISION,
          y_transfer DOUBLE PRECISION,
          z_transfer DOUBLE PRECISION,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (organization_id, school_code, source_file_hash)
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_pitch_metrics_scope_hash ON biomechanics_pitch_metrics (organization_id, school_code, source_file_hash);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_pitch_rows_scope_date ON biomechanics_pitch_rows (organization_id, school_code, captured_at DESC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope ON biomechanics_single_pitch_points (organization_id, school_code, source_file_hash, point_index ASC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope_date ON biomechanics_single_pitch_points (organization_id, school_code, captured_at DESC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope_hash ON biomechanics_single_pitch_points (organization_id, school_code, source_file_hash);`);
      await client.query(`
        WITH ranked AS (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY organization_id, school_code, upload_kind, source_file_hash
              ORDER BY created_at DESC, id DESC
            ) AS rn
          FROM biomechanics_uploads
        )
        DELETE FROM biomechanics_uploads u
        USING ranked r
        WHERE u.id = r.id
          AND r.rn > 1
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_biomech_uploads_scope_kind_hash ON biomechanics_uploads (organization_id, school_code, upload_kind, source_file_hash);`);
      await client.query('COMMIT');
      global.__pcuBiomechanicsDbPatched = true;
    } catch {
      await client.query('ROLLBACK');
      // Ignore patch warmup failures; runtime paths can still operate on base schema.
    } finally {
      client.release();
    }
    return;
  }
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '3s';`);
    await client.query(`SET LOCAL statement_timeout = '30s';`);
    await client.query(`SELECT pg_advisory_xact_lock(77431102519901);`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS biomechanics_uploads (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        school_code TEXT NOT NULL,
        upload_kind TEXT NOT NULL,
        source_file_name TEXT NOT NULL,
        source_file_hash TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        created_by_user_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS biomechanics_pitch_rows (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        school_code TEXT NOT NULL,
        upload_id BIGINT NOT NULL REFERENCES biomechanics_uploads(id) ON DELETE CASCADE,
        source_file_hash TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        captured_at TIMESTAMPTZ,
        pitch_label TEXT,
        row_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, school_code, source_file_hash, row_index)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS biomechanics_single_pitch_points (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        school_code TEXT NOT NULL,
        upload_id BIGINT NOT NULL REFERENCES biomechanics_uploads(id) ON DELETE CASCADE,
        source_file_hash TEXT NOT NULL,
        point_index INTEGER NOT NULL,
        t DOUBLE PRECISION NOT NULL,
        fx DOUBLE PRECISION,
        fy DOUBLE PRECISION,
        fz DOUBLE PRECISION,
        mx DOUBLE PRECISION,
        my DOUBLE PRECISION,
        mz DOUBLE PRECISION,
        row_json JSONB NOT NULL,
        captured_at TIMESTAMPTZ,
        pitch_label TEXT,
        pitcher_name TEXT,
        pitcher_name_norm TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, school_code, source_file_hash, point_index)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS biomechanics_pitch_metrics (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        school_code TEXT NOT NULL,
        source_file_hash TEXT NOT NULL,
        back_peak_fz DOUBLE PRECISION,
        back_peak_fy DOUBLE PRECISION,
        mound_connection DOUBLE PRECISION,
        impulse DOUBLE PRECISION,
        impulse_time DOUBLE PRECISION,
        yz_transfer_back DOUBLE PRECISION,
        lead_peak_fz DOUBLE PRECISION,
        lead_peak_fy DOUBLE PRECISION,
        clawback_time DOUBLE PRECISION,
        yz_transfer_front DOUBLE PRECISION,
        y_transfer DOUBLE PRECISION,
        z_transfer DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, school_code, source_file_hash)
      );
    `);
    await client.query(`ALTER TABLE biomechanics_single_pitch_points ADD COLUMN IF NOT EXISTS pitcher_name TEXT;`);
    await client.query(`ALTER TABLE biomechanics_single_pitch_points ADD COLUMN IF NOT EXISTS pitcher_name_norm TEXT;`);
    await client.query(`ALTER TABLE biomechanics_pitch_metrics ADD COLUMN IF NOT EXISTS impulse_time DOUBLE PRECISION;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_pitch_metrics_scope_hash ON biomechanics_pitch_metrics (organization_id, school_code, source_file_hash);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_pitch_rows_scope_date ON biomechanics_pitch_rows (organization_id, school_code, captured_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope ON biomechanics_single_pitch_points (organization_id, school_code, source_file_hash, point_index ASC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope_date ON biomechanics_single_pitch_points (organization_id, school_code, captured_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_biomech_single_points_scope_hash ON biomechanics_single_pitch_points (organization_id, school_code, source_file_hash);`);
    await client.query(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY organization_id, school_code, upload_kind, source_file_hash
            ORDER BY created_at DESC, id DESC
          ) AS rn
        FROM biomechanics_uploads
      )
      DELETE FROM biomechanics_uploads u
      USING ranked r
      WHERE u.id = r.id
        AND r.rn > 1
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_biomech_uploads_scope_kind_hash ON biomechanics_uploads (organization_id, school_code, upload_kind, source_file_hash);`);
    await client.query('COMMIT');
    global.__pcuBiomechanicsDbReady = true;
    global.__pcuBiomechanicsDbPatched = true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureBiomechanicsMetricsTable(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS biomechanics_pitch_metrics (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      source_file_hash TEXT NOT NULL,
      back_peak_fz DOUBLE PRECISION,
      back_peak_fy DOUBLE PRECISION,
      mound_connection DOUBLE PRECISION,
      impulse DOUBLE PRECISION,
      impulse_time DOUBLE PRECISION,
      yz_transfer_back DOUBLE PRECISION,
      lead_peak_fz DOUBLE PRECISION,
      lead_peak_fy DOUBLE PRECISION,
      clawback_time DOUBLE PRECISION,
      yz_transfer_front DOUBLE PRECISION,
      y_transfer DOUBLE PRECISION,
      z_transfer DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, school_code, source_file_hash)
    );
  `);
  await pool.query(`ALTER TABLE biomechanics_pitch_metrics ADD COLUMN IF NOT EXISTS impulse_time DOUBLE PRECISION;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_biomech_pitch_metrics_scope_hash ON biomechanics_pitch_metrics (organization_id, school_code, source_file_hash);`);
}

export async function saveAllPitchRows(args: {
  organizationId: number;
  schoolCode: string;
  sourceFileName: string;
  csvContent: string;
  rows: Array<Record<string, unknown> & NameMapping>;
  createdByUserId: number | null;
}): Promise<{ insertedRows: number }> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  await ensureBiomechanicsTables();
  const pool = getDbPool();
  const sourceFileHash = createHash('sha256').update(args.csvContent).digest('hex');
  const schoolCode = normalizeSchoolCode(args.schoolCode);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingUpload = await client.query<{ id: number }>(
      `
      SELECT id
      FROM biomechanics_uploads
      WHERE organization_id = $1
        AND school_code = $2
        AND upload_kind = 'all_pitches'
        AND source_file_hash = $3
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [args.organizationId, schoolCode, sourceFileHash]
    );
    let uploadId = Number(existingUpload.rows[0]?.id ?? 0);
    if (uploadId > 0) {
      await client.query(
        `
        UPDATE biomechanics_uploads
        SET source_file_name = $4,
            row_count = $5,
            created_by_user_id = $6,
            created_at = NOW()
        WHERE id = $1
          AND organization_id = $2
          AND school_code = $3
        `,
        [uploadId, args.organizationId, schoolCode, args.sourceFileName, args.rows.length, args.createdByUserId]
      );
    } else {
      const uploadInsert = await client.query<{ id: number }>(
        `
        INSERT INTO biomechanics_uploads (
          organization_id, school_code, upload_kind, source_file_name, source_file_hash, row_count, created_by_user_id
        ) VALUES ($1, $2, 'all_pitches', $3, $4, $5, $6)
        RETURNING id
        `,
        [args.organizationId, schoolCode, args.sourceFileName, sourceFileHash, args.rows.length, args.createdByUserId]
      );
      uploadId = Number(uploadInsert.rows[0]?.id ?? 0);
    }
    await client.query(
      `
      DELETE FROM biomechanics_pitch_rows
      WHERE organization_id = $1
        AND school_code = $2
        AND source_file_hash = $3
      `,
      [args.organizationId, schoolCode, sourceFileHash]
    );
    let insertedRows = 0;
    for (let idx = 0; idx < args.rows.length; idx += 1) {
      const row = args.rows[idx] ?? {};
      const capturedAt = parseCapturedAtFromRow(row);
      const pitchLabel = parsePitchLabelFromRow(row, `${args.sourceFileName} | Row ${idx + 1}`);
      const result = await client.query(
        `
        INSERT INTO biomechanics_pitch_rows (
          organization_id, school_code, upload_id, source_file_hash, row_index, captured_at, pitch_label, row_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        ON CONFLICT (organization_id, school_code, source_file_hash, row_index)
        DO UPDATE SET
          captured_at = EXCLUDED.captured_at,
          pitch_label = EXCLUDED.pitch_label,
          row_json = EXCLUDED.row_json
        `,
        [
          args.organizationId,
          schoolCode,
          uploadId,
          sourceFileHash,
          idx,
          capturedAt,
          pitchLabel,
          JSON.stringify(row),
        ]
      );
      insertedRows += result.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return { insertedRows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function saveSinglePitchPoints(args: {
  organizationId: number;
  schoolCode: string;
  sourceFileName: string;
  csvContent: string;
  rows: Array<Record<string, unknown>>;
  createdByUserId: number | null;
  pitcherName?: string | null;
  onChunkCommitted?: (rowsCommitted: number) => void;
}): Promise<{ insertedRows: number; pitchKey: string }> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  await ensureBiomechanicsTables();
  await ensureBiomechanicsMetricsTable();
  const pool = getDbPool();
  const sourceFileHash = createHash('sha256').update(args.csvContent).digest('hex');
  const schoolCode = normalizeSchoolCode(args.schoolCode);
  const client = await pool.connect();
  try {
    const firstRow = args.rows[0] ?? {};
    const capturedAt = parseCapturedAtFromRow(firstRow);
    const pitcherName = String(args.pitcherName ?? '').trim();
    const pitchLabel = pitcherName ? `${pitcherName} | ${args.sourceFileName}` : parsePitchLabelFromRow(firstRow, args.sourceFileName);

    await client.query('BEGIN');
    const existingUpload = await client.query<{ id: number }>(
      `
      SELECT id
      FROM biomechanics_uploads
      WHERE organization_id = $1
        AND school_code = $2
        AND upload_kind = 'single_pitch'
        AND source_file_hash = $3
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [args.organizationId, schoolCode, sourceFileHash]
    );
    let uploadId = Number(existingUpload.rows[0]?.id ?? 0);
    if (uploadId > 0) {
      await client.query(
        `
        UPDATE biomechanics_uploads
        SET source_file_name = $4,
            row_count = $5,
            created_by_user_id = $6,
            created_at = NOW()
        WHERE id = $1
          AND organization_id = $2
          AND school_code = $3
        `,
        [uploadId, args.organizationId, schoolCode, args.sourceFileName, args.rows.length, args.createdByUserId]
      );
    } else {
      const uploadInsert = await client.query<{ id: number }>(
        `
        INSERT INTO biomechanics_uploads (
          organization_id, school_code, upload_kind, source_file_name, source_file_hash, row_count, created_by_user_id
        ) VALUES ($1, $2, 'single_pitch', $3, $4, $5, $6)
        RETURNING id
        `,
        [args.organizationId, schoolCode, args.sourceFileName, sourceFileHash, args.rows.length, args.createdByUserId]
      );
      uploadId = Number(uploadInsert.rows[0]?.id ?? 0);
    }
    await client.query(
      `
      DELETE FROM biomechanics_single_pitch_points
      WHERE organization_id = $1
        AND school_code = $2
        AND source_file_hash = $3
      `,
      [args.organizationId, schoolCode, sourceFileHash]
    );
    await client.query(
      `
      DELETE FROM biomechanics_pitch_metrics
      WHERE organization_id = $1
        AND school_code = $2
        AND source_file_hash = $3
      `,
      [args.organizationId, schoolCode, sourceFileHash]
    );
    let insertedRows = 0;
    const pitcherNorm = normalizeName(pitcherName || '');
    const metricPoints: BiomechSinglePitchPoint[] = [];
    const chunkSize = 100;
    for (let start = 0; start < args.rows.length; start += chunkSize) {
      const chunk = args.rows.slice(start, start + chunkSize);
      const values: unknown[] = [];
      const rowsSql: string[] = [];
      for (let i = 0; i < chunk.length; i += 1) {
        const idx = start + i;
        const row = chunk[i] ?? {};
        const t =
          toFinite(pickValueCaseInsensitive(row, [
            'time',
            't',
            'time (unix ms)',
            'time_unix_ms',
            'time unix ms',
            'timestamp_ms',
            'unix ms',
            'ms',
            'frame',
          ])) ??
          idx;
        const fx = toFinite(pickValueCaseInsensitive(row, ['Fx', 'F_x']));
        const fy = toFinite(pickValueCaseInsensitive(row, ['Fy', 'F_y']));
        const fz = toFinite(pickValueCaseInsensitive(row, ['Fz', 'F_z']));
        const mx = toFinite(pickValueCaseInsensitive(row, ['Mx', 'M_x']));
        const my = toFinite(pickValueCaseInsensitive(row, ['My', 'M_y']));
        const mz = toFinite(pickValueCaseInsensitive(row, ['Mz', 'M_z']));
        metricPoints.push({
          t,
          fx,
          fy,
          fz,
          mx,
          my,
          mz,
          phase_name: pickStringCaseInsensitive(row, ['Phase Name', 'Phase']),
          device_id: pickStringCaseInsensitive(row, ['Device Id', 'Device']),
          position_id: pickStringCaseInsensitive(row, ['Position Id', 'Position']),
        });
        const base = values.length;
        rowsSql.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13}::jsonb,$${base + 14},$${base + 15},$${base + 16},$${base + 17})`
        );
        values.push(
          args.organizationId,
          schoolCode,
          uploadId,
          sourceFileHash,
          idx,
          t,
          fx,
          fy,
          fz,
          mx,
          my,
          mz,
          JSON.stringify(row),
          capturedAt,
          pitchLabel,
          pitcherName || null,
          pitcherNorm
        );
      }

      const result = await client.query(
        `
        INSERT INTO biomechanics_single_pitch_points (
          organization_id, school_code, upload_id, source_file_hash, point_index, t, fx, fy, fz, mx, my, mz,
          row_json, captured_at, pitch_label, pitcher_name, pitcher_name_norm
        ) VALUES ${rowsSql.join(',')}
        ON CONFLICT (organization_id, school_code, source_file_hash, point_index)
        DO UPDATE SET
          t = EXCLUDED.t,
          fx = EXCLUDED.fx,
          fy = EXCLUDED.fy,
          fz = EXCLUDED.fz,
          mx = EXCLUDED.mx,
          my = EXCLUDED.my,
          mz = EXCLUDED.mz,
          row_json = EXCLUDED.row_json,
          captured_at = EXCLUDED.captured_at,
          pitch_label = EXCLUDED.pitch_label,
          pitcher_name = EXCLUDED.pitcher_name,
          pitcher_name_norm = EXCLUDED.pitcher_name_norm
        `,
        values
      );
      insertedRows += result.rowCount ?? 0;
      if (args.onChunkCommitted) args.onChunkCommitted(chunk.length);
    }

    const computed = computePitchMetrics(metricPoints);
    await client.query(
      `
      INSERT INTO biomechanics_pitch_metrics (
        organization_id, school_code, source_file_hash,
        back_peak_fz, back_peak_fy, mound_connection, impulse, impulse_time, yz_transfer_back,
        lead_peak_fz, lead_peak_fy, clawback_time, yz_transfer_front, y_transfer, z_transfer
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      `,
      [
        args.organizationId,
        schoolCode,
        sourceFileHash,
        computed.backPeakFz,
        computed.backPeakFy,
        computed.moundConnection,
        computed.impulse,
        computed.impulseTime,
        computed.yzTransferBack,
        computed.leadPeakFz,
        computed.leadPeakFy,
        computed.clawbackTime,
        computed.yzTransferFront,
        computed.yTransfer,
        computed.zTransfer,
      ]
    );
    await client.query('COMMIT');
    return { insertedRows, pitchKey: sourceFileHash };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteBiomechanicsPitch(args: {
  organizationId: number;
  schoolCode: string;
  pitchKey: string;
}): Promise<{ deletedSinglePitch: boolean; deletedAllPitchRow: boolean; deletedAllPitchRowId: number | null }> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');

  const pool = getDbPool();
  const schoolCode = normalizeSchoolCode(args.schoolCode);
  const pitchKey = String(args.pitchKey ?? '').trim();
  if (!pitchKey) throw new Error('pitchKey is required.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '2s';`);
    await client.query(`SET LOCAL statement_timeout = '20s';`);

    const singleUploadResult = await client.query<{ id: number; source_file_name: string | null; created_at: string | null }>(
      `
      SELECT id, source_file_name, created_at::text AS created_at
      FROM biomechanics_uploads
      WHERE organization_id = $1
        AND school_code = $2
        AND upload_kind = 'single_pitch'
        AND source_file_hash = $3
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [args.organizationId, schoolCode, pitchKey]
    );
    if (!singleUploadResult.rows.length) {
      await client.query('ROLLBACK');
      return { deletedSinglePitch: false, deletedAllPitchRow: false, deletedAllPitchRowId: null };
    }

    const sourceFileName = String(singleUploadResult.rows[0]?.source_file_name ?? '').trim();
    const uploadCreatedAt = String(singleUploadResult.rows[0]?.created_at ?? '').trim() || null;
    const firstPointResult = await client.query<{ t: number | string | null }>(
      `
      SELECT t
      FROM biomechanics_single_pitch_points
      WHERE organization_id = $1
        AND school_code = $2
        AND source_file_hash = $3
        AND point_index = 0
      LIMIT 1
      `,
      [args.organizationId, schoolCode, pitchKey]
    );
    const pointTimeMs = toFinite(firstPointResult.rows[0]?.t ?? null);
    const pointIso = isoFromUnixMs(pointTimeMs);
    const parsedParts = parseSingleFileNameParts(sourceFileName);
    const singleDateKey = dateKeyPhoenixFromIso(pointIso) ?? parsedParts.dateKey ?? dateKeyPhoenixFromIso(uploadCreatedAt);
    const fallbackTimeSec = Number.isFinite(parsedParts.timeKey) ? parsedParts.timeKey : null;
    const targetIso = pointIso ?? uploadCreatedAt;

    let pairedAllPitchRowId: number | null = null;
    if (singleDateKey && targetIso) {
      const singleDay = `${singleDateKey.slice(0, 4)}-${singleDateKey.slice(4, 6)}-${singleDateKey.slice(6, 8)}`;
      const nearestAllPitchResult = await client.query<{ id: number }>(
        `
        SELECT id
        FROM biomechanics_pitch_rows
        WHERE organization_id = $1
          AND school_code = $2
          AND (COALESCE(captured_at, created_at) AT TIME ZONE 'America/Phoenix')::date = $3::date
        ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(captured_at, created_at) - $4::timestamptz))) ASC, id ASC
        LIMIT 1
        `,
        [args.organizationId, schoolCode, singleDay, targetIso]
      );
      pairedAllPitchRowId = Number(nearestAllPitchResult.rows[0]?.id ?? 0) || null;
    } else if (singleDateKey && fallbackTimeSec !== null && uploadCreatedAt) {
      const singleDay = `${singleDateKey.slice(0, 4)}-${singleDateKey.slice(4, 6)}-${singleDateKey.slice(6, 8)}`;
      const fallbackTargetIso = uploadCreatedAt;
      const nearestAllPitchResult = await client.query<{ id: number }>(
        `
        SELECT id
        FROM biomechanics_pitch_rows
        WHERE organization_id = $1
          AND school_code = $2
          AND (COALESCE(captured_at, created_at) AT TIME ZONE 'America/Phoenix')::date = $3::date
        ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(captured_at, created_at) - $4::timestamptz))) ASC, id ASC
        LIMIT 1
        `,
        [args.organizationId, schoolCode, singleDay, fallbackTargetIso]
      );
      pairedAllPitchRowId = Number(nearestAllPitchResult.rows[0]?.id ?? 0) || null;
    }

    const deleteUploadResult = await client.query(
      `
      DELETE FROM biomechanics_uploads
      WHERE organization_id = $1
        AND school_code = $2
        AND upload_kind = 'single_pitch'
        AND source_file_hash = $3
      `,
      [args.organizationId, schoolCode, pitchKey]
    );

    let deletedAllPitchRow = false;
    if (pairedAllPitchRowId !== null) {
      const deleteRowResult = await client.query(
        `
        DELETE FROM biomechanics_pitch_rows
        WHERE organization_id = $1
          AND school_code = $2
          AND id = $3
        `,
        [args.organizationId, schoolCode, pairedAllPitchRowId]
      );
      deletedAllPitchRow = (deleteRowResult.rowCount ?? 0) > 0;
    }

    await client.query('COMMIT');
    return {
      deletedSinglePitch: (deleteUploadResult.rowCount ?? 0) > 0,
      deletedAllPitchRow,
      deletedAllPitchRowId: pairedAllPitchRowId,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getBiomechanicsSnapshot(args: {
  organizationId: number;
  schoolCode: string;
  startDate?: string | null;
  endDate?: string | null;
  selectedPitchKey?: string | null;
  selectedPitcher?: string | null;
  selectedTag?: string | null;
  forceMode?: 'force' | 'bw';
}): Promise<{
  tableColumns: string[];
  tableRows: Array<Record<string, string | number | null>>;
  pitchOptions: BiomechPitchOption[];
  selectedPitchKey: string | null;
  selectedPitchPoints: BiomechSinglePitchPoint[];
  tagsOptions: string[];
  selectedPitchTags: string | null;
  selectedPitchPlayer: string | null;
  selectedPitchDate: string | null;
  selectedPitchVelocityMph: number | null;
  pitchVelocityByKey: Record<string, number | null>;
  selectedPitchBodyWeightLb: number | null;
  selectedPitchStrideLengthIn: number | null;
  selectedPitchStrideDirectionIn: number | null;
  matchSummary: {
    totalSinglePitchFiles: number;
    matchedSinglePitchFiles: number;
    unmatchedSinglePitchFiles: number;
    totalAllPitchRows: number;
    matchedAllPitchRows: number;
    unmatchedAllPitchRows: number;
  };
}> {
  if (!isDatabaseConfigured()) {
    return {
      tableColumns: [],
      tableRows: [],
      pitchOptions: [],
      selectedPitchKey: null,
      selectedPitchPoints: [],
      tagsOptions: [],
      selectedPitchTags: null,
      selectedPitchPlayer: null,
      selectedPitchDate: null,
      selectedPitchVelocityMph: null,
      pitchVelocityByKey: {},
      selectedPitchBodyWeightLb: null,
      selectedPitchStrideLengthIn: null,
      selectedPitchStrideDirectionIn: null,
      matchSummary: {
        totalSinglePitchFiles: 0,
        matchedSinglePitchFiles: 0,
        unmatchedSinglePitchFiles: 0,
        totalAllPitchRows: 0,
        matchedAllPitchRows: 0,
        unmatchedAllPitchRows: 0,
      },
    };
  }
  await ensureBiomechanicsTables();
  await ensureBiomechanicsMetricsTable();
  const pool = getDbPool();
  const schoolCode = normalizeSchoolCode(args.schoolCode);
  const selectedPitcher = String(args.selectedPitcher ?? '').trim();
  const selectedPitcherKeys = new Set(buildNameKeys(selectedPitcher));

  const dateFilterParts: string[] = [];
  const values: Array<string | number> = [args.organizationId, schoolCode];
  if (args.startDate) {
    values.push(args.startDate);
    dateFilterParts.push(`COALESCE(captured_at, created_at) >= $${values.length}::date`);
  }
  if (args.endDate) {
    values.push(args.endDate);
    dateFilterParts.push(`COALESCE(captured_at, created_at) < ($${values.length}::date + INTERVAL '1 day')`);
  }
  const dateFilterSql = dateFilterParts.length ? `AND ${dateFilterParts.join(' AND ')}` : '';
  const dateFilterSqlSingle = dateFilterParts.length
    ? `AND ${dateFilterParts
      .map((part) => part.replace(/COALESCE\(captured_at,\s*created_at\)/g, 'COALESCE(p.captured_at, p.created_at)'))
      .join(' AND ')}`
    : '';
  const dateFilterSqlUploads = dateFilterParts.length
    ? `AND ${dateFilterParts
      .map((part) => part.replace(/COALESCE\(captured_at,\s*created_at\)/g, 'COALESCE(u.created_at, u.created_at)'))
      .join(' AND ')}`
    : '';
  const summaryValues: Array<string | number> = [...values];
  const rowResult = await pool.query<{ row_json: Record<string, string | number | null>; captured_at: string | null; created_at: string | null }>(
    `
    SELECT row_json, captured_at::text AS captured_at, created_at::text AS created_at
    FROM biomechanics_pitch_rows
    WHERE organization_id = $1
      AND school_code = $2
      ${dateFilterSql}
    ORDER BY COALESCE(captured_at, created_at) DESC
    LIMIT 1200
    `,
    values
  );
  const summaryAllRowsResult = await pool.query<{ total_rows: string }>(
    `
    SELECT COUNT(*)::text AS total_rows
    FROM biomechanics_pitch_rows
    WHERE organization_id = $1
      AND school_code = $2
      ${dateFilterSql}
    `,
    summaryValues
  );

  const selectedTag = String(args.selectedTag ?? '').trim();
  const forceMode = args.forceMode === 'bw' ? 'bw' : 'force';

  const pitchOptionsResult = await pool.query<{
    pitch_key: string;
    label: string;
    captured_at: string | null;
    pitcher_name: string | null;
    source_file_name: string | null;
  }>(
    `
    SELECT
      u.source_file_hash AS pitch_key,
      COALESCE(
        NULLIF(TRIM(u.source_file_name), ''),
        u.source_file_hash
      ) AS label,
      u.created_at::text AS captured_at,
      NULL::text AS pitcher_name,
      NULLIF(TRIM(u.source_file_name), '') AS source_file_name
    FROM biomechanics_uploads u
    WHERE u.organization_id = $1
      AND u.school_code = $2
      AND u.upload_kind = 'single_pitch'
      ${dateFilterSqlUploads}
    ORDER BY u.created_at DESC
    `,
    summaryValues
  );
  const summarySingleFilesResult = await pool.query<{ total_files: string }>(
    `
    SELECT COUNT(*)::text AS total_files
    FROM biomechanics_uploads u
    WHERE u.organization_id = $1
      AND u.school_code = $2
      AND u.upload_kind = 'single_pitch'
      ${dateFilterSqlUploads}
    `,
    summaryValues
  );
  const pitchKeysForTime = pitchOptionsResult.rows.map((row) => String(row.pitch_key ?? '').trim()).filter(Boolean);
  const singleTimeByHash = new Map<string, number>();
  if (pitchKeysForTime.length) {
    const singleTimeRows = await pool.query<{ source_file_hash: string; t: number | string | null }>(
      `
      SELECT source_file_hash, t
      FROM biomechanics_single_pitch_points
      WHERE organization_id = $1
        AND school_code = $2
        AND point_index = 0
        AND source_file_hash = ANY($3::text[])
      `,
      [args.organizationId, schoolCode, pitchKeysForTime]
    );
    for (const row of singleTimeRows.rows) {
      const t = toFinite(row.t);
      if (t === null) continue;
      singleTimeByHash.set(String(row.source_file_hash ?? ''), t);
    }
  }

  const allRows = rowResult.rows.map((row) => {
    const json = (row.row_json ?? {}) as Record<string, unknown>;
    const playerRaw =
      pickStringCaseInsensitive(json, ['Player', 'Name', 'Pitcher']) ??
      `${pickStringCaseInsensitive(json, ['First Name']) ?? ''} ${pickStringCaseInsensitive(json, ['Last Name']) ?? ''}`.trim();
    const tags = pickStringCaseInsensitive(json, ['Tags', 'Tag']) ?? 'UnTagged';
    const capturedAt = row.captured_at ?? row.created_at ?? null;
    const dateKey = dateKeyPhoenixFromIso(capturedAt);
    const strideLengthCm = toFinite(pickValueCaseInsensitive(json, ['strideLength (cm)', 'strideLength', 'Stride Length (cm)']));
    const strideWidthCm = toFinite(pickValueCaseInsensitive(json, ['strideWidth (cm)', 'strideWidth', 'Stride Width (cm)']));
    const systemWeightN = toFinite(pickValueCaseInsensitive(json, ['systemWeight (N)', 'systemWeight', 'System Weight (N)']));
    const velocityMph = pickVelocityFromRow(json);
    return {
      name: toFirstLastName(playerRaw || 'Unknown'),
      nameNorm: normalizeName(playerRaw),
      nameKey: buildNameKeys(playerRaw)[0] ?? '',
      tags,
      dateKey,
      capturedAt,
      velocityMph,
      strideLengthIn: strideLengthCm === null ? null : strideLengthCm / 2.54,
      strideDirectionIn: strideWidthCm === null ? null : strideWidthCm / 2.54,
      bodyWeightLb: systemWeightN === null ? null : systemWeightN * 0.22480894387096,
    };
  }).filter((row) => row.dateKey);
  const isSelectedPitcherMatch = (nameRaw: string): boolean => {
    if (!selectedPitcherKeys.size) return true;
    const keys = buildNameKeys(nameRaw);
    return keys.some((k) => selectedPitcherKeys.has(k));
  };
  const filteredAllRows = allRows.filter((row) => isSelectedPitcherMatch(row.name));
  const trackmanVeloByNameDate = await getTrackmanVelocityByNameDate({
    schoolCode,
    startDate: args.startDate ?? null,
    endDate: args.endDate ?? null,
  });
  const pickNearestTrackmanVelo = (nameRaw: string, dateKey: string, timeKey: number | null): number | null => {
    const keys = buildNameKeys(nameRaw);
    const rows = keys.flatMap((k) => trackmanVeloByNameDate.get(`${k}|${dateKey}`) ?? []);
    if (!rows.length) return null;
    if (timeKey === null || !Number.isFinite(timeKey)) return rows[0]?.velo ?? null;
    let best: { delta: number; velo: number } | null = null;
    for (const row of rows) {
      if (row.tSec === null || !Number.isFinite(row.tSec)) continue;
      const delta = Math.abs(Number(row.tSec) - Number(timeKey));
      if (!best || delta < best.delta) best = { delta, velo: row.velo };
    }
    if (!best) return null;
    return best.delta <= 5 ? best.velo : null;
  };

  const singleRows = pitchOptionsResult.rows.map((row) => {
    const sourceFileName = String(row.source_file_name ?? '').trim();
    const parts = parseSingleFileNameParts(sourceFileName || String(row.label ?? ''));
    const fallbackDateKey = dateKeyPhoenixFromIso(row.captured_at);
    const fallbackTimeKey = secondsOfDayFromIso(row.captured_at);
    const pointTimeMs = singleTimeByHash.get(String(row.pitch_key ?? '')) ?? null;
    const pointIso = isoFromUnixMs(pointTimeMs);
    const pointDateKey = dateKeyPhoenixFromIso(pointIso);
    const pointTimeKey = secondsOfDayFromIso(pointIso);
    return {
      pitchKey: row.pitch_key,
      label: row.label,
      capturedAt: row.captured_at,
      pitcherName: String(row.pitcher_name ?? '').trim() || null,
      pitcherNorm: normalizeName(row.pitcher_name ?? ''),
      sourceFileName,
      dateKey: pointDateKey ?? parts.dateKey ?? fallbackDateKey,
      timeKey: (pointTimeKey !== null && Number.isFinite(pointTimeKey))
        ? pointTimeKey
        : (Number.isFinite(parts.timeKey) ? parts.timeKey : fallbackTimeKey),
    };
  });
  const singleRowByPitchKey = new Map(singleRows.map((row) => [row.pitchKey, row] as const));

  const allRowsForPitcherGrouping = filteredAllRows.filter((row) => row.nameNorm);
  const allGroups = new Map<string, Array<typeof allRowsForPitcherGrouping[number]>>();
  for (const row of allRowsForPitcherGrouping) {
    const key = `${row.nameNorm}|${row.dateKey}`;
    const arr = allGroups.get(key) ?? [];
    arr.push(row);
    allGroups.set(key, arr);
  }
  for (const arr of allGroups.values()) {
    arr.sort((a, b) => String(a.capturedAt ?? '').localeCompare(String(b.capturedAt ?? '')));
  }

  const singleGroups = new Map<string, Array<typeof singleRows[number]>>();
  for (const row of singleRows) {
    if (!row.dateKey || row.timeKey === null || !Number.isFinite(row.timeKey)) continue;
    const key = `__date_only__|${row.dateKey}`;
    const arr = singleGroups.get(key) ?? [];
    arr.push(row);
    singleGroups.set(key, arr);
  }
  for (const arr of singleGroups.values()) {
    arr.sort((a, b) => Number(a.timeKey ?? 0) - Number(b.timeKey ?? 0));
  }

  const mapping = new Map<string, {
    name: string;
    tags: string;
    tagsList: string[];
    strideLengthIn: number | null;
    strideDirectionIn: number | null;
    pitchDateLabel: string | null;
    bodyWeightLb: number | null;
    velocityMph: number | null;
  }>();
  for (const [key, singles] of singleGroups.entries()) {
    const allForGroup = allRows.filter((row) => `__date_only__|${row.dateKey}` === key);
    const n = Math.min(singles.length, allForGroup.length);
    for (let i = 0; i < n; i += 1) {
      const single = singles[i];
      const allRow = allForGroup[i];
      if (!single || !allRow) continue;
      const allRowTimeSec = secondsOfDayFromIso(allRow.capturedAt);
      mapping.set(single.pitchKey, {
        name: allRow.name,
        tags: allRow.tags || 'UnTagged',
        tagsList: splitTags(allRow.tags || 'UnTagged'),
        strideLengthIn: allRow.strideLengthIn,
        strideDirectionIn: allRow.strideDirectionIn,
        pitchDateLabel: formatDateKeyMddyy(allRow.dateKey),
        bodyWeightLb: allRow.bodyWeightLb,
        // Match to TrackMan using the all-pitch capture timestamp (Phoenix), not file-name time.
        velocityMph: pickNearestTrackmanVelo(String(allRow.name ?? ''), String(allRow.dateKey ?? ''), allRowTimeSec) ?? allRow.velocityMph,
      });
    }
  }

  const tagsOptions = Array.from(
    new Set(
      Array.from(mapping.values()).flatMap((v) => v.tagsList).filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const pitchOptionsUnfiltered: BiomechPitchOption[] = singleRows.map((row) => {
    const mappedName = mapping.get(row.pitchKey)?.name ?? '';
    const fallback = toFirstLastName(String(row.pitcherName ?? '').trim());
    return {
      pitchKey: row.pitchKey,
      label: mappedName || fallback || 'Unknown Pitcher',
      capturedAt: row.capturedAt,
      velocityMph: mapping.get(row.pitchKey)?.velocityMph ?? null,
    };
  });
  const pitchOptions = pitchOptionsUnfiltered.filter((option) => {
    if (selectedPitcherKeys.size) {
      const meta = mapping.get(option.pitchKey);
      const fallbackName = option.label || singleRowByPitchKey.get(option.pitchKey)?.pitcherName || '';
      if (!isSelectedPitcherMatch(meta?.name ?? fallbackName)) return false;
    }
    if (!selectedTag || selectedTag.toUpperCase() === 'ALL') return true;
    const meta = mapping.get(option.pitchKey);
    const tagsList = meta?.tagsList ?? ['UnTagged'];
    return tagsList.includes(selectedTag);
  });
  const selectedPitchKey =
    args.selectedPitchKey && pitchOptions.some((option) => option.pitchKey === args.selectedPitchKey)
      ? args.selectedPitchKey
      : (pitchOptions[0]?.pitchKey ?? null);

  let selectedPitchPoints: BiomechSinglePitchPoint[] = [];
  if (selectedPitchKey) {
    const pointsResult = await pool.query<BiomechSinglePitchPoint & { row_json?: Record<string, unknown> | null }>(
      `
      SELECT t, fx, fy, fz, mx, my, mz, row_json
      FROM biomechanics_single_pitch_points
      WHERE organization_id = $1
        AND school_code = $2
        AND source_file_hash = $3
      ORDER BY point_index ASC
      `,
      [args.organizationId, schoolCode, selectedPitchKey]
    );
    selectedPitchPoints = pointsResult.rows.map((row) => {
      const rowJson = (row.row_json ?? {}) as Record<string, unknown>;
      const rowTimeMs = toFinite(pickValueCaseInsensitive(rowJson, ['Time (Unix ms)', 'time_unix_ms', 'time unix ms', 'timestamp_ms', 'unix ms']));
      const dbTime = toFinite(row.t);
      const t = rowTimeMs !== null ? rowTimeMs : Number(dbTime ?? 0);
      return {
        t,
        fx: toFinite(row.fx),
        fy: toFinite(row.fy),
        fz: toFinite(row.fz),
        mx: toFinite(row.mx),
        my: toFinite(row.my),
        mz: toFinite(row.mz),
        phase_name: pickStringCaseInsensitive(rowJson, ['Phase Name', 'Phase']),
        device_id: pickStringCaseInsensitive(rowJson, ['Device Id', 'Device']),
        position_id: pickStringCaseInsensitive(rowJson, ['Position Id', 'Position']),
      };
    });
  }

  const selectedPitchTags = selectedPitchKey ? (mapping.get(selectedPitchKey)?.tags ?? null) : null;
  const selectedPitchPlayer = selectedPitchKey ? (mapping.get(selectedPitchKey)?.name ?? null) : null;
  const selectedPitchDate = selectedPitchKey ? (mapping.get(selectedPitchKey)?.pitchDateLabel ?? null) : null;
  const selectedPitchVelocityMph = selectedPitchKey ? (mapping.get(selectedPitchKey)?.velocityMph ?? null) : null;
  const pitchVelocityByKey = Object.fromEntries(
    pitchOptions.map((option) => [option.pitchKey, mapping.get(option.pitchKey)?.velocityMph ?? null])
  ) as Record<string, number | null>;
  const selectedPitchBodyWeightLb = selectedPitchKey ? (mapping.get(selectedPitchKey)?.bodyWeightLb ?? null) : null;
  const selectedPitchStrideLengthIn = selectedPitchKey ? (mapping.get(selectedPitchKey)?.strideLengthIn ?? null) : null;
  const selectedPitchStrideDirectionIn = selectedPitchKey ? (mapping.get(selectedPitchKey)?.strideDirectionIn ?? null) : null;
  const totalAllRowsFromDb = Number(summaryAllRowsResult.rows[0]?.total_rows ?? 0);
  const totalSingleFilesFromDb = Number(summarySingleFilesResult.rows[0]?.total_files ?? 0);
  const totalAllForSummary = Math.max(allRows.length, totalAllRowsFromDb);
  const totalSinglesForSummary = Math.max(singleRows.length, totalSingleFilesFromDb);
  const matchedForSummary = Math.min(mapping.size, totalAllForSummary);
  const matchSummary = {
    totalSinglePitchFiles: totalSinglesForSummary,
    matchedSinglePitchFiles: mapping.size,
    unmatchedSinglePitchFiles: Math.max(0, totalSinglesForSummary - mapping.size),
    totalAllPitchRows: totalAllForSummary,
    matchedAllPitchRows: matchedForSummary,
    unmatchedAllPitchRows: Math.max(0, totalAllForSummary - matchedForSummary),
  };

  const metricKeys = pitchOptions.map((p) => p.pitchKey);
  const pitchMetricsMap = new Map<string, BiomechComputedMetrics>();
  if (metricKeys.length) {
    const metricsAgg = await pool.query<{
      source_file_hash: string;
      back_peak_fz: number | null;
      back_peak_fy: number | null;
      mound_connection: number | null;
      impulse: number | null;
      impulse_time: number | null;
      yz_transfer_back: number | null;
      lead_peak_fz: number | null;
      lead_peak_fy: number | null;
      clawback_time: number | null;
      yz_transfer_front: number | null;
      y_transfer: number | null;
      z_transfer: number | null;
    }>(
      `
      SELECT
        source_file_hash,
        back_peak_fz,
        back_peak_fy,
        mound_connection,
        impulse,
        impulse_time,
        yz_transfer_back,
        lead_peak_fz,
        lead_peak_fy,
        clawback_time,
        yz_transfer_front,
        y_transfer,
        z_transfer
      FROM biomechanics_pitch_metrics
      WHERE organization_id = $1
        AND school_code = $2
        AND source_file_hash = ANY($3::text[])
      `,
      [args.organizationId, schoolCode, metricKeys]
    ).catch(async (error) => {
      const code = String((error as { code?: unknown } | null)?.code ?? '');
      const message = String((error as { message?: unknown } | null)?.message ?? '').toLowerCase();
      const missingMetricsShape = code === '42P01' || code === '42703' || message.includes('biomechanics_pitch_metrics') || message.includes('impulse_time');
      if (!missingMetricsShape) throw error;
      await ensureBiomechanicsMetricsTable();
      return pool.query<{
        source_file_hash: string;
        back_peak_fz: number | null;
        back_peak_fy: number | null;
        mound_connection: number | null;
        impulse: number | null;
        impulse_time: number | null;
        yz_transfer_back: number | null;
        lead_peak_fz: number | null;
        lead_peak_fy: number | null;
        clawback_time: number | null;
        yz_transfer_front: number | null;
        y_transfer: number | null;
        z_transfer: number | null;
      }>(
        `
        SELECT
          source_file_hash,
          back_peak_fz,
          back_peak_fy,
          mound_connection,
          impulse,
          impulse_time,
          yz_transfer_back,
          lead_peak_fz,
          lead_peak_fy,
          clawback_time,
          yz_transfer_front,
          y_transfer,
          z_transfer
        FROM biomechanics_pitch_metrics
        WHERE organization_id = $1
          AND school_code = $2
          AND source_file_hash = ANY($3::text[])
        `,
        [args.organizationId, schoolCode, metricKeys]
      );
    });
    for (const row of metricsAgg.rows) {
      pitchMetricsMap.set(row.source_file_hash, {
        backPeakFz: toFinite(row.back_peak_fz),
        backPeakFy: toFinite(row.back_peak_fy),
        moundConnection: toFinite(row.mound_connection),
        impulse: toFinite(row.impulse),
        impulseTime: toFinite(row.impulse_time),
        yzTransferBack: toFinite(row.yz_transfer_back),
        leadPeakFz: toFinite(row.lead_peak_fz),
        leadPeakFy: toFinite(row.lead_peak_fy),
        clawbackTime: toFinite(row.clawback_time),
        yzTransferFront: toFinite(row.yz_transfer_front),
        yTransfer: toFinite(row.y_transfer),
        zTransfer: toFinite(row.z_transfer),
      });
    }
    const missingMetricKeys = metricKeys.filter((key) => !pitchMetricsMap.has(key));
    if (missingMetricKeys.length) {
      const pointsAgg = await pool.query<BiomechSinglePitchPoint & { source_file_hash: string; row_json?: Record<string, unknown> | null }>(
        `
        SELECT source_file_hash, t, fx, fy, fz, mx, my, mz, row_json
        FROM biomechanics_single_pitch_points
        WHERE organization_id = $1
          AND school_code = $2
          AND source_file_hash = ANY($3::text[])
        ORDER BY source_file_hash, point_index ASC
        `,
        [args.organizationId, schoolCode, missingMetricKeys]
      );
      const grouped = new Map<string, BiomechSinglePitchPoint[]>();
      for (const row of pointsAgg.rows) {
        const point: BiomechSinglePitchPoint = {
          t: toFinite(row.t) ?? 0,
          fx: toFinite(row.fx),
          fy: toFinite(row.fy),
          fz: toFinite(row.fz),
          mx: toFinite(row.mx),
          my: toFinite(row.my),
          mz: toFinite(row.mz),
          phase_name: pickStringCaseInsensitive((row.row_json ?? {}) as Record<string, unknown>, ['Phase Name', 'Phase']),
          device_id: pickStringCaseInsensitive((row.row_json ?? {}) as Record<string, unknown>, ['Device Id', 'Device']),
          position_id: pickStringCaseInsensitive((row.row_json ?? {}) as Record<string, unknown>, ['Position Id', 'Position']),
        };
        const arr = grouped.get(row.source_file_hash) ?? [];
        arr.push(point);
        grouped.set(row.source_file_hash, arr);
      }
      for (const [pitchKey, points] of grouped.entries()) {
        const computed = computePitchMetrics(points);
        pitchMetricsMap.set(pitchKey, computed);
        await pool.query(
          `
      INSERT INTO biomechanics_pitch_metrics (
        organization_id, school_code, source_file_hash,
        back_peak_fz, back_peak_fy, mound_connection, impulse, impulse_time, yz_transfer_back,
        lead_peak_fz, lead_peak_fy, clawback_time, yz_transfer_front, y_transfer, z_transfer
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (organization_id, school_code, source_file_hash)
      DO UPDATE SET
        back_peak_fz = EXCLUDED.back_peak_fz,
        back_peak_fy = EXCLUDED.back_peak_fy,
        mound_connection = EXCLUDED.mound_connection,
        impulse = EXCLUDED.impulse,
        impulse_time = EXCLUDED.impulse_time,
        yz_transfer_back = EXCLUDED.yz_transfer_back,
            lead_peak_fz = EXCLUDED.lead_peak_fz,
            lead_peak_fy = EXCLUDED.lead_peak_fy,
            clawback_time = EXCLUDED.clawback_time,
            yz_transfer_front = EXCLUDED.yz_transfer_front,
            y_transfer = EXCLUDED.y_transfer,
            z_transfer = EXCLUDED.z_transfer
          `,
          [
            args.organizationId,
            schoolCode,
            pitchKey,
        computed.backPeakFz,
        computed.backPeakFy,
        computed.moundConnection,
        computed.impulse,
        computed.impulseTime,
        computed.yzTransferBack,
        computed.leadPeakFz,
        computed.leadPeakFy,
            computed.clawbackTime,
            computed.yzTransferFront,
            computed.yTransfer,
            computed.zTransfer,
          ]
        );
      }
    }
  }

  const tableColumnNames = [
    'Name',
    'Tags',
    'Pitch Velocity (mph)',
    'Back Leg Peak Fz (lb)',
    'Back Leg Peak Fy (lb)',
    'Mound Connection (BW%)',
    'Back Leg Impulse (lb·s)',
    'Back Leg Impulse Time (s)',
    'Back Leg YZ Transfer (s)',
    'Lead Leg Peak Fz (lb)',
    'Lead Leg Peak Fy (lb)',
    'Lead Leg Clawback (s)',
    'Lead Leg YZ Transfer (s)',
    'Y Transfer (s)',
    'Z Transfer (s)',
    'Stride Length (in)',
    'Stride Direction (in)',
  ];
  const agg = new Map<string, { name: string; tags: string; count: number; sums: Record<string, number>; strideLen: number[]; strideDir: number[]; velo: number[] }>();
  const groupPitches = new Map<string, string[]>();
  for (const option of pitchOptions) {
    const mappedMeta = mapping.get(option.pitchKey);
    const fallbackSingle = singleRowByPitchKey.get(option.pitchKey);
    const meta = mappedMeta ?? {
      name: option.label || toFirstLastName(String(fallbackSingle?.pitcherName ?? '').trim()) || 'Unknown Pitcher',
      tags: 'UnTagged',
      tagsList: ['UnTagged'],
      strideLengthIn: null,
      strideDirectionIn: null,
      pitchDateLabel: formatDateKeyMddyy(fallbackSingle?.dateKey ?? null),
      bodyWeightLb: null,
      velocityMph: null,
    };
    const metrics = pitchMetricsMap.get(option.pitchKey);
    if (!metrics) continue;
    for (const tag of meta.tagsList) {
      const key = `${meta.name}|${tag}`;
      const curr = agg.get(key) ?? { name: meta.name, tags: tag, count: 0, sums: {}, strideLen: [], strideDir: [], velo: [] };
      curr.count += 1;
      const add = (k: keyof BiomechComputedMetrics) => {
        const v = metrics[k];
        if (v !== null && Number.isFinite(v)) curr.sums[k] = (curr.sums[k] ?? 0) + v;
      };
      add('backPeakFz'); add('backPeakFy'); add('moundConnection'); add('impulse'); add('impulseTime'); add('yzTransferBack');
      add('leadPeakFz'); add('leadPeakFy'); add('clawbackTime'); add('yzTransferFront');
      add('yTransfer'); add('zTransfer');
      if (meta.strideLengthIn !== null && Number.isFinite(meta.strideLengthIn)) curr.strideLen.push(meta.strideLengthIn);
      if (meta.strideDirectionIn !== null && Number.isFinite(meta.strideDirectionIn)) curr.strideDir.push(meta.strideDirectionIn);
      if (meta.velocityMph !== null && Number.isFinite(meta.velocityMph)) curr.velo.push(meta.velocityMph);
      agg.set(key, curr);
      const list = groupPitches.get(key) ?? [];
      list.push(option.pitchKey);
      groupPitches.set(key, list);
    }
  }
  const avg = (sum: number | undefined, count: number) => (sum === undefined || count <= 0 ? null : sum / count);
  const avgArr = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  const avgBwMetric = (groupKey: string, pickMetric: (m: BiomechComputedMetrics) => number | null) => {
    const keys = groupPitches.get(groupKey) ?? [];
    let sum = 0;
    let count = 0;
    for (const pitchKey of keys) {
      const metrics = pitchMetricsMap.get(pitchKey);
      const bw = mapping.get(pitchKey)?.bodyWeightLb;
      const metricValue = metrics ? pickMetric(metrics) : null;
      const bwNum = typeof bw === 'number' && Number.isFinite(bw) ? bw : null;
      const bwIsPlausible = bwNum !== null && bwNum >= 80 && bwNum <= 400;
      if (!bwIsPlausible || metricValue === null || !Number.isFinite(metricValue)) continue;
      sum += metricValue / bwNum;
      count += 1;
    }
    return count > 0 ? sum / count : null;
  };
  const tableRows: BiomechTableSummaryRow[] = Array.from(agg.values())
    .sort((a, b) => a.name.localeCompare(b.name) || a.tags.localeCompare(b.tags))
    .map((r) => ({
      Name: r.name,
      Tags: r.tags,
      'Pitch Velocity (mph)': avgArr(r.velo),
      'Back Leg Peak Fz (lb)': forceMode === 'bw'
        ? avgBwMetric(`${r.name}|${r.tags}`, (m) => m.backPeakFz)
        : avg(r.sums.backPeakFz, r.count),
      'Back Leg Peak Fy (lb)': forceMode === 'bw'
        ? avgBwMetric(`${r.name}|${r.tags}`, (m) => m.backPeakFy)
        : avg(r.sums.backPeakFy, r.count),
      'Mound Connection (BW%)': avgBwMetric(`${r.name}|${r.tags}`, (m) => m.moundConnection),
      'Back Leg Impulse (lb·s)': forceMode === 'bw'
        ? avgBwMetric(`${r.name}|${r.tags}`, (m) => m.impulse)
        : avg(r.sums.impulse, r.count),
      'Back Leg Impulse Time (s)': avg(r.sums.impulseTime, r.count),
      'Back Leg YZ Transfer (s)': avg(r.sums.yzTransferBack, r.count),
      'Lead Leg Peak Fz (lb)': forceMode === 'bw'
        ? avgBwMetric(`${r.name}|${r.tags}`, (m) => m.leadPeakFz)
        : avg(r.sums.leadPeakFz, r.count),
      'Lead Leg Peak Fy (lb)': forceMode === 'bw'
        ? avgBwMetric(`${r.name}|${r.tags}`, (m) => m.leadPeakFy)
        : avg(r.sums.leadPeakFy, r.count),
      'Lead Leg Clawback (s)': avg(r.sums.clawbackTime, r.count),
      'Lead Leg YZ Transfer (s)': avg(r.sums.yzTransferFront, r.count),
      'Y Transfer (s)': avg(r.sums.yTransfer, r.count),
      'Z Transfer (s)': avg(r.sums.zTransfer, r.count),
      'Stride Length (in)': avgArr(r.strideLen),
      'Stride Direction (in)': avgArr(r.strideDir),
    }));

  return {
    tableColumns: tableColumnNames,
    tableRows,
    pitchOptions,
    selectedPitchKey,
    selectedPitchPoints,
    tagsOptions,
    selectedPitchTags,
    selectedPitchPlayer,
    selectedPitchDate,
    selectedPitchVelocityMph,
    pitchVelocityByKey,
    selectedPitchBodyWeightLb,
    selectedPitchStrideLengthIn,
    selectedPitchStrideDirectionIn,
    matchSummary,
  };
}

export async function getLatestBiomechanicsDate(args: {
  organizationId: number;
  schoolCode: string;
}): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureBiomechanicsTables();
  const pool = getDbPool();
  const schoolCode = normalizeSchoolCode(args.schoolCode);
  const result = await pool.query<{ latest_date: string | null }>(
    `
    WITH all_pitch_dates AS (
      SELECT DISTINCT (COALESCE(captured_at, created_at))::date AS d
      FROM biomechanics_pitch_rows
      WHERE organization_id = $1
        AND school_code = $2
    ),
    single_pitch_dates AS (
      SELECT DISTINCT (COALESCE(captured_at, created_at))::date AS d
      FROM biomechanics_single_pitch_points
      WHERE organization_id = $1
        AND school_code = $2
    ),
    latest_matchable AS (
      SELECT MAX(a.d)::text AS d
      FROM all_pitch_dates a
      INNER JOIN single_pitch_dates s
        ON s.d = a.d
    ),
    latest_all_pitch AS (
      SELECT MAX(d)::text AS d
      FROM all_pitch_dates
    ),
    latest_single_pitch AS (
      SELECT MAX(d)::text AS d
      FROM single_pitch_dates
    )
    SELECT COALESCE(
      (SELECT d FROM latest_matchable),
      (SELECT d FROM latest_all_pitch),
      (SELECT d FROM latest_single_pitch)
    ) AS latest_date
    `,
    [args.organizationId, schoolCode]
  );
  return String(result.rows[0]?.latest_date ?? '').trim() || null;
}
