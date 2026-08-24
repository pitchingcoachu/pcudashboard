/**
 * One-time import: creates player login accounts for the UNM 2026 Fall
 * roster (source: ~/Downloads/2026 Fall Roster Trackman.xlsx), all sharing
 * the same temp password. Reuses createClientWithLogin (same insertion path
 * as the "Add Player Login" admin form) so hashing, org resolution, and the
 * auth_users/players dual-insert stay identical to the production form.
 *
 * Usage:
 *   npx tsx scripts/import-unm-fall-2026-roster.ts
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '.env.local') });

// Dynamic import, not a static top-level one: lib/training-db.ts (via
// lib/auth-db.ts) reads process.env.DATABASE_URL into a module-level const
// at import time, and ESM hoists static imports before any top-level
// statement in this file runs -- including the config() call above -- so a
// static import here would capture DATABASE_URL as undefined regardless of
// where the import statement appears in the source. Confirmed via a direct
// repro: a static import reads undefined; a dynamic import after config()
// reads the real value.
const { createClientWithLogin, resolveOrganizationIdForSchool } = await import('../lib/training-db');

const SCHOOL_CODE = 'UNM';
const SHARED_PASSWORD = 'pitchingcoachu';

type RosterRow = {
  first: string;
  last: string;
  position: string;
  batThrow: string; // "R/R" = bats/throws
  email: string;
};

const ROSTER: RosterRow[] = [
  { first: 'Talan', last: 'Barraza', position: 'INF', batThrow: 'R/R', email: 'talanbarraza@icloud.com' },
  { first: 'Reid', last: 'Jacobson', position: 'INF', batThrow: 'L/R', email: 'rjacobson1@unm.edu' },
  { first: 'Zakye', last: 'Hawkins', position: 'INF', batThrow: 'R/R', email: 'flyinghawk312@yahoo.com' },
  { first: 'Austin', last: 'Frye', position: 'OF', batThrow: 'L/L', email: 'austinfrye22@unm.edu' },
  { first: 'Shane', last: 'Miller', position: 'INF', batThrow: 'L/R', email: 'shanemiller2024@unm.edu' },
  { first: 'David', last: 'Hernandez', position: 'INF', batThrow: 'R/R', email: 'd3.hernandez.2024@gmail.com' },
  { first: 'Austin', last: 'Godwin', position: 'INF', batThrow: 'R/R', email: 'austingodwin@unm.edu' },
  { first: 'Diego', last: 'Alvarez', position: 'RHP', batThrow: 'R/R', email: 'dalvarez1@unm.edu' },
  { first: 'Antonio', last: 'Gianni', position: 'OF', batThrow: 'R/R', email: 'gianniantonio2005@gmail.com' },
  { first: 'Ethin', last: 'Woltz', position: 'RHP', batThrow: 'R/R', email: 'ewoltz@unm.edu' },
  { first: 'Tim', last: 'Hudson', position: 'RHP', batThrow: 'R/R', email: 'htim15966@gmail.com' },
  { first: 'Lucas', last: 'Moore', position: 'RHP', batThrow: 'R/R', email: 'lucasmoore12@unm.edu' },
  { first: 'Ethan', last: 'Guzman', position: 'C', batThrow: 'L/R', email: 'ethanguzman32@yahoo.com' },
  { first: 'Ryder', last: 'Melsa', position: 'RHP', batThrow: 'R/R', email: 'rydermelsa48@gmail.com' },
  { first: 'Willie', last: 'Cornejo-Farmer', position: 'UTL', batThrow: 'R/R', email: 'wcornejofarmer15@unm.edu' },
  { first: 'Kai', last: 'Fitak', position: 'RHP', batThrow: 'R/R', email: 'kfitak@unm.edu' },
  { first: 'Cristian', last: 'Mogen', position: 'RHP', batThrow: 'R/R', email: 'cmogen2917@unm.edu' },
  { first: 'Eduardo', last: 'Torres', position: 'RHP', batThrow: 'R/R', email: 'torresloera32@gmail.com' },
  { first: 'Lachlan', last: 'Maude', position: 'C', batThrow: 'R/R', email: 'lachlanmaude405@gmail.com' },
  { first: 'Giuseppe', last: 'Salvatore', position: 'C', batThrow: 'L/R', email: 'gsalvatore@unm.edu' },
  { first: 'Reed', last: 'McConnell', position: 'RHP', batThrow: 'R/R', email: 'ramcconnell34@gmail.com' },
  { first: 'Ethan', last: 'Califf', position: 'RHP', batThrow: 'R/R', email: 'ethancaliff@unm.edu' },
  { first: 'Jackson', last: 'Glueck', position: 'INF', batThrow: 'L/L', email: 'jglueck@unm.edu' },
  { first: 'Skyler', last: 'Daniel', position: 'INF', batThrow: 'R/R', email: 'sdaniel2@unm.edu' },
  { first: 'Luke', last: 'Feist', position: 'RHP', batThrow: 'R/R', email: 'feistab5@unm.edu' },
  { first: 'Carson', last: 'Munroe', position: 'RHP', batThrow: 'R/R', email: 'carsonmunroe23@unm.edu' },
  { first: 'Ian', last: 'Lemus', position: 'RHP', batThrow: 'R/R', email: 'ianlemus2024@gmail.com' },
  { first: 'Alex', last: 'Altmann', position: 'OF', batThrow: 'L/L', email: 'alexrocket27@gmail.com' },
  { first: 'Tyler', last: 'Do', position: 'RHP', batThrow: 'R/R', email: 'tylerdobaseball2023@gmail.com' },
  { first: 'Ryan', last: 'Castillo', position: 'RHP', batThrow: 'R/R', email: 'rlcastillo@unm.edu' },
  { first: 'Holden', last: 'Harris', position: 'RHP', batThrow: 'R/R', email: 'holdenharris2023@gmail.com' },
  { first: 'Matvey', last: 'Yudaev', position: 'LHP', batThrow: 'L/L', email: 'yudaevmatvey@gmail.com' },
  { first: 'Diego', last: 'Rodriguez', position: 'RHP', batThrow: 'R/R', email: 'drodriguez19@unm.edu' },
  { first: 'Aidan', last: 'Kuni', position: 'UTL', batThrow: 'L/R', email: 'aidankuni@gmail.com' },
  { first: 'Jacob', last: 'Gergen', position: 'RHP', batThrow: 'R/R', email: 'jgergen@unm.edu' },
  { first: 'Matthew', last: 'Castillo', position: 'RHP', batThrow: 'R/R', email: 'mcastillo7@unm.edu' },
];

function handFromCode(code: string): string {
  if (code === 'R') return 'Right';
  if (code === 'L') return 'Left';
  if (code === 'S') return 'Switch';
  return '';
}

async function main() {
  const organizationId = await resolveOrganizationIdForSchool({ schoolCode: SCHOOL_CODE });
  if (!organizationId) {
    console.error(`Could not resolve an organization_id for school_code=${SCHOOL_CODE}. Aborting.`);
    process.exit(1);
  }
  console.log(`Resolved UNM -> organization_id=${organizationId}`);

  let created = 0;
  let skipped = 0;
  const failures: { name: string; email: string; error: string }[] = [];

  for (const row of ROSTER) {
    const [batCode, throwCode] = row.batThrow.split('/').map((s) => s.trim());
    const fullName = `${row.first.trim()} ${row.last.trim()}`.trim();
    const result = await createClientWithLogin({
      organizationId,
      schoolCode: SCHOOL_CODE,
      fullName,
      email: row.email.trim().toLowerCase(),
      password: SHARED_PASSWORD,
      position: row.position,
      batsHand: handFromCode(batCode ?? ''),
      throwsHand: handFromCode(throwCode ?? ''),
    });
    if (result.ok) {
      created += 1;
      console.log(`OK    ${fullName} <${row.email}>`);
    } else if (result.error === 'A login already exists with that email.') {
      skipped += 1;
      console.log(`SKIP  ${fullName} <${row.email}> -- already exists`);
    } else {
      failures.push({ name: fullName, email: row.email, error: result.error });
      console.error(`FAIL  ${fullName} <${row.email}> -- ${result.error}`);
    }
  }

  console.log('---');
  console.log(`Created: ${created}, Skipped (already existed): ${skipped}, Failed: ${failures.length}`);
  if (failures.length) {
    console.log('Failures:', JSON.stringify(failures, null, 2));
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
