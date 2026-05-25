import pg from 'pg';

const { Pool } = pg;

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

const ORG_ID = 1;
const SCHOOL_CODE = 'PCU';

const run = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const metrics = await client.query(
      `DELETE FROM biomechanics_pitch_metrics WHERE organization_id = $1 AND school_code = $2`,
      [ORG_ID, SCHOOL_CODE]
    );
    const singles = await client.query(
      `DELETE FROM biomechanics_single_pitch_points WHERE organization_id = $1 AND school_code = $2`,
      [ORG_ID, SCHOOL_CODE]
    );
    const allRows = await client.query(
      `DELETE FROM biomechanics_pitch_rows WHERE organization_id = $1 AND school_code = $2`,
      [ORG_ID, SCHOOL_CODE]
    );
    const uploads = await client.query(
      `DELETE FROM biomechanics_uploads WHERE organization_id = $1 AND school_code = $2`,
      [ORG_ID, SCHOOL_CODE]
    );
    await client.query('COMMIT');
    console.log(
      JSON.stringify(
        {
          organization_id: ORG_ID,
          school_code: SCHOOL_CODE,
          deleted: {
            biomechanics_pitch_metrics: Number(metrics.rowCount ?? 0),
            biomechanics_single_pitch_points: Number(singles.rowCount ?? 0),
            biomechanics_pitch_rows: Number(allRows.rowCount ?? 0),
            biomechanics_uploads: Number(uploads.rowCount ?? 0),
          },
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
};

run().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});

