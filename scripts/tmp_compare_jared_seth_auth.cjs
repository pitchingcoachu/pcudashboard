const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const jared = await client.query(
    `SELECT id, email, username, name, role, organization_id, is_active, app_url
     FROM auth_users
     WHERE lower(email) LIKE '%jared%' OR lower(name) LIKE '%jared gaynor%'
     ORDER BY email, organization_id, id`
  );
  const seth = await client.query(
    `SELECT id, email, username, name, role, organization_id, is_active, app_url
     FROM auth_users
     WHERE email = 'sethconner12@gmail.com'
     ORDER BY organization_id, id`
  );
  console.log('JARED_ROWS', JSON.stringify(jared.rows, null, 2));
  console.log('SETH_ROWS', JSON.stringify(seth.rows, null, 2));

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
