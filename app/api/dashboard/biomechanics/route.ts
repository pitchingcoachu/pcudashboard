import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { getDbPool, isDatabaseConfigured } from '../../../../lib/auth-db';
import type { PortalSession } from '../../../../lib/portal-session';
import {
  deleteBiomechanicsPitch,
  getBiomechanicsSnapshot,
  getLatestBiomechanicsDate,
  saveAllPitchRows,
  saveSinglePitchPoints,
  type BiomechanicsUploadKind,
} from '../../../../lib/biomechanics-db';
import { resolveSchoolScopedOrganizationId } from '../../../../lib/programming-scope';

export const maxDuration = 300;
const BIOMECH_RESPONSE_CACHE_TTL_MS = 60_000;
const BIOMECH_ROLLUP_CACHE_TTL_MS = 60 * 60_000;
const biomechanicsResponseCache = new Map<string, { at: number; payload: unknown }>();

let biomechRollupCacheReady = false;

async function ensureBiomechRollupCacheTable() {
  if (biomechRollupCacheReady) return;
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS biomechanics_query_rollups (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, school_code, cache_key)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_biomech_query_rollups_scope_created ON biomechanics_query_rollups (organization_id, school_code, created_at DESC);`);
  biomechRollupCacheReady = true;
}

async function readBiomechRollupCache(args: { organizationId: number; schoolCode: string; cacheKey: string }) {
  if (!isDatabaseConfigured()) return null;
  await ensureBiomechRollupCacheTable();
  const pool = getDbPool();
  const result = await pool.query<{ payload_json: unknown; created_at: string }>(
    `
    SELECT payload_json, created_at::text AS created_at
    FROM biomechanics_query_rollups
    WHERE organization_id = $1
      AND school_code = $2
      AND cache_key = $3
    LIMIT 1
    `,
    [args.organizationId, args.schoolCode, args.cacheKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  const createdAtMs = Date.parse(String(row.created_at ?? ''));
  if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > BIOMECH_ROLLUP_CACHE_TTL_MS) return null;
  return row.payload_json ?? null;
}

async function writeBiomechRollupCache(args: { organizationId: number; schoolCode: string; cacheKey: string; payload: unknown }) {
  if (!isDatabaseConfigured()) return;
  await ensureBiomechRollupCacheTable();
  const pool = getDbPool();
  await pool.query(
    `
    INSERT INTO biomechanics_query_rollups (organization_id, school_code, cache_key, payload_json, created_at)
    VALUES ($1, $2, $3, $4::jsonb, NOW())
    ON CONFLICT (organization_id, school_code, cache_key)
    DO UPDATE SET payload_json = EXCLUDED.payload_json, created_at = NOW()
    `,
    [args.organizationId, args.schoolCode, args.cacheKey, JSON.stringify(args.payload ?? {})]
  );
}

async function clearBiomechRollupCache(args: { organizationId: number; schoolCode: string }) {
  if (!isDatabaseConfigured()) return;
  await ensureBiomechRollupCacheTable();
  const pool = getDbPool();
  await pool.query(
    `DELETE FROM biomechanics_query_rollups WHERE organization_id = $1 AND school_code = $2`,
    [args.organizationId, args.schoolCode]
  );
}

type CsvRow = Record<string, string>;
type PitchingFiltersPayload = { pitchers?: string[]; error?: string; detail?: string };

function parseCsv(text: string): CsvRow[] {
  const out: CsvRow[] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let field = '';
  let current: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i] ?? '';
    const next = normalized[i + 1] ?? '';
    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      current.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' && !inQuotes) {
      current.push(field);
      rows.push(current);
      current = [];
      field = '';
      continue;
    }
    field += ch;
  }
  current.push(field);
  rows.push(current);

  const headers = (rows.shift() ?? []).map((h) => String(h ?? '').trim());
  if (!headers.length || headers.every((h) => !h)) return [];

  for (const row of rows) {
    if (!row.length) continue;
    const record: CsvRow = {};
    let hasValue = false;
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i] ?? `Column ${i + 1}`;
      const value = String(row[i] ?? '').trim();
      if (value) hasValue = true;
      record[key] = value;
    }
    if (hasValue) out.push(record);
  }
  return out;
}

function canonicalNameToken(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toFirstLastFromLastFirst(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',');
  return `${rest.join(' ').trim()} ${last.trim()}`.replace(/\s+/g, ' ').trim();
}

function getValueCaseInsensitive(row: Record<string, unknown>, wanted: string[]): string {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) map.set(canonicalNameToken(k), String(v ?? '').trim());
  for (const key of wanted) {
    const value = map.get(canonicalNameToken(key));
    if (value) return value;
  }
  return '';
}

function normalizePcuPlayerName(lastFirstName: string): string {
  const raw = String(lastFirstName ?? '').trim();
  if (!raw) return '';
  if (raw.includes(',')) return raw.replace(/\s+/g, ' ');
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return raw;
  const first = parts[0];
  const last = parts.slice(1).join(' ');
  return `${last}, ${first}`;
}

async function fetchPcuPitchers(): Promise<string[]> {
  const apiBase = resolveDashboardApiBaseUrl();
  const url = new URL(`${apiBase}/v1/pitching/filters`);
  url.searchParams.set('school_code', 'PCU');
  const response = await fetch(url.toString(), { cache: 'no-store' });
  const payload = (await response.json().catch(() => ({}))) as PitchingFiltersPayload;
  if (!response.ok) throw new Error(String(payload.error ?? payload.detail ?? 'Failed to load PCU pitcher list.'));
  const list = Array.isArray(payload.pitchers) ? payload.pitchers.map((v) => String(v ?? '').trim()).filter(Boolean) : [];
  return Array.from(new Set(list.map((name) => normalizePcuPlayerName(name)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function applyPcuNameMatching(rows: Array<Record<string, unknown>>, pitchers: string[]): Array<Record<string, unknown>> {
  const byFirstLast = new Map<string, string>();
  const byCanonical = new Map<string, string>();
  for (const name of pitchers) {
    const normalized = normalizePcuPlayerName(name);
    const firstLast = toFirstLastFromLastFirst(normalized);
    if (firstLast) byFirstLast.set(canonicalNameToken(firstLast), normalized);
    byCanonical.set(canonicalNameToken(normalized), normalized);
  }

  return rows.map((row) => {
    const first = getValueCaseInsensitive(row, ['First Name', 'FirstName', 'first_name']);
    const last = getValueCaseInsensitive(row, ['Last Name', 'LastName', 'last_name']);
    const combinedFirstLast = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    const combinedLastFirst = `${last}, ${first}`.replace(/\s+/g, ' ').trim();
    const existingName = getValueCaseInsensitive(row, ['Player', 'Name', 'Pitcher']);
    const candidate =
      byFirstLast.get(canonicalNameToken(combinedFirstLast)) ??
      byCanonical.get(canonicalNameToken(combinedLastFirst)) ??
      byCanonical.get(canonicalNameToken(existingName)) ??
      null;
    if (!candidate) return row;
    return {
      ...row,
      Player: candidate,
      Name: candidate,
    };
  });
}

async function getSession() {
  const cookieStore = await cookies();
  return getSessionFromCookies(cookieStore);
}

function toScopedSession(session: NonNullable<Awaited<ReturnType<typeof getSession>>>): PortalSession {
  return {
    email: session.email,
    appUrl: session.appUrl,
    apps: session.apps,
    name: session.name,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    userId: Number(session.userId ?? 0),
    organizationId: Number(session.organizationId ?? 0),
    playerId: session.playerId ?? null,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
  };
}

function forbidden() {
  return NextResponse.json({ error: 'Biomechanics is only enabled for PCU.' }, { status: 403 });
}

function hasSnapshotData(snapshot: {
  tableRows: Array<Record<string, string | number | null>>;
  pitchOptions: Array<{ pitchKey: string; label: string; capturedAt?: string | null }>;
  matchSummary: {
    totalSinglePitchFiles: number;
    totalAllPitchRows: number;
  };
}): boolean {
  if (snapshot.tableRows.length > 0) return true;
  if (snapshot.pitchOptions.length > 0) return true;
  if (Number(snapshot.matchSummary.totalSinglePitchFiles ?? 0) > 0) return true;
  if (Number(snapshot.matchSummary.totalAllPitchRows ?? 0) > 0) return true;
  return false;
}

function parseSelectedValues(raw: string | null): string[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((v) => String(v ?? '').trim())
        .filter(Boolean);
    }
  } catch {
    // Treat non-JSON as single value.
  }
  return [text];
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const scopedSession = toScopedSession(session);
  const schoolCode = resolveDashboardSchoolCode(scopedSession);
  if (schoolCode !== 'PCU') return forbidden();

  const scopedOrgId = resolveSchoolScopedOrganizationId(scopedSession);
  const organizationId = Number.isFinite(Number(scopedOrgId)) && Number(scopedOrgId) > 0 ? Number(scopedOrgId) : Number(session.organizationId ?? 0);
  if (organizationId <= 0) {
    return NextResponse.json({
      table_columns: [],
      table_rows: [],
      leaderboard_individual_columns: [],
      leaderboard_individual_rows: [],
      leaderboard_average_columns: [],
      leaderboard_average_rows: [],
      pitch_options: [],
      selected_pitch_key: null,
      selected_pitch_points: [],
      tags_options: [],
      pitch_type_options: [],
      selected_pitch_tags: null,
      selected_pitch_player: null,
      selected_pitch_date: null,
      selected_pitch_velocity_mph: null,
      selected_pitch_body_weight_lb: null,
      selected_pitch_stride_length_in: null,
      selected_pitch_stride_direction_in: null,
      match_summary: {
        totalSinglePitchFiles: 0,
        matchedSinglePitchFiles: 0,
        unmatchedSinglePitchFiles: 0,
        totalAllPitchRows: 0,
        matchedAllPitchRows: 0,
        unmatchedAllPitchRows: 0,
      },
    });
  }

  const { searchParams } = new URL(request.url);
  const startDateParam = String(searchParams.get('startDate') ?? '').trim() || null;
  const endDateParam = String(searchParams.get('endDate') ?? '').trim() || null;
  const selectedPitchKey = String(searchParams.get('pitchKey') ?? '').trim() || null;
  const selectedPitcherRaw = String(searchParams.get('pitcher') ?? '').trim() || null;
  const selectedTag = String(searchParams.get('tag') ?? '').trim() || null;
  const selectedPitchType = String(searchParams.get('pitchType') ?? '').trim() || null;
  const velocityMinRaw = String(searchParams.get('velocityMin') ?? '').trim();
  const velocityMaxRaw = String(searchParams.get('velocityMax') ?? '').trim();
  const velocityMin = velocityMinRaw === '' ? null : Number(velocityMinRaw);
  const velocityMax = velocityMaxRaw === '' ? null : Number(velocityMaxRaw);
  const selectedVelocityMin = Number.isFinite(velocityMin) ? velocityMin : null;
  const selectedVelocityMax = Number.isFinite(velocityMax) ? velocityMax : null;
  const forceMode = String(searchParams.get('forceMode') ?? '').trim().toLowerCase() === 'bw' ? 'bw' : 'force';
  const playerScopedName = session.role === 'player' ? String(session.name ?? '').trim() : '';
  const selectedPitcher = session.role === 'player'
    ? (playerScopedName ? JSON.stringify([playerScopedName]) : null)
    : selectedPitcherRaw;
  const cacheKey = [
    'biomech:v2',
    Number(organizationId),
    String(schoolCode),
    session.role === 'player' ? `player:${String(session.userId ?? '')}` : `role:${session.role}`,
    startDateParam ?? '',
    endDateParam ?? '',
    selectedPitchKey ?? '',
    selectedPitcher ?? '',
    selectedTag ?? '',
    selectedPitchType ?? '',
    selectedVelocityMin ?? '',
    selectedVelocityMax ?? '',
    forceMode,
  ].join('|');
  const cached = biomechanicsResponseCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BIOMECH_RESPONSE_CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, {
      headers: {
        'cache-control': 'private, max-age=5, stale-while-revalidate=25',
      },
    });
  }
  try {
    const rollupCached = await readBiomechRollupCache({ organizationId, schoolCode, cacheKey });
    if (rollupCached && typeof rollupCached === 'object') {
      biomechanicsResponseCache.set(cacheKey, { at: Date.now(), payload: rollupCached });
      return NextResponse.json(rollupCached, {
        headers: {
          'cache-control': 'private, max-age=5, stale-while-revalidate=25',
        },
      });
    }
  } catch {
    // Ignore rollup cache read errors and continue to live computation.
  }
  try {
    let stage = 'fetch PCU pitcher options';
    const failAtStage = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return new Error(`${stage}: ${message}`);
    };
    const pitcherOptionsAll = await fetchPcuPitchers().catch(() => []);
    const pitcherOptions = session.role === 'player'
      ? (playerScopedName ? [playerScopedName] : [])
      : pitcherOptionsAll;
    const candidateOrgIds = Array.from(
      new Set(
        [
          Number(scopedOrgId),
          Number(session.organizationId ?? 0),
          ...(schoolCode === 'PCU' ? [1] : []),
        ].filter((value) => Number.isFinite(value) && value > 0)
      )
    );

    let snapshot = null as Awaited<ReturnType<typeof getBiomechanicsSnapshot>> | null;
    let allSessionsSnapshot = null as Awaited<ReturnType<typeof getBiomechanicsSnapshot>> | null;
    let appliedStartDate = startDateParam;
    let appliedEndDate = endDateParam;
    let selectedOrgId = organizationId;

    for (const orgId of candidateOrgIds) {
      let orgStartDate = startDateParam;
      let orgEndDate = endDateParam;
      if (!orgStartDate && !orgEndDate) {
        stage = `latest biomechanics date org ${orgId}`;
        const latestDate = await getLatestBiomechanicsDate({ organizationId: orgId, schoolCode }).catch((error) => {
          throw failAtStage(error);
        });
        if (latestDate) {
          orgStartDate = latestDate;
          orgEndDate = latestDate;
        }
      }

      stage = `biomechanics snapshot org ${orgId}`;
      const datedSnapshot = await getBiomechanicsSnapshot({
        organizationId: orgId,
        schoolCode,
        startDate: orgStartDate,
        endDate: orgEndDate,
        selectedPitchKey,
        selectedPitcher,
        selectedTag,
        selectedPitchType,
        selectedVelocityMin,
        selectedVelocityMax,
        forceMode,
      }).catch((error) => {
        throw failAtStage(error);
      });

      if (hasSnapshotData(datedSnapshot)) {
        snapshot = datedSnapshot;
        selectedOrgId = orgId;
        appliedStartDate = orgStartDate;
        appliedEndDate = orgEndDate;
        break;
      }

      if (!startDateParam && !endDateParam && (orgStartDate || orgEndDate)) {
        stage = `unbounded biomechanics snapshot org ${orgId}`;
        const unboundedSnapshot = await getBiomechanicsSnapshot({
          organizationId: orgId,
          schoolCode,
          startDate: null,
          endDate: null,
          selectedPitchKey,
          selectedPitcher,
          selectedTag,
          selectedPitchType,
          selectedVelocityMin,
          selectedVelocityMax,
          forceMode,
        }).catch((error) => {
          throw failAtStage(error);
        });
        if (hasSnapshotData(unboundedSnapshot)) {
          snapshot = unboundedSnapshot;
          selectedOrgId = orgId;
          appliedStartDate = null;
          appliedEndDate = null;
          break;
        }
      }

      snapshot = datedSnapshot;
      selectedOrgId = orgId;
      appliedStartDate = orgStartDate;
      appliedEndDate = orgEndDate;
    }

    if (!snapshot) {
      stage = `fallback biomechanics snapshot org ${organizationId}`;
      snapshot = await getBiomechanicsSnapshot({
        organizationId,
        schoolCode,
        startDate: startDateParam,
        endDate: endDateParam,
        selectedPitchKey,
        selectedPitcher,
        selectedTag,
        selectedPitchType,
        selectedVelocityMin,
        selectedVelocityMax,
        forceMode,
      }).catch((error) => {
        throw failAtStage(error);
      });
      selectedOrgId = organizationId;
      appliedStartDate = startDateParam;
      appliedEndDate = endDateParam;
    }

    const selectedPitchers = parseSelectedValues(selectedPitcher).filter((v) => v.toUpperCase() !== 'ALL');
    if (selectedPitchers.length === 1) {
      const allSessionsCacheKey = [
        'biomech:allsessions:v2',
        Number(selectedOrgId),
        String(schoolCode),
        session.role === 'player' ? `player:${String(session.userId ?? '')}` : `role:${session.role}`,
        selectedPitcher ?? '',
        selectedTag ?? '',
        selectedPitchType ?? '',
        selectedVelocityMin ?? '',
        selectedVelocityMax ?? '',
        forceMode,
      ].join('|');
      const allSessionsMemCached = biomechanicsResponseCache.get(allSessionsCacheKey);
      if (allSessionsMemCached && Date.now() - allSessionsMemCached.at < BIOMECH_RESPONSE_CACHE_TTL_MS) {
        allSessionsSnapshot = allSessionsMemCached.payload as typeof allSessionsSnapshot;
      } else {
        const allSessionsRollupCached = await readBiomechRollupCache({ organizationId: selectedOrgId, schoolCode, cacheKey: allSessionsCacheKey }).catch(() => null);
        if (allSessionsRollupCached && typeof allSessionsRollupCached === 'object') {
          allSessionsSnapshot = allSessionsRollupCached as typeof allSessionsSnapshot;
          biomechanicsResponseCache.set(allSessionsCacheKey, { at: Date.now(), payload: allSessionsRollupCached });
        } else {
          stage = `all-sessions biomechanics snapshot org ${selectedOrgId}`;
          allSessionsSnapshot = await getBiomechanicsSnapshot({
            organizationId: selectedOrgId,
            schoolCode,
            startDate: null,
            endDate: null,
            selectedPitchKey: null,
            selectedPitcher,
            selectedTag,
            selectedPitchType,
            selectedVelocityMin,
            selectedVelocityMax,
            forceMode,
          }).catch((error) => {
            throw failAtStage(error);
          });
          biomechanicsResponseCache.set(allSessionsCacheKey, { at: Date.now(), payload: allSessionsSnapshot });
          void writeBiomechRollupCache({ organizationId: selectedOrgId, schoolCode, cacheKey: allSessionsCacheKey, payload: allSessionsSnapshot }).catch(() => {});
        }
      }
    }

    const responsePayload = {
      table_columns: snapshot.tableColumns,
      table_rows: snapshot.tableRows,
      leaderboard_individual_columns: snapshot.leaderboardIndividualColumns,
      leaderboard_individual_rows: snapshot.leaderboardIndividualRows,
      leaderboard_average_columns: snapshot.leaderboardAverageColumns,
      leaderboard_average_rows: snapshot.leaderboardAverageRows,
      pitch_options: snapshot.pitchOptions,
      selected_pitch_key: snapshot.selectedPitchKey,
      selected_pitch_points: snapshot.selectedPitchPoints,
      tags_options: snapshot.tagsOptions,
      pitch_type_options: snapshot.pitchTypeOptions,
      selected_pitch_tags: snapshot.selectedPitchTags,
      selected_pitch_type: snapshot.selectedPitchType,
      selected_pitch_player: snapshot.selectedPitchPlayer,
      selected_pitch_date: snapshot.selectedPitchDate,
      selected_pitch_velocity_mph: snapshot.selectedPitchVelocityMph,
      pitch_velocity_by_key: snapshot.pitchVelocityByKey,
      selected_pitch_body_weight_lb: snapshot.selectedPitchBodyWeightLb,
      selected_pitch_stride_length_in: snapshot.selectedPitchStrideLengthIn,
      selected_pitch_stride_direction_in: snapshot.selectedPitchStrideDirectionIn,
      applied_start_date: appliedStartDate,
      applied_end_date: appliedEndDate,
      applied_velocity_min: selectedVelocityMin,
      applied_velocity_max: selectedVelocityMax,
      match_summary: snapshot.matchSummary,
      pitcher_options: pitcherOptions,
      all_sessions_leaderboard_individual_rows: allSessionsSnapshot?.leaderboardIndividualRows ?? [],
    };
    biomechanicsResponseCache.set(cacheKey, { at: Date.now(), payload: responsePayload });
    void writeBiomechRollupCache({ organizationId, schoolCode, cacheKey, payload: responsePayload }).catch(() => {});
    return NextResponse.json(responsePayload, {
      headers: {
        'cache-control': 'private, max-age=5, stale-while-revalidate=25',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        table_columns: [],
        table_rows: [],
        leaderboard_individual_columns: [],
        leaderboard_individual_rows: [],
        leaderboard_average_columns: [],
        leaderboard_average_rows: [],
        pitch_options: [],
        selected_pitch_key: null,
        selected_pitch_points: [],
        tags_options: [],
        pitch_type_options: [],
        selected_pitch_tags: null,
        selected_pitch_type: null,
        selected_pitch_player: null,
        selected_pitch_date: null,
        selected_pitch_velocity_mph: null,
        pitch_velocity_by_key: {},
        selected_pitch_body_weight_lb: null,
        selected_pitch_stride_length_in: null,
        selected_pitch_stride_direction_in: null,
        applied_start_date: startDateParam,
        applied_end_date: endDateParam,
        match_summary: {
          totalSinglePitchFiles: 0,
          matchedSinglePitchFiles: 0,
          unmatchedSinglePitchFiles: 0,
          totalAllPitchRows: 0,
          matchedAllPitchRows: 0,
          unmatchedAllPitchRows: 0,
        },
        pitcher_options: [],
        all_sessions_leaderboard_individual_rows: [],
        error: error instanceof Error ? error.message : 'Failed to load biomechanics data.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const scopedSession = toScopedSession(session);
  if (session.role !== 'admin' && session.role !== 'coach') {
    return NextResponse.json({ error: 'Only admins/coaches can upload biomechanics CSVs.' }, { status: 403 });
  }

  const schoolCode = resolveDashboardSchoolCode(scopedSession);
  if (schoolCode !== 'PCU') return forbidden();

  const scopedOrgId = resolveSchoolScopedOrganizationId(scopedSession);
  const organizationId = Number.isFinite(Number(scopedOrgId)) && Number(scopedOrgId) > 0 ? Number(scopedOrgId) : Number(session.organizationId ?? 0);
  if (organizationId <= 0) return NextResponse.json({ error: 'Unable to resolve organization scope.' }, { status: 400 });

  try {
    const formData = await request.formData();
    const uploadKind = String(formData.get('uploadKind') ?? '').trim() as BiomechanicsUploadKind;
    if (uploadKind !== 'all_pitches' && uploadKind !== 'single_pitch') {
      return NextResponse.json({ error: 'uploadKind must be all_pitches or single_pitch.' }, { status: 400 });
    }

    const files = formData
      .getAll('files')
      .filter((entry): entry is File => typeof File !== 'undefined' && entry instanceof File);

    if (!files.length) return NextResponse.json({ error: 'No CSV files were provided.' }, { status: 400 });

    const pitcherOptions = await fetchPcuPitchers();

    let totalInserted = 0;
    for (const file of files) {
      const fileText = await file.text();
      const rawRows = parseCsv(fileText).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v])));
      const rows = uploadKind === 'all_pitches' ? applyPcuNameMatching(rawRows, pitcherOptions) : rawRows;
      if (!rows.length) continue;
      if (uploadKind === 'all_pitches') {
        const result = await saveAllPitchRows({
          organizationId,
          schoolCode,
          sourceFileName: file.name || 'all-pitches.csv',
          csvContent: fileText,
          rows,
          createdByUserId: Number(session.userId ?? 0) || null,
        });
        totalInserted += result.insertedRows;
      } else {
        const result = await saveSinglePitchPoints({
          organizationId,
          schoolCode,
          sourceFileName: file.name || 'single-pitch.csv',
          csvContent: fileText,
          rows,
          createdByUserId: Number(session.userId ?? 0) || null,
        });
        totalInserted += result.insertedRows;
      }
    }

    biomechanicsResponseCache.clear();
    await clearBiomechRollupCache({ organizationId, schoolCode }).catch(() => {});
    return NextResponse.json({ ok: true, filesProcessed: files.length, rowsInserted: totalInserted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload biomechanics CSV files.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const scopedSession = toScopedSession(session);
  if (session.role !== 'admin' && session.role !== 'coach') {
    return NextResponse.json({ error: 'Only admins/coaches can delete biomechanics pitches.' }, { status: 403 });
  }

  const schoolCode = resolveDashboardSchoolCode(scopedSession);
  if (schoolCode !== 'PCU') return forbidden();

  const scopedOrgId = resolveSchoolScopedOrganizationId(scopedSession);
  const organizationId = Number.isFinite(Number(scopedOrgId)) && Number(scopedOrgId) > 0 ? Number(scopedOrgId) : Number(session.organizationId ?? 0);
  if (organizationId <= 0) return NextResponse.json({ error: 'Unable to resolve organization scope.' }, { status: 400 });

  try {
    const payload = (await request.json().catch(() => ({}))) as { pitchKey?: string };
    const pitchKey = String(payload.pitchKey ?? '').trim();
    if (!pitchKey) return NextResponse.json({ error: 'pitchKey is required.' }, { status: 400 });
    const result = await deleteBiomechanicsPitch({
      organizationId,
      schoolCode,
      pitchKey,
    });
    biomechanicsResponseCache.clear();
    await clearBiomechRollupCache({ organizationId, schoolCode }).catch(() => {});
    return NextResponse.json({
      ok: true,
      deleted_single_pitch: result.deletedSinglePitch,
      deleted_all_pitch_row: result.deletedAllPitchRow,
      deleted_all_pitch_row_id: result.deletedAllPitchRowId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete biomechanics pitch.' },
      { status: 500 }
    );
  }
}
