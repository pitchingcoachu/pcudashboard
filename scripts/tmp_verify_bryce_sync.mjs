import pg from 'pg';

const connectionString = process.env.DASHBOARD_DATABASE_URL || process.env.DATABASE_URL;
const client = new pg.Client({ connectionString });
await client.connect();
try {
  const raw = await client.query(`
    SELECT session_date::text, pitcher, COUNT(*)::int AS pitches,
           ARRAY_AGG(DISTINCT source_file ORDER BY source_file) AS source_files
    FROM public.pitch_events
    WHERE school_code = 'PCU'
      AND session_date BETWEEN DATE '2026-09-21' AND DATE '2026-09-25'
      AND regexp_replace(lower(COALESCE(pitcher, '')), '[^a-z0-9]', '', 'g') = 'conleybryce'
    GROUP BY session_date, pitcher
    ORDER BY session_date
  `);
  console.log(JSON.stringify({ raw: raw.rows }));
} finally {
  await client.end();
}

const base = String(process.env.DASHBOARD_API_BASE_URL || '').replace(/\/+$/, '');
const params = new URLSearchParams({
  school_code: 'PCU',
  start_date: '2026-09-21',
  end_date: '2026-09-25',
  pitcher: 'Conley, Bryce',
  team_type: 'PCU',
  session_type: 'Bullpen',
  table_mode: 'Stuff',
  split_by: 'Date',
  include_chart_points: 'false',
  include_row_pitches: 'false',
  include_trend_rows: 'false',
  post_edit_refresh: 'true',
});
const response = await fetch(`${base}/v1/pitching/overview?${params}`);
const body = await response.json();
console.log(JSON.stringify({
  live_status: response.status,
  rows: (body.table_rows || []).map((row) => ({ date: row.Date, pitches: row['#'] })),
  detail: body.detail,
}));
