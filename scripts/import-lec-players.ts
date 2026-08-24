/**
 * One-time import: creates player login accounts for Lake Erie College
 * (source: ~/Downloads/Lake Erie Emails.xlsx), all sharing the same shared
 * password. Reuses createClientWithLogin (same insertion path as the "Add
 * Player Login" admin form) so hashing, org resolution, and the
 * auth_users/players dual-insert stay identical to the production form.
 *
 * Rows tagged "Coach" in the source sheet are excluded -- those coaches
 * already have accounts.
 *
 * Usage:
 *   npx tsx scripts/import-lec-players.ts
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
// repro (see PR/commit note): a static import reads undefined; a dynamic
// import after config() reads the real value.
const { createClientWithLogin, resolveOrganizationIdForSchool } = await import('../lib/training-db');

const SCHOOL_CODE = 'LEC';
const SHARED_PASSWORD = 'Storm2026';

type RosterRow = { first: string; last: string; email: string };

const ROSTER: RosterRow[] = [
  { first: 'Koden', last: 'Bechtel', email: 'kbechtel@lec.edu' },
  { first: 'Zaviour', last: 'Esquivel', email: 'Zesquivel@lec.edu' },
  { first: 'Ajay', last: 'Workman', email: 'aworkman@lec.edu' },
  { first: 'Trent', last: 'Gardner', email: 'Tgardner@lec.edu' },
  { first: 'Joey', last: 'Lehner', email: 'jlehner@lec.edu' },
  { first: 'Nathan', last: "O'Leary", email: 'Noleary@lec.edu' },
  { first: 'Brady', last: 'Carman', email: 'Bcarman@lec.edu' },
  { first: 'Logan', last: 'Kozma', email: 'lkozma@lec.edu' },
  { first: 'Liam', last: 'Widemire', email: 'Lwidemire@lec.edu' },
  { first: 'Jonah', last: 'Marks', email: 'jmarks@lec.edu' },
  { first: 'Brady', last: 'Pennza', email: 'bpennza@lec.edu' },
  { first: 'Brenden', last: 'Tuttle', email: 'btuttle@lec.edu' },
  { first: 'Matt', last: 'Fountain', email: 'Mfountain@lec.edu' },
  { first: 'Cooper', last: 'Merckling', email: 'Cmerckling@lec.edu' },
  { first: 'Hunter', last: 'Bays', email: 'hbays@lec.edu' },
  { first: 'Justin', last: 'Costello', email: 'jcostello@lec.edu' },
  { first: 'Brayden', last: 'Poltrone', email: 'bpoltrone@lec.edu' },
  { first: 'Jackson', last: 'Rood', email: 'Jrood@lec.edu' },
  { first: 'William', last: 'Cornett', email: 'Wcornett@lec.edu' },
  { first: 'Colton', last: 'Tyler', email: 'Ctyler@lec.edu' },
  { first: 'Micah', last: 'Geise', email: 'mgeise@lec.edu' },
  { first: 'Owen', last: 'Sullivan', email: 'osullivan@lec.edu' },
  { first: 'Seth', last: 'Yacobucci', email: 'Syacobucci@lec.edu' },
  { first: 'Mark', last: 'Williams', email: 'Marwilliams@lec.edu' },
  { first: 'Tanner', last: "O'Farrell", email: 'tofarrell@lec.edu' },
  { first: 'Dylan', last: 'Minnie', email: 'dminnie@lec.edu' },
  { first: 'Teagan', last: 'Williams', email: 'tewilliams@lec.edu' },
  { first: 'Noah', last: 'Bowerman', email: 'nbowerman@lec.edu' },
  { first: 'Brendon', last: 'Rowe', email: 'Browe@lec.edu' },
  { first: 'Luke', last: 'Reasor', email: 'lreasor@lec.edu' },
  { first: 'Mason', last: 'Wolf', email: 'mwolf@lec.edu' },
  { first: 'Carter', last: 'Phillips', email: 'Cphillips@lec.edu' },
  { first: 'Ethan', last: 'Baker', email: 'Ebaker@lec.edu' },
  { first: 'Jason', last: 'Begalla', email: 'jbegalla@lec.edu' },
  { first: 'Jackson', last: 'Lee', email: 'Jlee@lec.edu' },
  { first: 'Ryne', last: 'Buckley', email: 'rbuckley@lec.edu' },
  { first: 'Neeko', last: 'Spicer', email: 'Nspicer@lec.edu' },
  { first: 'Axel', last: 'Hammerschmidt', email: 'ahammerschmidt@lec.edu' },
  { first: 'Gannon', last: 'Padgett', email: 'Gpadgett@lec.edu' },
  { first: 'Matt', last: 'Lorencz', email: 'mlorencz@lec.edu' },
  { first: 'Dylan', last: 'LeFevre', email: 'dlefevre@lec.edu' },
  { first: 'AJ', last: 'Pierson', email: 'apierson@lec.edu' },
  { first: 'Braylon', last: 'McBride', email: 'bmcbride@lec.edu' },
  { first: 'Zach', last: 'Hoskins', email: 'zhoskins@lec.edu' },
  { first: 'George', last: 'Edwards', email: 'gedwards@lec.edu' },
  { first: 'Aaron', last: 'de Oleo Rivas', email: 'adeoleorivas@lec.edu' },
  { first: 'Hunter', last: 'Lefkus', email: 'hlefkus@lec.edu' },
  { first: 'Brayden', last: 'Stem', email: 'bstem@lec.edu' },
  { first: 'Ben', last: 'Kearns', email: 'bkearns@lec.edu' },
  { first: 'Camden', last: 'Sharkey', email: 'Casharkey@lec.edu' },
  { first: 'Elliot', last: 'Tomb', email: 'etomb@lec.edu' },
  { first: 'Travis', last: 'Yankovich', email: 'Tyankovich@lec.edu' },
  { first: 'Andrew', last: 'Baileys', email: 'Abaileys@lec.edu' },
  { first: 'Tucker', last: 'Webb', email: 'twebb@lec.edu' },
  { first: 'Anthony', last: 'Macias', email: 'Anmacias@lec.edu' },
  { first: 'Seth', last: 'Mannos', email: 'Smannos@lec.edu' },
  { first: 'Ryan', last: 'Mielnicki', email: 'rmielnicki@lec.edu' },
  { first: 'Tyson', last: 'Welch', email: 'Tywelch@lec.edu' },
];

async function main() {
  const organizationId = await resolveOrganizationIdForSchool({ schoolCode: SCHOOL_CODE });
  if (!organizationId) {
    console.error(`Could not resolve an organization_id for school_code=${SCHOOL_CODE}. Aborting.`);
    process.exit(1);
  }
  console.log(`Resolved LEC -> organization_id=${organizationId}`);

  let created = 0;
  let skipped = 0;
  const failures: { name: string; email: string; error: string }[] = [];

  for (const row of ROSTER) {
    const fullName = `${row.first.trim()} ${row.last.trim()}`.trim();
    const result = await createClientWithLogin({
      organizationId,
      schoolCode: SCHOOL_CODE,
      fullName,
      email: row.email.trim().toLowerCase(),
      password: SHARED_PASSWORD,
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
