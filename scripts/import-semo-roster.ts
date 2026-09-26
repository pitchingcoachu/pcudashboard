/**
 * Idempotent SEMO player-login sync using coach-supplied player emails.
 *
 * Usage:
 *   SEMO_PLAYER_PASSWORD=... npx tsx scripts/import-semo-roster.ts --dry-run --prune
 *   SEMO_PLAYER_PASSWORD=... npx tsx scripts/import-semo-roster.ts --prune
 *
 * --prune removes SEMO player profiles not included in PLAYERS. It is never
 * implied, so a normal rerun cannot accidentally remove a future roster row.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });

const { getDbPool } = await import('../lib/auth-db');
const { createClientWithLogin, deleteClientUser, ensureTrainingDbReady, resolveOrganizationIdForSchool } = await import('../lib/training-db');

const SCHOOL_CODE = 'SEMO';
const SCHOOL_TEAM = 'SEMO Baseball';
const DRY_RUN = process.argv.includes('--dry-run');
const PRUNE = process.argv.includes('--prune');

type PlayerRow = { name: string; email: string; position: string };

const PLAYERS: PlayerRow[] = [
  { name: 'Andrew Carroll', email: 'andrew7carroll@icloud.com', position: 'RHP' },
  { name: 'Matt Wnukowski', email: 'mattynuk1302@gmail.com', position: 'LHP' },
  { name: 'Jaxson Joggerst', email: 'jjjoggerst1s@semo.edu', position: 'RHP' },
  { name: 'Drew Parsons', email: 'dsparsons1s@semo.edu', position: 'RHP' },
  { name: 'Ty Earwood', email: 'teearwood1s@semo.edu', position: 'LHP' },
  { name: 'Colin Galvin', email: 'cjgalvin27@gmail.com', position: 'RHP' },
  { name: 'Sean York', email: 'seanhyork2005@gmail.com', position: 'RHP' },
  { name: 'Evan Bogart', email: 'evanbogart1@gmail.com', position: 'RHP' },
  { name: 'John-Paul Sauer', email: 'jrsauer2s@semo.edu', position: 'RHP' },
  { name: 'Ben Snider', email: 'besnider1s@semo.edu', position: 'LHP' },
  { name: 'Rex Tedder', email: 'rextedder06@gmail.com', position: 'RHP' },
  { name: 'Ben Lackey', email: 'bklackey1s@semo.edu', position: 'RHP' },
  { name: 'Alex Lora', email: 'arloramatos1s@semo.edu', position: 'RHP' },
  { name: 'Alex Menth', email: 'admenth1s@semo.edu', position: 'LHP' },
  { name: 'Cole Scott', email: 'cdscott3s@semo.edu', position: 'RHP' },
  { name: "Trey O'Neil", email: 'thoneil1s@semo.edu', position: 'RHP' },
  { name: 'Turner Zdunich', email: 'tzdunich1s@semo.edu', position: 'UTL' },
  { name: 'JoJo Keldsen', email: 'jakeldsen1s@semo.edu', position: 'RHP' },
  { name: 'Brayden Briscoe', email: 'bbriscoe1s@semo.edu', position: 'RHP' },
  { name: 'Eli Maynor', email: 'egmaynor1s@semo.edu', position: 'RHP' },
  { name: 'Drew Zemaitis', email: 'azemaitis1s@semo.edu', position: 'RHP' },
  { name: 'Blake Coleman', email: 'bdcoleman3s@semo.edu', position: 'LHP' },
  { name: 'John Haberkorn', email: 'jphaberkorn1s@semo.edu', position: 'RHP' },
];

function normalizeName(value: string) {
  return value.trim().replace(/[’]/g, "'").replace(/\s+/g, ' ').toLowerCase();
}

function throwingHand(position: string) {
  if (position === 'LHP') return 'Left';
  if (position === 'RHP') return 'Right';
  return '';
}

async function main() {
  const password = process.env.SEMO_PLAYER_PASSWORD ?? '';
  await ensureTrainingDbReady();
  const pool = getDbPool();
  const organizationId = await resolveOrganizationIdForSchool({ schoolCode: SCHOOL_CODE });
  if (!organizationId) throw new Error('Unable to resolve the SEMO organization.');

  const currentResult = await pool.query<{
    player_id: number;
    user_id: number | null;
    full_name: string;
    player_email: string;
    login_email: string | null;
  }>(`
    SELECT p.id AS player_id, p.user_id, p.full_name, p.email AS player_email, u.email AS login_email
    FROM players p
    LEFT JOIN auth_users u ON u.id = p.user_id
    WHERE p.organization_id = $1
    ORDER BY p.full_name
  `, [organizationId]);

  const currentByName = new Map(currentResult.rows.map((row) => [normalizeName(row.full_name), row]));
  const targetNames = new Set(PLAYERS.map((row) => normalizeName(row.name)));
  const toCreate = PLAYERS.filter((row) => !currentByName.has(normalizeName(row.name)));
  const toUpdate = PLAYERS.flatMap((row) => {
    const current = currentByName.get(normalizeName(row.name));
    if (!current) return [];
    const targetEmail = row.email.trim().toLowerCase();
    return current.login_email?.trim().toLowerCase() === targetEmail && current.player_email.trim().toLowerCase() === targetEmail
      ? []
      : [{ row, current }];
  });
  const toDelete = PRUNE ? currentResult.rows.filter((row) => !targetNames.has(normalizeName(row.full_name))) : [];

  const targetEmails = PLAYERS.map((row) => row.email.trim().toLowerCase());
  const currentUserIds = currentResult.rows.map((row) => Number(row.user_id ?? 0)).filter((id) => id > 0);
  const conflicts = await pool.query<{ email: string; name: string | null; organization_id: number | null }>(`
    SELECT email, name, organization_id
    FROM auth_users
    WHERE LOWER(email) = ANY($1::text[])
      AND NOT (organization_id = $2 AND role = 'player' AND id = ANY($3::int[]))
  `, [targetEmails, organizationId, currentUserIds]);
  if ((conflicts.rowCount ?? 0) > 0) {
    throw new Error(`Target email conflicts found: ${JSON.stringify(conflicts.rows)}`);
  }

  console.log(`Organization: ${SCHOOL_CODE} (id=${organizationId})`);
  console.log(`Email-backed roster: ${PLAYERS.length}`);
  console.log(`Create: ${toCreate.length}; Update: ${toUpdate.length}; Delete: ${toDelete.length}; Unchanged: ${PLAYERS.length - toCreate.length - toUpdate.length}`);
  for (const item of toUpdate) console.log(`UPDATE  ${item.row.name}: ${item.current.login_email} -> ${item.row.email}`);
  for (const item of toCreate) console.log(`CREATE  ${item.name} <${item.email}>`);
  for (const item of toDelete) console.log(`DELETE  ${item.full_name} <${item.login_email ?? item.player_email}>`);
  if (DRY_RUN) return;
  if (toCreate.length > 0 && !password) throw new Error('SEMO_PLAYER_PASSWORD is required when accounts must be created.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of toUpdate) {
      if (!item.current.user_id) throw new Error(`${item.row.name} has no linked login user.`);
      const email = item.row.email.trim().toLowerCase();
      await client.query(`
        UPDATE auth_users
        SET email = $1, username = $1, name = $2, updated_at = NOW()
        WHERE id = $3 AND organization_id = $4 AND role = 'player'
      `, [email, item.row.name, item.current.user_id, organizationId]);
      await client.query(`
        UPDATE players
        SET email = $1, full_name = $2, position = $3, throws_hand = $4, updated_at = NOW()
        WHERE id = $5 AND organization_id = $6
      `, [email, item.row.name, item.row.position, throwingHand(item.row.position), item.current.player_id, organizationId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  for (const row of toCreate) {
    const result = await createClientWithLogin({
      organizationId,
      schoolCode: SCHOOL_CODE,
      schoolTeam: SCHOOL_TEAM,
      fullName: row.name,
      email: row.email,
      password,
      position: row.position,
      throwsHand: throwingHand(row.position),
    });
    if (!result.ok) throw new Error(`Failed to create ${row.name}: ${result.error}`);
  }

  for (const row of toDelete) {
    const result = await deleteClientUser({ organizationId, playerId: row.player_id });
    if (!result.ok) throw new Error(`Failed to delete ${row.full_name}: ${result.error}`);
  }

  console.log(`Applied: ${toCreate.length} created, ${toUpdate.length} updated, ${toDelete.length} deleted.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
