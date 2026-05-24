import pg from 'pg';

const { Pool } = pg;

function resolveDbUrl() {
  const value = process.env.DATABASE_URL;
  if (!value || !String(value).trim()) {
    throw new Error('DATABASE_URL is not set.');
  }
  return String(value).trim();
}

async function main() {
  const pool = new Pool({ connectionString: resolveDbUrl() });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s';`);
    await client.query(`SET LOCAL statement_timeout = '60s';`);

    const dupesBefore = await client.query(
      `
      SELECT COUNT(*)::int AS duplicate_groups
      FROM (
        SELECT organization_id, school_code, upload_kind, source_file_hash
        FROM biomechanics_uploads
        GROUP BY organization_id, school_code, upload_kind, source_file_hash
        HAVING COUNT(*) > 1
      ) d
      `
    );

    const deleteResult = await client.query(
      `
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY organization_id, school_code, upload_kind, source_file_hash
            ORDER BY created_at DESC, id DESC
          ) AS rn
        FROM biomechanics_uploads
      )
      DELETE FROM biomechanics_uploads u
      USING ranked r
      WHERE u.id = r.id
        AND r.rn > 1
      `
    );

    await client.query(
      `
      CREATE UNIQUE INDEX IF NOT EXISTS uq_biomech_uploads_scope_kind_hash
      ON biomechanics_uploads (organization_id, school_code, upload_kind, source_file_hash)
      `
    );

    const dupesAfter = await client.query(
      `
      SELECT COUNT(*)::int AS duplicate_groups
      FROM (
        SELECT organization_id, school_code, upload_kind, source_file_hash
        FROM biomechanics_uploads
        GROUP BY organization_id, school_code, upload_kind, source_file_hash
        HAVING COUNT(*) > 1
      ) d
      `
    );

    const indexCheck = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM pg_indexes
      WHERE schemaname = ANY (current_schemas(false))
        AND tablename = 'biomechanics_uploads'
        AND indexname = 'uq_biomech_uploads_scope_kind_hash'
      `
    );

    await client.query('COMMIT');
    console.log(
      JSON.stringify(
        {
          ok: true,
          duplicate_groups_before: Number(dupesBefore.rows[0]?.duplicate_groups ?? 0),
          duplicate_rows_deleted: Number(deleteResult.rowCount ?? 0),
          duplicate_groups_after: Number(dupesAfter.rows[0]?.duplicate_groups ?? 0),
          index_present: Number(indexCheck.rows[0]?.count ?? 0) > 0,
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

