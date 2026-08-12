import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { getScheduleThrowingState, playerExistsInOrganization, saveScheduleThrowingState } from '../../../../../lib/training-db';
import { logApiTiming } from '../../../../../lib/request-timing';
import { isBubbleColumnType } from '../../../../../lib/bullpen-column-types';

const SHARED_PLAYER_ID = 0;

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
  const cols = source
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 16);
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

function templateMergeKey(template: ScriptTemplate): string {
  const id = template.id.trim();
  if (id) return `id:${id}`;
  return `name:${template.name.trim().toLowerCase()}`;
}

function templateUpdatedTime(template: ScriptTemplate): number {
  const time = Date.parse(template.updatedAt);
  return Number.isFinite(time) ? time : 0;
}

function normalizeDeletedTemplateKeys(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  const keys = new Set<string>();
  for (const value of raw) {
    const id = String(value ?? '').trim();
    if (id) keys.add(`id:${id}`);
  }
  return keys;
}

/** Same union-newest-wins merge as the bullpen/velocity template lists in
 * admin/schedule/throwing/route.ts, so concurrent saves from two sessions
 * don't silently drop each other's templates. */
function mergeTemplateLists(existingRaw: unknown, incoming: ScriptTemplate[], deletedKeys: Set<string> = new Set()): ScriptTemplate[] {
  const existing = normalizeTemplateList(existingRaw);
  if (existing.length === 0) return incoming.filter((template) => !deletedKeys.has(templateMergeKey(template)));
  const merged = new Map<string, ScriptTemplate>();
  for (const template of existing) merged.set(templateMergeKey(template), template);
  for (const template of incoming) {
    const key = templateMergeKey(template);
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, template);
      continue;
    }
    const previousTime = templateUpdatedTime(previous);
    const nextTime = templateUpdatedTime(template);
    merged.set(key, nextTime >= previousTime ? template : previous);
  }
  for (const key of deletedKeys) merged.delete(key);
  return Array.from(merged.values());
}

function parseTemplatesObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export async function GET(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.hitting.GET', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };

  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) return finish(400, { error: 'Session context missing. Please log out and log in again.' });

  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get('playerId') ?? '0');
  if (!Number.isFinite(playerId) || playerId < 0) return finish(400, { error: 'playerId is required.' });

  const isSharedOnly = playerId === 0;
  if (!isSharedOnly) {
    const exists = await playerExistsInOrganization({ organizationId, playerId });
    if (!exists) return finish(404, { error: 'Player not found in this organization.' });
  }

  const [playerState, sharedState] = await Promise.all([
    isSharedOnly ? Promise.resolve({ templates: {}, byDate: {}, weekNotes: {} }) : getScheduleThrowingState({ organizationId, playerId }),
    getScheduleThrowingState({ organizationId, playerId: SHARED_PLAYER_ID }),
  ]);

  const playerTemplatesObj = parseTemplatesObject(playerState.templates);
  const sharedTemplatesObj = parseTemplatesObject(sharedState.templates);

  const hittingTemplates = normalizeTemplateList(sharedTemplatesObj.hittingTemplates);
  const hittingState = normalizeScriptState(playerTemplatesObj.hitting);
  if (hittingState.visibleTemplateIds.length === 0) {
    hittingState.visibleTemplateIds = hittingTemplates.map((row) => row.id);
  }

  return finish(200, { hittingState, hittingTemplates }, { organizationId, playerId });
}

export async function POST(request: Request) {
  const startedAtMs = Date.now();
  const finish = (status: number, payload: Record<string, unknown>, meta?: Record<string, unknown>) => {
    logApiTiming({ route: 'admin.schedule.hitting.POST', startedAtMs, status, meta });
    return NextResponse.json(payload, { status });
  };

  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return finish(401, { error: 'Unauthorized' });
  if (session.role === 'player') return finish(403, { error: 'Forbidden' });

  const organizationId = await resolveProgrammingOrganizationId(session);
  const userId = Number(session.userId ?? 0);
  if (organizationId <= 0 || userId <= 0) {
    return finish(400, { error: 'Session context missing. Please log out and log in again.' });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        playerId?: number;
        hittingState?: unknown;
        hittingTemplates?: unknown[];
        deletedHittingTemplateIds?: unknown[];
      }
    | null;
  if (!body) return finish(400, { error: 'Invalid JSON body.' });

  const playerId = Number(body.playerId ?? 0);
  if (!Number.isFinite(playerId) || playerId < 0) return finish(400, { error: 'playerId is required.' });

  // playerId=0 means shared/global templates only — no player-specific data.
  const isSharedOnly = playerId === 0;

  if (!isSharedOnly) {
    const exists = await playerExistsInOrganization({ organizationId, playerId });
    if (!exists) return finish(404, { error: 'Player not found in this organization.' });
  }

  const [currentPlayer, currentShared] = await Promise.all([
    isSharedOnly ? Promise.resolve({ templates: {}, byDate: {}, weekNotes: {} }) : getScheduleThrowingState({ organizationId, playerId }),
    getScheduleThrowingState({ organizationId, playerId: SHARED_PLAYER_ID }),
  ]);

  // templates_json is a single JSONB blob shared with Bullpens/Velocity/Drills
  // (see schedule_throwing_state) and saveScheduleThrowingState overwrites the
  // whole column -- so the existing object must be read and only the hitting-
  // specific keys replaced, or a hitting save would silently wipe out that
  // player's bullpen/velocity/drills data.
  const playerObj = parseTemplatesObject(currentPlayer.templates);
  const sharedObj = parseTemplatesObject(currentShared.templates);

  const hasHittingTemplatesInput = Array.isArray(body.hittingTemplates);
  const deletedHittingTemplateKeys = normalizeDeletedTemplateKeys(body.deletedHittingTemplateIds);
  let nextHittingTemplates = normalizeTemplateList(hasHittingTemplatesInput ? body.hittingTemplates : sharedObj.hittingTemplates);
  if (hasHittingTemplatesInput) {
    nextHittingTemplates = mergeTemplateLists(sharedObj.hittingTemplates, nextHittingTemplates, deletedHittingTemplateKeys);
  }

  const hittingTemplateIds = new Set(nextHittingTemplates.map((row) => row.id));
  const nextHittingState = normalizeScriptState(body.hittingState ?? playerObj.hitting);
  nextHittingState.visibleTemplateIds = nextHittingState.visibleTemplateIds.filter((id) => hittingTemplateIds.has(id));

  if (!isSharedOnly) {
    const savePlayer = await saveScheduleThrowingState({
      organizationId,
      playerId,
      userId,
      byDate: currentPlayer.byDate ?? {},
      weekNotes: currentPlayer.weekNotes ?? {},
      templates: {
        ...playerObj,
        hitting: nextHittingState,
      },
    });
    if (!savePlayer.ok) return finish(400, { error: savePlayer.error });
  }

  const saveShared = await saveScheduleThrowingState({
    organizationId,
    playerId: SHARED_PLAYER_ID,
    userId,
    byDate: currentShared.byDate ?? {},
    weekNotes: currentShared.weekNotes ?? {},
    templates: {
      ...sharedObj,
      hittingTemplates: nextHittingTemplates,
    },
  });
  if (!saveShared.ok) return finish(400, { error: saveShared.error });

  return finish(200, { ok: true }, { organizationId, playerId });
}
