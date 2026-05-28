import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
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
  const selectedPitcher = String(searchParams.get('pitcher') ?? '').trim() || null;
  const selectedTag = String(searchParams.get('tag') ?? '').trim() || null;
  const selectedPitchType = String(searchParams.get('pitchType') ?? '').trim() || null;
  const forceMode = String(searchParams.get('forceMode') ?? '').trim().toLowerCase() === 'bw' ? 'bw' : 'force';
  try {
    const pitcherOptions = await fetchPcuPitchers().catch(() => []);
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
    let appliedStartDate = startDateParam;
    let appliedEndDate = endDateParam;
    let selectedOrgId = organizationId;

    for (const orgId of candidateOrgIds) {
      let orgStartDate = startDateParam;
      let orgEndDate = endDateParam;
      if (!orgStartDate && !orgEndDate) {
        const latestDate = await getLatestBiomechanicsDate({ organizationId: orgId, schoolCode });
        if (latestDate) {
          orgStartDate = latestDate;
          orgEndDate = latestDate;
        }
      }

      const datedSnapshot = await getBiomechanicsSnapshot({
        organizationId: orgId,
        schoolCode,
        startDate: orgStartDate,
        endDate: orgEndDate,
        selectedPitchKey,
        selectedPitcher,
        selectedTag,
        selectedPitchType,
        forceMode,
      });

      if (hasSnapshotData(datedSnapshot)) {
        snapshot = datedSnapshot;
        selectedOrgId = orgId;
        appliedStartDate = orgStartDate;
        appliedEndDate = orgEndDate;
        break;
      }

      if (!startDateParam && !endDateParam && (orgStartDate || orgEndDate)) {
        const unboundedSnapshot = await getBiomechanicsSnapshot({
          organizationId: orgId,
          schoolCode,
          startDate: null,
          endDate: null,
          selectedPitchKey,
          selectedPitcher,
          selectedTag,
          selectedPitchType,
          forceMode,
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
      snapshot = await getBiomechanicsSnapshot({
        organizationId,
        schoolCode,
        startDate: startDateParam,
        endDate: endDateParam,
        selectedPitchKey,
        selectedPitcher,
        selectedTag,
        selectedPitchType,
        forceMode,
      });
      selectedOrgId = organizationId;
      appliedStartDate = startDateParam;
      appliedEndDate = endDateParam;
    }

    return NextResponse.json({
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
      match_summary: snapshot.matchSummary,
      pitcher_options: pitcherOptions,
      debug: {
        candidate_org_ids: candidateOrgIds,
        selected_org_id: selectedOrgId,
        applied_start_date: appliedStartDate,
        applied_end_date: appliedEndDate,
        table_rows_count: snapshot.tableRows.length,
        pitch_options_count: snapshot.pitchOptions.length,
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
