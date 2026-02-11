import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';

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

type SessionUser = {
  email: string;
  appUrl: string;
  name?: string;
};

type ResetTokenRecord = {
  token: string;
  email: string;
  name?: string;
};

declare global {
  var __pcuPool: Pool | undefined;
  var __pcuAuthDbReady: boolean | undefined;
}

const DATABASE_URL = process.env.DATABASE_URL;

export function isDatabaseConfigured(): boolean {
  return Boolean(DATABASE_URL);
}

function getPool(): Pool {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (!global.__pcuPool) {
    global.__pcuPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    });
  }

  return global.__pcuPool;
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
  const appUrl = process.env.AUTH_APP_URL;
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

function hashPassword(password: string): string {
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

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function ensureAuthDbReady(): Promise<void> {
  if (!isDatabaseConfigured()) return;

  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      app_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Legacy migration: older tables may exist without all required columns.
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS name TEXT;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS app_url TEXT;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  // Legacy migration: if a prior version created reset tokens with user_id or
  // FK constraints, recreate this table with the current email-based schema.
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

  const configuredUsers = parseConfiguredUsers();
  for (const user of configuredUsers) {
    const normalizedEmail = user.email.trim().toLowerCase();
    const passwordHash = hashPassword(user.password);
    const primaryAppUrl = getPrimaryConfiguredAppUrl(user);
    if (!primaryAppUrl) continue;
    const existing = await pool.query<{ email: string; name: string | null; app_url: string | null }>(
      `SELECT email, name, app_url FROM auth_users WHERE email = $1 LIMIT 1`,
      [normalizedEmail]
    );
    if (existing.rowCount === 0) {
      await pool.query(
        `
        INSERT INTO auth_users (email, name, password_hash, app_url)
        VALUES ($1, $2, $3, $4)
        `,
        [normalizedEmail, user.name ?? null, passwordHash, primaryAppUrl]
      );
      continue;
    }

    const existingRow = existing.rows[0];
    const updates: string[] = [];
    const values: Array<string | null> = [normalizedEmail];

    if (!existingRow.app_url || !existingRow.app_url.trim()) {
      updates.push(`app_url = $${values.length + 1}`);
      values.push(primaryAppUrl);
    }

    if ((!existingRow.name || !existingRow.name.trim()) && user.name && user.name.trim()) {
      updates.push(`name = $${values.length + 1}`);
      values.push(user.name);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      await pool.query(
        `
        UPDATE auth_users
        SET ${updates.join(', ')}
        WHERE email = $1
        `,
        values
      );
    }
  }

  global.__pcuAuthDbReady = true;
}

export async function validateLoginWithDatabase(email: string, password: string): Promise<SessionUser | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureAuthDbReady();

  const normalizedEmail = email.trim().toLowerCase();
  const pool = getPool();
  const result = await pool.query<{
    email: string;
    name: string | null;
    password_hash: string;
    app_url: string | null;
  }>(
    `SELECT email, name, password_hash, app_url FROM auth_users WHERE email = $1 LIMIT 1`,
    [normalizedEmail]
  );

  if (result.rowCount !== 1) return null;
  const row = result.rows[0];
  if (!verifyPassword(row.password_hash, password)) return null;
  const appUrl = row.app_url?.trim();
  if (!appUrl) return null;

  return {
    email: row.email,
    name: row.name ?? undefined,
    appUrl,
  };
}

export async function createPasswordResetToken(email: string): Promise<ResetTokenRecord | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureAuthDbReady();

  const normalizedEmail = email.trim().toLowerCase();
  const pool = getPool();
  const userResult = await pool.query<{ email: string }>(
    `SELECT email FROM auth_users WHERE email = $1 LIMIT 1`,
    [normalizedEmail]
  );

  if (userResult.rowCount !== 1) return null;

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
  const pool = getPool();

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

    if (tokenResult.rowCount !== 1) {
      await client.query('ROLLBACK');
      return false;
    }

    const tokenRow = tokenResult.rows[0];
    const newPasswordHash = hashPassword(newPassword);

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
