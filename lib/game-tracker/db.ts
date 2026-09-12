import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getDbPool, isDatabaseConfigured } from '../auth-db';
import { applyGameEvent, battingIndexForPlayer, currentSituation, rebuildGameState } from './engine';
import { calculateGameTrackerStats, gameTrackerPlayerIdentityKey, type GameStatSource } from './stats';
import {
  GAME_TYPES,
  initialGameState,
  type GameEventInput,
  type GameState,
  type GameTrackerGame,
  type GameTrackerPlayer,
  type GameTrackerRosterMember,
  type GameTrackerTeam,
  type GameType,
  type Handedness,
  type ScenarioFilters,
  type StoredGameEvent,
  type TeamSide,
  type ThrowingHand,
} from './types';

declare global {
  var __gameTrackerReadyV3: boolean | undefined;
  var __gameTrackerReadyPromiseV3: Promise<void> | undefined;
}

type DbGameRow = {
  id: number;
  organization_id: number;
  school_code: string;
  us_team_id: number | null;
  opponent_team_id: number | null;
  us_team_name: string | null;
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
  roster_person_id: number | null;
  stat_team_id: number | null;
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

type DbTeamRow = {
  id: number;
  organization_id: number;
  name: string;
  short_name: string | null;
  team_type: GameTrackerTeam['teamType'];
  stat_source_team_id: number | null;
  is_primary: boolean;
  member_count?: string | number;
};

type DbRosterMemberRow = {
  id: number;
  team_id: number;
  roster_person_id: number;
  player_id: number | null;
  display_name: string;
  jersey_number: string | null;
  bats: Handedness;
  throws: ThrowingHand;
  position: string | null;
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
  rosterPersonId?: number | null;
  statTeamId?: number | null;
  displayName: string;
  jerseyNumber?: string | null;
  bats: Handedness;
  throws: ThrowingHand;
  battingOrder?: number | null;
  position?: string | null;
  isStarter?: boolean;
  isActive?: boolean;
};

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function mapTeam(row: DbTeamRow): GameTrackerTeam {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), name: row.name, shortName: row.short_name,
    teamType: row.team_type, statSourceTeamId: row.stat_source_team_id ? Number(row.stat_source_team_id) : null,
    isPrimary: row.is_primary, memberCount: Number(row.member_count ?? 0),
  };
}

function mapRosterMember(row: DbRosterMemberRow): GameTrackerRosterMember {
  return {
    id: Number(row.id), teamId: Number(row.team_id), rosterPersonId: Number(row.roster_person_id),
    playerId: row.player_id ? Number(row.player_id) : null, displayName: row.display_name,
    jerseyNumber: row.jersey_number, bats: row.bats, throws: row.throws, position: row.position,
  };
}

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
    usTeamId: row.us_team_id ? Number(row.us_team_id) : null,
    opponentTeamId: row.opponent_team_id ? Number(row.opponent_team_id) : null,
    usTeamName: row.us_team_name?.trim() || row.school_code,
    gameType: row.game_type, gameDate: isoDate(row.game_date), season: row.season, opponentName: row.opponent_name,
    location: row.location, homeAway: row.home_away, inningsScheduled: Number(row.innings_scheduled), status: row.status,
    notes: row.notes, state: parseJson(row.state_jsonb, initialGameState()), revision: Number(row.revision),
    createdAt: isoTime(row.created_at), updatedAt: isoTime(row.updated_at),
  };
}

function mapPlayer(row: DbPlayerRow): GameTrackerPlayer {
  return {
    id: Number(row.id), gameId: Number(row.game_id), teamSide: row.team_side, playerId: row.player_id ? Number(row.player_id) : null,
    rosterPersonId: row.roster_person_id ? Number(row.roster_person_id) : null,
    statTeamId: row.stat_team_id ? Number(row.stat_team_id) : null,
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
  if (global.__gameTrackerReadyV3) return;
  if (global.__gameTrackerReadyPromiseV3) return global.__gameTrackerReadyPromiseV3;
  global.__gameTrackerReadyPromiseV3 = (async () => {
    const pool = getDbPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_tracker_teams (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        name TEXT NOT NULL,
        short_name TEXT,
        team_type TEXT NOT NULL DEFAULT 'opponent' CHECK (team_type IN ('organization','intrasquad','opponent')),
        stat_source_team_id BIGINT REFERENCES game_tracker_teams(id) ON DELETE SET NULL,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS game_tracker_teams_org_name_idx
        ON game_tracker_teams (organization_id, LOWER(name));

      CREATE TABLE IF NOT EXISTS game_tracker_roster_people (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        player_id BIGINT,
        display_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        bats TEXT NOT NULL DEFAULT 'R' CHECK (bats IN ('R','L','S')),
        throws TEXT NOT NULL DEFAULT 'R' CHECK (throws IN ('R','L')),
        position TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS game_tracker_roster_people_internal_idx
        ON game_tracker_roster_people (organization_id, player_id) WHERE player_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS game_tracker_team_members (
        id BIGSERIAL PRIMARY KEY,
        team_id BIGINT NOT NULL REFERENCES game_tracker_teams(id) ON DELETE CASCADE,
        roster_person_id BIGINT NOT NULL REFERENCES game_tracker_roster_people(id) ON DELETE CASCADE,
        jersey_number TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (team_id, roster_person_id)
      );

      CREATE TABLE IF NOT EXISTS game_tracker_games (
        id BIGSERIAL PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        school_code TEXT NOT NULL,
        us_team_id BIGINT REFERENCES game_tracker_teams(id) ON DELETE SET NULL,
        opponent_team_id BIGINT REFERENCES game_tracker_teams(id) ON DELETE SET NULL,
        us_team_name TEXT,
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
        roster_person_id BIGINT REFERENCES game_tracker_roster_people(id) ON DELETE SET NULL,
        stat_team_id BIGINT REFERENCES game_tracker_teams(id) ON DELETE SET NULL,
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
        event_type TEXT NOT NULL CHECK (event_type IN ('pitch','runner','half_inning')),
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

      ALTER TABLE game_tracker_games ADD COLUMN IF NOT EXISTS us_team_id BIGINT REFERENCES game_tracker_teams(id) ON DELETE SET NULL;
      ALTER TABLE game_tracker_games ADD COLUMN IF NOT EXISTS opponent_team_id BIGINT REFERENCES game_tracker_teams(id) ON DELETE SET NULL;
      ALTER TABLE game_tracker_games ADD COLUMN IF NOT EXISTS us_team_name TEXT;
      ALTER TABLE game_tracker_players ADD COLUMN IF NOT EXISTS roster_person_id BIGINT REFERENCES game_tracker_roster_people(id) ON DELETE SET NULL;
      ALTER TABLE game_tracker_players ADD COLUMN IF NOT EXISTS stat_team_id BIGINT REFERENCES game_tracker_teams(id) ON DELETE SET NULL;
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'game_tracker_events'::regclass
            AND conname = 'game_tracker_events_event_type_check'
            AND pg_get_constraintdef(oid) NOT LIKE '%half_inning%'
        ) THEN
          ALTER TABLE game_tracker_events DROP CONSTRAINT game_tracker_events_event_type_check;
          ALTER TABLE game_tracker_events ADD CONSTRAINT game_tracker_events_event_type_check
            CHECK (event_type IN ('pitch','runner','half_inning'));
        END IF;
      END $$;
    `);
    global.__gameTrackerReadyV3 = true;
  })().finally(() => { global.__gameTrackerReadyPromiseV3 = undefined; });
  await global.__gameTrackerReadyPromiseV3;
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

async function ensurePrimaryGameTrackerTeam(organizationId: number, schoolCode: string): Promise<number> {
  const pool = getDbPool();
  let result = await pool.query<{ id: number }>(`
    SELECT id FROM game_tracker_teams WHERE organization_id=$1 AND is_primary=TRUE ORDER BY id LIMIT 1
  `, [organizationId]);
  if (!result.rows[0]) {
    result = await pool.query<{ id: number }>(`
      INSERT INTO game_tracker_teams (organization_id, name, short_name, team_type, is_primary)
      SELECT $1, $2, $2, 'organization', TRUE
      WHERE NOT EXISTS (SELECT 1 FROM game_tracker_teams WHERE organization_id=$1 AND LOWER(name)=LOWER($2))
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [organizationId, schoolCode]);
    if (!result.rows[0]) {
      result = await pool.query<{ id: number }>(`
        UPDATE game_tracker_teams SET is_primary=TRUE, team_type='organization', updated_at=NOW()
        WHERE organization_id=$1 AND LOWER(name)=LOWER($2) RETURNING id
      `, [organizationId, schoolCode]);
    }
  }
  const teamId = Number(result.rows[0].id);
  await pool.query('UPDATE game_tracker_teams SET stat_source_team_id=COALESCE(stat_source_team_id, id) WHERE id=$1', [teamId]);
  await pool.query(`
    INSERT INTO game_tracker_roster_people (organization_id, player_id, display_name, normalized_name, bats, throws, position)
    SELECT p.organization_id, p.id, p.full_name, LOWER(REGEXP_REPLACE(TRIM(p.full_name), '\\s+', ' ', 'g')),
      CASE WHEN UPPER(COALESCE(p.bats_hand, '')) IN ('R','L','S') THEN UPPER(p.bats_hand) ELSE 'R' END,
      CASE WHEN UPPER(COALESCE(p.throws_hand, '')) IN ('R','L') THEN UPPER(p.throws_hand) ELSE 'R' END,
      NULLIF(UPPER(TRIM(COALESCE(p.position, ''))), '')
    FROM players p
    WHERE p.organization_id=$1 AND LOWER(COALESCE(p.status, 'active'))='active'
    ON CONFLICT (organization_id, player_id) WHERE player_id IS NOT NULL DO UPDATE SET
      display_name=EXCLUDED.display_name, normalized_name=EXCLUDED.normalized_name, bats=EXCLUDED.bats,
      throws=EXCLUDED.throws, position=EXCLUDED.position, updated_at=NOW()
  `, [organizationId]);
  await pool.query(`
    INSERT INTO game_tracker_team_members (team_id, roster_person_id, sort_order)
    SELECT $1, rp.id, ROW_NUMBER() OVER (ORDER BY rp.display_name)::int
    FROM game_tracker_roster_people rp
    WHERE rp.organization_id=$2 AND rp.player_id IS NOT NULL
    ON CONFLICT (team_id, roster_person_id) DO UPDATE SET is_active=TRUE, updated_at=NOW()
  `, [teamId, organizationId]);
  return teamId;
}

export async function listGameTrackerTeams(organizationId: number, schoolCode: string) {
  await ensureGameTrackerReady();
  await ensurePrimaryGameTrackerTeam(organizationId, schoolCode);
  const pool = getDbPool();
  const [teamsResult, membersResult, organizationRoster] = await Promise.all([
    pool.query<DbTeamRow>(`
      SELECT t.*, COUNT(tm.id) FILTER (WHERE tm.is_active=TRUE)::int AS member_count
      FROM game_tracker_teams t
      LEFT JOIN game_tracker_team_members tm ON tm.team_id=t.id
      WHERE t.organization_id=$1
      GROUP BY t.id
      ORDER BY t.is_primary DESC, t.team_type, t.name
    `, [organizationId]),
    pool.query<DbRosterMemberRow>(`
      SELECT tm.id, tm.team_id, rp.id AS roster_person_id, rp.player_id, rp.display_name,
        tm.jersey_number, rp.bats, rp.throws, rp.position
      FROM game_tracker_team_members tm
      JOIN game_tracker_teams t ON t.id=tm.team_id
      JOIN game_tracker_roster_people rp ON rp.id=tm.roster_person_id
      WHERE t.organization_id=$1 AND tm.is_active=TRUE
      ORDER BY tm.team_id, tm.sort_order, rp.display_name
    `, [organizationId]),
    listGameTrackerRoster(organizationId),
  ]);
  return { teams: teamsResult.rows.map(mapTeam), members: membersResult.rows.map(mapRosterMember), organizationRoster };
}

export async function createGameTrackerTeam(input: {
  organizationId: number; name: string; shortName?: string | null; teamType: GameTrackerTeam['teamType']; statSourceTeamId?: number | null;
}) {
  await ensureGameTrackerReady();
  const name = input.name.trim();
  if (!name) throw new Error('Team name is required.');
  if (input.statSourceTeamId) {
    const source = await getDbPool().query('SELECT id FROM game_tracker_teams WHERE id=$1 AND organization_id=$2', [input.statSourceTeamId, input.organizationId]);
    if (!source.rows[0]) throw new Error('Stats source team was not found.');
  }
  const result = await getDbPool().query<DbTeamRow>(`
    INSERT INTO game_tracker_teams (organization_id, name, short_name, team_type, stat_source_team_id)
    VALUES ($1,$2,$3,$4,$5) RETURNING *, 0::int AS member_count
  `, [input.organizationId, name, input.shortName?.trim() || null, input.teamType, input.statSourceTeamId ?? null]);
  const team = mapTeam(result.rows[0]);
  if (!team.statSourceTeamId) {
    await getDbPool().query('UPDATE game_tracker_teams SET stat_source_team_id=id WHERE id=$1', [team.id]);
    team.statSourceTeamId = team.id;
  }
  return team;
}

async function requireOrganizationTeam(client: PoolClient | ReturnType<typeof getDbPool>, organizationId: number, teamId: number) {
  const result = await client.query<DbTeamRow>('SELECT * FROM game_tracker_teams WHERE id=$1 AND organization_id=$2', [teamId, organizationId]);
  if (!result.rows[0]) throw new Error('Team not found.');
  return result.rows[0];
}

export async function saveGameTrackerRosterMember(input: {
  organizationId: number; teamId: number; rosterPersonId?: number | null; playerId?: number | null; displayName: string;
  jerseyNumber?: string | null; bats: Handedness; throws: ThrowingHand; position?: string | null;
}) {
  await ensureGameTrackerReady();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await requireOrganizationTeam(client, input.organizationId, input.teamId);
    const name = input.displayName.trim();
    if (!name) throw new Error('Player name is required.');
    let rosterPersonId = Number(input.rosterPersonId ?? 0);
    let linkedPlayerId = Number(input.playerId ?? 0) || null;
    if (!rosterPersonId && !linkedPlayerId) {
      const exactPlayer = await client.query<{ id: number }>(`
        SELECT id FROM players WHERE organization_id=$1 AND LOWER(TRIM(full_name))=LOWER(TRIM($2))
        ORDER BY CASE WHEN LOWER(COALESCE(status, 'active'))='active' THEN 0 ELSE 1 END, id LIMIT 1
      `, [input.organizationId, name]);
      linkedPlayerId = exactPlayer.rows[0] ? Number(exactPlayer.rows[0].id) : null;
    }
    if (rosterPersonId) {
      const person = await client.query('SELECT id FROM game_tracker_roster_people WHERE id=$1 AND organization_id=$2', [rosterPersonId, input.organizationId]);
      if (!person.rows[0]) throw new Error('Roster player not found.');
    } else if (linkedPlayerId) {
      const existing = await client.query<{ id: number }>('SELECT id FROM game_tracker_roster_people WHERE organization_id=$1 AND player_id=$2', [input.organizationId, linkedPlayerId]);
      if (existing.rows[0]) rosterPersonId = Number(existing.rows[0].id);
      else {
        const inserted = await client.query<{ id: number }>(`
          INSERT INTO game_tracker_roster_people (organization_id, player_id, display_name, normalized_name, bats, throws, position)
          VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
        `, [input.organizationId, linkedPlayerId, name, normalizeName(name), input.bats, input.throws, input.position?.trim().toUpperCase() || null]);
        rosterPersonId = Number(inserted.rows[0].id);
      }
    } else {
      const existing = await client.query<{ id: number }>(`
        SELECT rp.id FROM game_tracker_roster_people rp
        JOIN game_tracker_team_members tm ON tm.roster_person_id=rp.id
        WHERE tm.team_id=$1 AND rp.normalized_name=$2 LIMIT 1
      `, [input.teamId, normalizeName(name)]);
      if (existing.rows[0]) rosterPersonId = Number(existing.rows[0].id);
      else {
        const inserted = await client.query<{ id: number }>(`
          INSERT INTO game_tracker_roster_people (organization_id, display_name, normalized_name, bats, throws, position)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
        `, [input.organizationId, name, normalizeName(name), input.bats, input.throws, input.position?.trim().toUpperCase() || null]);
        rosterPersonId = Number(inserted.rows[0].id);
      }
    }
    await client.query(`
      UPDATE game_tracker_roster_people SET display_name=$1, normalized_name=$2, bats=$3, throws=$4,
        position=$5, updated_at=NOW() WHERE id=$6
    `, [name, normalizeName(name), input.bats, input.throws, input.position?.trim().toUpperCase() || null, rosterPersonId]);
    const memberInsert = await client.query<{ id: number }>(`
      INSERT INTO game_tracker_team_members (team_id, roster_person_id, jersey_number, sort_order)
      VALUES ($1,$2,$3,(SELECT COALESCE(MAX(sort_order),0)+1 FROM game_tracker_team_members WHERE team_id=$1))
      ON CONFLICT (team_id, roster_person_id) DO UPDATE SET jersey_number=EXCLUDED.jersey_number, is_active=TRUE, updated_at=NOW()
      RETURNING id
    `, [input.teamId, rosterPersonId, input.jerseyNumber?.trim() || null]);
    const member = await client.query<DbRosterMemberRow>(`
      SELECT tm.id, tm.team_id, rp.id AS roster_person_id, rp.player_id, rp.display_name,
        tm.jersey_number, rp.bats, rp.throws, rp.position
      FROM game_tracker_team_members tm JOIN game_tracker_roster_people rp ON rp.id=tm.roster_person_id
      WHERE tm.id=$1
    `, [memberInsert.rows[0].id]);
    await client.query('COMMIT');
    return mapRosterMember(member.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function removeGameTrackerRosterMember(input: { organizationId: number; teamId: number; memberId: number }) {
  await ensureGameTrackerReady();
  const result = await getDbPool().query(`
    DELETE FROM game_tracker_team_members tm USING game_tracker_teams t
    WHERE tm.id=$1 AND tm.team_id=$2 AND t.id=tm.team_id AND t.organization_id=$3 RETURNING tm.id
  `, [input.memberId, input.teamId, input.organizationId]);
  if (!result.rows[0]) throw new Error('Roster member not found.');
  return { ok: true };
}

export async function linkGameTrackerPersonToPlayer(input: { organizationId: number; rosterPersonId: number; playerId: number }) {
  await ensureGameTrackerReady();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const sourceResult = await client.query<{ id: number }>('SELECT id FROM game_tracker_roster_people WHERE id=$1 AND organization_id=$2 FOR UPDATE', [input.rosterPersonId, input.organizationId]);
    const playerResult = await client.query<{ id: number; full_name: string }>('SELECT id, full_name FROM players WHERE id=$1 AND organization_id=$2', [input.playerId, input.organizationId]);
    if (!sourceResult.rows[0]) throw new Error('Tracker player identity not found.');
    if (!playerResult.rows[0]) throw new Error('Organization player not found.');
    const targetResult = await client.query<{ id: number }>(`
      SELECT id FROM game_tracker_roster_people WHERE organization_id=$1 AND player_id=$2 FOR UPDATE
    `, [input.organizationId, input.playerId]);
    const targetId = targetResult.rows[0] ? Number(targetResult.rows[0].id) : input.rosterPersonId;
    if (targetId !== input.rosterPersonId) {
      await client.query(`
        INSERT INTO game_tracker_team_members (team_id, roster_person_id, jersey_number, sort_order, is_active)
        SELECT team_id, $1, jersey_number, sort_order, is_active FROM game_tracker_team_members WHERE roster_person_id=$2
        ON CONFLICT (team_id, roster_person_id) DO UPDATE SET is_active=EXCLUDED.is_active, updated_at=NOW()
      `, [targetId, input.rosterPersonId]);
      await client.query('UPDATE game_tracker_players SET player_id=$1, roster_person_id=$2, display_name=$3 WHERE roster_person_id=$4', [input.playerId, targetId, playerResult.rows[0].full_name, input.rosterPersonId]);
      await client.query('DELETE FROM game_tracker_team_members WHERE roster_person_id=$1', [input.rosterPersonId]);
      await client.query('DELETE FROM game_tracker_roster_people WHERE id=$1', [input.rosterPersonId]);
    } else {
      await client.query(`
        UPDATE game_tracker_roster_people SET player_id=$1, display_name=$2, normalized_name=$3, updated_at=NOW() WHERE id=$4
      `, [input.playerId, playerResult.rows[0].full_name, normalizeName(playerResult.rows[0].full_name), input.rosterPersonId]);
      await client.query('UPDATE game_tracker_players SET player_id=$1, display_name=$2 WHERE roster_person_id=$3', [input.playerId, playerResult.rows[0].full_name, input.rosterPersonId]);
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function createGameTrackerGame(input: {
  organizationId: number; schoolCode: string; gameType: GameType; gameDate: string; season: string; opponentName: string;
  location?: string | null; homeAway: 'home' | 'away'; inningsScheduled: number; notes?: string | null; createdByUserId?: number | null;
  usTeamId?: number | null; opponentTeamId?: number | null;
}): Promise<GameTrackerGame> {
  await ensureGameTrackerReady();
  if (!GAME_TYPES.includes(input.gameType)) throw new Error('Invalid game type.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.gameDate)) throw new Error('A valid game date is required.');
  if (!input.opponentName.trim()) throw new Error('Opponent or session name is required.');
  const state = initialGameState();
  const pool = getDbPool();
  let usTeamName = input.schoolCode.trim().toUpperCase();
  let opponentName = input.opponentName.trim();
  if (input.usTeamId) usTeamName = (await requireOrganizationTeam(pool, input.organizationId, input.usTeamId)).name;
  if (input.opponentTeamId) opponentName = (await requireOrganizationTeam(pool, input.organizationId, input.opponentTeamId)).name;
  const result = await pool.query<DbGameRow>(`
    INSERT INTO game_tracker_games (
      organization_id, school_code, us_team_id, opponent_team_id, us_team_name, game_type, game_date, season,
      opponent_name, location, home_away, innings_scheduled, notes, state_jsonb, created_by_user_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
    RETURNING *
  `, [
    input.organizationId, input.schoolCode.trim().toUpperCase(), input.usTeamId ?? null, input.opponentTeamId ?? null,
    usTeamName, input.gameType, input.gameDate, input.season.trim() || input.gameDate.slice(0, 4), opponentName,
    input.location?.trim() || null, input.homeAway,
    Math.min(30, Math.max(1, Math.round(input.inningsScheduled || 9))), input.notes?.trim() || null,
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
  const gameResult = await pool.query<DbGameRow>('SELECT * FROM game_tracker_games WHERE id = $1 AND organization_id = $2 LIMIT 1', [gameId, organizationId]);
  if (!gameResult.rows[0]) return null;
  const [players, events, roster, teamData] = await Promise.all([
    getPlayers(pool, gameId),
    getEvents(pool, gameId),
    listGameTrackerRoster(organizationId),
    listGameTrackerTeams(organizationId, gameResult.rows[0].school_code),
  ]);
  return { game: mapGame(gameResult.rows[0]), players, events, roster, teams: teamData.teams, rosterMembers: teamData.members };
}

function baseStateForPlayers(players: GameTrackerPlayer[]): GameState {
  const state = initialGameState();
  state.pitcherIds.us = players.find((player) => player.teamSide === 'us' && player.isActive && player.position === 'P')?.id ?? null;
  state.pitcherIds.opponent = players.find((player) => player.teamSide === 'opponent' && player.isActive && player.position === 'P')?.id ?? null;
  return state;
}

async function resolveLineupIdentity(
  client: PoolClient,
  input: { organizationId: number; name: string; playerId?: number | null; rosterPersonId?: number | null; statTeamId?: number | null; appearanceTeamId?: number | null }
): Promise<{ rosterPersonId: number | null; statTeamId: number | null }> {
  async function attachToAppearanceTeam(personId: number | null) {
    if (!personId || !input.appearanceTeamId) return;
    await requireOrganizationTeam(client, input.organizationId, input.appearanceTeamId);
    await client.query(`
      INSERT INTO game_tracker_team_members (team_id, roster_person_id, sort_order)
      VALUES ($1,$2,(SELECT COALESCE(MAX(sort_order),0)+1 FROM game_tracker_team_members WHERE team_id=$1))
      ON CONFLICT (team_id, roster_person_id) DO UPDATE SET is_active=TRUE, updated_at=NOW()
    `, [input.appearanceTeamId, personId]);
  }
  let statTeamId = Number(input.statTeamId ?? 0) || null;
  if (statTeamId) {
    const team = await requireOrganizationTeam(client, input.organizationId, statTeamId);
    statTeamId = Number(team.stat_source_team_id ?? team.id);
  }
  let rosterPersonId = Number(input.rosterPersonId ?? 0) || null;
  if (rosterPersonId) {
    const person = await client.query('SELECT id FROM game_tracker_roster_people WHERE id=$1 AND organization_id=$2', [rosterPersonId, input.organizationId]);
    if (!person.rows[0]) throw new Error(`${input.name} is not available to this organization.`);
    await attachToAppearanceTeam(rosterPersonId);
    return { rosterPersonId, statTeamId };
  }
  if (input.playerId) {
    const existing = await client.query<{ id: number }>('SELECT id FROM game_tracker_roster_people WHERE organization_id=$1 AND player_id=$2', [input.organizationId, input.playerId]);
    if (existing.rows[0]) rosterPersonId = Number(existing.rows[0].id);
    else {
      const inserted = await client.query<{ id: number }>(`
        INSERT INTO game_tracker_roster_people (organization_id, player_id, display_name, normalized_name)
        VALUES ($1,$2,$3,$4) RETURNING id
      `, [input.organizationId, input.playerId, input.name, normalizeName(input.name)]);
      rosterPersonId = Number(inserted.rows[0].id);
    }
    await attachToAppearanceTeam(rosterPersonId);
    return { rosterPersonId, statTeamId };
  }
  if (!statTeamId) return { rosterPersonId: null, statTeamId: null };
  const existing = await client.query<{ id: number }>(`
    SELECT rp.id FROM game_tracker_roster_people rp
    JOIN game_tracker_team_members tm ON tm.roster_person_id=rp.id
    WHERE tm.team_id=$1 AND rp.normalized_name=$2 LIMIT 1
  `, [statTeamId, normalizeName(input.name)]);
  if (existing.rows[0]) rosterPersonId = Number(existing.rows[0].id);
  else {
    const inserted = await client.query<{ id: number }>(`
      INSERT INTO game_tracker_roster_people (organization_id, display_name, normalized_name)
      VALUES ($1,$2,$3) RETURNING id
    `, [input.organizationId, input.name, normalizeName(input.name)]);
    rosterPersonId = Number(inserted.rows[0].id);
    await client.query(`
      INSERT INTO game_tracker_team_members (team_id, roster_person_id, sort_order)
      VALUES ($1,$2,(SELECT COALESCE(MAX(sort_order),0)+1 FROM game_tracker_team_members WHERE team_id=$1))
      ON CONFLICT (team_id, roster_person_id) DO UPDATE SET is_active=TRUE, updated_at=NOW()
    `, [statTeamId, rosterPersonId]);
  }
  await attachToAppearanceTeam(rosterPersonId);
  return { rosterPersonId, statTeamId };
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
    if (hasEvents) throw new Error('Use the live substitution controls after scoring has started.');
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
      const sideTeamId = player.teamSide === 'us' ? gameResult.rows[0].us_team_id : gameResult.rows[0].opponent_team_id;
      const identity = await resolveLineupIdentity(client, {
        organizationId: input.organizationId, name, playerId: player.playerId,
        rosterPersonId: player.rosterPersonId, statTeamId: player.statTeamId ?? sideTeamId, appearanceTeamId: sideTeamId,
      });
      const values = [
        input.gameId, player.teamSide, player.playerId ?? null, identity.rosterPersonId, identity.statTeamId,
        name, player.jerseyNumber?.trim() || null, player.bats, player.throws, player.battingOrder ?? null,
        player.position?.trim().toUpperCase() || null, player.isStarter !== false, player.isActive !== false,
      ];
      if (hasEvents && Number(player.id ?? 0) > 0) {
        await client.query(`
          UPDATE game_tracker_players SET team_side=$2, player_id=$3, roster_person_id=$4, stat_team_id=$5,
            display_name=$6, jersey_number=$7, bats=$8, throws=$9, batting_order=$10, position=$11,
            is_starter=$12, is_active=$13, updated_at=NOW() WHERE id=$14 AND game_id=$1
        `, [...values, Number(player.id)]);
      } else {
        await client.query(`
          INSERT INTO game_tracker_players (
            game_id, team_side, player_id, roster_person_id, stat_team_id, display_name, jersey_number,
            bats, throws, batting_order, position, is_starter, is_active
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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

function nextPitcherId(players: GameTrackerPlayer[], side: TeamSide, excludingId?: number): number | null {
  return players.find((player) => player.teamSide === side && player.isActive && player.id !== excludingId && player.position === 'P')?.id ?? null;
}

export async function substituteGameTrackerPlayer(input: {
  organizationId: number;
  gameId: number;
  outgoingPlayerId: number;
  incoming: Omit<LineupPlayerInput, 'id' | 'teamSide' | 'battingOrder' | 'isStarter' | 'isActive'>;
}) {
  await ensureGameTrackerReady();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const gameResult = await client.query<DbGameRow>(
      'SELECT * FROM game_tracker_games WHERE id=$1 AND organization_id=$2 FOR UPDATE',
      [input.gameId, input.organizationId]
    );
    if (!gameResult.rows[0]) throw new Error('Game not found.');
    if (gameResult.rows[0].status === 'final') throw new Error('Reopen the game before making a substitution.');
    const outgoingResult = await client.query<DbPlayerRow>(
      'SELECT * FROM game_tracker_players WHERE id=$1 AND game_id=$2 AND is_active=TRUE FOR UPDATE',
      [input.outgoingPlayerId, input.gameId]
    );
    const outgoing = outgoingResult.rows[0];
    if (!outgoing) throw new Error('The player being replaced is no longer active. Refresh and try again.');
    const game = mapGame(gameResult.rows[0]);
    const playersBeforeSubstitution = await getPlayers(client, input.gameId);
    const situationBeforeSubstitution = currentSituation(game.state, playersBeforeSubstitution, game.homeAway);
    const isReplacingCurrentBatter = situationBeforeSubstitution.batterGamePlayerId === Number(outgoing.id);
    const name = input.incoming.displayName.trim();
    if (!name) throw new Error('Enter the replacement player name.');
    const position = input.incoming.position?.trim().toUpperCase() || outgoing.position;
    const sideTeamId = outgoing.team_side === 'us' ? gameResult.rows[0].us_team_id : gameResult.rows[0].opponent_team_id;
    const identity = await resolveLineupIdentity(client, {
      organizationId: input.organizationId, name, playerId: input.incoming.playerId,
      rosterPersonId: input.incoming.rosterPersonId,
      statTeamId: input.incoming.statTeamId ?? outgoing.stat_team_id ?? sideTeamId, appearanceTeamId: sideTeamId,
    });
    await client.query('UPDATE game_tracker_players SET is_active=FALSE, updated_at=NOW() WHERE id=$1', [outgoing.id]);
    const inserted = await client.query<DbPlayerRow>(`
      INSERT INTO game_tracker_players (
        game_id, team_side, player_id, roster_person_id, stat_team_id, display_name, jersey_number,
        bats, throws, batting_order, position, is_starter, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,TRUE)
      RETURNING *
    `, [
      input.gameId, outgoing.team_side, input.incoming.playerId ?? null, identity.rosterPersonId,
      identity.statTeamId, name, input.incoming.jerseyNumber?.trim() || null, input.incoming.bats,
      input.incoming.throws, outgoing.batting_order, position,
    ]);
    const incomingPlayer = mapPlayer(inserted.rows[0]);
    const players = await getPlayers(client, input.gameId);
    const state = structuredClone(game.state);
    if (isReplacingCurrentBatter) {
      const alignedIndex = battingIndexForPlayer(state.battingIndex[outgoing.team_side], players, outgoing.team_side, incomingPlayer.id);
      if (alignedIndex === null) throw new Error('The pinch hitter could not be placed into the active batting order.');
      state.battingIndex[outgoing.team_side] = alignedIndex;
    }
    if (state.pitcherIds[outgoing.team_side] === Number(outgoing.id)) {
      state.pitcherIds[outgoing.team_side] = position === 'P'
        ? incomingPlayer.id
        : nextPitcherId(players, outgoing.team_side, Number(outgoing.id));
    } else if (position === 'P') {
      state.pitcherIds[outgoing.team_side] = incomingPlayer.id;
    }
    const updated = await client.query<DbGameRow>(`
      UPDATE game_tracker_games SET state_jsonb=$1::jsonb, revision=revision+1, updated_at=NOW() WHERE id=$2 RETURNING *
    `, [JSON.stringify(state), input.gameId]);
    await client.query('COMMIT');
    return { game: mapGame(updated.rows[0]), players };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function changeGameTrackerPlayerPosition(input: {
  organizationId: number;
  gameId: number;
  playerId: number;
  position: string;
}) {
  await ensureGameTrackerReady();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const gameResult = await client.query<DbGameRow>(
      'SELECT * FROM game_tracker_games WHERE id=$1 AND organization_id=$2 FOR UPDATE',
      [input.gameId, input.organizationId]
    );
    if (!gameResult.rows[0]) throw new Error('Game not found.');
    if (gameResult.rows[0].status === 'final') throw new Error('Reopen the game before changing positions.');
    const playerResult = await client.query<DbPlayerRow>(
      'SELECT * FROM game_tracker_players WHERE id=$1 AND game_id=$2 AND is_active=TRUE FOR UPDATE',
      [input.playerId, input.gameId]
    );
    const row = playerResult.rows[0];
    if (!row) throw new Error('Player not found in the active lineup.');
    const oldPosition = row.position;
    const position = input.position.trim().toUpperCase();
    await client.query('UPDATE game_tracker_players SET position=$1, updated_at=NOW() WHERE id=$2', [position, input.playerId]);
    const players = await getPlayers(client, input.gameId);
    const game = mapGame(gameResult.rows[0]);
    const state = structuredClone(game.state);
    if (position === 'P') state.pitcherIds[row.team_side] = input.playerId;
    else if (oldPosition === 'P' && state.pitcherIds[row.team_side] === input.playerId) {
      state.pitcherIds[row.team_side] = nextPitcherId(players, row.team_side, input.playerId);
    }
    const updated = await client.query<DbGameRow>(`
      UPDATE game_tracker_games SET state_jsonb=$1::jsonb, revision=revision+1, updated_at=NOW() WHERE id=$2 RETURNING *
    `, [JSON.stringify(state), input.gameId]);
    await client.query('COMMIT');
    return { game: mapGame(updated.rows[0]), players };
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

export async function getGameTrackerPlayerDetail(organizationId: number, playerKey: string) {
  await ensureGameTrackerReady();
  if (!/^(player|roster|game-player):\d+$/.test(playerKey)) throw new Error('Invalid player identifier.');
  const pool = getDbPool();
  const gamesResult = await pool.query<DbGameRow>('SELECT * FROM game_tracker_games WHERE organization_id=$1 ORDER BY game_date DESC, id DESC', [organizationId]);
  const sources: GameStatSource[] = [];
  let playerName = '';
  for (const row of gamesResult.rows) {
    const game = mapGame(row);
    const players = await getPlayers(pool, game.id);
    const match = players.find((player) => gameTrackerPlayerIdentityKey(player) === playerKey);
    if (!match) continue;
    playerName ||= match.displayName;
    sources.push({ game, players, events: await getEvents(pool, game.id) });
  }
  if (!playerName) throw new Error('Player not found in Game Tracker.');
  return {
    playerKey,
    playerName,
    totals: calculateGameTrackerStats(sources, { playerKey }),
    games: sources.map((source) => ({
      game: source.game,
      stats: calculateGameTrackerStats([source], { playerKey }),
      appearances: source.players.filter((player) => gameTrackerPlayerIdentityKey(player) === playerKey).map((player) => ({
        teamSide: player.teamSide, battingOrder: player.battingOrder, position: player.position,
      })),
    })),
  };
}
