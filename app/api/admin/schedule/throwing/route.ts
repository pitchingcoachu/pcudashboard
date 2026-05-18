import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { getScheduleThrowingState, playerExistsInOrganization, saveScheduleThrowingState } from '../../../../../lib/training-db';
import { logApiTiming } from '../../../../../lib/request-timing';

type ScriptGrid = {
  title: string;
  rowCount: number;
  columns: string[];
  rows: string[][];
};

type ScriptTemplate = {
  id: string;
  name: string;
  rowCount: number;
  columns: string[];
  rows: string[][];
  updatedAt: string;
};

type ScriptState = {
  current: ScriptGrid;
  selectedTemplateId: string;
  visibleTemplateIds: string[];
};
type DrillsState = {
  rowCount: number;
  rows: Array<{ drill: string; sets: string; reps: string; weight: string; notes: string }>;
};

const SHARED_PLAYER_ID = 0;
const DEFAULT_COLUMNS = ['Pitch Type', 'Ball Type', 'Stretch/Windup', 'Location', 'Situation', 'Notes'];

const DEFAULT_SCRIPT_STATE: ScriptState = {
  current: { title: '', rowCount: 20, columns: [...DEFAULT_COLUMNS], rows: [] },
  selectedTemplateId: '',
  visibleTemplateIds: [],
};
const DEFAULT_DRILLS_STATE: DrillsState = {
  rowCount: 4,
  rows: [],
};

function normalizeColumns(raw: unknown): string[] {
  const source = Array.isArray(raw) ? raw : [];
  const cols = source
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 16);
  return cols.length ? cols : [...DEFAULT_COLUMNS];
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
        rowCount: count,
        columns: cols,
        rows: normalizeRows(t.rows, count, cols.length),
        updatedAt: String(t.updatedAt ?? ''),
      };
    })
    .filter((row) => row.id && row.name);
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
      rows: normalizeRows(currentRaw.rows, rowCount, columns.length),
    },
    selectedTemplateId,
    visibleTemplateIds,
  };
}

function parseTemplatesObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (Array.isArray(raw)) {
    return {
      throwingTemplates: raw,
      bullpen: DEFAULT_SCRIPT_STATE,
      velocity: DEFAULT_SCRIPT_STATE,
      drills: DEFAULT_DRILLS_STATE,
      bullpenTemplates: [],
      velocityTemplates: [],
    };
  }
  return {};
}
function normalizeDrillsState(raw: unknown): DrillsState {
  if (!raw || typeof raw !== 'object') return DEFAULT_DRILLS_STATE;
  const data = raw as Record<string, unknown>;
  const rowCount = Math.max(1, Math.min(200, Number(data.rowCount ?? 4) || 4));
  const sourceRows = Array.isArray(data.rows) ? data.rows : [];
  const rows = sourceRows.slice(0, rowCount).map((row) => {
    const value = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    return {
      drill: String(value.drill ?? ''),
      sets: String(value.sets ?? ''),
      reps: String(value.reps ?? ''),
      weight: String(value.weight ?? ''),
      notes: String(value.notes ?? ''),
    };
  });
  while (rows.length < rowCount) rows.push({ drill: '', sets: '', reps: '', weight: '', notes: '' });
  return { rowCount, rows };
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

  const [playerState, sharedState] = await Promise.all([
    getScheduleThrowingState({ organizationId, playerId }),
    getScheduleThrowingState({ organizationId, playerId: SHARED_PLAYER_ID }),
  ]);

  const playerTemplatesObj = parseTemplatesObject(playerState.templates);
  const sharedTemplatesObj = parseTemplatesObject(sharedState.templates);

  const throwingTemplates = Array.isArray(playerTemplatesObj.throwingTemplates)
    ? (playerTemplatesObj.throwingTemplates as unknown[])
    : [];

  const legacyBullpen = normalizeScriptState(playerTemplatesObj.bullpen);
  const legacyVelocity = normalizeScriptState(playerTemplatesObj.velocity);

  const bullpenTemplates = normalizeTemplateList(sharedTemplatesObj.bullpenTemplates);
  const velocityTemplates = normalizeTemplateList(sharedTemplatesObj.velocityTemplates);

  const bullpenState = normalizeScriptState(playerTemplatesObj.bullpen);
  const velocityState = normalizeScriptState(playerTemplatesObj.velocity);

  if (bullpenState.visibleTemplateIds.length === 0) {
    bullpenState.visibleTemplateIds = bullpenTemplates.map((row) => row.id);
  }
  if (velocityState.visibleTemplateIds.length === 0) {
    velocityState.visibleTemplateIds = velocityTemplates.map((row) => row.id);
  }

  return finish(
    200,
    {
      byDate: playerState.byDate,
      weekNotes: playerState.weekNotes,
      templates: throwingTemplates,
      bullpenState: bullpenState.current.title || bullpenState.selectedTemplateId || bullpenState.visibleTemplateIds.length ? bullpenState : legacyBullpen,
      velocityState: velocityState.current.title || velocityState.selectedTemplateId || velocityState.visibleTemplateIds.length ? velocityState : legacyVelocity,
      bullpenTemplates,
      velocityTemplates,
      drillsState: normalizeDrillsState(playerTemplatesObj.drills),
    },
    { organizationId, playerId }
  );
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
    | {
        playerId?: number;
        byDate?: Record<string, unknown>;
        weekNotes?: Record<string, unknown>;
        templates?: unknown[];
        bullpenState?: unknown;
        velocityState?: unknown;
        bullpenTemplates?: unknown[];
        velocityTemplates?: unknown[];
        drillsState?: unknown;
      }
    | null;
  if (!body) return finish(400, { error: 'Invalid JSON body.' });

  const playerId = Number(body.playerId ?? 0);
  if (!Number.isFinite(playerId) || playerId <= 0) return finish(400, { error: 'playerId is required.' });

  const exists = await playerExistsInOrganization({ organizationId, playerId });
  if (!exists) return finish(404, { error: 'Player not found in this organization.' });

  const [currentPlayer, currentShared] = await Promise.all([
    getScheduleThrowingState({ organizationId, playerId }),
    getScheduleThrowingState({ organizationId, playerId: SHARED_PLAYER_ID }),
  ]);

  const playerObj = parseTemplatesObject(currentPlayer.templates);
  const sharedObj = parseTemplatesObject(currentShared.templates);

  const existingThrowingTemplates = Array.isArray(playerObj.throwingTemplates) ? (playerObj.throwingTemplates as unknown[]) : [];

  const nextBullpenTemplates = normalizeTemplateList(Array.isArray(body.bullpenTemplates) ? body.bullpenTemplates : sharedObj.bullpenTemplates);
  const nextVelocityTemplates = normalizeTemplateList(Array.isArray(body.velocityTemplates) ? body.velocityTemplates : sharedObj.velocityTemplates);

  const bullpenTemplateIds = new Set(nextBullpenTemplates.map((row) => row.id));
  const velocityTemplateIds = new Set(nextVelocityTemplates.map((row) => row.id));

  const nextBullpenState = normalizeScriptState(body.bullpenState ?? playerObj.bullpen);
  const nextVelocityState = normalizeScriptState(body.velocityState ?? playerObj.velocity);
  const nextDrillsState = normalizeDrillsState(body.drillsState ?? playerObj.drills);

  nextBullpenState.visibleTemplateIds = nextBullpenState.visibleTemplateIds.filter((id) => bullpenTemplateIds.has(id));
  nextVelocityState.visibleTemplateIds = nextVelocityState.visibleTemplateIds.filter((id) => velocityTemplateIds.has(id));

  const savePlayer = await saveScheduleThrowingState({
    organizationId,
    playerId,
    userId,
    byDate: body.byDate ?? currentPlayer.byDate ?? {},
    weekNotes: body.weekNotes ?? currentPlayer.weekNotes ?? {},
    templates: {
      throwingTemplates: Array.isArray(body.templates) ? body.templates : existingThrowingTemplates,
      bullpen: nextBullpenState,
      velocity: nextVelocityState,
      drills: nextDrillsState,
    },
  });
  if (!savePlayer.ok) return finish(400, { error: savePlayer.error });

  const saveShared = await saveScheduleThrowingState({
    organizationId,
    playerId: SHARED_PLAYER_ID,
    userId,
    byDate: currentShared.byDate ?? {},
    weekNotes: currentShared.weekNotes ?? {},
    templates: {
      bullpenTemplates: nextBullpenTemplates,
      velocityTemplates: nextVelocityTemplates,
    },
  });
  if (!saveShared.ok) return finish(400, { error: saveShared.error });

  return finish(200, { ok: true }, { organizationId, playerId });
}
