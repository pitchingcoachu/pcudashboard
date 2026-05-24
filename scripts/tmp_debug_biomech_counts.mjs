import pg from 'pg';

const { Pool } = pg;

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

const run = async () => {
  const client = await pool.connect();
  try {
    const orgs = await client.query(`
      SELECT organization_id, school_code, COUNT(*)::int AS uploads
      FROM biomechanics_uploads
      GROUP BY organization_id, school_code
      ORDER BY uploads DESC
      LIMIT 10
    `);
    const rows = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM biomechanics_pitch_rows)::int AS all_pitch_rows,
        (SELECT COUNT(DISTINCT source_file_hash) FROM biomechanics_single_pitch_points)::int AS single_files,
        (SELECT COUNT(*) FROM biomechanics_single_pitch_points)::int AS single_points
    `);
    const samples = await client.query(`
      SELECT source_file_name, source_file_hash, upload_kind, row_count, created_at
      FROM biomechanics_uploads
      ORDER BY created_at DESC
      LIMIT 20
    `);
    console.log(JSON.stringify({ orgs: orgs.rows, totals: rows.rows[0], latest_uploads: samples.rows }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});

