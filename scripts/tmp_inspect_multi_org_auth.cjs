const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const multi = await client.query(
    `SELECT email, COUNT(*) AS n
     FROM auth_users
     GROUP BY email
     HAVING COUNT(*) > 1
     ORDER BY n DESC
     LIMIT 20`
  );
  console.log('multi emails', multi.rows);

  if (multi.rows.length > 0) {
    const sampleEmail = multi.rows[0].email;
    const sample = await client.query(
      `SELECT id, email, username, organization_id, role, is_active
       FROM auth_users
       WHERE email = $1
       ORDER BY organization_id, id`,
      [sampleEmail]
    );
    console.log('sample multi rows', JSON.stringify(sample.rows, null, 2));
  }

  const seth = await client.query(
    `SELECT id, email, username, organization_id, role, is_active
     FROM auth_users
     WHERE email = 'sethconner12@gmail.com'
     ORDER BY organization_id, id`
  );
  console.log('seth rows', JSON.stringify(seth.rows, null, 2));

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
