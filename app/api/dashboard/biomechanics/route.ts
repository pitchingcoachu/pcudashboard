import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import type { PortalSession } from '../../../../lib/portal-session';
import {
  getBiomechanicsSnapshot,
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
      pitch_options: [],
      selected_pitch_key: null,
      selected_pitch_points: [],
    });
  }

  const { searchParams } = new URL(request.url);
  const startDate = String(searchParams.get('startDate') ?? '').trim() || null;
  const endDate = String(searchParams.get('endDate') ?? '').trim() || null;
  const selectedPitchKey = String(searchParams.get('pitchKey') ?? '').trim() || null;
  const selectedPitcher = String(searchParams.get('pitcher') ?? '').trim() || null;

  const pitcherOptions = await fetchPcuPitchers().catch(() => []);
  try {
    const snapshot = await getBiomechanicsSnapshot({
      organizationId,
      schoolCode,
      startDate,
      endDate,
      selectedPitchKey,
      selectedPitcher,
    });

    return NextResponse.json({
      table_columns: snapshot.tableColumns,
      table_rows: snapshot.tableRows,
      pitch_options: snapshot.pitchOptions,
      selected_pitch_key: snapshot.selectedPitchKey,
      selected_pitch_points: snapshot.selectedPitchPoints,
      pitcher_options: pitcherOptions,
    });
  } catch (error) {
    return NextResponse.json({
      table_columns: [],
      table_rows: [],
      pitch_options: [],
      selected_pitch_key: null,
      selected_pitch_points: [],
      pitcher_options: pitcherOptions,
      error: error instanceof Error ? error.message : 'Failed to load biomechanics data.',
    });
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
    const selectedPitcher = String(formData.get('pitcherName') ?? '').trim();

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
        if (!selectedPitcher) {
          return NextResponse.json({ error: 'Select a pitcher before uploading single-pitch CSV files.' }, { status: 400 });
        }
        if (!pitcherOptions.includes(selectedPitcher)) {
          return NextResponse.json({ error: 'Selected pitcher is not in the PCU allowed pitcher list.' }, { status: 400 });
        }
        const result = await saveSinglePitchPoints({
          organizationId,
          schoolCode,
          sourceFileName: file.name || 'single-pitch.csv',
          csvContent: fileText,
          rows,
          createdByUserId: Number(session.userId ?? 0) || null,
          pitcherName: selectedPitcher,
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
