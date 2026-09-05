/**
 * Idempotent University of Arizona onboarding.
 *
 * Passwords are intentionally supplied at runtime and are never stored here:
 *   ARIZONA_PLAYER_PASSWORD=... ARIZONA_COACH_PASSWORD=... \
 *     npx tsx scripts/import-arizona-roster.ts
 *
 * Add --dry-run to validate the organization and roster without creating users.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });

const { getDbPool } = await import('../lib/auth-db');
const { createClientWithLogin, createStaffUser, ensureTrainingDbReady } = await import('../lib/training-db');
const { setSchoolMobileAccess, setSchoolProductAccess } = await import('../lib/programming-scope');

const SCHOOL_CODE = 'ARIZONA';
const ORGANIZATION_NAME = 'University of Arizona';
const DRY_RUN = process.argv.includes('--dry-run');

type PlayerRow = {
  name: string;
  email: string;
  position?: string;
};

type CoachRow = {
  name: string;
  email: string;
};

const PLAYERS: PlayerRow[] = [
  { name: 'TJ Adams', email: 'tjadams23@arizona.edu' },
  { name: 'Ariel Antigua', email: 'aantigua@arizona.edu' },
  { name: 'Smith Bailey', email: 'smbai@arizona.edu', position: 'RHP' },
  { name: 'Ben Ball', email: 'benball@arizona.edu' },
  { name: 'Trever Baumler', email: 'treverbaumler@arizona.edu', position: 'RHP' },
  { name: 'Robert Bowers', email: 'bowersrh@arizona.edu', position: 'RHP' },
  { name: 'Evan Brandt', email: 'evanbrandt@arizona.edu', position: 'RHP' },
  { name: 'Cash Brennan', email: 'cashbrennan11@arizona.edu' },
  { name: 'Easton Breyfogle', email: 'breyfogle@arizona.edu' },
  { name: 'Jack Byers', email: 'byers@arizona.edu', position: 'RHP' },
  { name: 'Andrew Cain', email: 'andrewcain@arizona.edu' },
  { name: 'Jory Crocker', email: 'jorycrocker@arizona.edu' },
  { name: 'Caleb Danzeisen', email: 'calebdanzeisen@arizona.edu' },
  { name: 'Ayden Deome', email: 'aydendeome@arizona.edu' },
  { name: 'JT Drake', email: 'jtdrake@arizona.edu', position: 'RHP' },
  { name: 'Joe Forbes', email: 'forbes3@arizona.edu' },
  { name: 'Randy Guzman', email: 'randyguzman@arizona.edu', position: 'RHP' },
  { name: 'Benton Hickman', email: 'bentonhickman2@arizona.edu', position: 'RHP' },
  { name: 'Garrett Hicks', email: 'ghicks6@arizona.edu', position: 'RHP' },
  { name: 'James Hunt', email: 'jamesehunt@arizona.edu', position: 'RHP' },
  { name: 'Charlie Kinkaid', email: 'ckinkaid@arizona.edu', position: 'RHP' },
  { name: 'Cooper Kruk', email: 'ckruk@arizona.edu' },
  { name: 'Jack Lafflam', email: 'jlafflam@arizona.edu', position: 'RHP' },
  { name: 'Lyndon Lee', email: 'lyndonlee@arizona.edu' },
  { name: 'Tony Lira', email: 'tonylira@arizona.edu' },
  { name: 'Matthew Maize', email: 'matthewmaize@arizona.edu' },
  { name: 'Carson McEntire', email: 'cmcentire@arizona.edu' },
  { name: 'Nate Novitske', email: 'natenovitske@arizona.edu' },
  { name: "Quinn O'Rourke", email: 'quinnorourke@arizona.edu', position: 'RHP' },
  { name: 'Tommy Pascanu', email: 'tpascanu@arizona.edu', position: 'LHP' },
  { name: 'Gunnar Penzkover', email: 'gpenzkover@arizona.edu', position: 'RHP' },
  { name: 'Tony Pluta', email: 'tonypluta@arizona.edu', position: 'RHP' },
  { name: 'Maclain Roberts', email: 'maclainroberts@arizona.edu', position: 'LHP' },
  { name: 'Tyler Russell', email: 'tylerrussell1@arizona.edu' },
  { name: 'Abram Sherrin', email: 'abramsherrin@arizona.edu', position: 'T-W' },
  { name: 'Beau Sylvester', email: 'beaus@arizona.edu' },
  { name: 'Gavin Triezenberg', email: 'gavintriezenberg@arizona.edu' },
  { name: 'Drew Ward', email: 'drewward11@arizona.edu' },
  { name: 'Dylan Weekly', email: 'dweekly@arizona.edu', position: 'RHP' },
];

const COACHES: CoachRow[] = [
  { name: 'Chip Hale', email: 'chale8@arizona.edu' },
  { name: 'Trip Couch', email: 'rcouch1@arizona.edu' },
  { name: 'Ella Wolters', email: 'ellawolters@arizona.edu' },
  { name: 'Sean Kenny', email: 'seankenny@arizona.edu' },
  { name: 'Jack Meggs', email: 'jmeggs@arizona.edu' },
  { name: 'Sean Winston', email: 'swinston@arizona.edu' },
  { name: 'Garen Caulfield', email: 'gcaulfield3@arizona.edu' },
  { name: 'Daniel Molinari', email: 'danielmolinari@arizona.edu' },
  { name: 'Jalen Borders', email: 'jalenborders32@arizona.edu' },
  { name: 'OJ Favela', email: 'ofavela91@arizona.edu' },
];

function throwsHand(position?: string): string {
  if (position === 'RHP') return 'Right';
  if (position === 'LHP') return 'Left';
  return '';
}

async function ensureOrganization(): Promise<number> {
  const pool = getDbPool();
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM organizations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) ORDER BY id ASC LIMIT 1`,
    [ORGANIZATION_NAME]
  );
  if ((existing.rowCount ?? 0) > 0) return Number(existing.rows[0].id);
  if (DRY_RUN) return 0;
  const created = await pool.query<{ id: number }>(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [ORGANIZATION_NAME]
  );
  return Number(created.rows[0].id);
}

async function existingEmails(organizationId: number): Promise<Set<string>> {
  if (!organizationId) return new Set();
  const result = await getDbPool().query<{ email: string }>(
    `SELECT LOWER(email) AS email FROM auth_users WHERE organization_id = $1`,
    [organizationId]
  );
  return new Set(result.rows.map((row) => row.email));
}

async function main() {
  const playerPassword = process.env.ARIZONA_PLAYER_PASSWORD ?? '';
  const coachPassword = process.env.ARIZONA_COACH_PASSWORD ?? '';
  if (!DRY_RUN && (!playerPassword || !coachPassword)) {
    throw new Error('ARIZONA_PLAYER_PASSWORD and ARIZONA_COACH_PASSWORD are required.');
  }

  await ensureTrainingDbReady();
  const organizationId = await ensureOrganization();
  const existing = await existingEmails(organizationId);
  const plannedPlayers = PLAYERS.filter((row) => !existing.has(row.email));
  const plannedCoaches = COACHES.filter((row) => !existing.has(row.email));

  console.log(`Organization: ${ORGANIZATION_NAME}${organizationId ? ` (id=${organizationId})` : ' (will be created)'}`);
  console.log(`Roster: ${PLAYERS.length} players, ${COACHES.length} coaches`);
  console.log(`To create: ${plannedPlayers.length} players, ${plannedCoaches.length} coaches`);
  if (DRY_RUN) return;

  let playersCreated = 0;
  let coachesCreated = 0;
  const failures: string[] = [];

  for (const row of plannedPlayers) {
    const result = await createClientWithLogin({
      organizationId,
      schoolCode: SCHOOL_CODE,
      schoolTeam: ORGANIZATION_NAME,
      fullName: row.name,
      email: row.email,
      password: playerPassword,
      position: row.position ?? '',
      throwsHand: throwsHand(row.position),
    });
    if (result.ok) playersCreated += 1;
    else failures.push(`${row.email}: ${result.error}`);
  }

  for (const row of plannedCoaches) {
    const result = await createStaffUser({
      organizationId,
      name: row.name,
      email: row.email,
      password: coachPassword,
      role: 'coach',
      allowCrossSchoolLinking: true,
    });
    if (result.ok) coachesCreated += 1;
    else failures.push(`${row.email}: ${result.error}`);
  }

  await setSchoolProductAccess({
    schoolCode: SCHOOL_CODE,
    dashboard: true,
    programming: true,
    clientManagement: true,
    gameTracker: true,
  });
  await setSchoolMobileAccess({
    schoolCode: SCHOOL_CODE,
    mobileSchedule: true,
    mobileWorkouts: true,
    mobileGameTracker: true,
    mobileNutrition: true,
  });

  console.log(`Created: ${playersCreated} players, ${coachesCreated} coaches`);
  console.log(`Already present: ${existing.size}`);
  if (failures.length) {
    console.error(`Failures (${failures.length}):\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
