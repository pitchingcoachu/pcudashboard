const { Client } = require('pg');

async function main() {
  const email = 'sethconner12@gmail.com';
  const collegeOrgIds = [2, 5, 6, 7, 8, 11, 12, 13, 14, 15, 18, 19];

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('BEGIN');

    const baseRes = await client.query(
      `SELECT id, email, username, name, phone, password, password_hash, app_url
       FROM auth_users
       WHERE email = $1
       ORDER BY id ASC
       LIMIT 1`,
      [email]
    );
    if (!baseRes.rowCount) throw new Error('Seth base row not found');
    const base = baseRes.rows[0];

    await client.query(
      `UPDATE auth_users
       SET role = 'admin', is_active = TRUE, updated_at = NOW()
       WHERE email = $1
         AND organization_id = ANY($2::int[])`,
      [email, collegeOrgIds]
    );

    const ins = await client.query(
      `INSERT INTO auth_users (
        email, username, name, phone, password, password_hash, app_url, role, organization_id, is_active
      )
      SELECT
        $1, $2, $3, $4, $5, $6, $7, 'admin', t.org_id, TRUE
      FROM unnest($8::int[]) AS t(org_id)
      WHERE NOT EXISTS (
        SELECT 1
        FROM auth_users u
        WHERE u.email = $1
          AND u.organization_id = t.org_id
      )
      RETURNING id, organization_id`,
      [
        email,
        base.username,
        base.name,
        base.phone,
        base.password,
        base.password_hash,
        base.app_url,
        collegeOrgIds,
      ]
    );

    const final = await client.query(
      `SELECT organization_id, role, is_active
       FROM auth_users
       WHERE email = $1
       ORDER BY organization_id`,
      [email]
    );

    await client.query('COMMIT');
    console.log(JSON.stringify({ inserted: ins.rows, total: final.rows.length, rows: final.rows }, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
