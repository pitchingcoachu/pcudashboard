import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getDbPool, isDatabaseConfigured } from '../auth-db';
import { applyGameEvent, rebuildGameState } from './engine';
import { calculateGameTrackerStats, type GameStatSource } from './stats';
import {
  GAME_TYPES,
  initialGameState,
  type GameEventInput,
  type GameState,
  type GameTrackerGame,
  type GameTrackerPlayer,
  type GameType,
  type Handedness,
  type ScenarioFilters,
  type StoredGameEvent,
  type TeamSide,
  type ThrowingHand,
} from './types';

declare global {
  var __gameTrackerReady: boolean | undefined;
  var __gameTrackerReadyPromise: Promise<void> | undefined;
}

type DbGameRow = {
  id: number;
  organization_id: number;
  school_code: string;
  game_type: GameType;
  game_date: string | Date;
  season: string;
  opponent_name: string;
  location: string | null;
  home_away: 'home' | 'away';
  innings_scheduled: number;
  status: 'setup' | 'live' | 'final';
  notes: string | null;
  state_jsonb: GameState | string | null;
  revision: number;
  created_at: string | Date;
  updated_at: string | Date;
};

type DbPlayerRow = {
  id: number;
  game_id: number;
  team_side: TeamSide;
  player_id: number | null;
  display_name: string;
  jersey_number: string | null;
  bats: Handedness;
  throws: ThrowingHand;
  batting_order: number | null;
  position: string | null;
  is_starter: boolean;
  is_active: boolean;
};

type DbEventRow = {
  id: number;
  game_id: number;
  sequence_no: number;
  input_jsonb: GameEventInput | string;
  situation_jsonb: StoredGameEvent['situation'] | string;
  state_after_jsonb: GameState | string;
  is_voided: boolean;
  created_at: string | Date;
};

export type RosterPlayer = {
  playerId: number;
  fullName: string;
  jerseyNumber: string | null;
  bats: Handedness | null;
  throws: ThrowingHand | null;
  position: string | null;
};

export type LineupPlayerInput = {
  id?: number | null;
  teamSide: TeamSide;
  playerId?: number | null;
  displayName: string;
  jerseyNumber?: string | null;
  bats: Handedness;
  throws: ThrowingHand;
  battingOrder?: number | null;
  position?: string | null;
  isStarter?: boolean;
  isActive?: boolean;
};

function isoDate(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function isoTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function parseJson<T>(value: T | string | null, fallback: T): T {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapGame(row: DbGameRow): GameTrackerGame {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), schoolCode: row.school_code,
    gameType: row.game_type, gameDate: isoDate(row.game_date), season: row.season, opponentName: row.opponent_name,
    location: row.location, homeAway: row.home_away, inningsScheduled: Number(row.innings_scheduled), status: row.status,
    notes: row.notes, state: parseJson(row.state_jsonb, initialGameState()), revision: Number(row.revision),
    createdAt: isoTime(row.created_at), updatedAt: isoTime(row.updated_at),
  };
}

function mapPlayer(row: DbPlayerRow): GameTrackerPlayer {
  return {
    id: Number(row.id), gameId: Number(row.game_id), teamSide: row.team_side, playerId: row.player_id ? Number(row.player_id) : null,
    displayName: row.display_name, jerseyNumber: row.jersey_number, bats: row.bats, throws: row.throws,
    battingOrder: row.batting_order === null ? null : Number(row.batting_order), position: row.position,
    isStarter: row.is_starter, isActive: row.is_active,
  };
}

function mapEvent(row: DbEventRow): StoredGameEvent {
  return {
    id: Number(row.id), gameId: Number(row.game_id), sequence: Number(row.sequence_no),
    input: parseJson(row.input_jsonb, {} as GameEventInput),
    situation: parseJson(row.situation_jsonb, {} as StoredGameEvent['situation']),
    stateAfter: parseJson(row.state_after_jsonb, initialGameState()),
    isVoided: row.is_voided, createdAt: isoTime(row.created_at),
  };
}

export async function ensureGameTrackerReady(): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  if (global.__gameTrackerReady) return;
  if (global.__gameTrackerReadyPromise) return global.__gameTrackerReadyPromise;
  global.__gameTrackerReadyPromise = (async () => {
    const pool = getDbPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_tracker_games (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        school_code TEXT NOT NULL,
        game_type TEXT NOT NULL CHECK (game_type IN ('game','scrimmage','live_bp')),
        game_date DATE NOT NULL,
        season TEXT NOT NULL,
        opponent_name TEXT NOT NULL,
        location TEXT,
        home_away TEXT NOT NULL CHECK (home_away IN ('home','away')),
        innings_scheduled INTEGER NOT NULL DEFAULT 9 CHECK (innings_scheduled BETWEEN 1 AND 30),
        status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','live','final')),
        notes TEXT,
        state_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
        revision INTEGER NOT NULL DEFAULT 0,
        created_by_user_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS game_tracker_games_org_date_idx
        ON game_tracker_games (organization_id, game_date DESC, id DESC);
      CREATE INDEX IF NOT EXISTS game_tracker_games_school_type_date_idx
        ON game_tracker_games (school_code, game_type, game_date DESC);

      CREATE TABLE IF NOT EXISTS game_tracker_players (
        id BIGSERIAL PRIMARY KEY,
        game_id BIGINT NOT NULL REFERENCES game_tracker_games(id) ON DELETE CASCADE,
        team_side TEXT NOT NULL CHECK (team_side IN ('us','opponent')),
        player_id BIGINT,
        display_name TEXT NOT NULL,
        jersey_number TEXT,
        bats TEXT NOT NULL CHECK (bats IN ('R','L','S')),
        throws TEXT NOT NULL CHECK (throws IN ('R','L')),
        batting_order INTEGER,
        position TEXT,
        is_starter BOOLEAN NOT NULL DEFAULT TRUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS game_tracker_players_game_side_order_idx
        ON game_tracker_players (game_id, team_side, batting_order, id);
      CREATE INDEX IF NOT EXISTS game_tracker_players_player_idx
        ON game_tracker_players (player_id, game_id);

      CREATE TABLE IF NOT EXISTS game_tracker_events (
        id BIGSERIAL PRIMARY KEY,
        game_id BIGINT NOT NULL REFERENCES game_tracker_games(id) ON DELETE CASCADE,
        sequence_no INTEGER NOT NULL,
        client_event_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('pitch','runner')),
        input_jsonb JSONB NOT NULL,
        situation_jsonb JSONB NOT NULL,
        state_after_jsonb JSONB NOT NULL,
        is_voided BOOLEAN NOT NULL DEFAULT FALSE,
        voided_by_user_id BIGINT,
        created_by_user_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        voided_at TIMESTAMPTZ,
        UNIQUE (game_id, sequence_no),
        UNIQUE (game_id, client_event_id)
      );
      CREATE INDEX IF NOT EXISTS game_tracker_events_game_active_idx
        ON game_tracker_events (game_id, sequence_no) WHERE is_voided = FALSE;
      CREATE INDEX IF NOT EXISTS game_tracker_events_situation_idx
        ON game_tracker_events USING GIN (situation_jsonb);
    `);
    global.__gameTrackerReady = true;
  })().finally(() => { global.__gameTrackerReadyPromise = undefined; });
  await global.__gameTrackerReadyPromise;
}

export async function listGameTrackerRoster(organizationId: number): Promise<RosterPlayer[]> {
  await ensureGameTrackerReady();
  const result = await getDbPool().query<{
    player_id: number; full_name: string; jersey_number: string | null; bats_hand: string | null; throws_hand: string | null; position: string | null;
  }>(`
    SELECT id AS player_id, full_name, NULL::text AS jersey_number, bats_hand, throws_hand, position
    FROM players
    WHERE organization_id = $1 AND LOWER(COALESCE(status, 'active')) = 'active'
    ORDER BY full_name
  `, [organizationId]);
  return result.rows.map((row) => ({
    playerId: Number(row.player_id), fullName: row.full_name, jerseyNumber: row.jersey_number,
    bats: ['R', 'L', 'S'].includes(String(row.bats_hand).toUpperCase()) ? String(row.bats_hand).toUpperCase() as Handedness : null,
    throws: ['R', 'L'].includes(String(row.throws_hand).toUpperCase()) ? String(row.throws_hand).toUpperCase() as ThrowingHand : null,
    position: row.position,
  }));
}

export async function createGameTrackerGame(input: {
  organizationId: number; schoolCode: string; gameType: GameType; gameDate: string; season: string; opponentName: string;
  location?: string | null; homeAway: 'home' | 'away'; inningsScheduled: number; notes?: string | null; createdByUserId?: number | null;
}): Promise<GameTrackerGame> {
  await ensureGameTrackerReady();
  if (!GAME_TYPES.includes(input.gameType)) throw new Error('Invalid game type.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.gameDate)) throw new Error('A valid game date is required.');
  if (!input.opponentName.trim()) throw new Error('Opponent or session name is required.');
  const state = initialGameState();
  const result = await getDbPool().query<DbGameRow>(`
    INSERT INTO game_tracker_games (
      organization_id, school_code, game_type, game_date, season, opponent_name, location, home_away,
      innings_scheduled, notes, state_jsonb, created_by_user_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
    RETURNING *
  `, [
    input.organizationId, input.schoolCode.trim().toUpperCase(), input.gameType, input.gameDate,
    input.season.trim() || input.gameDate.slice(0, 4), input.opponentName.trim(), input.location?.trim() || null,
    input.homeAway, Math.min(30, Math.max(1, Math.round(input.inningsScheduled || 9))), input.notes?.trim() || null,
    JSON.stringify(state), input.createdByUserId ?? null,
  ]);
  return mapGame(result.rows[0]);
}

export async function listGameTrackerGames(organizationId: number): Promise<GameTrackerGame[]> {
  await ensureGameTrackerReady();
  const result = await getDbPool().query<DbGameRow>(`
    SELECT * FROM game_tracker_games WHERE organization_id = $1 ORDER BY game_date DESC, id DESC LIMIT 250
  `, [organizationId]);
  return result.rows.map(mapGame);
}

async function getPlayers(client: PoolClient | ReturnType<typeof getDbPool>, gameId: number): Promise<GameTrackerPlayer[]> {
  const result = await client.query<DbPlayerRow>(`
    SELECT * FROM game_tracker_players WHERE game_id = $1 ORDER BY team_side, batting_order NULLS LAST, id
  `, [gameId]);
  return result.rows.map(mapPlayer);
}

async function getEvents(client: PoolClient | ReturnType<typeof getDbPool>, gameId: number): Promise<StoredGameEvent[]> {
  const result = await client.query<DbEventRow>(`
    SELECT * FROM game_tracker_events WHERE game_id = $1 ORDER BY sequence_no
  `, [gameId]);
  return result.rows.map(mapEvent);
}

export async function getGameTrackerBundle(organizationId: number, gameId: number) {
  await ensureGameTrackerReady();
  const pool = getDbPool();
  const [gameResult, players, events, roster] = await Promise.all([
    pool.query<DbGameRow>('SELECT * FROM game_tracker_games WHERE id = $1 AND organization_id = $2 LIMIT 1', [gameId, organizationId]),
    getPlayers(pool, gameId),
    getEvents(pool, gameId),
    listGameTrackerRoster(organizationId),
  ]);
  if (!gameResult.rows[0]) return null;
  return { game: mapGame(gameResult.rows[0]), players, events, roster };
}

function baseStateForPlayers(players: GameTrackerPlayer[]): GameState {
  const state = initialGameState();
  state.pitcherIds.us = players.find((player) => player.teamSide === 'us' && player.isActive && player.position === 'P')?.id ?? null;
  state.pitcherIds.opponent = players.find((player) => player.teamSide === 'opponent' && player.isActive && player.position === 'P')?.id ?? null;
  return state;
}

export async function saveGameTrackerLineup(input: {
  organizationId: number; gameId: number; players: LineupPlayerInput[];
}): Promise<GameTrackerPlayer[]> {
  await ensureGameTrackerReady();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const gameResult = await client.query<DbGameRow>(
      'SELECT * FROM game_tracker_games WHERE id = $1 AND organization_id = $2 FOR UPDATE',
      [input.gameId, input.organizationId]
    );
    if (!gameResult.rows[0]) throw new Error('Game not found.');
    const eventCount = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM game_tracker_events WHERE game_id = $1', [input.gameId]);
    const hasEvents = Number(eventCount.rows[0]?.count ?? 0) > 0;
    const incomingIds = new Set(input.players.map((player) => Number(player.id ?? 0)).filter((id) => id > 0));

    if (!hasEvents) {
      await client.query('DELETE FROM game_tracker_players WHERE game_id = $1', [input.gameId]);
    } else {
      await client.query(
        `UPDATE game_tracker_players SET is_active = FALSE, updated_at = NOW() WHERE game_id = $1 AND NOT (id = ANY($2::bigint[]))`,
        [input.gameId, Array.from(incomingIds)]
      );
    }

    for (const player of input.players) {
      const name = player.displayName.trim();
      if (!name) throw new Error('Every lineup player needs a name.');
      if (!['R', 'L', 'S'].includes(player.bats)) throw new Error(`${name} needs a batting handedness.`);
      if (!['R', 'L'].includes(player.throws)) throw new Error(`${name} needs a throwing handedness.`);
      const values = [
        input.gameId, player.teamSide, player.playerId ?? null, name, player.jerseyNumber?.trim() || null,
        player.bats, player.throws, player.battingOrder ?? null, player.position?.trim().toUpperCase() || null,
        player.isStarter !== false, player.isActive !== false,
      ];
      if (hasEvents && Number(player.id ?? 0) > 0) {
        await client.query(`
          UPDATE game_tracker_players SET team_side=$2, player_id=$3, display_name=$4, jersey_number=$5, bats=$6,
            throws=$7, batting_order=$8, position=$9, is_starter=$10, is_active=$11, updated_at=NOW()
          WHERE id=$12 AND game_id=$1
        `, [...values, Number(player.id)]);
      } else {
        await client.query(`
          INSERT INTO game_tracker_players (
            game_id, team_side, player_id, display_name, jersey_number, bats, throws, batting_order, position, is_starter, is_active
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, values);
      }
    }
    const players = await getPlayers(client, input.gameId);
    if (!hasEvents) {
      const state = baseStateForPlayers(players);
      await client.query('UPDATE game_tracker_games SET state_jsonb=$1::jsonb, revision=revision+1, updated_at=NOW() WHERE id=$2', [JSON.stringify(state), input.gameId]);
    }
    await client.query('COMMIT');
    return players;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function appendGameTrackerEvent(input: {
  organizationId: number; gameId: number; event: GameEventInput; clientEventId?: string; userId?: number | null; expectedRevision?: number | null;
}) {
  await ensureGameTrackerReady();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const gameResult = await client.query<DbGameRow>(
      'SELECT * FROM game_tracker_games WHERE id=$1 AND organization_id=$2 FOR UPDATE',
      [input.gameId, input.organizationId]
    );
    const row = gameResult.rows[0];
    if (!row) throw new Error('Game not found.');
    if (row.status === 'final') throw new Error('Reopen the game before adding plays.');
    const eventId = input.clientEventId?.trim() || randomUUID();
    const existing = await client.query<DbEventRow>(`
      SELECT * FROM game_tracker_events WHERE game_id=$1 AND client_event_id=$2 LIMIT 1
    `, [input.gameId, eventId]);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { game: mapGame(row), event: mapEvent(existing.rows[0]), players: await getPlayers(client, input.gameId) };
    }
    if (input.expectedRevision !== null && input.expectedRevision !== undefined && Number(row.revision) !== input.expectedRevision) {
      throw new Error('This game changed on another device. Refresh before scoring the next play.');
    }
    const game = mapGame(row);
    const players = await getPlayers(client, input.gameId);
    const reduced = applyGameEvent(game.state, input.event, players, game.homeAway);
    const battingSide = reduced.situation.battingSide;
    const runsOnPlay = Math.max(0, reduced.state.score[battingSide] - game.state.score[battingSide]);
    const storedInput: GameEventInput = reduced.input.type === 'pitch'
      ? {
          ...reduced.input,
          runsScored: reduced.input.runsScored ?? runsOnPlay,
          earnedRuns: reduced.input.earnedRuns ?? runsOnPlay,
        }
      : reduced.input;
    const sequenceResult = await client.query<{ sequence: number }>(
      'SELECT COALESCE(MAX(sequence_no), 0) + 1 AS sequence FROM game_tracker_events WHERE game_id=$1',
      [input.gameId]
    );
    const sequence = Number(sequenceResult.rows[0]?.sequence ?? 1);
    const inserted = await client.query<DbEventRow>(`
      INSERT INTO game_tracker_events (
        game_id, sequence_no, client_event_id, event_type, input_jsonb, situation_jsonb, state_after_jsonb, created_by_user_id
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)
      RETURNING *
    `, [input.gameId, sequence, eventId, storedInput.type, JSON.stringify(storedInput), JSON.stringify(reduced.situation), JSON.stringify(reduced.state), input.userId ?? null]);
    const nextStatus = row.status === 'setup' ? 'live' : row.status;
    const updated = await client.query<DbGameRow>(`
      UPDATE game_tracker_games SET state_jsonb=$1::jsonb, status=$2, revision=revision+1, updated_at=NOW()
      WHERE id=$3 RETURNING *
    `, [JSON.stringify(reduced.state), nextStatus, input.gameId]);
    await client.query('COMMIT');
    return { game: mapGame(updated.rows[0]), event: mapEvent(inserted.rows[0]), players };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function undoLastGameTrackerEvent(input: { organizationId: number; gameId: number; userId?: number | null }) {
  await ensureGameTrackerReady();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const gameResult = await client.query<DbGameRow>(
      'SELECT * FROM game_tracker_games WHERE id=$1 AND organization_id=$2 FOR UPDATE',
      [input.gameId, input.organizationId]
    );
    if (!gameResult.rows[0]) throw new Error('Game not found.');
    const players = await getPlayers(client, input.gameId);
    const last = await client.query<{ id: number }>(`
      SELECT id FROM game_tracker_events WHERE game_id=$1 AND is_voided=FALSE ORDER BY sequence_no DESC LIMIT 1 FOR UPDATE
    `, [input.gameId]);
    if (!last.rows[0]) throw new Error('There is no play to undo.');
    await client.query(`
      UPDATE game_tracker_events SET is_voided=TRUE, voided_by_user_id=$1, voided_at=NOW() WHERE id=$2
    `, [input.userId ?? null, last.rows[0].id]);
    const events = await getEvents(client, input.gameId);
    const game = mapGame(gameResult.rows[0]);
    const state = rebuildGameState(events, players, game.homeAway, baseStateForPlayers(players));
    const updated = await client.query<DbGameRow>(`
      UPDATE game_tracker_games SET state_jsonb=$1::jsonb, revision=revision+1, updated_at=NOW() WHERE id=$2 RETURNING *
    `, [JSON.stringify(state), input.gameId]);
    await client.query('COMMIT');
    return { game: mapGame(updated.rows[0]), players, events };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function setGameTrackerStatus(input: { organizationId: number; gameId: number; status: 'setup' | 'live' | 'final' }) {
  await ensureGameTrackerReady();
  const result = await getDbPool().query<DbGameRow>(`
    UPDATE game_tracker_games SET status=$1, revision=revision+1, updated_at=NOW()
    WHERE id=$2 AND organization_id=$3 RETURNING *
  `, [input.status, input.gameId, input.organizationId]);
  if (!result.rows[0]) throw new Error('Game not found.');
  return mapGame(result.rows[0]);
}

export async function deleteGameTrackerGame(input: { organizationId: number; gameId: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureGameTrackerReady();
  const result = await getDbPool().query<{ id: number }>(
    `DELETE FROM game_tracker_games WHERE id = $1 AND organization_id = $2 RETURNING id`,
    [input.gameId, input.organizationId]
  );
  if ((result.rowCount ?? 0) !== 1) return { ok: false, error: 'Game not found.' };
  return { ok: true };
}

export async function getGameTrackerStats(organizationId: number, filters: ScenarioFilters = {}) {
  await ensureGameTrackerReady();
  const pool = getDbPool();
  const params: unknown[] = [organizationId];
  const where = ['organization_id=$1'];
  if (filters.dateFrom) { params.push(filters.dateFrom); where.push(`game_date >= $${params.length}`); }
  if (filters.dateTo) { params.push(filters.dateTo); where.push(`game_date <= $${params.length}`); }
  if (filters.gameTypes?.length) { params.push(filters.gameTypes); where.push(`game_type = ANY($${params.length}::text[])`); }
  const gamesResult = await pool.query<DbGameRow>(`
    SELECT * FROM game_tracker_games WHERE ${where.join(' AND ')} ORDER BY game_date, id
  `, params);
  const games = gamesResult.rows.map(mapGame);
  const sources: GameStatSource[] = await Promise.all(games.map(async (game) => ({
    game,
    players: await getPlayers(pool, game.id),
    events: await getEvents(pool, game.id),
  })));
  return calculateGameTrackerStats(sources, filters);
}
