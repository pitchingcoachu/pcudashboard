const fs = require("fs");
const { Client } = require("pg");

function loadEnv() {
  const txt = fs.readFileSync(".env.local", "utf8");
  const env = {};
  txt.split(/\n/).forEach((line) => {
    if (!line || line.trim().startsWith("#")) return;
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return env;
}

const schoolNs = {
  PCU: ["tmdata", "pcu", "pcubaseball"],
  OSU: ["oklahomastate", "osubaseball"],
  CNU: ["cnubaseball", "carsonnewman"],
  GCU: ["gcubaseball"],
  LSU: ["lsubaseball", "lsu"],
};

async function main() {
  const env = loadEnv();
  const url =
    env.DATABASE_URL ||
    env.DASHBOARD_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.DASHBOARD_DATABASE_URL;

  if (!url) {
    console.log("no_db_url");
    process.exit(0);
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.pitch_event_edits (
        id BIGSERIAL PRIMARY KEY,
        school_code TEXT NOT NULL,
        pitch_event_id INT NOT NULL,
        pitch_type TEXT NOT NULL,
        pitcher TEXT NOT NULL,
        edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pitch_event_edits_school_code
      ON public.pitch_event_edits (school_code)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pitch_event_edits_unique
      ON public.pitch_event_edits (school_code, pitch_event_id, pitch_type, pitcher)
    `);

    const summary = [];
    for (const [schoolCode, namespaces] of Object.entries(schoolNs)) {
      const res = await client.query(
        `
        WITH latest_mod AS (
          SELECT DISTINCT ON (btrim(m.pitch_key))
            btrim(m.pitch_key) AS pitch_key,
            NULLIF(btrim(m.new_pitch_type), '') AS new_pitch_type,
            NULLIF(btrim(m.new_pitcher), '') AS new_pitcher
          FROM public.modifications m
          WHERE lower(btrim(COALESCE(m.namespace, ''))) = ANY($2::text[])
            AND COALESCE(m.is_deleted, 0) = 0
            AND NULLIF(btrim(COALESCE(m.pitch_key, '')), '') IS NOT NULL
            AND (
              NULLIF(btrim(COALESCE(m.new_pitch_type, '')), '') IS NOT NULL
              OR NULLIF(btrim(COALESCE(m.new_pitcher, '')), '') IS NOT NULL
            )
          ORDER BY btrim(m.pitch_key), COALESCE(m.modified_at, m.created_at) DESC, m.id DESC
        ),
        updated AS (
          UPDATE public.pitch_events pe
          SET taggedpitchtype = COALESCE(lm.new_pitch_type, pe.taggedpitchtype),
              pitcher = COALESCE(lm.new_pitcher, pe.pitcher)
          FROM latest_mod lm
          WHERE pe.school_code = $1
            AND btrim(COALESCE(pe.pitch_key, '')) = lm.pitch_key
            AND (
              (lm.new_pitch_type IS NOT NULL AND COALESCE(btrim(pe.taggedpitchtype), '') <> lm.new_pitch_type)
              OR (lm.new_pitcher IS NOT NULL AND COALESCE(btrim(pe.pitcher), '') <> lm.new_pitcher)
            )
          RETURNING
            pe.id AS pitch_event_id,
            COALESCE(NULLIF(btrim(pe.taggedpitchtype), ''), 'Undefined') AS pitch_type,
            COALESCE(NULLIF(btrim(pe.pitcher), ''), '') AS pitcher
        ),
        inserted AS (
          INSERT INTO public.pitch_event_edits (school_code, pitch_event_id, pitch_type, pitcher)
          SELECT $1, u.pitch_event_id, u.pitch_type, u.pitcher
          FROM updated u
          ON CONFLICT (school_code, pitch_event_id, pitch_type, pitcher) DO NOTHING
          RETURNING 1
        )
        SELECT
          (SELECT COUNT(*)::int FROM updated) AS updated_rows,
          (SELECT COUNT(*)::int FROM inserted) AS inserted_rows
        `,
        [schoolCode, namespaces]
      );
      summary.push({ school: schoolCode, ...res.rows[0] });
    }

    await client.query("COMMIT");
    console.log(JSON.stringify(summary));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("err", err.message);
  process.exit(1);
});
