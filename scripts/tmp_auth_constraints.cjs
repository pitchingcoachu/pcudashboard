const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const idx = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public' AND tablename='auth_users'
    ORDER BY indexname
  `);
  console.log(JSON.stringify(idx.rows, null, 2));

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
