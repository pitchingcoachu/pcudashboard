/**
 * One-time password reset: sets every Lake Erie College coach account
 * (organization_id=39, role='coach') to a shared password. Reuses
 * createPasswordHash (same hashing path as the real reset-password flow, see
 * lib/auth-db.ts resetPasswordWithToken) so the hash format matches.
 *
 * Usage:
 *   npx tsx scripts/reset-lec-coach-passwords.ts
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '.env.local') });

// Dynamic import: lib/auth-db.ts reads process.env.DATABASE_URL into a
// module-level const at import time, and ESM hoists static imports before
// config() above would run -- see scripts/import-lec-players.ts for the
// full explanation/repro.
const { createPasswordHash, getDbPool } = await import('../lib/auth-db');

const ORGANIZATION_ID = 39; // Lake Erie College
const NEW_PASSWORD = 'LEC2026';

async function main() {
  const pool = getDbPool();
  const passwordHash = createPasswordHash(NEW_PASSWORD);

  const { rows } = await pool.query<{ email: string; name: string }>(
    `SELECT email, name FROM auth_users WHERE organization_id = $1 AND role = 'coach' ORDER BY email`,
    [ORGANIZATION_ID]
  );

  if (!rows.length) {
    console.log('No coach accounts found for organization_id =', ORGANIZATION_ID);
    return;
  }

  console.log(`Found ${rows.length} coach account(s) for organization_id=${ORGANIZATION_ID}:`);
  for (const r of rows) console.log(`  ${r.name} <${r.email}>`);

  const result = await pool.query(
    `UPDATE auth_users SET password_hash = $1, updated_at = NOW() WHERE organization_id = $2 AND role = 'coach'`,
    [passwordHash, ORGANIZATION_ID]
  );

  console.log(`\nUpdated ${result.rowCount} row(s) to the new shared password.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
