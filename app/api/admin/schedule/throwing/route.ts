import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import {
  getRecoverableBullpenScripts,
  getRecoverableVelocityScripts,
  getScheduleThrowingState,
  getPcuSharedThrowingState,
  playerExistsInOrganization,
  saveScheduleThrowingState,
} from '../../../../../lib/training-db';
import { logApiTiming } from '../../../../../lib/request-timing';
import { normalizeDrillsState, normalizeDrillTemplates } from '../../../../../lib/drills-program';

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
  category?: string;
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
const SHARED_PLAYER_ID = 0;
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
  const cols = source
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 16);
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

function extractLegacyTemplates(scriptRaw: unknown): ScriptTemplate[] {
  if (!scriptRaw || typeof scriptRaw !== 'object') return [];
  const data = scriptRaw as Record<string, unknown>;
  return normalizeTemplateList(data.templates);
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

function mergeTemplateLists(existingRaw: unknown, incoming: ScriptTemplate[]): ScriptTemplate[] {
  const existing = normalizeTemplateList(existingRaw);
  if (existing.length === 0) return incoming;
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
    const shouldUseIncoming = nextTime >= previousTime;
    merged.set(key, {
      ...(shouldUseIncoming ? template : previous),
      category: (shouldUseIncoming ? template.category : previous.category) ?? previous.category ?? template.category,
    });
  }
  return Array.from(merged.values());
}

function recoverBullpenTemplates(raw: unknown): ScriptTemplate[] {
  const source = Array.isArray(raw) ? raw : [];
  return normalizeTemplateList(
    source.map((value) => {
      const script = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const name = String(script.title ?? '').trim();
      return {
        ...script,
        id: name ? `recovered-bullpen:${name.toLowerCase()}` : '',
        name,
        updatedAt: '',
      };
    })
  );
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
  if (Array.isArray(raw)) {
    return {
      throwingTemplates: raw,
      bullpen: DEFAULT_SCRIPT_STATE,
      velocity: DEFAULT_SCRIPT_STATE,
      bullpenTemplates: [],
      velocityTemplates: [],
      preThrowDrillTemplates: [],
      postThrowDrillTemplates: [],
    };
  }
  return {};
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
  if (!Number.isFinite(playerId) || playerId < 0) return finish(400, { error: 'playerId is required.' });

  const isSharedOnly = playerId === 0;
  if (!isSharedOnly) {
    const exists = await playerExistsInOrganization({ organizationId, playerId });
    if (!exists) return finish(404, { error: 'Player not found in this organization.' });
  }

  const PCU_ORG_ID = 1;
  const isNonPcuOrg = organizationId !== PCU_ORG_ID;

  const [playerState, sharedState, pcuSharedState] = await Promise.all([
    isSharedOnly ? Promise.resolve({ templates: {}, byDate: {}, weekNotes: {} }) : getScheduleThrowingState({ organizationId, playerId }),
    getScheduleThrowingState({ organizationId, playerId: SHARED_PLAYER_ID }),
    isNonPcuOrg ? getPcuSharedThrowingState() : Promise.resolve(null),
  ]);

  const playerTemplatesObj = parseTemplatesObject(playerState.templates);
  const sharedTemplatesObj = parseTemplatesObject(sharedState.templates);
  const pcuTemplatesObj = pcuSharedState ? parseTemplatesObject(pcuSharedState.templates) : null;

  const orgThrowingTemplates = Array.isArray(sharedTemplatesObj.throwingTemplates)
    ? (sharedTemplatesObj.throwingTemplates as unknown[])
    : [];
  const pcuThrowingTemplates = pcuTemplatesObj && Array.isArray(pcuTemplatesObj.throwingTemplates)
    ? (pcuTemplatesObj.throwingTemplates as unknown[])
    : [];
  // Merge PCU throwing templates that aren't already present by name
  const orgThrowingNames = new Set(orgThrowingTemplates.map((t) => String((t as Record<string, unknown>).name ?? '').trim().toLowerCase()).filter(Boolean));
  const throwingTemplates = [
    ...orgThrowingTemplates,
    ...pcuThrowingTemplates.filter((t) => {
      const name = String((t as Record<string, unknown>).name ?? '').trim().toLowerCase();
      return name && !orgThrowingNames.has(name);
    }),
  ];

  const legacyBullpen = normalizeScriptState(playerTemplatesObj.bullpen);
  const legacyVelocity = normalizeScriptState(playerTemplatesObj.velocity);

  let bullpenTemplates = normalizeTemplateList(sharedTemplatesObj.bullpenTemplates);
  let velocityTemplates = normalizeTemplateList(sharedTemplatesObj.velocityTemplates);
  const preThrowDrillTemplates = normalizeDrillTemplates(sharedTemplatesObj.preThrowDrillTemplates);
  const postThrowDrillTemplates = normalizeDrillTemplates(sharedTemplatesObj.postThrowDrillTemplates);

  if (bullpenTemplates.length === 0 && !isSharedOnly) {
    bullpenTemplates = extractLegacyTemplates(playerTemplatesObj.bullpen);
  }
  if (bullpenTemplates.length === 0) {
    bullpenTemplates = recoverBullpenTemplates(await getRecoverableBullpenScripts({ organizationId }));
  }
  if (velocityTemplates.length === 0 && !isSharedOnly) {
    velocityTemplates = extractLegacyTemplates(playerTemplatesObj.velocity);
  }
  if (velocityTemplates.length === 0) {
    velocityTemplates = recoverVelocityTemplates(await getRecoverableVelocityScripts({ organizationId }));
  }

  // Merge PCU bullpen/velocity templates for non-PCU orgs — org's own templates take priority by name
  if (pcuTemplatesObj) {
    const pcuBullpen = normalizeTemplateList(pcuTemplatesObj.bullpenTemplates);
    if (pcuBullpen.length > 0) {
      const orgNames = new Set(bullpenTemplates.map((t) => t.name.trim().toLowerCase()));
      bullpenTemplates = [
        ...bullpenTemplates,
        ...pcuBullpen.filter((t) => !orgNames.has(t.name.trim().toLowerCase())),
      ];
    }
    const pcuVelocity = normalizeTemplateList(pcuTemplatesObj.velocityTemplates);
    const pcuVelocityTemplates = pcuVelocity.length > 0
      ? pcuVelocity
      : recoverVelocityTemplates(await getRecoverableVelocityScripts({ organizationId: PCU_ORG_ID }));
    if (pcuVelocityTemplates.length > 0) {
      const orgNames = new Set(velocityTemplates.map((t) => t.name.trim().toLowerCase()));
      velocityTemplates = [
        ...velocityTemplates,
        ...pcuVelocityTemplates.filter((t) => !orgNames.has(t.name.trim().toLowerCase())),
      ];
    }
  }

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
      preThrowDrillTemplates,
      postThrowDrillTemplates,
      catchPlayNotes: normalizeCatchPlayNotes(playerTemplatesObj.catchPlayNotes),
      cycleNotes: normalizeCycleNotes(playerTemplatesObj.cycleNotes),
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
        preThrowDrillTemplates?: unknown[];
        postThrowDrillTemplates?: unknown[];
        catchPlayNotes?: unknown;
        cycleNotes?: unknown;
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

  const playerObj = parseTemplatesObject(currentPlayer.templates);
  const sharedObj = parseTemplatesObject(currentShared.templates);

  const existingThrowingTemplates = Array.isArray(sharedObj.throwingTemplates) ? (sharedObj.throwingTemplates as unknown[]) : [];

  const hasBullpenTemplatesInput = Array.isArray(body.bullpenTemplates);
  const hasVelocityTemplatesInput = Array.isArray(body.velocityTemplates);
  let nextBullpenTemplates = normalizeTemplateList(hasBullpenTemplatesInput ? body.bullpenTemplates : sharedObj.bullpenTemplates);
  let nextVelocityTemplates = normalizeTemplateList(hasVelocityTemplatesInput ? body.velocityTemplates : sharedObj.velocityTemplates);
  if (hasBullpenTemplatesInput) {
    nextBullpenTemplates = mergeTemplateLists(sharedObj.bullpenTemplates, nextBullpenTemplates);
  }
  if (hasVelocityTemplatesInput) {
    nextVelocityTemplates = mergeTemplateLists(sharedObj.velocityTemplates, nextVelocityTemplates);
  }
  const nextPreThrowDrillTemplates = normalizeDrillTemplates(
    Array.isArray(body.preThrowDrillTemplates) ? body.preThrowDrillTemplates : sharedObj.preThrowDrillTemplates
  );
  const nextPostThrowDrillTemplates = normalizeDrillTemplates(
    Array.isArray(body.postThrowDrillTemplates) ? body.postThrowDrillTemplates : sharedObj.postThrowDrillTemplates
  );

  if (nextBullpenTemplates.length === 0 && !hasBullpenTemplatesInput && !isSharedOnly) {
    nextBullpenTemplates = extractLegacyTemplates(playerObj.bullpen);
  }
  if (nextBullpenTemplates.length === 0 && !hasBullpenTemplatesInput) {
    nextBullpenTemplates = recoverBullpenTemplates(await getRecoverableBullpenScripts({ organizationId }));
  }
  if (nextVelocityTemplates.length === 0 && !hasVelocityTemplatesInput && !isSharedOnly) {
    nextVelocityTemplates = extractLegacyTemplates(playerObj.velocity);
  }
  if (nextVelocityTemplates.length === 0 && !hasVelocityTemplatesInput) {
    nextVelocityTemplates = recoverVelocityTemplates(await getRecoverableVelocityScripts({ organizationId }));
  }

  const bullpenTemplateIds = new Set(nextBullpenTemplates.map((row) => row.id));
  const velocityTemplateIds = new Set(nextVelocityTemplates.map((row) => row.id));

  const nextBullpenState = normalizeScriptState(body.bullpenState ?? playerObj.bullpen);
  const nextVelocityState = normalizeScriptState(body.velocityState ?? playerObj.velocity);
  const nextDrillsState = normalizeDrillsState(body.drillsState ?? playerObj.drills);

  const preTemplateIds = new Set(nextPreThrowDrillTemplates.map((template) => template.id));
  const postTemplateIds = new Set(nextPostThrowDrillTemplates.map((template) => template.id));
  if (!preTemplateIds.has(nextDrillsState.pre.selectedTemplateId)) nextDrillsState.pre.selectedTemplateId = '';
  if (!postTemplateIds.has(nextDrillsState.post.selectedTemplateId)) nextDrillsState.post.selectedTemplateId = '';

  nextBullpenState.visibleTemplateIds = nextBullpenState.visibleTemplateIds.filter((id) => bullpenTemplateIds.has(id));
  nextVelocityState.visibleTemplateIds = nextVelocityState.visibleTemplateIds.filter((id) => velocityTemplateIds.has(id));

  if (!isSharedOnly) {
    const savePlayer = await saveScheduleThrowingState({
      organizationId,
      playerId,
      userId,
      byDate: body.byDate ?? currentPlayer.byDate ?? {},
      weekNotes: body.weekNotes ?? currentPlayer.weekNotes ?? {},
      templates: {
        bullpen: nextBullpenState,
        velocity: nextVelocityState,
        drills: nextDrillsState,
        catchPlayNotes: normalizeCatchPlayNotes(body.catchPlayNotes ?? playerObj.catchPlayNotes),
        cycleNotes: normalizeCycleNotes(body.cycleNotes ?? playerObj.cycleNotes),
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
      throwingTemplates: Array.isArray(body.templates) ? body.templates : existingThrowingTemplates,
      bullpenTemplates: nextBullpenTemplates,
      velocityTemplates: nextVelocityTemplates,
      preThrowDrillTemplates: nextPreThrowDrillTemplates,
      postThrowDrillTemplates: nextPostThrowDrillTemplates,
    },
  });
  if (!saveShared.ok) return finish(400, { error: saveShared.error });

  return finish(200, { ok: true }, { organizationId, playerId });
}
