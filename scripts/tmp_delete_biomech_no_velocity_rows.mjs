import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ORG_ID = Number(process.env.ORG_ID || 1);
const SCHOOL_CODE = String(process.env.SCHOOL_CODE || 'PCU').trim().toUpperCase();

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not configured.');
  process.exit(1);
}
if (!Number.isFinite(ORG_ID) || ORG_ID <= 0) {
  console.error('ORG_ID must be a positive number.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

const missingVelocityWhere = `
  COALESCE(NULLIF(TRIM(row_json->>'RelSpeed'), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(row_json->>'RelSpeed (mph)'), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(row_json->>'Rel Speed'), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(row_json->>'Rel Speed (mph)'), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(row_json->>'velocity'), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(row_json->>'velo'), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(row_json->>'Pitch Velocity'), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(row_json->>'pitch velocity'), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(row_json->>'pitch_velocity'), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(row_json->>'mph'), ''), NULL) IS NULL
`;

try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '2s'");
  await client.query("SET LOCAL statement_timeout = '60s'");

  const before = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM biomechanics_pitch_rows
     WHERE organization_id = $1
       AND school_code = $2`,
    [ORG_ID, SCHOOL_CODE]
  );

  const target = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM biomechanics_pitch_rows
     WHERE organization_id = $1
       AND school_code = $2
       AND (${missingVelocityWhere})`,
    [ORG_ID, SCHOOL_CODE]
  );

  const deleted = await client.query(
    `DELETE FROM biomechanics_pitch_rows
     WHERE organization_id = $1
       AND school_code = $2
       AND (${missingVelocityWhere})`,
    [ORG_ID, SCHOOL_CODE]
  );

  const after = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM biomechanics_pitch_rows
     WHERE organization_id = $1
       AND school_code = $2`,
    [ORG_ID, SCHOOL_CODE]
  );

  await client.query('COMMIT');

  console.log(JSON.stringify({
    organization_id: ORG_ID,
    school_code: SCHOOL_CODE,
    before_rows: Number(before.rows[0]?.n ?? 0),
    target_rows_without_velocity: Number(target.rows[0]?.n ?? 0),
    deleted_rows: Number(deleted.rowCount ?? 0),
    after_rows: Number(after.rows[0]?.n ?? 0),
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
