import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { getPlayerForUser, getScheduleThrowingState, playerExistsInOrganization } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';
import { isBubbleColumnType } from '../../../../lib/bullpen-column-types';

const SHARED_PLAYER_ID = 0;

function parseTemplatesObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

type ScriptGrid = {
  title: string;
  rowCount: number;
  columns: string[];
  columnTypes?: HittingColumnType[];
  rows: string[][];
};
type ScriptTemplate = {
  id: string;
  name: string;
  category?: string;
  rowCount: number;
  columns: string[];
  columnTypes?: HittingColumnType[];
  rows: string[][];
  updatedAt: string;
};
type ScriptState = {
  current: ScriptGrid;
  selectedTemplateId: string;
  visibleTemplateIds: string[];
  notes?: string;
};

const DEFAULT_COLUMNS = ['Pitch Type', 'Result', 'Zone', 'Contact Quality', 'Notes'];
type HittingColumnType = 'auto' | 'text' | 'fill' | 'velocity' | 'strike' | 'two-thirds' | string;
const DEFAULT_COLUMN_TYPE: HittingColumnType = 'auto';
const ALLOWED_COLUMN_TYPES = new Set<HittingColumnType>(['auto', 'text', 'fill', 'velocity', 'strike', 'two-thirds']);
const DEFAULT_SCRIPT_STATE: ScriptState = {
  current: { title: '', rowCount: 20, columns: [...DEFAULT_COLUMNS], rows: [] },
  selectedTemplateId: '',
  visibleTemplateIds: [],
  notes: '',
};

function normalizeColumns(raw: unknown): string[] {
  const source = Array.isArray(raw) ? raw : [];
  const cols = source.map((value) => String(value ?? '').trim()).filter(Boolean).slice(0, 16);
  return cols.length ? cols : [...DEFAULT_COLUMNS];
}

function normalizeColumnTypes(raw: unknown, columnCount: number): HittingColumnType[] {
  const source = Array.isArray(raw) ? raw : [];
  const types = source.slice(0, columnCount).map((value) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'yes-no') return 'strike';
    if (isBubbleColumnType(normalized)) return normalized;
    return ALLOWED_COLUMN_TYPES.has(normalized) ? normalized : DEFAULT_COLUMN_TYPE;
  });
  while (types.length < columnCount) types.push(DEFAULT_COLUMN_TYPE);
  return types;
}

function normalizeRows(raw: unknown, rowCount: number, columnCount: number): string[][] {
  const source = Array.isArray(raw) ? raw : [];
  const rows: string[][] = source.slice(0, rowCount).map((row) => {
    if (Array.isArray(row)) {
      const values = row.slice(0, columnCount).map((value) => String(value ?? ''));
      while (values.length < columnCount) values.push('');
      return values;
    }
    return Array.from({ length: columnCount }, () => '');
  });
  while (rows.length < rowCount) rows.push(Array.from({ length: columnCount }, () => ''));
  return rows;
}

function normalizeScriptState(raw: unknown): ScriptState {
  if (!raw || typeof raw !== 'object') return DEFAULT_SCRIPT_STATE;
  const data = raw as Record<string, unknown>;
  const currentRaw = (data.current ?? {}) as Record<string, unknown>;
  const rowCount = Math.max(1, Math.min(300, Number(currentRaw.rowCount ?? 20) || 20));
  const columns = normalizeColumns(currentRaw.columns);
  const selectedTemplateId = String(data.selectedTemplateId ?? '');
  const visibleTemplateIds = Array.from(
    new Set((Array.isArray(data.visibleTemplateIds) ? data.visibleTemplateIds : []).map((value) => String(value ?? '').trim()).filter(Boolean))
  );
  return {
    current: {
      title: String(currentRaw.title ?? '').trim(),
      rowCount,
      columns,
      columnTypes: normalizeColumnTypes(currentRaw.columnTypes, columns.length),
      rows: normalizeRows(currentRaw.rows, rowCount, columns.length),
    },
    selectedTemplateId,
    visibleTemplateIds,
    notes: String(data.notes ?? ''),
  };
}

function normalizeTemplateList(raw: unknown): ScriptTemplate[] {
  const source = Array.isArray(raw) ? raw : [];
  return source
    .map((row) => {
      const t = (row ?? {}) as Record<string, unknown>;
      const count = Math.max(1, Math.min(300, Number(t.rowCount ?? 20) || 20));
      const cols = normalizeColumns(t.columns);
      return {
        id: String(t.id ?? ''),
        name: String(t.name ?? ''),
        category: String(t.category ?? '').trim() || undefined,
        rowCount: count,
        columns: cols,
        columnTypes: normalizeColumnTypes(t.columnTypes, cols.length),
        rows: normalizeRows(t.rows, count, cols.length),
        updatedAt: String(t.updatedAt ?? ''),
      };
    })
    .filter((row) => row.id && row.name);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

  const url = new URL(request.url);
  const requestedPlayerId = Number(url.searchParams.get('playerId') ?? '0');
  let playerId = 0;
  if (session.role === 'player') {
    const userId = Number(session.userId ?? 0);
    const ownPlayer = userId > 0 ? await getPlayerForUser({ organizationId, userId }) : null;
    playerId = Number(ownPlayer?.id ?? session.playerId ?? 0);
  } else if (session.role === 'admin' || session.role === 'coach') {
    playerId = requestedPlayerId;
    if (!Number.isFinite(playerId) || playerId <= 0) {
      return NextResponse.json({ error: 'playerId is required.' }, { status: 400 });
    }
    if (session.role === 'coach') {
      const allowed = await canManagePlayer(session, playerId);
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!Number.isFinite(playerId) || playerId <= 0) return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
  const exists = await playerExistsInOrganization({ organizationId, playerId });
  if (!exists) return NextResponse.json({ error: 'Player not found in this organization.' }, { status: 404 });

  const [playerState, sharedState] = await Promise.all([
    getScheduleThrowingState({ organizationId, playerId }),
    getScheduleThrowingState({ organizationId, playerId: SHARED_PLAYER_ID }),
  ]);

  const playerTemplatesObj = parseTemplatesObject(playerState.templates);
  const sharedTemplatesObj = parseTemplatesObject(sharedState.templates);
  const hittingTemplates = normalizeTemplateList(sharedTemplatesObj.hittingTemplates);
  const hittingState = normalizeScriptState(playerTemplatesObj.hitting);
  if (hittingState.visibleTemplateIds.length === 0) {
    hittingState.visibleTemplateIds = hittingTemplates.map((row) => row.id);
  }

  return NextResponse.json({
    hittingState,
    hittingTemplates,
  });
}
