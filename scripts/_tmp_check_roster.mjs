import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL, max: 1 });
try {
  console.log('=== Mogen in players table, all orgs ===');
  const r1 = await pool.query(`
    SELECT p.id, p.full_name, p.status, o.name AS org_name, o.id AS org_id
    FROM public.players p
    JOIN public.organizations o ON o.id = p.organization_id
    WHERE lower(p.full_name) LIKE '%mogen%'
  `);
  console.table(r1.rows);

  console.log('=== organizations named UNM (exact match check) ===');
  const r2 = await pool.query(`
    SELECT id, name, UPPER(TRIM(name)) AS normalized FROM public.organizations
    WHERE UPPER(TRIM(name)) LIKE '%UNM%' OR UPPER(TRIM(name)) LIKE '%NEW MEXICO%'
  `);
  console.table(r2.rows);
} finally { await pool.end(); }
