const { Client } = require('pg');

function parseOrgSchoolMap(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    const out = new Map();
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k);
      const school = String(v || '').trim().toUpperCase();
      if (Number.isFinite(id) && id > 0 && school) out.set(id, school);
    }
    return out;
  } catch {
    return new Map();
  }
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const orgRows = await client.query(`SELECT id, name FROM organizations ORDER BY id`);
  const map = parseOrgSchoolMap(process.env.DASHBOARD_ORG_SCHOOL_MAP || '{}');
  const pcuOrgIds = orgRows.rows
    .filter((r) => {
      const name = String(r.name || '').toUpperCase();
      const mapped = map.get(Number(r.id)) || '';
      return mapped === 'PCU' || name.includes('PITCHINGCOACHU') || name === 'PCU';
    })
    .map((r) => Number(r.id));

  await client.query('BEGIN');
  const deleted = await client.query(
    `DELETE FROM players
     WHERE email LIKE '%@autolink.local'
       AND organization_id = ANY($1::int[])
     RETURNING id, organization_id, full_name, email`,
    [pcuOrgIds.length ? pcuOrgIds : [-1]]
  );
  await client.query('COMMIT');

  console.log(JSON.stringify({ pcuOrgIds, deleted: deleted.rows.length, rows: deleted.rows }, null, 2));
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
