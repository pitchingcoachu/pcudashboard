import { config } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
config({ path: resolve(process.cwd(), '.env.local') });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = process.env.DASHBOARD_DATABASE_URL ?? '';

import { Pool } from 'pg';
import { createHash } from 'node:crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/);
  const headers = lines[0]?.split(',').map((h) => h.trim().replace(/^"|"$/g, '')) ?? [];
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  }).filter((row) => Object.values(row).some(Boolean));
}

async function main() {
  const path = '/Users/jaredgaynor/Documents/GitHub/pcudashboard/trackman files/04/Pitching_2026-06-04T193307_verified.csv';
  const text = readFileSync(path, 'utf-8');
  const rows = parseCsv(text);
  console.log(`Parsed ${rows.length} rows`);

  // Ensure pitch_events table has the columns we need
  const client = await pool.connect();
  try {
    let inserted = 0;
    let skipped = 0;
    for (const row of rows) {
      const pitchUid = row['PitchUID']?.trim();
      if (!pitchUid) continue;

      // Check if already exists
      const exists = await client.query('SELECT 1 FROM pitch_events WHERE pitch_key = $1 AND school_code = $2 LIMIT 1', [pitchUid, 'PCU']);
      if (exists.rows.length > 0) { skipped++; continue; }

      const sessionDate = row['Date']?.trim() || null;
      const pitcher = row['Pitcher']?.trim() || null;
      const relspeed = row['RelSpeed']?.trim() || null;
      const taggedPitchType = row['TaggedPitchType']?.trim() || null;
      const time = row['Time']?.trim() || null;
      const pitcherThrows = row['PitcherThrows']?.trim() || null;
      const inducedVertBreak = row['InducedVertBreak']?.trim() || null;
      const horzBreak = row['HorzBreak']?.trim() || null;
      const spinRate = row['SpinRate']?.trim() || null;
      const extension = row['Extension']?.trim() || null;
      const relHeight = row['RelHeight']?.trim() || null;
      const relSide = row['RelSide']?.trim() || null;
      const plateLocHeight = row['PlateLocHeight']?.trim() || null;
      const plateLocSide = row['PlateLocSide']?.trim() || null;
      const vertApprAngle = row['VertApprAngle']?.trim() || null;
      const horzApprAngle = row['HorzApprAngle']?.trim() || null;
      const pitchCall = row['PitchCall']?.trim() || null;
      const batter = row['Batter']?.trim() || null;
      const balls = row['Balls']?.trim() || null;
      const strikes = row['Strikes']?.trim() || null;
      const customLabel = row['CustomLabel']?.trim() || null;

      // Generate file_id from source file hash
      const fileHash = createHash('sha256').update(path).digest('hex').slice(0, 16);
      const fileIdRes = await client.query(
        `INSERT INTO pitch_event_files (school_code, source_file, file_checksum, file_mtime, row_count)
         VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT (school_code, source_file) DO UPDATE SET row_count = EXCLUDED.row_count
         RETURNING file_id`,
        ['PCU', 'Pitching_2026-06-04T193307_verified.csv', fileHash, rows.length]
      ).catch(() => ({ rows: [{ file_id: 1 }] }));
      const fileId = fileIdRes.rows[0]?.file_id ?? 1;

      await client.query(
        `INSERT INTO pitch_events (school_code, file_id, session_date, session_type, source_file, pitch_key,
           pitcher, pitcherthrows, relspeed, taggedpitchtype, time, inducedvertbreak, horzbreak,
           spinrate, extension, relheight, relside, platelocheight, platelocside,
           vertapprangle, horzapprangle, pitchcall, batter, balls, strikes, customlabel)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         ON CONFLICT DO NOTHING`,
        ['PCU', fileId, sessionDate, 'Live', 'Pitching_2026-06-04T193307_verified.csv', pitchUid,
         pitcher, pitcherThrows, relspeed || null, taggedPitchType || null, time || null,
         inducedVertBreak || null, horzBreak || null, spinRate || null, extension || null,
         relHeight || null, relSide || null, plateLocHeight || null, plateLocSide || null,
         vertApprAngle || null, horzApprAngle || null, pitchCall || null, batter || null,
         balls || null, strikes || null, customLabel]
      );
      inserted++;
    }
    console.log(`Done. Inserted: ${inserted}, Skipped (already exist): ${skipped}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
