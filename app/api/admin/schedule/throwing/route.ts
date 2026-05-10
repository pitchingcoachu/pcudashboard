import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { getScheduleThrowingState, playerExistsInOrganization, saveScheduleThrowingState } from '../../../../../lib/training-db';
import { logApiTiming } from '../../../../../lib/request-timing';

type BullpenScript = {
  title: string;
  rowCount: number;
  columns: string[];
  rows: string[][];
};

type BullpenTemplate = {
  id: string;
  name: string;
  rowCount: number;
  columns: string[];
  rows: string[][];
  updatedAt: string;
};

type BullpenState = {
  current: BullpenScript;
  templates: BullpenTemplate[];
  selectedTemplateId: string;
};

const DEFAULT_BULLPEN_STATE: BullpenState = {
  current: { title: '', rowCount: 20, columns: ['Pitch Type', 'Ball Type', 'Stretch/Windup', 'Location', 'Situation', 'Notes'], rows: [] },
  templates: [],
  selectedTemplateId: '',
};

const DEFAULT_BULLPEN_COLUMNS = ['Pitch Type', 'Ball Type', 'Stretch/Windup', 'Location', 'Situation', 'Notes'];

function normalizeColumns(raw: unknown): string[] {
  const source = Array.isArray(raw) ? raw : [];
  const cols = source
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 16);
  return cols.length ? cols : [...DEFAULT_BULLPEN_COLUMNS];
}

function toLegacyRowArray(row: Record<string, unknown>): string[] {
  return [
    String(row.pitchType ?? ''),
    String(row.ballType ?? ''),
    String(row.stretchWindup ?? ''),
    String(row.location ?? ''),
    String(row.situation ?? ''),
    String(row.notes ?? ''),
  ];
}

function normalizeRows(raw: unknown, rowCount: number, columnCount: number): string[][] {
  const source = Array.isArray(raw) ? raw : [];
  const rows: string[][] = source.slice(0, rowCount).map((row) => {
    if (Array.isArray(row)) {
      const values = row.slice(0, columnCount).map((value) => String(value ?? ''));
      while (values.length < columnCount) values.push('');
      return values;
    }
    if (row && typeof row === 'object') {
      const values = toLegacyRowArray(row as Record<string, unknown>).slice(0, columnCount);
      while (values.length < columnCount) values.push('');
      return values;
    }
    return Array.from({ length: columnCount }, () => '');
  });
  while (rows.length < rowCount) rows.push(Array.from({ length: columnCount }, () => ''));
  return rows;
}

function normalizeBullpenState(raw: unknown): BullpenState {
  if (!raw || typeof raw !== 'object') return DEFAULT_BULLPEN_STATE;
  const data = raw as Record<string, unknown>;
  const currentRaw = (data.current ?? {}) as Record<string, unknown>;
  const title = String(currentRaw.title ?? '').trim();
  const rowCount = Math.max(1, Math.min(300, Number(currentRaw.rowCount ?? 20) || 20));
  const columns = normalizeColumns(currentRaw.columns);
  const rows = normalizeRows(currentRaw.rows, rowCount, columns.length);
  const templatesRaw = Array.isArray(data.templates) ? data.templates : [];
  const templates = templatesRaw.map((row) => {
    const t = (row ?? {}) as Record<string, unknown>;
    const count = Math.max(1, Math.min(300, Number(t.rowCount ?? 20) || 20));
    const templateColumns = normalizeColumns(t.columns);
    const templateRows = normalizeRows(t.rows, count, templateColumns.length);
    return {
      id: String(t.id ?? ''),
      name: String(t.name ?? ''),
      rowCount: count,
      columns: templateColumns,
      rows: templateRows,
      updatedAt: String(t.updatedAt ?? ''),
    };
  }).filter((row) => row.id && row.name);
  const selectedTemplateId = String(data.selectedTemplateId ?? '');
  return {
    current: { title, rowCount, columns, rows },
    templates,
    selectedTemplateId,
  };
}

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.throwing.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };

  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return finish(400, { error: 'Session context missing. Please log out and log in again.' });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId <= 0) return finish(400, { error: 'playerId is required.' });

  const exists = await playerExistsInOrganization({ organizationId, playerId });
  if (!exists) return finish(404, { error: 'Player not found in this organization.' });

  const state = await getScheduleThrowingState({ organizationId, playerId });
  const templatesRaw = state.templates;
  const throwingTemplates = Array.isArray(templatesRaw)
    ? templatesRaw
    : (templatesRaw && typeof templatesRaw === 'object' && Array.isArray((templatesRaw as Record<string, unknown>).throwingTemplates))
      ? ((templatesRaw as Record<string, unknown>).throwingTemplates as unknown[])
      : [];
  const bullpenRaw = !Array.isArray(templatesRaw) && templatesRaw && typeof templatesRaw === 'object'
    ? (templatesRaw as Record<string, unknown>).bullpen
    : null;
  return finish(200, {
    byDate: state.byDate,
    weekNotes: state.weekNotes,
    templates: throwingTemplates,
    bullpenState: normalizeBullpenState(bullpenRaw),
  }, { organizationId, playerId });
}

export async function POST(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.throwing.POST', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };

  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = resolveProgrammingOrganizationId(session);
  const userId = Number(session.userId ?? 0);
  if (organizationId <= 0 || userId <= 0) {
    return finish(400, { error: 'Session context missing. Please log out and log in again.' });
  }

  const body = (await request.json().catch(() => null)) as
    | { playerId?: number; byDate?: Record<string, unknown>; weekNotes?: Record<string, unknown>; templates?: unknown[]; bullpenState?: unknown }
    | null;
  if (!body) return finish(400, { error: 'Invalid JSON body.' });

  const playerId = Number(body.playerId ?? 0);
  if (!Number.isFinite(playerId) || playerId <= 0) return finish(400, { error: 'playerId is required.' });

  const exists = await playerExistsInOrganization({ organizationId, playerId });
  if (!exists) return finish(404, { error: 'Player not found in this organization.' });

  const current = await getScheduleThrowingState({ organizationId, playerId });
  const existingTemplatesRaw = current.templates;
  const existingThrowingTemplates = Array.isArray(existingTemplatesRaw)
    ? existingTemplatesRaw
    : (existingTemplatesRaw && typeof existingTemplatesRaw === 'object' && Array.isArray((existingTemplatesRaw as Record<string, unknown>).throwingTemplates))
      ? ((existingTemplatesRaw as Record<string, unknown>).throwingTemplates as unknown[])
      : [];
  const existingBullpenRaw = !Array.isArray(existingTemplatesRaw) && existingTemplatesRaw && typeof existingTemplatesRaw === 'object'
    ? (existingTemplatesRaw as Record<string, unknown>).bullpen
    : null;

  const result = await saveScheduleThrowingState({
    organizationId,
    playerId,
    userId,
    byDate: body.byDate ?? {},
    weekNotes: body.weekNotes ?? {},
    templates: {
      throwingTemplates: Array.isArray(body.templates) ? body.templates : existingThrowingTemplates,
      bullpen: normalizeBullpenState(body.bullpenState ?? existingBullpenRaw),
    },
  });
  if (!result.ok) return finish(400, { error: result.error });
  return finish(200, { ok: true }, { organizationId, playerId });
}
