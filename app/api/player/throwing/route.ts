import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { getPlayerForUser, getRecoverableVelocityScripts, getScheduleThrowingState, playerExistsInOrganization } from '../../../../lib/training-db';
import { canManagePlayer } from '../../../../lib/portal-access';
import { normalizeDrillsState } from '../../../../lib/drills-program';

const SHARED_PLAYER_ID = 0;

function normalizeCatchPlayNotes(raw: unknown): { highDay: string; mediumDay: string; lowDay: string } {
  if (!raw || typeof raw !== 'object') return { highDay: '', mediumDay: '', lowDay: '' };
  const value = raw as Record<string, unknown>;
  return {
    highDay: String(value.highDay ?? ''),
    mediumDay: String(value.mediumDay ?? ''),
    lowDay: String(value.lowDay ?? ''),
  };
}

function normalizeCycleNotes(raw: unknown): string {
  return String(raw ?? '').slice(0, 5000);
}

function parseTemplatesObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (Array.isArray(raw)) return { throwingTemplates: raw, bullpenTemplates: [] };
  return {};
}

type ScriptGrid = {
  title: string;
  rowCount: number;
  columns: string[];
  columnTypes?: BullpenColumnType[];
  rows: string[][];
};
type ScriptTemplate = {
  id: string;
  name: string;
  rowCount: number;
  columns: string[];
  columnTypes?: BullpenColumnType[];
  rows: string[][];
  updatedAt: string;
};
type ScriptState = {
  current: ScriptGrid;
  selectedTemplateId: string;
  visibleTemplateIds: string[];
  notes?: string;
};

const DEFAULT_COLUMNS = ['Pitch Type', 'Ball Type', 'Stretch/Windup', 'Location', 'Situation', 'Notes'];
type BullpenColumnType = 'auto' | 'text' | 'fill' | 'velocity' | 'strike' | 'two-thirds';
const DEFAULT_COLUMN_TYPE: BullpenColumnType = 'auto';
const ALLOWED_COLUMN_TYPES = new Set<BullpenColumnType>(['auto', 'text', 'fill', 'velocity', 'strike', 'two-thirds']);
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

function normalizeColumnTypes(raw: unknown, columnCount: number): BullpenColumnType[] {
  const source = Array.isArray(raw) ? raw : [];
  const types = source.slice(0, columnCount).map((value) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'yes-no') return 'strike';
    return ALLOWED_COLUMN_TYPES.has(normalized as BullpenColumnType) ? normalized as BullpenColumnType : DEFAULT_COLUMN_TYPE;
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

function extractLegacyTemplates(scriptRaw: unknown): ScriptTemplate[] {
  if (!scriptRaw || typeof scriptRaw !== 'object') return [];
  const data = scriptRaw as Record<string, unknown>;
  return normalizeTemplateList(data.templates);
}

function recoverVelocityTemplates(raw: unknown): ScriptTemplate[] {
  const source = Array.isArray(raw) ? raw : [];
  return normalizeTemplateList(
    source.map((value) => {
      const script = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const name = String(script.title ?? '').trim();
      return {
        ...script,
        id: name ? `recovered-velocity:${name.toLowerCase()}` : '',
        name,
        updatedAt: '',
      };
    })
  );
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
      const CATEGORIES = ['Velocity', 'Command', 'Pitch Design', 'Combo', 'Mechanical', 'Build Ups'];
      const rawCategory = String(t.category ?? '').trim();
      return {
        id: String(t.id ?? ''),
        name: String(t.name ?? ''),
        category: CATEGORIES.includes(rawCategory) ? rawCategory : undefined,
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
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const organizationId = resolveProgrammingOrganizationId(session);
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
  let bullpenTemplates = normalizeTemplateList(sharedTemplatesObj.bullpenTemplates);
  const bullpenState = normalizeScriptState(playerTemplatesObj.bullpen);
  let velocityTemplates = normalizeTemplateList(sharedTemplatesObj.velocityTemplates);
  const velocityState = normalizeScriptState(playerTemplatesObj.velocity);
  const drillsState = normalizeDrillsState(playerTemplatesObj.drills);

  if (bullpenTemplates.length === 0) {
    bullpenTemplates = extractLegacyTemplates(playerTemplatesObj.bullpen);
  }
  if (velocityTemplates.length === 0) {
    velocityTemplates = extractLegacyTemplates(playerTemplatesObj.velocity);
  }
  if (velocityTemplates.length === 0) {
    velocityTemplates = recoverVelocityTemplates(await getRecoverableVelocityScripts({ organizationId }));
  }
  if (bullpenState.visibleTemplateIds.length === 0) {
    bullpenState.visibleTemplateIds = bullpenTemplates.map((row) => row.id);
  }
  if (velocityState.visibleTemplateIds.length === 0) {
    velocityState.visibleTemplateIds = velocityTemplates.map((row) => row.id);
  }

  return NextResponse.json({
    byDate: playerState.byDate,
    weekNotes: playerState.weekNotes,
    bullpenState,
    bullpenTemplates,
    velocityState,
    velocityTemplates,
    drillsState,
    catchPlayNotes: normalizeCatchPlayNotes(playerTemplatesObj.catchPlayNotes),
    cycleNotes: normalizeCycleNotes(playerTemplatesObj.cycleNotes),
  });
}
