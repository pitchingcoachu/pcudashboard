import { config } from 'dotenv';
import { resolve, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

config({ path: resolve(process.cwd(), '.env.local') });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = process.env.DASHBOARD_DATABASE_URL ?? '';
process.env.DB_QUERY_TIMEOUT_MS = process.env.DB_QUERY_TIMEOUT_MS || '120000';
process.env.DB_STATEMENT_TIMEOUT_MS = process.env.DB_STATEMENT_TIMEOUT_MS || '120000';

const { saveAllPitchRows, saveSinglePitchPoints } = await import('../lib/biomechanics-db');

const ORG_ID = 1;
const SCHOOL_CODE = 'PCU';

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/);
  const headers = lines[0]?.split(',').map((h) => h.trim().replace(/^"|"$/g, '')) ?? [];
  return lines
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] ?? '';
      });
      return row;
    })
    .filter((row) => Object.values(row).some(Boolean));
}

async function main() {
  const allPitchDir = '/Users/jaredgaynor/Documents/GitHub/pcudashboard/Axioforce/All pitch CSVs/6:12';
  const singlePitchDir = '/Users/jaredgaynor/Documents/GitHub/pcudashboard/Axioforce/Single Pitch CSVs/6:12';

  const allPitchFiles = readdirSync(allPitchDir).filter((fileName) => fileName.endsWith('.csv')).sort();
  console.log(`Found ${allPitchFiles.length} all-pitch CSV(s)`);
  for (const fileName of allPitchFiles) {
    const csvContent = readFileSync(join(allPitchDir, fileName), 'utf-8');
    const rows = parseCsv(csvContent);
    console.log(`  Ingesting: ${fileName} (${rows.length} rows)`);
    const result = await saveAllPitchRows({
      organizationId: ORG_ID,
      schoolCode: SCHOOL_CODE,
      sourceFileName: fileName,
      csvContent,
      rows,
      createdByUserId: null,
    });
    console.log(`  -> Inserted ${result.insertedRows} rows, backfilled ${result.trackmanTimesBackfilled} TrackMan time(s)`);
  }

  const singleFiles = readdirSync(singlePitchDir).filter((fileName) => fileName.endsWith('.csv')).sort();
  console.log(`\nFound ${singleFiles.length} single-pitch CSV(s)`);
  let done = 0;
  let inserted = 0;
  for (const fileName of singleFiles) {
    const csvContent = readFileSync(join(singlePitchDir, fileName), 'utf-8');
    const rows = parseCsv(csvContent);
    const result = await saveSinglePitchPoints({
      organizationId: ORG_ID,
      schoolCode: SCHOOL_CODE,
      sourceFileName: fileName,
      csvContent,
      rows,
      createdByUserId: null,
    });
    inserted += result.insertedRows;
    done += 1;
    if (done % 10 === 0 || done === singleFiles.length) {
      console.log(`  Ingested ${done}/${singleFiles.length} (${inserted} graph rows cached)...`);
    }
  }
  console.log(`\nDone. ${done} single-pitch files ingested, ${inserted} graph rows cached.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
