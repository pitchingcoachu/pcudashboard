import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Pool, PoolClient } from 'pg';

type UserRecord = {
  email: string;
  password: string;
  appUrl?: string;
  apps?: Array<{
    name?: string;
    label?: string;
    url?: string;
  }>;
  name?: string;
};

type UserRole = 'admin' | 'coach' | 'player';

export type SessionUser = {
  userId: number;
  email: string;
  appUrl: string;
  name?: string;
  role: UserRole;
  organizationId: number;
  playerId: number | null;
};

async function expireDueTrialAccounts(pool: Pool): Promise<void> {
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;`);
  await pool.query(`
    UPDATE auth_users
    SET is_active = FALSE, updated_at = NOW()
    WHERE COALESCE(is_active, TRUE) = TRUE
      AND trial_expires_at IS NOT NULL
      AND trial_expires_at <= NOW()
  `);
}

function isMissingSchemaError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (code === '42P01' || code === '42703') return true; // undefined_table / undefined_column
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message ?? '').toLowerCase()
      : '';
  return message.includes('relation') && message.includes('does not exist');
}

async function queryWithLazyAuthBootstrap<T>(
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    await ensureAuthDbReady();
    return await run();
  }
}

export async function listActiveStaffOrganizationIdsByEmail(email: string): Promise<number[]> {
  if (!isDatabaseConfigured()) return [];
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return [];
  const pool = getDbPool();
  const result = await queryWithLazyAuthBootstrap(() =>
    pool.query<{ organization_id: number | null }>(
      `
        SELECT DISTINCT organization_id
        FROM auth_users
        WHERE LOWER(email) = LOWER($1)
          AND COALESCE(is_active, TRUE) = TRUE
          AND role IN ('admin', 'coach')
          AND organization_id IS NOT NULL
      `,
      [normalizedEmail]
    )
  );
  return Array.from(
    new Set(
      result.rows
        .map((row) => Number(row.organization_id ?? 0))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
}

export async function listActiveStaffOrganizationsByEmail(
  email: string
): Promise<Array<{ organizationId: number; organizationName: string | null }>> {
  if (!isDatabaseConfigured()) return [];
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return [];
  const pool = getDbPool();
  const result = await queryWithLazyAuthBootstrap(() =>
    pool.query<{ organization_id: number | null; organization_name: string | null }>(
      `
        SELECT DISTINCT
          u.organization_id,
          o.name AS organization_name
        FROM auth_users u
        LEFT JOIN organizations o ON o.id = u.organization_id
        WHERE LOWER(u.email) = LOWER($1)
          AND COALESCE(u.is_active, TRUE) = TRUE
          AND u.role IN ('admin', 'coach')
          AND u.organization_id IS NOT NULL
      `,
      [normalizedEmail]
    )
  );
  return result.rows
    .map((row) => ({
      organizationId: Number(row.organization_id ?? 0),
      organizationName: row.organization_name,
    }))
    .filter((row) => Number.isFinite(row.organizationId) && row.organizationId > 0);
}

type ResetTokenRecord = {
  token: string;
  email: string;
  name?: string;
};

declare global {
  var __pcuPool: Pool | undefined;
  var __pcuAuthDbReady: boolean | undefined;
  var __pcuAuthDbReadyPromise: Promise<void> | undefined;
}

const DATABASE_URL = process.env.DATABASE_URL;
const DEFAULT_DASHBOARD_URL = 'https://pitchingcoachu.shinyapps.io/TMdata/';
const DB_POOL_MAX = Number.parseInt(String(process.env.AUTH_DB_POOL_MAX ?? '12'), 10);
const DB_CONNECT_TIMEOUT_MS = Number.parseInt(String(process.env.AUTH_DB_CONNECT_TIMEOUT_MS ?? '5000'), 10);
const DB_IDLE_TIMEOUT_MS = Number.parseInt(String(process.env.AUTH_DB_IDLE_TIMEOUT_MS ?? '10000'), 10);
const DB_QUERY_TIMEOUT_MS = Number.parseInt(String(process.env.AUTH_DB_QUERY_TIMEOUT_MS ?? '20000'), 10);
const DB_STATEMENT_TIMEOUT_MS = Number.parseInt(String(process.env.AUTH_DB_STATEMENT_TIMEOUT_MS ?? '20000'), 10);

function boundedPositiveInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function normalizePgConnectionString(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return value;
  try {
    const parsed = new URL(value);
    const sslMode = String(parsed.searchParams.get('sslmode') ?? '').trim().toLowerCase();
    const needsCompat = sslMode === 'prefer' || sslMode === 'require' || sslMode === 'verify-ca';
    if (needsCompat && !parsed.searchParams.has('uselibpqcompat')) {
      parsed.searchParams.set('uselibpqcompat', 'true');
      return parsed.toString();
    }
    return value;
  } catch {
    return value;
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(DATABASE_URL);
}

export function getDbPool(): Pool {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  const connectionString = normalizePgConnectionString(DATABASE_URL);

  if (!global.__pcuPool) {
    const max = boundedPositiveInt(DB_POOL_MAX, 12, 2, 50);
    const connectionTimeoutMillis = boundedPositiveInt(DB_CONNECT_TIMEOUT_MS, 5000, 1000, 30000);
    const idleTimeoutMillis = boundedPositiveInt(DB_IDLE_TIMEOUT_MS, 10000, 5000, 60000);
    const queryTimeoutMs = boundedPositiveInt(DB_QUERY_TIMEOUT_MS, 20000, 3000, 120000);
    const statementTimeoutMs = boundedPositiveInt(DB_STATEMENT_TIMEOUT_MS, 20000, 3000, 120000);
    global.__pcuPool = new Pool({
      connectionString,
      ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
      max,
      connectionTimeoutMillis,
      idleTimeoutMillis,
      query_timeout: queryTimeoutMs,
      statement_timeout: statementTimeoutMs,
      keepAlive: true,
      keepAliveInitialDelayMillis: 0,
    });
    // Idle pool clients can be dropped by the server (e.g. Neon closing an
    // idle connection) outside of any in-flight query. node-postgres emits
    // that as an 'error' event on the Pool itself; without a listener it
    // becomes an uncaught exception that can crash the process.
    global.__pcuPool.on('error', (err) => {
      console.error('[auth-db] idle pool client error', err instanceof Error ? err.message : err);
    });
  }

  return global.__pcuPool;
}

export async function resetDbPool(): Promise<void> {
  const pool = global.__pcuPool;
  global.__pcuPool = undefined;
  if (!pool) return;
  await pool.end().catch(() => {});
}

function parseConfiguredUsers(): UserRecord[] {
  const rawJson = process.env.APP_USERS_JSON;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as UserRecord[];
      return parsed.filter((u) => u.email && u.password && getPrimaryConfiguredAppUrl(u));
    } catch {
      return [];
    }
  }

  const email = process.env.AUTH_LOGIN_EMAIL;
  const password = process.env.AUTH_LOGIN_PASSWORD;
  const appUrl = DEFAULT_DASHBOARD_URL;
  const name = process.env.AUTH_LOGIN_NAME;

  if (email && password && appUrl) {
    return [{ email, password, appUrl, name }];
  }

  return [];
}

function getPrimaryConfiguredAppUrl(user: UserRecord): string | null {
  const fromApps =
    user.apps
      ?.map((app) => app.url?.trim() ?? '')
      .find((url) => url.length > 0) ?? '';
  if (fromApps) return fromApps;

  const fallbackUrl = user.appUrl?.trim();
  if (fallbackUrl) return fallbackUrl;
  return null;
}

function deriveUsernameFromEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createPasswordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(storedHash: string, password: string): boolean {
  if (!storedHash.includes('$')) {
    return storedHash === password;
  }

  const [algorithm, salt, hash] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) {
    return false;
  }

  const candidate = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyPasswordAgainstHash(storedHash: string, password: string): boolean {
  if (!storedHash || !password) return false;
  return verifyPassword(storedHash, password);
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function ensureOrganizationForEmail(client: PoolClient, email: string): Promise<number> {
  const normalizedEmail = email.trim().toLowerCase();
  const [, domainRaw] = normalizedEmail.split('@');
  const domain = (domainRaw ?? '').trim();
  const orgName = domain ? `${domain} Organization` : 'Default Organization';

  const existing = await client.query<{ id: number }>(
    `SELECT id FROM organizations WHERE name = $1 LIMIT 1`,
    [orgName]
  );
  if ((existing.rowCount ?? 0) === 1) {
    return existing.rows[0].id;
  }

  const created = await client.query<{ id: number }>(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [orgName]
  );
  return created.rows[0].id;
}

function preferredDashboardUrl(): string {
  return DEFAULT_DASHBOARD_URL;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isAuthSchemaReady(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query<{
      organizations_exists: string | null;
      auth_users_exists: string | null;
      players_exists: string | null;
    }>(
      `
        SELECT
          to_regclass('public.organizations') AS organizations_exists,
          to_regclass('public.auth_users') AS auth_users_exists,
          to_regclass('public.players') AS players_exists
      `
    );
    const row = result.rows[0];
    return Boolean(row?.organizations_exists && row?.auth_users_exists && row?.players_exists);
  } catch {
    return false;
  }
}

async function waitForMigrationOrLock(pool: Pool, lockId: number): Promise<'lock' | 'ready' | 'pending'> {
  const maxAttempts = 120; // ~30 seconds
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const lock = await pool.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock($1) AS locked`, [lockId]);
    if (lock.rows[0]?.locked) return 'lock';
    if (await isAuthSchemaReady(pool)) return 'ready';
    await delay(250);
  }
  if (await isAuthSchemaReady(pool)) return 'ready';
  const finalLock = await pool.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock($1) AS locked`, [lockId]);
  if (finalLock.rows[0]?.locked) return 'lock';
  return 'pending';
}

export async function ensureAuthDbReady(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (global.__pcuAuthDbReady) return;
  if (global.__pcuAuthDbReadyPromise) {
    await global.__pcuAuthDbReadyPromise;
    return;
  }

  const pool = getDbPool();
  const migrationLockId = 14840321;

  global.__pcuAuthDbReadyPromise = (async () => {
    // Prevent concurrent schema bootstrap from multiple requests/processes
    // without blocking on a long lock wait that can trigger read timeouts.
    const lockState = await waitForMigrationOrLock(pool, migrationLockId);
    if (lockState === 'ready') {
      global.__pcuAuthDbReady = true;
      return;
    }
    if (lockState === 'pending') {
      throw new Error('Database bootstrap is still running. Please retry in a few seconds.');
    }
    try {
      if (global.__pcuAuthDbReady) return;

      await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS id SERIAL;`);
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS name TEXT;`);
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_id_unique ON organizations (id);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_name_unique ON organizations (name);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      password_hash TEXT NOT NULL,
      app_url TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      role TEXT NOT NULL DEFAULT 'admin',
      organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Legacy migration: older auth_users tables may not have a numeric id column.
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS auth_users_id_seq;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS id BIGINT;`);
  await pool.query(`ALTER TABLE auth_users ALTER COLUMN id SET DEFAULT nextval('auth_users_id_seq');`);
  await pool.query(`UPDATE auth_users SET id = nextval('auth_users_id_seq') WHERE id IS NULL;`);
  await pool.query(`SELECT setval('auth_users_id_seq', COALESCE((SELECT MAX(id) FROM auth_users), 0) + 1, false);`);
  await pool.query(`ALTER TABLE auth_users ALTER COLUMN id SET NOT NULL;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_id_unique ON auth_users (id);`);

  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS name TEXT;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS password TEXT;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS app_url TEXT;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`UPDATE auth_users SET username = LOWER(email) WHERE username IS NULL OR LENGTH(TRIM(username)) = 0;`);
  await pool.query(`UPDATE auth_users SET password = password_hash WHERE password IS NULL OR LENGTH(TRIM(password)) = 0;`);
  await pool.query(`UPDATE auth_users SET is_active = TRUE WHERE is_active IS NULL;`);
  await pool.query(`UPDATE auth_users SET app_url = $1 WHERE COALESCE(TRIM(app_url), '') <> $1`, [preferredDashboardUrl()]);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER UNIQUE REFERENCES auth_users(id) ON DELETE SET NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      date_of_birth DATE,
      school_team TEXT,
      phone TEXT,
      college_commitment TEXT,
      bats_hand TEXT,
      throws_hand TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS date_of_birth DATE;`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS school_team TEXT;`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS college_commitment TEXT;`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS grad_year TEXT;`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS position TEXT;`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS bats_hand TEXT;`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS throws_hand TEXT;`);
  await pool.query(
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS assigned_coach_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL;`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_pro_links (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      pro_player_name TEXT NOT NULL,
      pro_name_norm TEXT NOT NULL,
      created_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_player_pro_links_player ON player_pro_links (player_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS body_weight_logs (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      log_date DATE NOT NULL,
      weight_lbs NUMERIC(6,2) NOT NULL,
      notes TEXT,
      created_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (player_id, log_date)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_groups (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_player_groups_org_name ON player_groups (organization_id, LOWER(name));`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_group_members (
      group_id INTEGER NOT NULL REFERENCES player_groups(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, player_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_player_group_members_player ON player_group_members (player_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_plan_goals (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      slot_index SMALLINT NOT NULL CHECK (slot_index BETWEEN 1 AND 3),
      category TEXT NOT NULL,
      goal_description TEXT NOT NULL,
      created_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (player_id, slot_index)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS completed_player_plan_goals (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      slot_index SMALLINT NOT NULL CHECK (slot_index BETWEEN 1 AND 3),
      category TEXT NOT NULL,
      goal_description TEXT NOT NULL,
      completion_details TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_plan_automation_rollups (
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      school_code TEXT NOT NULL,
      percentile_source TEXT NOT NULL,
      season_year INTEGER NOT NULL,
      payload_json JSONB NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, player_id, school_code, percentile_source, season_year)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exercise_categories (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_by INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, name)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exercise_library (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'lift',
      rep_measure TEXT NOT NULL DEFAULT 'reps',
      reps_per_side BOOLEAN NOT NULL DEFAULT FALSE,
      description TEXT,
      instruction_video_url TEXT,
      coaching_cues TEXT,
      created_by INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE exercise_library ADD COLUMN IF NOT EXISTS rep_measure TEXT NOT NULL DEFAULT 'reps';`);
  await pool.query(`ALTER TABLE exercise_library ADD COLUMN IF NOT EXISTS reps_per_side BOOLEAN NOT NULL DEFAULT FALSE;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workout_library (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      description TEXT,
      created_by INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE workout_library ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workout_exercises (
      id SERIAL PRIMARY KEY,
      workout_id INTEGER NOT NULL REFERENCES workout_library(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES exercise_library(id) ON DELETE CASCADE,
      exercise_prefix TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      prescribed_sets TEXT,
      prescribed_reps TEXT,
      prescribed_load TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workout_id, exercise_id, sort_order)
    );
  `);
  await pool.query(`ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS exercise_prefix TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programs (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE,
      created_by INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS program_days (
      id SERIAL PRIMARY KEY,
      program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
      day_date DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (program_id, day_date)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS program_day_items (
      id SERIAL PRIMARY KEY,
      program_day_id INTEGER NOT NULL REFERENCES program_days(id) ON DELETE CASCADE,
      exercise_id INTEGER REFERENCES exercise_library(id) ON DELETE CASCADE,
      workout_id INTEGER REFERENCES workout_library(id) ON DELETE CASCADE,
      prescribed_sets TEXT,
      prescribed_reps TEXT,
      prescribed_load TEXT,
      prescribed_notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE program_day_items ADD COLUMN IF NOT EXISTS workout_id INTEGER REFERENCES workout_library(id) ON DELETE CASCADE;`);
  await pool.query(`ALTER TABLE program_day_items ALTER COLUMN exercise_id DROP NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exercise_logs (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      program_day_item_id INTEGER NOT NULL REFERENCES program_day_items(id) ON DELETE CASCADE,
      performed_sets TEXT,
      performed_reps TEXT,
      performed_load TEXT,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      logged_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (player_id, program_day_item_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS program_cycle_items (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      cycle_slot TEXT NOT NULL CHECK (cycle_slot IN ('medium', 'high', 'low', 'mobility', 's_and_c')),
      workout_id INTEGER NOT NULL REFERENCES workout_library(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // "Plan" view -- a second, independent fixed-section alternative to the
  // calendar, separate from program_cycle_items (medium/high/low/mobility/
  // s_and_c) above. Sections are always rendered in this fixed order:
  // daily_prep, throwing, post_throw_arm_care, s_and_c, movement_mobility.
  // target_count NULL means "just tally completions, no goal"; a set value
  // means the UI should show "N/target". Actual completion counts are read
  // off exercise_log_history (schedule_type='plan', plan_item_id=...) at
  // query time rather than duplicated into a counter column here.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS program_plan_items (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      plan_section TEXT NOT NULL CHECK (plan_section IN ('daily_prep', 'throwing', 'post_throw_arm_care', 's_and_c', 'movement_mobility')),
      workout_id INTEGER NOT NULL REFERENCES workout_library(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      target_count INTEGER CHECK (target_count IS NULL OR target_count > 0),
      created_by INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // One note per player per section, player-visible; persists until changed.
  // An empty/absent row here means "no player-specific override" -- the read
  // path falls back to program_plan_section_default_notes below.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS program_plan_section_notes (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      plan_section TEXT NOT NULL CHECK (plan_section IN ('daily_prep', 'throwing', 'post_throw_arm_care', 's_and_c', 'movement_mobility')),
      note_text TEXT NOT NULL DEFAULT '',
      updated_by INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (player_id, plan_section)
    );
  `);

  // Org-wide standard note per section -- shown for every player in the org
  // who doesn't have their own non-empty override in program_plan_section_notes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS program_plan_section_default_notes (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      plan_section TEXT NOT NULL CHECK (plan_section IN ('daily_prep', 'throwing', 'post_throw_arm_care', 's_and_c', 'movement_mobility')),
      note_text TEXT NOT NULL DEFAULT '',
      updated_by INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, plan_section)
    );
  `);

  await pool.query(`
    DO $$
    DECLARE
      constraint_name text;
    BEGIN
      SELECT con.conname
      INTO constraint_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'program_cycle_items'
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) LIKE '%cycle_slot%'
      LIMIT 1;

      IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.program_cycle_items DROP CONSTRAINT %I', constraint_name);
      END IF;

      ALTER TABLE public.program_cycle_items
      ADD CONSTRAINT program_cycle_items_cycle_slot_check
      CHECK (cycle_slot IN ('medium', 'high', 'low', 'mobility', 's_and_c'));
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exercise_log_history (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      schedule_type TEXT NOT NULL CHECK (schedule_type IN ('calendar', 'cycle', 'plan')),
      program_day_item_id INTEGER REFERENCES program_day_items(id) ON DELETE CASCADE,
      cycle_item_id INTEGER REFERENCES program_cycle_items(id) ON DELETE CASCADE,
      plan_item_id INTEGER REFERENCES program_plan_items(id) ON DELETE CASCADE,
      performed_sets TEXT,
      performed_reps TEXT,
      performed_load TEXT,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      logged_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // exercise_log_history already existed in production with schedule_type
  // CHECK'd to ('calendar','cycle') and no plan_item_id column -- the
  // CREATE TABLE IF NOT EXISTS above only takes effect for brand-new
  // databases, so both need an idempotent migration for existing ones.
  await pool.query(`ALTER TABLE public.exercise_log_history ADD COLUMN IF NOT EXISTS plan_item_id INTEGER REFERENCES program_plan_items(id) ON DELETE CASCADE;`);
  await pool.query(`
    DO $$
    DECLARE
      constraint_name text;
    BEGIN
      SELECT con.conname
      INTO constraint_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'exercise_log_history'
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) LIKE '%schedule_type%'
      LIMIT 1;

      IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.exercise_log_history DROP CONSTRAINT %I', constraint_name);
      END IF;

      ALTER TABLE public.exercise_log_history
      ADD CONSTRAINT exercise_log_history_schedule_type_check
      CHECK (schedule_type IN ('calendar', 'cycle', 'plan'));
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END $$;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users (LOWER(email));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_users_org ON auth_users (organization_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_org ON players (organization_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_assigned_coach ON players (assigned_coach_user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_body_weight_logs_player_date ON body_weight_logs (player_id, log_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_player_plan_goals_player_slot ON player_plan_goals (player_id, slot_index);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_completed_plan_goals_player_completed_at ON completed_player_plan_goals (player_id, completed_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_plan_automation_rollups_lookup ON player_plan_automation_rollups (organization_id, school_code, percentile_source, season_year, generated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_exercise_categories_org ON exercise_categories (organization_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_exercise_library_org ON exercise_library (organization_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workout_library_org ON workout_library (organization_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout ON workout_exercises (workout_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_programs_player ON programs (player_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_days_date ON program_days (day_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_days_program_date ON program_days (program_id, day_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_day_items_day_sort ON program_day_items (program_day_id, sort_order, id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_exercise_logs_player_item ON exercise_logs (player_id, program_day_item_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_cycle_items_player_slot ON program_cycle_items (player_id, cycle_slot, sort_order);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_exercise_log_history_player_logged_at ON exercise_log_history (player_id, logged_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_exercise_log_history_program_item ON exercise_log_history (program_day_item_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_exercise_log_history_cycle_item ON exercise_log_history (cycle_item_id);`);

  const tokenColumnsResult = await pool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'password_reset_tokens'
    `
  );
  if (tokenColumnsResult.rows.length > 0) {
    const tokenColumns = new Set(tokenColumnsResult.rows.map((row) => row.column_name));
    const hasLegacyUserId = tokenColumns.has('user_id');
    const missingUserEmail = !tokenColumns.has('user_email');
    const tokenFkResult = await pool.query<{ constraint_name: string }>(
      `
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'password_reset_tokens'
          AND tc.constraint_type = 'FOREIGN KEY'
      `
    );
    const hasLegacyForeignKeys = tokenFkResult.rows.length > 0;

    if (hasLegacyUserId || missingUserEmail || hasLegacyForeignKeys) {
      await pool.query(`DROP TABLE IF EXISTS password_reset_tokens;`);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_email
    ON password_reset_tokens(user_email);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_school_access (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      school_code TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_school_access_user_school
    ON user_school_access (user_id, school_code);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_school_access_school
    ON user_school_access (school_code);
  `);

  // Video exports render for several minutes, so the request that kicks one
  // off returns immediately with a job row rather than blocking until the
  // ffmpeg pipeline finishes -- this table is the persistent record a client
  // (web Settings > Exports, mobile Settings > Exports) polls/lists against,
  // and r2_key is only set once the finished MP4 has actually been uploaded.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_export_jobs (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      requested_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
      request_params JSONB NOT NULL,
      r2_key TEXT,
      file_size_bytes BIGINT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_video_export_jobs_requested_by
    ON video_export_jobs (requested_by_user_id, created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_video_export_jobs_org
    ON video_export_jobs (organization_id, created_at DESC);
  `);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const configuredUsers = parseConfiguredUsers();
    for (const user of configuredUsers) {
      const normalizedEmail = user.email.trim().toLowerCase();
      const passwordHash = createPasswordHash(user.password);
      const primaryAppUrl = getPrimaryConfiguredAppUrl(user);
      if (!primaryAppUrl) continue;
      const organizationId = await ensureOrganizationForEmail(client, normalizedEmail);

      const existing = await client.query<{
        id: number;
        email: string;
        name: string | null;
        app_url: string | null;
        organization_id: number | null;
      }>(
        `SELECT id, email, name, app_url, organization_id FROM auth_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [normalizedEmail]
      );

      if ((existing.rowCount ?? 0) === 0) {
        const username = deriveUsernameFromEmail(normalizedEmail);
        await client.query(
          `
            INSERT INTO auth_users (email, username, name, password, password_hash, app_url, role, organization_id)
            VALUES ($1, $2, $3, $4, $5, $6, 'admin', $7)
          `,
          [normalizedEmail, username, user.name ?? null, passwordHash, passwordHash, primaryAppUrl, organizationId]
        );
        continue;
      }

      const existingRow = existing.rows[0];
      const updates: string[] = [];
      const values: Array<string | number | null> = [existingRow.id];

      if (!existingRow.app_url || !existingRow.app_url.trim()) {
        updates.push(`app_url = $${values.length + 1}`);
        values.push(primaryAppUrl);
      }

      if ((!existingRow.name || !existingRow.name.trim()) && user.name && user.name.trim()) {
        updates.push(`name = $${values.length + 1}`);
        values.push(user.name);
      }

      if (!existingRow.organization_id) {
        updates.push(`organization_id = $${values.length + 1}`);
        values.push(organizationId);
      }

      if (updates.length > 0) {
        updates.push('updated_at = NOW()');
        await client.query(
          `
            UPDATE auth_users
            SET ${updates.join(', ')}
            WHERE id = $1
          `,
          values
        );
      }
    }

    const usersMissingOrg = await client.query<{ id: number; email: string }>(
      `SELECT id, email FROM auth_users WHERE organization_id IS NULL`
    );
    for (const row of usersMissingOrg.rows) {
      const orgId = await ensureOrganizationForEmail(client, row.email);
      await client.query(`UPDATE auth_users SET organization_id = $1, updated_at = NOW() WHERE id = $2`, [orgId, row.id]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

      global.__pcuAuthDbReady = true;
    } finally {
      await pool.query(`SELECT pg_advisory_unlock($1)`, [migrationLockId]);
    }
  })().finally(() => {
    global.__pcuAuthDbReadyPromise = undefined;
  });

  await global.__pcuAuthDbReadyPromise;
}

export async function validateLoginWithDatabase(email: string, password: string): Promise<SessionUser | null> {
  if (!isDatabaseConfigured()) return null;

  const normalizedEmail = email.trim().toLowerCase();
  const pool = getDbPool();
  await queryWithLazyAuthBootstrap(() => expireDueTrialAccounts(pool));
  const result = await queryWithLazyAuthBootstrap(() =>
    pool.query<{
      id: number;
      email: string;
      name: string | null;
      password_hash: string;
      app_url: string | null;
      role: string | null;
      is_active: boolean | null;
      trial_expires_at: string | null;
      organization_id: number | null;
      player_id: number | null;
      }>(
      `
        SELECT
          u.id,
          u.email,
          u.name,
          u.password_hash,
          u.app_url,
          u.role,
          u.is_active,
          u.trial_expires_at::text AS trial_expires_at,
          u.organization_id,
          p.id AS player_id
        FROM auth_users u
        LEFT JOIN players p ON p.user_id = u.id
        WHERE LOWER(u.email) = LOWER($1)
        ORDER BY
          CASE WHEN COALESCE(u.is_active, TRUE) = TRUE THEN 0 ELSE 1 END,
          CASE WHEN u.role = 'admin' THEN 0 WHEN u.role = 'coach' THEN 1 WHEN u.role = 'player' THEN 2 ELSE 3 END,
          u.id DESC
      `,
      [normalizedEmail]
    )
  );

  if ((result.rowCount ?? 0) < 1) return null;
  for (const row of result.rows) {
    if (row.is_active === false) continue;
    const trialExpiresAt = row.trial_expires_at ? Date.parse(row.trial_expires_at) : NaN;
    if (Number.isFinite(trialExpiresAt) && trialExpiresAt <= Date.now()) continue;
    if (!verifyPassword(row.password_hash, password)) continue;
    const appUrl = row.app_url?.trim();
    if (!appUrl) continue;
    return {
      userId: row.id,
      email: row.email,
      name: row.name ?? undefined,
      appUrl,
      role: row.role === 'player' ? 'player' : row.role === 'coach' ? 'coach' : 'admin',
      organizationId: row.organization_id ?? 0,
      playerId: row.player_id ?? null,
    };
  }
  return null;
}

export async function getSessionUserByEmail(email: string): Promise<SessionUser | null> {
  if (!isDatabaseConfigured()) return null;

  const normalizedEmail = email.trim().toLowerCase();
  const pool = getDbPool();
  const result = await queryWithLazyAuthBootstrap(() =>
    pool.query<{
      id: number;
      email: string;
      name: string | null;
      app_url: string | null;
      role: string | null;
      is_active: boolean | null;
      organization_id: number | null;
      player_id: number | null;
      }>(
      `
        SELECT
          u.id,
          u.email,
          u.name,
          u.app_url,
          u.role,
          u.is_active,
          u.organization_id,
          p.id AS player_id
        FROM auth_users u
        LEFT JOIN players p ON p.user_id = u.id
        WHERE LOWER(u.email) = LOWER($1)
          AND COALESCE(u.is_active, TRUE) = TRUE
        ORDER BY
          CASE WHEN u.role = 'admin' THEN 0 WHEN u.role = 'coach' THEN 1 WHEN u.role = 'player' THEN 2 ELSE 3 END,
          u.id DESC
        LIMIT 1
      `,
      [normalizedEmail]
    )
  );

  if ((result.rowCount ?? 0) !== 1) return null;
  const row = result.rows[0];
  const appUrl = row.app_url?.trim();
  if (!appUrl) return null;

  return {
    userId: row.id,
    email: row.email,
    name: row.name ?? undefined,
    appUrl,
    role: row.role === 'player' ? 'player' : row.role === 'coach' ? 'coach' : 'admin',
    organizationId: row.organization_id ?? 0,
    playerId: row.player_id ?? null,
  };
}

export async function createPasswordResetToken(email: string): Promise<ResetTokenRecord | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureAuthDbReady();

  const normalizedEmail = email.trim().toLowerCase();
  const pool = getDbPool();
  const userResult = await pool.query<{ email: string }>(
    `SELECT email FROM auth_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [normalizedEmail]
  );

  if ((userResult.rowCount ?? 0) !== 1) return null;

  const user = userResult.rows[0];
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashResetToken(token);

  await pool.query(
    `
      INSERT INTO password_reset_tokens (user_email, token_hash, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '1 hour')
    `,
    [user.email, tokenHash]
  );

  return {
    token,
    email: user.email,
  };
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  await ensureAuthDbReady();

  const tokenHash = hashResetToken(token);
  const pool = getDbPool();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tokenResult = await client.query<{ id: number; user_email: string }>(
      `
        SELECT id, user_email
        FROM password_reset_tokens
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
      `,
      [tokenHash]
    );

    if ((tokenResult.rowCount ?? 0) !== 1) {
      await client.query('ROLLBACK');
      return false;
    }

    const tokenRow = tokenResult.rows[0];
    const newPasswordHash = createPasswordHash(newPassword);

    await client.query(
      `UPDATE auth_users SET password_hash = $1, updated_at = NOW() WHERE email = $2`,
      [newPasswordHash, tokenRow.user_email]
    );

    await client.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE user_email = $1 AND used_at IS NULL`,
      [tokenRow.user_email]
    );

    await client.query('COMMIT');
    return true;
  } catch {
    await client.query('ROLLBACK');
    return false;
  } finally {
    client.release();
  }
}

export interface StaffSchoolContact {
  userId: number;
  email: string;
  name: string | null;
  role: string;
}

export async function listSchoolCodesForUser(userId: number): Promise<string[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureAuthDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ school_code: string }>(
    `SELECT school_code FROM user_school_access WHERE user_id = $1 ORDER BY school_code`,
    [userId]
  );
  return result.rows.map((row) => row.school_code);
}

export async function setSchoolCodesForUser(userId: number, schoolCodes: string[]): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensureAuthDbReady();
  const pool = getDbPool();
  const normalized = Array.from(
    new Set(schoolCodes.map((code) => String(code ?? '').trim().toUpperCase()).filter(Boolean))
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM user_school_access WHERE user_id = $1`, [userId]);
    for (const schoolCode of normalized) {
      await client.query(
        `INSERT INTO user_school_access (user_id, school_code) VALUES ($1, $2)
         ON CONFLICT (user_id, school_code) DO NOTHING`,
        [userId, schoolCode]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listStaffForSchool(schoolCode: string): Promise<StaffSchoolContact[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureAuthDbReady();
  const normalized = String(schoolCode ?? '').trim().toUpperCase();
  if (!normalized) return [];
  const pool = getDbPool();
  const result = await pool.query<{ id: number; email: string; name: string | null; role: string }>(
    `
      SELECT DISTINCT a.id, a.email, a.name, a.role
      FROM auth_users a
      JOIN user_school_access usa ON usa.user_id = a.id
      WHERE usa.school_code = $1
        AND a.is_active = TRUE
        AND a.role IN ('admin', 'coach')
    `,
    [normalized]
  );
  return result.rows.map((row) => ({ userId: row.id, email: row.email, name: row.name, role: row.role }));
}
